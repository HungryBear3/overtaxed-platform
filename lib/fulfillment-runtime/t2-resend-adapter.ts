import { trustedPaymentAuthority } from "./payment-authority";
import { neutralDeliveryEnabled } from "@/lib/fulfillment/flag";
/**
 * The real T2 delivery adapter: a plain-code packet handoff over Resend.
 *
 * ## Why a code in the body and not a link
 *
 * The capability IS the authorization. A link that carries it puts it in the
 * recipient's URL bar, in the `Referer` of anything that page loads, in browser
 * history, in every mail client's link-prefetch and safe-browsing scanner, and in
 * whatever proxy sits between. So the message contains two things that are not
 * the same thing: a GENERIC `/packet` URL with no token, no fragment and no order
 * id, and — separately — a short-lived high-entropy code the recipient pastes
 * into that page. The page POSTs it. Nothing with the value in it is ever
 * navigable.
 *
 * ## What this does and does not claim
 *
 * The destination is the address designated at checkout, read server-side from
 * the authoritative order. A request can never supply an alternate destination,
 * and there is no resend endpoint. Possession of the code authorizes download;
 * knowledge of the order id or the email address does not. This does NOT assert
 * that the mailbox was verified or that the recipient owns the property — it is
 * the same trust model the existing purchase confirmation already operates under,
 * made explicit.
 *
 * ## Ordering and honesty about outcomes
 *
 * The delivery orchestrator has already persisted a durable attempt AND proved
 * it was still sendable before this function is entered. Here the order is:
 * re-verify authority against freshly read state → mint the capability (durably
 * bound to THIS attempt, inside one transaction, conditional on the attempt
 * having none) → re-assert the orchestrator's gate one last time → send.
 *
 * That final re-assert is the point of the whole ordering. Minting a credential
 * is real asynchronous work, and the orchestrator's own gate closed before it
 * started. Without a gate AFTER issuance and immediately before the provider
 * call, a refund or a withdrawn flag landing during issuance would still mail a
 * live code. A denial there revokes the unsent code and reports REJECTED — the
 * one thing that is certain is that no bytes reached a provider.
 *
 * A message id back means ACCEPTED — the provider took custody. It never means
 * delivered. A recognized definite provider rejection means REJECTED, and the
 * unsent capability is revoked. Anything else — a timeout, an unrecognized
 * error, a response with neither an id nor an error — is UNKNOWN, which records
 * nothing, leaves the summary unresolved, and is deliberately not retryable.
 *
 * A retry after UNKNOWN cannot re-mint: the attempt already owns a capability
 * and the store refuses. The raw value is not durable, so a "replay" could only
 * ever mail a DIFFERENT code — a second delivery wearing the first one's
 * identity. Refusing is the only honest option.
 */
import "server-only";

import { Resend } from "resend";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DeliverySendOutcome } from "@/lib/fulfillment/delivery-orchestration";
import {
  t2DeliveryAdapterEnabled,
  t2PacketDownloadEnabled,
} from "@/lib/fulfillment/flag";
import { RESEND_PROVIDER } from "@/lib/fulfillment/provider-callbacks";
import { isValidArtifactSha256 } from "@/lib/fulfillment/validation";
import type { T2DeliveryAdapter } from "@/lib/fulfillment-runtime/t2-delivery-orchestrator";
import {
  issueT2PacketCapability,
  type T2PacketIssuanceDeps,
} from "@/lib/fulfillment-runtime/t2-packet-issuance";
import { prismaPacketDownloadStore } from "@/lib/fulfillment-runtime/packet-download-store";

/** Hard ceiling on one provider call. Past it the outcome is UNKNOWN, not failure. */
export const T2_SEND_TIMEOUT_MS = 15_000;

/* ── Configuration ───────────────────────────────────────────────────────── */

export type T2ResendAdapterConfig = {
  apiKey: string;
  from: string;
  /** Absolute origin, no trailing slash. The `/packet` URL is built from it. */
  appOrigin: string;
};

/**
 * A bounded, conservative RFC5321-ish address check.
 *
 * Its job is not to decide deliverability — only the provider can — but to keep
 * anything that is not a single plain address out of a header we construct.
 */
const ADDRESS = /^[^\s<>@",;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

/** `Name <addr@example.com>` or a bare address. Nothing multi-line, nothing multi-valued. */
const FROM_HEADER = /^(?:[^<>\r\n,;]{1,96}<[^\s<>@",;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}>|[^\s<>@",;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})$/;

export type ConfigResolution =
  | { ok: true; config: T2ResendAdapterConfig }
  | { ok: false; missing: string };

/**
 * Resolve the adapter's configuration, or name the first thing that is missing.
 *
 * Fail-closed and complete: every value the adapter needs is required here, so
 * the adapter can never be constructed half-configured and discover it mid-send.
 * The API key is validated for shape only — never logged, never returned, and
 * never echoed into an error.
 */
export function resolveT2ResendAdapterConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConfigResolution {
  if (!t2DeliveryAdapterEnabled(env))
    return { ok: false, missing: "OT_T2_DELIVERY_ADAPTER_ENABLED" };
  // Issuance is part of sending: with the download surface shut there would be
  // nowhere for the code to be redeemed, so mailing one would be a broken promise.
  if (!t2PacketDownloadEnabled(env))
    return { ok: false, missing: "OT_T2_PACKET_DOWNLOAD_ENABLED" };

  const apiKey = env.RESEND_API_KEY ?? "";
  if (apiKey.length < 8 || apiKey.length > 256 || /\s/.test(apiKey))
    return { ok: false, missing: "RESEND_API_KEY" };

  // A dedicated sender variable, falling back to the existing transactional
  // sender identity. Both are validated; neither is trusted for being present.
  const from = (env.OT_T2_DELIVERY_FROM ?? env.RESEND_FROM ?? "").trim();
  if (!FROM_HEADER.test(from))
    return { ok: false, missing: "OT_T2_DELIVERY_FROM" };

  const origin = (env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  // https only, no credentials, no query, no fragment: this string is pasted
  // into a customer-visible message and must be exactly an origin.
  if (!/^https:\/\/[A-Za-z0-9.-]{1,253}(?::\d{2,5})?$/.test(origin))
    return { ok: false, missing: "NEXT_PUBLIC_APP_URL" };

  return { ok: true, config: { apiKey, from, appOrigin: origin } };
}

/* ── Server-side send context ────────────────────────────────────────────── */

/**
 * Everything the adapter needs, read from authoritative state rather than taken
 * from the caller. The recipient in particular is never request-supplied.
 */
export type T2SendContext = {
  recipient: string;
  orderStatus: string;
  orderTier: string;
  fulfillmentOrderId: string;
  fulfillmentKind: string;
  neutralQaApproved?: boolean;
  fulfillmentStatus: string;
  attemptCount: number;
  currentArtifactVersion: number;
  currentArtifactSha256: string;
  attemptProvider: string;
  attemptIdempotencyKey: string;
  attemptCapabilityId: string | null;
};

export interface T2SendContextReader {
  load(input: {
    orderId: string;
    fulfillmentId: string;
    attemptNumber: number;
  }): Promise<T2SendContext | null>;
}

type ContextRow = {
  recipient: string;
  orderStatus: string;
  orderTier: string;
  fulfillmentOrderId: string;
  fulfillmentKind: string;
  neutralQaApproved?: boolean;
  fulfillmentStatus: string;
  attemptCount: number;
  currentArtifactVersion: number;
  currentArtifactSha256: string;
  attemptProvider: string;
  attemptIdempotencyKey: string;
  attemptCapabilityId: string | null;
};

type RawClient = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };

export function createPrismaT2SendContextReader(
  client: RawClient,
): T2SendContextReader {
  return {
    async load(input) {
      // One statement, so every fact is read from one consistent snapshot: an
      // order, its fulfillment, the CURRENT (highest-version) artifact, and the
      // exact attempt. A join that silently lost one of them yields no row, and
      // no row means the adapter refuses rather than sending on partial state.
      const rows = await client.$queryRaw<ContextRow[]>(
        Prisma.sql`
          SELECT o."email" AS "recipient",
                 o."status" AS "orderStatus",
                 o."tier" AS "orderTier",
                 f."order_id" AS "fulfillmentOrderId",
                 f."kind"::text AS "fulfillmentKind",
                 CASE WHEN f."kind"::text='NEUTRAL_RECORDS_REPORT' THEN EXISTS (
                   SELECT 1 FROM "ot_neutral_qa_review" q
                   JOIN "ot_neutral_report_reservation" r ON r."id"=q."reservation_id"
                   WHERE q."fulfillment_id"=f."id" AND q."order_id"=o."id" AND q."status"='APPROVED'
                     AND r."status"='PROMOTED' AND r."superseded_by_sha256" IS NULL
                     AND q."customer_artifact_sha256"=a."artifact_sha256"
                     AND q."artifact_sha256"=r."bundle_sha256"
                     AND q."property_binding_fingerprint"=a."property_binding_fingerprint"
                     AND q."policy_version"=a."template_version"
                 ) ELSE FALSE END AS "neutralQaApproved",
                 f."status"::text AS "fulfillmentStatus",
                 f."attempt_count" AS "attemptCount",
                 a."version" AS "currentArtifactVersion",
                 a."artifact_sha256" AS "currentArtifactSha256",
                 t."provider" AS "attemptProvider",
                 t."idempotency_key" AS "attemptIdempotencyKey",
                 t."download_capability_id" AS "attemptCapabilityId"
          FROM "ot_fulfillment" f
          JOIN "ot_order" o ON o."id" = f."order_id"
          JOIN LATERAL (
            SELECT "version", "artifact_sha256"
            FROM "ot_fulfillment_artifact"
            WHERE "fulfillment_id" = f."id"
            ORDER BY "version" DESC
            LIMIT 1
          ) a ON TRUE
          JOIN "ot_delivery_attempt" t
            ON t."fulfillment_id" = f."id"
           AND t."attempt_number" = ${input.attemptNumber}
          WHERE f."id" = ${input.fulfillmentId}
            AND f."order_id" = ${input.orderId}
            AND ${trustedPaymentAuthority("o")}
        `,
      );
      return rows[0] ?? null;
    },
  };
}

export const prismaT2SendContextReader = createPrismaT2SendContextReader(
  prisma as unknown as RawClient,
);

/* ── Provider seam ───────────────────────────────────────────────────────── */

/**
 * The minimum of the provider SDK this adapter uses, named as an interface so a
 * synthetic acceptance test can supply a fake provider without a network stack
 * and without a credential.
 */
export interface T2MailProvider {
  send(
    message: { from: string; to: string; subject: string; text: string; html: string },
    options: { idempotencyKey: string },
  ): Promise<{ id: string | null; errorName: string | null }>;
}

/**
 * Provider error names that mean the message was DEFINITELY not accepted and
 * retrying this exact call would fail the same way.
 *
 * Everything not on this list — an application error, an internal server error,
 * an unrecognized name, a network failure — is deliberately treated as UNKNOWN.
 * The list is an allowlist for CERTAINTY, not for failure: being unsure must
 * never be upgraded into a confident "not sent".
 */
const DEFINITE_REJECTIONS: ReadonlyMap<string, string> = new Map([
  ["validation_error", "MANUAL_REVIEW"],
  ["missing_required_field", "MANUAL_REVIEW"],
  ["invalid_parameter", "MANUAL_REVIEW"],
  ["invalid_idempotency_key", "MANUAL_REVIEW"],
  ["invalid_from_address", "MANUAL_REVIEW"],
  ["invalid_access", "MANUAL_REVIEW"],
  // Both spellings on purpose: Resend's published error name for this case
  // carries a capital K, and matching only the lowercase form would silently
  // demote a definite credential rejection to UNKNOWN.
  ["invalid_api_Key", "MANUAL_REVIEW"],
  ["invalid_api_key", "MANUAL_REVIEW"],
  ["restricted_api_key", "MANUAL_REVIEW"],
  ["not_found", "MANUAL_REVIEW"],
  ["method_not_allowed", "MANUAL_REVIEW"],
  ["invalid_attachment", "MANUAL_REVIEW"],
  ["invalid_scope", "MANUAL_REVIEW"],
  ["security_error", "MANUAL_REVIEW"],
  ["daily_quota_exceeded", "RATE_LIMITED"],
  ["rate_limit_exceeded", "RATE_LIMITED"],
  ["concurrent_idempotent_requests", "RATE_LIMITED"],
  ["suppressed_recipient", "INVALID_RECIPIENT"],
  ["invalid_to_address", "INVALID_RECIPIENT"],
]);

function resendProvider(config: T2ResendAdapterConfig): T2MailProvider {
  // Constructed per adapter rather than imported from the shared singleton, so
  // nothing here depends on a module that warns about a missing key at import.
  const client = new Resend(config.apiKey);
  return {
    async send(message, options) {
      const response = await client.emails.send(message, {
        idempotencyKey: options.idempotencyKey,
      });
      const id =
        typeof response?.data?.id === "string" ? response.data.id : null;
      const errorName =
        typeof response?.error?.name === "string" ? response.error.name : null;
      // The provider's error MESSAGE is deliberately never read. It can quote the
      // recipient address and the remote SMTP response, and neither may be
      // retained or logged.
      return { id, errorName };
    },
  };
}

/* ── Message ─────────────────────────────────────────────────────────────── */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The outbound message.
 *
 * The URL is generic: `/packet`, nothing else. It carries no token, no query,
 * no fragment, and no order identifier, so forwarding the mail or leaking the
 * URL discloses nothing. The code is printed on its own line as plain text so
 * that no mail client turns it into a link.
 */
export function buildPacketHandoffMessage(input: {
  appOrigin: string;
  code: string;
  expiresAt: string;
}): { subject: string; text: string; html: string } {
  const url = `${input.appOrigin}/packet`;
  const expiresOn = input.expiresAt.slice(0, 10);
  const subject = "Your OverTaxed IL evidence packet is ready to download";
  const text = [
    "Your Cook County assessment evidence packet has been prepared.",
    "",
    `Open ${url} and paste this one-time code:`,
    "",
    input.code,
    "",
    `The code stops working after ${expiresOn}, and after a small number of downloads.`,
    "Save the PDF once you have it.",
    "",
    "We never put this code in a link, and we never ask for it by reply.",
    "If you did not order a packet, you can ignore this message.",
    "",
    "— OverTaxed IL",
  ].join("\n");
  const html = [
    "<p>Your Cook County assessment evidence packet has been prepared.</p>",
    `<p>Open <a href="${escapeHtml(url)}">${escapeHtml(url)}</a> and paste this one-time code:</p>`,
    `<p style="font-family:monospace;font-size:18px;word-break:break-all">${escapeHtml(input.code)}</p>`,
    `<p>The code stops working after ${escapeHtml(expiresOn)}, and after a small number of downloads. Save the PDF once you have it.</p>`,
    "<p>We never put this code in a link, and we never ask for it by reply. If you did not order a packet, you can ignore this message.</p>",
    "<p>— OverTaxed IL</p>",
  ].join("");
  return { subject, text, html };
}

/* ── Adapter ─────────────────────────────────────────────────────────────── */

export type T2ResendAdapterDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  config?: T2ResendAdapterConfig;
  provider?: T2MailProvider;
  reader?: T2SendContextReader;
  issue?: typeof issueT2PacketCapability;
  issuanceDeps?: T2PacketIssuanceDeps;
  revoke?: (input: {
    fulfillmentId: string;
    reasonCode: "SEND_REJECTED";
  }) => Promise<unknown>;
  timeoutMs?: number;
};

const rejected = (reasonCode: string): DeliverySendOutcome => ({
  kind: "REJECTED",
  provider: RESEND_PROVIDER,
  reasonCode,
});
const unknown: DeliverySendOutcome = {
  kind: "UNKNOWN",
  provider: RESEND_PROVIDER,
};

/**
 * Build the adapter, or refuse.
 *
 * Returning null rather than a degraded adapter is the point: the delivery
 * orchestrator makes zero store calls and zero writes when no adapter is
 * supplied, so an unconfigured deployment never manufactures a failed delivery
 * record for a send that was never possible.
 */
export function createT2ResendAdapter(
  deps: T2ResendAdapterDeps = {},
): T2DeliveryAdapter | null {
  let config = deps.config;
  if (!config) {
    const resolved = resolveT2ResendAdapterConfig(deps.env ?? process.env);
    if (!resolved.ok) return null;
    config = resolved.config;
  }
  const settings = config;
  const provider = deps.provider ?? resendProvider(settings);
  const reader = deps.reader ?? prismaT2SendContextReader;
  const issue = deps.issue ?? issueT2PacketCapability;
  const revoke =
    deps.revoke ??
    ((input: { fulfillmentId: string; reasonCode: "SEND_REJECTED" }) =>
      prismaPacketDownloadStore.revoke(input));
  const timeoutMs = deps.timeoutMs ?? T2_SEND_TIMEOUT_MS;

  return {
    provider: RESEND_PROVIDER,
    async send(input) {
      // Re-checked here and not only at construction: a withdrawal between
      // injection and the send must stop the send.
      if (!t2DeliveryAdapterEnabled(deps.env ?? process.env))
        return rejected("MANUAL_REVIEW");

      const context = await reader.load({
        orderId: input.orderId,
        fulfillmentId: input.fulfillmentId,
        attemptNumber: input.attemptNumber,
      });
      // No row means order, fulfillment, artifact or attempt did not line up.
      // Nothing was sent, and the state is not one we may guess about.
      if (!context) return rejected("MANUAL_REVIEW");

      // Every authority fact re-verified against what was just read, not against
      // what the caller passed. Settlement first.
      if (context.orderStatus !== "PAID" || context.orderTier !== "T2")
        return rejected("MANUAL_REVIEW");
      const kindAllowed = context.fulfillmentKind === "T2_APPEAL_EVIDENCE" ||
        (context.fulfillmentKind === "NEUTRAL_RECORDS_REPORT" && neutralDeliveryEnabled(deps.env ?? process.env) && context.neutralQaApproved === true);
      if (context.fulfillmentOrderId !== input.orderId || !kindAllowed)
        return rejected("MANUAL_REVIEW");
      // The attempt this send belongs to must be the current, in-flight one.
      if (
        context.fulfillmentStatus !== "DELIVERY_PENDING" ||
        context.attemptCount !== input.attemptNumber
      )
        return rejected("MANUAL_REVIEW");
      if (
        context.attemptProvider !== RESEND_PROVIDER ||
        context.attemptIdempotencyKey !== input.idempotencyKey
      )
        return rejected("MANUAL_REVIEW");
      // The packet being sent must be EXACTLY the artifact the attempt bound. A
      // newer version means the order is entitled to something else.
      if (
        context.currentArtifactVersion !== input.artifactVersion ||
        !isValidArtifactSha256(context.currentArtifactSha256) ||
        context.currentArtifactSha256 !== input.artifactSha256
      )
        return rejected("MANUAL_REVIEW");

      // A pre-existing capability on this attempt means a send under this exact
      // key already reached the minting stage — so it may already be in flight.
      // UNKNOWN, never REJECTED: claiming "not sent" here could authorize a
      // duplicate later.
      if (context.attemptCapabilityId !== null) return unknown;

      const recipient = context.recipient.trim();
      if (!ADDRESS.test(recipient)) return rejected("INVALID_RECIPIENT");

      const issued = await issue(
        {
          fulfillmentId: input.fulfillmentId,
          attemptNumber: input.attemptNumber,
          provider: RESEND_PROVIDER,
        },
        deps.issuanceDeps ?? {},
      );
      if (!issued.ok) {
        // The one issuance refusal that is ambiguous rather than definite: the
        // attempt already owns a capability, which a concurrent issuer may have
        // just minted and mailed.
        if (issued.blocker === "CAPABILITY_BINDING_MISMATCH") return unknown;
        return rejected("MANUAL_REVIEW");
      }

      const message = buildPacketHandoffMessage({
        appOrigin: settings.appOrigin,
        code: issued.issuance.value,
        expiresAt: issued.issuance.expiresAt,
      });

      // THE LAST THING BEFORE THE PROVIDER CALL.
      //
      // Everything above — the context read, the address check, the issuance
      // transaction — is asynchronous work done after the orchestrator already
      // proved this send was authorized. A refund, a withdrawn flag, property
      // drift, a superseding artifact or a lost lease landing in that window
      // must stop the send, and only a fresh read under the lock can see it.
      // The orchestrator supplies this gate bound to the lease and the exact
      // durable attempt; nothing here can widen it or skip it and still send.
      //
      // A denial is DEFINITE about the one thing that matters: no bytes were
      // handed to a provider, because this runs before the only call that
      // could. It is therefore recorded like every other authority failure the
      // adapter detects before sending — REJECTED, not UNKNOWN — and the code
      // minted moments ago is revoked, because it reached no mailbox.
      const stillSendable = await input.assertSendable();
      if (!stillSendable.ok) {
        await revokeQuietly(revoke, input.fulfillmentId);
        return rejected("MANUAL_REVIEW");
      }

      let result: { id: string | null; errorName: string | null };
      try {
        result = await withTimeout(
          provider.send(
            {
              from: settings.from,
              to: recipient,
              subject: message.subject,
              text: message.text,
              html: message.html,
            },
            // The durable delivery idempotency key, so a provider-side retry of
            // this exact logical send cannot produce a second message.
            { idempotencyKey: input.idempotencyKey },
          ),
          timeoutMs,
        );
      } catch {
        // A throw, an abort, or a timeout. The mail may be in flight. The
        // capability stays LIVE precisely because it may already have arrived.
        return unknown;
      }

      if (result.id !== null && result.id.length > 0) {
        return {
          kind: "ACCEPTED",
          provider: RESEND_PROVIDER,
          providerMessageId: result.id,
        };
      }

      const definite =
        result.errorName === null
          ? undefined
          : DEFINITE_REJECTIONS.get(result.errorName);
      if (definite === undefined) return unknown;

      // Definitely not sent, so the code reached no mailbox and must not stay
      // live. This revokes every LIVE capability for the fulfillment, which is
      // exactly the one just minted: issuance superseded any older credential
      // inside the same transaction that created this one.
      //
      // Best effort by contract: a revocation that fails leaves the capability
      // alive, but the fulfillment is about to become terminal FAILED, which is
      // not a downloadable status, so access ends regardless.
      await revokeQuietly(revoke, input.fulfillmentId);
      return rejected(definite);
    },
  };
}

/**
 * Best effort by contract. A revocation that fails leaves the capability alive,
 * but a definitely-unsent attempt is about to become terminal FAILED, which is
 * not a downloadable status, so access ends regardless. Never rethrown and
 * never logged: the thrown value may carry provider or connection detail.
 */
async function revokeQuietly(
  revoke: (input: {
    fulfillmentId: string;
    reasonCode: "SEND_REJECTED";
  }) => Promise<unknown>,
  fulfillmentId: string,
): Promise<void> {
  try {
    await revoke({ fulfillmentId, reasonCode: "SEND_REJECTED" });
  } catch {
    // Deliberately swallowed; see above.
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("T2_SEND_TIMEOUT")), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}
