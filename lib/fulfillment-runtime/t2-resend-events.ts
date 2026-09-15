/**
 * Signed ingestion of Resend delivery callbacks for paid T2 packets.
 *
 * This is deliberately NOT the outreach verifier. That one is allowed to run
 * without a secret outside production and carries a legacy raw-HMAC fallback,
 * which is a reasonable posture for campaign telemetry and an unacceptable one
 * for evidence about a paid order. Here:
 *
 *   - the secret is REQUIRED in every environment, development and test
 *     included. Absent, malformed, or too short, and the endpoint behaves as if
 *     it is not configured. There is no "skip verification locally" path;
 *   - only Svix signatures are accepted. There is no raw-HMAC fallback, so a
 *     legacy signing scheme cannot be used to bypass the strict path;
 *   - verification runs on the RAW bytes, before any JSON parse, so nothing a
 *     parser does can change what was signed;
 *   - the body is size-bounded before it is read as text;
 *   - the replay identity is the SIGNED envelope id, never a body field, so a
 *     forged payload cannot choose its own dedup key;
 *   - the timestamp is checked independently of the library, so a stale replay
 *     is refused by this code and not only by a dependency's default tolerance.
 *
 * Everything admitted is then sanitized by the pure layer and handed to the
 * store, which records it before it changes anything.
 */
import "server-only";

import { Webhook as SvixWebhook } from "svix";
import { t2DeliveryCallbackEnabled } from "@/lib/fulfillment/flag";
import {
  MAX_CALLBACK_BODY_BYTES,
  normalizeProviderCallback,
  RESEND_PROVIDER,
  type CallbackRefusal,
  type SanitizedProviderCallback,
} from "@/lib/fulfillment/provider-callbacks";
import { isValidProviderEventId } from "@/lib/fulfillment/validation";
import {
  prismaProviderCallbackStore,
  type CallbackIngestResult,
  type ProviderCallbackStore,
} from "@/lib/fulfillment-runtime/provider-callback-store";

/** Environment variable holding the T2 callback secret. Distinct from outreach. */
export const OT_T2_RESEND_WEBHOOK_SECRET = "OT_T2_RESEND_WEBHOOK_SECRET";

/**
 * Maximum age of a signed envelope we will accept, in milliseconds.
 *
 * Svix applies its own tolerance; this is an independent check so the property
 * is owned by this repository and provable by its tests rather than inherited
 * from a dependency's default.
 */
export const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

export type CallbackHeaders = Readonly<Record<string, string | null>>;

export type T2CallbackIngestOutcome =
  | { ok: false; code: CallbackRefusal }
  | { ok: true; result: CallbackIngestResult };

export type T2CallbackDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  store?: ProviderCallbackStore;
  now?: () => Date;
  /** Injected only so a test can drive verification without a real secret. */
  verify?: (input: {
    rawBody: string;
    headers: { "svix-id": string; "svix-timestamp": string; "svix-signature": string };
    secret: string;
  }) => boolean;
};

function header(headers: CallbackHeaders, ...names: string[]): string {
  for (const name of names) {
    const value = headers[name];
    if (typeof value === "string" && value.length > 0 && value.length <= 1024)
      return value;
  }
  return "";
}

/**
 * The configured secret, or null.
 *
 * Shape-checked only, and never returned to a caller that would log it. A value
 * that is obviously not a signing secret is treated as absent, so a placeholder
 * left in an environment file fails closed instead of silently accepting
 * nothing.
 */
export function getT2CallbackSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const secret = (env[OT_T2_RESEND_WEBHOOK_SECRET] ?? "").trim();
  if (secret.length < 16 || secret.length > 256) return null;
  if (/\s/.test(secret)) return null;
  return secret;
}

function verifyWithSvix(input: {
  rawBody: string;
  headers: { "svix-id": string; "svix-timestamp": string; "svix-signature": string };
  secret: string;
}): boolean {
  try {
    new SvixWebhook(input.secret).verify(input.rawBody, input.headers);
    return true;
  } catch {
    // The thrown value names the failure mode and is deliberately not read: a
    // caller that distinguishes "bad signature" from "stale timestamp" hands an
    // attacker an oracle.
    return false;
  }
}

/**
 * Verify and admit one signed callback.
 *
 * Returns a bounded refusal code or the store's outcome. No input is echoed,
 * nothing from the body reaches a log, and the refusal codes are deliberately
 * coarse at the transport layer above this.
 */
export async function ingestT2ResendCallback(
  input: { rawBody: string; headers: CallbackHeaders },
  deps: T2CallbackDeps = {},
): Promise<T2CallbackIngestOutcome> {
  const env = deps.env ?? process.env;
  if (!t2DeliveryCallbackEnabled(env)) return { ok: false, code: "FLAG_DISABLED" };

  const secret = getT2CallbackSecret(env);
  // Fail closed in EVERY environment. There is no development exception.
  if (secret === null) return { ok: false, code: "SECRET_NOT_CONFIGURED" };

  // Byte length, not code-unit length: a multi-byte body must be measured the
  // way the transport measured it.
  if (Buffer.byteLength(input.rawBody, "utf8") > MAX_CALLBACK_BODY_BYTES)
    return { ok: false, code: "BODY_TOO_LARGE" };

  const svixId = header(input.headers, "svix-id", "webhook-id");
  const svixTimestamp = header(input.headers, "svix-timestamp", "webhook-timestamp");
  const svixSignature = header(input.headers, "svix-signature", "webhook-signature");
  if (!svixId || !svixTimestamp || !svixSignature)
    return { ok: false, code: "INVALID_SIGNATURE" };

  const now = deps.now?.() ?? new Date();
  // Independent staleness check on the signed timestamp, before the library's.
  const seconds = Number(svixTimestamp);
  if (!Number.isSafeInteger(seconds) || seconds <= 0)
    return { ok: false, code: "INVALID_SIGNATURE" };
  const ageMs = now.getTime() - seconds * 1000;
  if (ageMs > MAX_SIGNATURE_AGE_MS || ageMs < -MAX_SIGNATURE_AGE_MS)
    return { ok: false, code: "INVALID_SIGNATURE" };

  const verify = deps.verify ?? verifyWithSvix;
  const verified = verify({
    rawBody: input.rawBody,
    headers: {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    },
    secret,
  });
  if (!verified) return { ok: false, code: "INVALID_SIGNATURE" };

  // The replay identity comes from the envelope the signature covers. Svix
  // reuses one message id across its retries, so a retry of the same logical
  // delivery dedups; two distinct deliveries never share one.
  if (!isValidProviderEventId(svixId))
    return { ok: false, code: "INVALID_PROVIDER_EVENT_ID" };

  // Only now, after the bytes are proven, is the body parsed.
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, code: "INVALID_JSON" };
  }

  const normalized = normalizeProviderCallback({
    provider: RESEND_PROVIDER,
    providerEventId: svixId,
    body,
    receivedAt: now.toISOString(),
  });
  if (!normalized.ok) return { ok: false, code: normalized.code };

  const store = deps.store ?? prismaProviderCallbackStore;
  return { ok: true, result: await store.ingest(normalized.event) };
}

/**
 * Reconcile stored unmatched callbacks once a send has bound its message id.
 *
 * This is the other half of the send/callback race. It is called immediately
 * after an accepted send records its message id, and is also reachable from the
 * bounded operator recovery control. It never sends, never mints, and never
 * regenerates — it only re-offers evidence we already hold to a binding that now
 * exists.
 */
export async function reconcileT2ResendCallbacks(
  input: { providerMessageId: string },
  deps: T2CallbackDeps = {},
): Promise<{ examined: number; applied: number; stillUnmatched: number }> {
  const store = deps.store ?? prismaProviderCallbackStore;
  return store.reconcile({
    provider: RESEND_PROVIDER,
    providerMessageId: input.providerMessageId,
  });
}

export type { SanitizedProviderCallback };
