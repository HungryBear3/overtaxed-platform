/**
 * OT T2 delivery-evidence — asynchronous provider callbacks (PURE decision layer).
 *
 * A provider callback is the only evidence that can say a packet was DELIVERED,
 * BOUNCED or COMPLAINED. It is also the only place where attacker-shaped JSON
 * gets within reach of paid-order state, so everything this module does is
 * subtractive: it takes an arbitrary parsed body and returns either a bounded,
 * sanitized, fully-typed event or a bounded refusal code. Nothing from the body
 * survives except values that passed an explicit allowlist.
 *
 * Four properties this module exists to hold.
 *
 * **Nothing here authenticates anything.** Signature verification happens at the
 * route, on the RAW bytes, BEFORE a body is parsed and before this module is
 * called. `providerEventId` is supplied by the caller from the signed envelope
 * (the Svix message id), never read out of the JSON — a body-supplied id would
 * let a forged payload choose its own replay identity.
 *
 * **No correlation tag is ever assumed.** The provider is not required to echo
 * anything we put on the send, and this module never reads a `tags` array. The
 * ONLY correlation is the provider's own message id, which we learn when the
 * send returns. An event that arrives before that binding is therefore genuinely
 * unmatched, and is stored as such rather than guessed onto an order.
 *
 * **Acceptance is never delivery.** `email.sent` maps to ACCEPTED. Only
 * `email.delivered` maps to DELIVERED.
 *
 * **No free text is ever retained.** A bounce message, a recipient address, a
 * subject line and a raw payload all stop here. What survives is an event type,
 * an allowlisted reason code, an opaque message id, and an instant.
 *
 * Pure: no database, no clock, no framework, no I/O. Every refusal is a stable
 * non-PII code and no input is echoed back.
 */
import type { OTDeliveryEventType } from "@/lib/fulfillment/types";
import { TERMINAL_LOCK_STATUSES } from "@/lib/fulfillment/types";
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types";
import { nextStatusForEvent } from "@/lib/fulfillment/state";
import {
  isBoundedOpaqueString,
  isPgIntInRange,
  isValidInstant,
  isValidProviderEventId,
  isValidProviderMessageId,
  isValidProviderName,
  parseProviderInstant,
  parseStrictInstant,
  PG_INT_MAX,
} from "@/lib/fulfillment/validation";

/** The only provider this module normalizes for. */
export const RESEND_PROVIDER = "resend";

/**
 * Upper bound on a callback body, in bytes, enforced by the route before any
 * parse. Resend's transactional event payloads are a few hundred bytes; this is
 * two orders of magnitude of headroom and still refuses a memory-pressure body.
 */
export const MAX_CALLBACK_BODY_BYTES = 64 * 1024;

/**
 * How far a provider-stated `created_at` may sit from the instant we received
 * it before we stop believing it. Past skew is generous because a provider may
 * legitimately retry a day-old event; future skew is tight because an event
 * cannot have happened after it arrived.
 */
export const MAX_CALLBACK_PAST_SKEW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_CALLBACK_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Resend event type → the bounded internal vocabulary.
 *
 * `email.opened` and `email.clicked` are deliberately ABSENT rather than mapped
 * to nothing-in-particular. They are engagement tracking, they say nothing about
 * whether a packet arrived, and admitting them would put a record of when a
 * customer read their mail into paid-order evidence for no evidential gain.
 */
const RESEND_EVENT_TYPES: Readonly<Record<string, OTDeliveryEventType>> = {
  "email.sent": "ACCEPTED",
  "email.delivered": "DELIVERED",
  "email.delivery_delayed": "DELAYED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.failed": "FAILED",
};

/** Engagement events we accept a 200 for and deliberately record nothing about. */
const RESEND_IGNORED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "email.opened",
  "email.clicked",
  "email.scheduled",
]);

/** Bounded, stable, non-PII refusal/disposition vocabulary. */
export type CallbackRefusal =
  | "FLAG_DISABLED"
  | "SECRET_NOT_CONFIGURED"
  | "INVALID_SIGNATURE"
  | "BODY_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_PROVIDER"
  | "INVALID_PROVIDER_EVENT_ID"
  | "UNSUPPORTED_EVENT_TYPE"
  | "IGNORED_EVENT_TYPE"
  | "MISSING_MESSAGE_ID"
  | "INVALID_MESSAGE_ID"
  | "INVALID_TIMESTAMP"
  | "IMPLAUSIBLE_TIMESTAMP";

/** Bounded disposition of an admitted callback. Persisted, so it is a closed set. */
export type CallbackDisposition =
  | "APPLIED"
  | "UNMATCHED"
  | "REFUSED"
  | "DUPLICATE";

export const CALLBACK_DISPOSITIONS: ReadonlySet<string> = new Set<string>([
  "APPLIED",
  "UNMATCHED",
  "REFUSED",
  "DUPLICATE",
]);

/**
 * Why an admitted, well-formed callback was not applied to a fulfillment.
 * Every one of these is recorded, never silently dropped.
 */
export type CallbackNonApplicationCode =
  | "ATTEMPT_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "FULFILLMENT_NOT_FOUND"
  | "INELIGIBLE_SETTLEMENT"
  | "FULFILLMENT_ORDER_MISMATCH"
  | "ATTEMPT_FULFILLMENT_MISMATCH"
  | "ATTEMPT_PROVIDER_MISMATCH"
  | "STALE_ATTEMPT"
  | "ARTIFACT_SUPERSEDED"
  | "NOT_APPLICABLE"
  | "TERMINAL_LOCKED"
  | "UNTRUSTED_CLOCK"
  | "UNMATCHED_STORE_FULL"
  /**
   * One provider message id resolved to more than one delivery attempt.
   *
   * `ot_delivery_attempt` carries a UNIQUE `(provider, provider_message_id)`, so
   * this cannot happen while that index exists — which is exactly why it must be
   * a refusal rather than an unstated assumption. If the index is ever dropped,
   * relaxed, or replaced during a migration, the alternative is picking the
   * first row an unordered query happened to return and folding a provider event
   * onto an arbitrary one of two orders.
   */
  | "AMBIGUOUS_MESSAGE_BINDING";

export const CALLBACK_NON_APPLICATION_CODES: ReadonlySet<string> =
  new Set<string>([
    "ATTEMPT_NOT_FOUND",
    "ORDER_NOT_FOUND",
    "FULFILLMENT_NOT_FOUND",
    "INELIGIBLE_SETTLEMENT",
    "FULFILLMENT_ORDER_MISMATCH",
    "ATTEMPT_FULFILLMENT_MISMATCH",
    "ATTEMPT_PROVIDER_MISMATCH",
    "STALE_ATTEMPT",
    "ARTIFACT_SUPERSEDED",
    "NOT_APPLICABLE",
    "TERMINAL_LOCKED",
    "UNTRUSTED_CLOCK",
    "UNMATCHED_STORE_FULL",
    "AMBIGUOUS_MESSAGE_BINDING",
  ]);

/**
 * A sanitized provider callback. This is the ONLY shape that crosses out of this
 * module, and every field on it has passed an explicit validator. There is no
 * recipient, no subject, no bounce text, and no residual payload.
 */
export type SanitizedProviderCallback = {
  provider: string;
  /** From the SIGNED envelope, never from the body. The replay identity. */
  providerEventId: string;
  /** The provider's own opaque id for the message. The only correlation we have. */
  providerMessageId: string;
  eventType: OTDeliveryEventType;
  /** Allowlisted code, or null when the event carries no reason. */
  reasonCode: string | null;
  /**
   * Strict canonical RFC3339 UTC instant.
   *
   * NORMALIZED, never the provider's own spelling. A provider may legitimately
   * write six fractional digits or a `+00:00` offset; what leaves this module is
   * always `YYYY-MM-DDTHH:MM:SS.mmmZ`, so nothing downstream has to know that.
   */
  occurredAt: string;
};

export type NormalizeCallbackInput = {
  provider: string;
  /** Taken from the signed envelope by the caller. */
  providerEventId: string;
  /** The already-parsed body. Parsing happens after signature verification. */
  body: unknown;
  /** Trusted receive instant, used only for the plausibility window. */
  receivedAt: string;
};

export type NormalizeCallbackResult =
  | { ok: true; event: SanitizedProviderCallback }
  | { ok: false; code: CallbackRefusal };

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

/**
 * Map a provider bounce/complaint shape onto the closed reason-code allowlist.
 *
 * Anything unrecognized becomes null or the generic code — never the provider's
 * own words. A 550 SMTP string, a mailbox name, or a spam-filter explanation
 * cannot reach a database column through here.
 */
function reasonFor(
  eventType: OTDeliveryEventType,
  data: Record<string, unknown>,
): string | null {
  if (eventType === "COMPLAINED") return "SPAM_COMPLAINT";
  if (eventType === "FAILED") return "PROVIDER_ERROR";
  if (eventType !== "BOUNCED") return null;

  const bounce = record(data.bounce);
  const raw =
    (typeof bounce?.type === "string" ? bounce.type : undefined) ??
    (typeof bounce?.subType === "string" ? bounce.subType : undefined) ??
    (typeof data.bounce === "string" ? data.bounce : undefined) ??
    (typeof data.bounce_type === "string" ? data.bounce_type : undefined) ??
    "";
  // Lowercased classification over a bounded prefix only: an enormous or
  // adversarial string cannot drive an expensive scan and cannot be retained.
  const v = raw.slice(0, 64).toLowerCase();
  if (v.includes("hard") || v === "permanent") return "HARD_BOUNCE";
  if (v.includes("soft") || v === "transient") return "SOFT_BOUNCE";
  if (v.includes("suppress")) return "INVALID_RECIPIENT";
  if (v.includes("full")) return "MAILBOX_FULL";
  // A bounce whose class we cannot name is still a bounce. UNKNOWN is honest;
  // guessing HARD would suppress a recipient on evidence we do not have.
  return "UNKNOWN";
}

/**
 * Turn an arbitrary parsed callback body into a sanitized event, or refuse.
 *
 * The body is treated as hostile throughout: every read is type-checked, every
 * retained value is validated, and nothing is coerced into validity.
 */
export function normalizeProviderCallback(
  input: NormalizeCallbackInput,
): NormalizeCallbackResult {
  if (!isValidProviderName(input.provider))
    return { ok: false, code: "INVALID_PROVIDER" };
  if (!isValidProviderEventId(input.providerEventId))
    return { ok: false, code: "INVALID_PROVIDER_EVENT_ID" };

  const body = record(input.body);
  if (!body) return { ok: false, code: "INVALID_JSON" };

  const rawType = body.type;
  if (typeof rawType !== "string")
    return { ok: false, code: "UNSUPPORTED_EVENT_TYPE" };
  if (RESEND_IGNORED_EVENT_TYPES.has(rawType))
    return { ok: false, code: "IGNORED_EVENT_TYPE" };
  const eventType = RESEND_EVENT_TYPES[rawType];
  if (eventType === undefined)
    return { ok: false, code: "UNSUPPORTED_EVENT_TYPE" };

  const data = record(body.data);
  if (!data) return { ok: false, code: "INVALID_JSON" };

  // `email_id` is Resend's own identifier for the message. `id` is accepted as
  // its documented alias. Neither is trusted for correlation on its own — the
  // binding to an attempt is verified separately, under a lock.
  const messageId =
    typeof data.email_id === "string"
      ? data.email_id
      : typeof data.id === "string"
        ? data.id
        : null;
  if (messageId === null) return { ok: false, code: "MISSING_MESSAGE_ID" };
  if (!isValidProviderMessageId(messageId))
    return { ok: false, code: "INVALID_MESSAGE_ID" };

  // `created_at` is the PROVIDER's spelling of the instant, not ours, so it is
  // parsed with the wider RFC3339 grammar and normalized once — deliberately,
  // by [[parseProviderInstant]], and never by handing the string to `Date`.
  //
  // This is the difference between refusing and admitting a real
  // `email.delivered`: Resend documents six fractional digits and a `+00:00`
  // offset on its timestamps, and the strict canonical validator — correct for
  // instants this system itself renders — accepts neither. What crosses out of
  // here is always the canonical form, so every downstream comparison, column
  // and event row still sees exactly one timestamp shape.
  const stated = parseProviderInstant(body.created_at);
  if (stated === null) return { ok: false, code: "INVALID_TIMESTAMP" };
  // `receivedAt` is ours, so it is held to the strict rule.
  const receivedMs = parseStrictInstant(input.receivedAt);
  if (receivedMs === null) return { ok: false, code: "INVALID_TIMESTAMP" };
  if (
    stated.epochMs > receivedMs + MAX_CALLBACK_FUTURE_SKEW_MS ||
    stated.epochMs < receivedMs - MAX_CALLBACK_PAST_SKEW_MS
  ) {
    return { ok: false, code: "IMPLAUSIBLE_TIMESTAMP" };
  }

  return {
    ok: true,
    event: {
      provider: input.provider,
      providerEventId: input.providerEventId,
      providerMessageId: messageId,
      eventType,
      reasonCode: reasonFor(eventType, data),
      occurredAt: stated.canonical,
    },
  };
}

/* ── Application decision ────────────────────────────────────────────────── */

export type CallbackOrderRow = {
  id: string;
  tier: string;
  status: string;
};

export type CallbackFulfillmentRow = {
  id: string;
  orderId: string;
  kind: string;
  status: OTFulfillmentStatus | string;
  statusRevision: number;
  attemptCount: number;
};

export type CallbackAttemptRow = {
  fulfillmentId: string;
  attemptNumber: number;
  provider: string;
  artifactVersion: number;
};

export type CallbackApplicationInput = {
  event: SanitizedProviderCallback;
  order: CallbackOrderRow | null;
  fulfillment: CallbackFulfillmentRow | null;
  attempt: CallbackAttemptRow | null;
  /** Highest bound artifact version for this fulfillment, read under the lock. */
  currentArtifactVersion: number | null;
  trustedNow: string;
};

export type CallbackApplicationPlan = {
  fulfillmentId: string;
  attemptNumber: number;
  eventType: OTDeliveryEventType;
  reasonCode: string | null;
  occurredAt: string;
  fromStatus: OTFulfillmentStatus;
  nextStatus: OTFulfillmentStatus;
  expectedStatusRevision: number;
  /**
   * Whether this outcome ends customer access. True exactly for the terminal
   * lock states a live capability must not survive.
   */
  revokesCapabilities: boolean;
};

export type CallbackApplicationDecision =
  | { ok: true; plan: CallbackApplicationPlan }
  | { ok: false; code: CallbackNonApplicationCode };

/**
 * Decide whether a sanitized callback may advance this fulfillment.
 *
 * Every check is against state the caller read fresh under the authoritative
 * order lock. The status edge itself is delegated to [[nextStatusForEvent]], the
 * single existing fold authority, so "accepted is not delivered" and
 * "terminal states are never resurrected" are not restated here and cannot
 * drift from the rest of the system.
 */
export function decideCallbackApplication(
  input: CallbackApplicationInput,
): CallbackApplicationDecision {
  if (!isValidInstant(input.trustedNow))
    return { ok: false, code: "UNTRUSTED_CLOCK" };
  if (!isValidInstant(input.event.occurredAt))
    return { ok: false, code: "UNTRUSTED_CLOCK" };

  const attempt = input.attempt;
  if (!attempt) return { ok: false, code: "ATTEMPT_NOT_FOUND" };
  const order = input.order;
  if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
  const fulfillment = input.fulfillment;
  if (!fulfillment) return { ok: false, code: "FULFILLMENT_NOT_FOUND" };

  if (fulfillment.orderId !== order.id)
    return { ok: false, code: "FULFILLMENT_ORDER_MISMATCH" };
  if (fulfillment.kind !== "T2_APPEAL_EVIDENCE")
    return { ok: false, code: "FULFILLMENT_NOT_FOUND" };
  if (attempt.fulfillmentId !== fulfillment.id)
    return { ok: false, code: "ATTEMPT_FULFILLMENT_MISMATCH" };
  // The provider that reports must be the provider that was sent through. A
  // "resend" event can never resolve an attempt recorded against another sender.
  if (attempt.provider !== input.event.provider)
    return { ok: false, code: "ATTEMPT_PROVIDER_MISMATCH" };

  // Settlement is re-read, not remembered. A refunded or disputed order stops
  // accepting evidence into its summary; the callback is still RECORDED by the
  // caller, so the event is never silently lost — it is simply not applied.
  if (String(order.tier ?? "").trim() !== "T2")
    return { ok: false, code: "INELIGIBLE_SETTLEMENT" };
  if (String(order.status ?? "").trim() !== "PAID")
    return { ok: false, code: "INELIGIBLE_SETTLEMENT" };

  // Only the CURRENT attempt may move the summary. A late event about attempt 1
  // cannot rewrite the status attempt 2 is living in.
  if (!isPgIntInRange(fulfillment.attemptCount, 1, PG_INT_MAX))
    return { ok: false, code: "STALE_ATTEMPT" };
  if (attempt.attemptNumber !== fulfillment.attemptCount)
    return { ok: false, code: "STALE_ATTEMPT" };

  // The attempt must still describe the current packet. A newer artifact version
  // means what was sent is no longer what the order is entitled to.
  if (
    input.currentArtifactVersion === null ||
    attempt.artifactVersion !== input.currentArtifactVersion
  ) {
    return { ok: false, code: "ARTIFACT_SUPERSEDED" };
  }

  // A revision that cannot be advanced within the PostgreSQL Int range is a row
  // we cannot act on. NOT_APPLICABLE rather than a clock code, so the recorded
  // disposition says what is actually true about it.
  if (!isPgIntInRange(fulfillment.statusRevision, 0, PG_INT_MAX - 1))
    return { ok: false, code: "NOT_APPLICABLE" };

  const fromStatus = fulfillment.status as OTFulfillmentStatus;
  if (TERMINAL_LOCK_STATUSES.has(fromStatus))
    return { ok: false, code: "TERMINAL_LOCKED" };

  const nextStatus = nextStatusForEvent(fromStatus, input.event.eventType);
  if (nextStatus === null) return { ok: false, code: "NOT_APPLICABLE" };

  return {
    ok: true,
    plan: {
      fulfillmentId: fulfillment.id,
      attemptNumber: attempt.attemptNumber,
      eventType: input.event.eventType,
      reasonCode: input.event.reasonCode,
      occurredAt: input.event.occurredAt,
      fromStatus,
      nextStatus,
      expectedStatusRevision: fulfillment.statusRevision,
      revokesCapabilities: TERMINAL_LOCK_STATUSES.has(nextStatus),
    },
  };
}

/**
 * True when a stored unmatched callback is still worth attempting to reconcile.
 *
 * Bounded in both directions on purpose: an unresolved row is retained long
 * enough to cover a realistic send/callback race and an operator's response
 * time, and no longer. Beyond the window it stays on record as evidence but is
 * no longer replayed, so reconciliation work cannot grow without limit.
 */
export const UNMATCHED_RECONCILIATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard ceiling on durable unresolved unmatched callbacks. */
export const MAX_UNMATCHED_CALLBACKS = 1000;

/** Ceiling on how many stored callbacks one reconciliation pass may replay. */
export const MAX_RECONCILIATION_BATCH = 50;

/**
 * Ceiling on how many times one stored callback may be replayed, ever.
 *
 * The column's own CHECK bounds it at 1000, and the claim that begins a replay
 * is a compare-and-set on this counter. A counter pinned AT the ceiling would
 * satisfy its own compare-and-set forever — two concurrent reconcilers would
 * both "win" the same row — so the claim requires strictly less than this and a
 * row that reaches it stops being offered for replay at all. It keeps its
 * evidence; it simply stops costing work.
 */
export const MAX_CALLBACK_REPLAYS = 1000;

export function isReconcilable(input: {
  receivedAt: string;
  trustedNow: string;
}): boolean {
  const received = parseStrictInstant(input.receivedAt);
  const now = parseStrictInstant(input.trustedNow);
  if (received === null || now === null) return false;
  return now - received <= UNMATCHED_RECONCILIATION_WINDOW_MS && now >= received;
}

/** Bounded opaque identifier guard reused by the callback stores. */
export function isBoundedIdentifier(value: unknown): boolean {
  return isBoundedOpaqueString(value, 128);
}
