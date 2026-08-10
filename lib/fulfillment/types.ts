/**
 * OT T2 delivery-evidence foundation — shared state language (Phase 1, additive).
 *
 * This module is the single source of truth for the fulfillment state vocabulary
 * that the durable schema (prisma) and the pure helpers share. It is framework-
 * free and database-free. It defines *distinctions* only — it performs no work,
 * no writes, and no side effects.
 *
 * Design contract (from the accepted OT Fulfillment Evidence Console V2 state
 * reference — a state-language reference only, not source ported here):
 *   - artifact regeneration is distinct from delivery retry;
 *   - provider "accepted" is distinct from "delivered";
 *   - an unresolved send is distinct from a safe retry;
 *   - terminal bounced / complained / cancelled / failed states are never
 *     resurrected by a later provider event.
 *
 * Checkout success never implies fulfillment. Historical PAID is never inferred
 * as packet-generated, provider-accepted, or delivered.
 */

/** The only fulfillment kind modeled in Phase 1. T3/T4 remain manual. */
export type OTFulfillmentKind = "T2_APPEAL_EVIDENCE"

/**
 * Coarse per-order fulfillment status. Fine-grained provider signals live on the
 * append-only event log; this summary status is folded monotonically from them.
 */
export type OTFulfillmentStatus =
  | "NOT_STARTED"
  | "NEEDS_RECONCILIATION"
  | "INELIGIBLE"
  | "INCOMPLETE_INPUT"
  | "MANUAL_REVIEW"
  | "ARTIFACT_PENDING"
  | "ARTIFACT_READY"
  | "DELIVERY_PENDING"
  | "PROVIDER_ACCEPTED"
  | "DELIVERED"
  | "DELAYED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED"
  | "CANCELLED"

export const FULFILLMENT_STATUSES: readonly OTFulfillmentStatus[] = [
  "NOT_STARTED",
  "NEEDS_RECONCILIATION",
  "INELIGIBLE",
  "INCOMPLETE_INPUT",
  "MANUAL_REVIEW",
  "ARTIFACT_PENDING",
  "ARTIFACT_READY",
  "DELIVERY_PENDING",
  "PROVIDER_ACCEPTED",
  "DELIVERED",
  "DELAYED",
  "BOUNCED",
  "COMPLAINED",
  "FAILED",
  "CANCELLED",
]

/**
 * Hard-terminal states: once entered, no provider event may move the fulfillment
 * out of them. Note DELIVERED is intentionally NOT in this set — a post-delivery
 * COMPLAINED signal may still supersede a delivered success (see state.ts).
 */
export const TERMINAL_LOCK_STATUSES: ReadonlySet<OTFulfillmentStatus> = new Set([
  "BOUNCED",
  "COMPLAINED",
  "CANCELLED",
  "FAILED",
  "INELIGIBLE",
])

/** Normalized provider delivery-event vocabulary (payload-free). */
export type OTDeliveryEventType =
  | "REQUESTED"
  | "ACCEPTED"
  | "DELIVERED"
  | "DELAYED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED"

/** Explicit T2 eligibility outcomes — every non-eligible case is named. */
export type T2EligibilityOutcome =
  | "ELIGIBLE"
  | "INCOMPLETE_INPUT"
  | "INELIGIBLE_NOT_T2"
  | "INELIGIBLE_T3_MANUAL"
  | "INELIGIBLE_UNKNOWN_TIER"
  | "INELIGIBLE_UNPAID"
  | "INELIGIBLE_RECOVERY_REQUIRED"
  | "INELIGIBLE_REFUNDED"
  | "INELIGIBLE_DISPUTED"
  | "INELIGIBLE_CANCELLED"

/**
 * Bounded, non-PII reason/error codes. Deliberately a small closed allowlist so
 * that no free-form provider text, address, or exception string can ever be
 * persisted as a "reason".
 */
export const REASON_CODES: ReadonlySet<string> = new Set([
  "HARD_BOUNCE",
  "SOFT_BOUNCE",
  "SPAM_COMPLAINT",
  "MAILBOX_FULL",
  "INVALID_RECIPIENT",
  "RATE_LIMITED",
  "GENERATION_FAILED",
  "STORAGE_FAILED",
  "PROVIDER_ERROR",
  "TIMEOUT",
  "INCOMPLETE_INPUT",
  "MANUAL_REVIEW",
  "UNKNOWN",
])

/** Upper bound on a persisted artifact's byte size (defensive validation only). */
export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024

/**
 * Whether a bound artifact's stored property-binding fingerprint still agrees with
 * the authoritative order it claims to describe.
 *
 * This is the ONLY property-binding fact that may cross into a read model. The
 * comparison is performed server-side against the current order; neither the PIN,
 * the address, the stored fingerprint, nor the expected fingerprint travels with it.
 *
 *   ABSENT       no fingerprint recorded — the normal shape of a pre-Slice-2 row,
 *                silent and non-tainting
 *   MATCHES      recomputed fingerprint equals the stored one
 *   DRIFTED      well-formed fingerprint that does NOT describe this order's property
 *   MALFORMED    stored value is not a well-formed fingerprint
 *   UNVERIFIABLE the current order lacks the property inputs needed to compare
 */
export type PropertyBindingState =
  | "ABSENT"
  | "MATCHES"
  | "DRIFTED"
  | "MALFORMED"
  | "UNVERIFIABLE"

/** Property-binding states that make a bound artifact untrustworthy. */
export const UNTRUSTED_PROPERTY_BINDING_STATES: ReadonlySet<PropertyBindingState> =
  new Set<PropertyBindingState>(["DRIFTED", "MALFORMED", "UNVERIFIABLE"])
