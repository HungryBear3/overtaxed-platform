/**
 * OT T2 delivery-evidence foundation — retry & regeneration decisions.
 *
 * Two strictly separated decisions:
 *   - `decideDeliverySend`: may we (re)send using the CURRENT artifact? It never
 *     regenerates (`regenerate: false` always) and fails closed on an unresolved
 *     in-flight send to avoid duplicate delivery. A provider DELAY is one of
 *     those in-flight states, not a retry cue — see [[UNRESOLVED_STATUSES]].
 *   - `decideRegeneration`: should we produce a NEW artifact version? It never
 *     creates or sends a delivery attempt (`createsDeliveryAttempt: false`).
 *
 * A delivery retry is not a regeneration; a regeneration is not a send.
 */
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types";
import { TERMINAL_LOCK_STATUSES } from "@/lib/fulfillment/types";
import { nextDeliveryAttemptNumber } from "@/lib/fulfillment/state";
import { isPgIntInRange, PG_INT_MAX } from "@/lib/fulfillment/validation";

export type DeliverySendInput = {
  status: OTFulfillmentStatus;
  attemptCount: number;
  maxAttempts: number;
};

export type DeliverySendDecision =
  | { send: true; attemptNumber: number; regenerate: false }
  | { send: false; reason: string };

/**
 * States from which a fresh delivery attempt is safe.
 *
 * Exactly one. A packet that has never been handed to a provider is the only
 * thing this system will send, and every other status either has a message in
 * flight, has a resolved outcome, or has no packet at all.
 */
const SENDABLE_STATUSES: ReadonlySet<OTFulfillmentStatus> = new Set([
  "ARTIFACT_READY",
]);

/**
 * States representing an unresolved in-flight send — never auto-retry (dup caution).
 *
 * DELAYED belongs here, and its absence was a duplicate-delivery defect.
 * DELAYED is only ever reached by an `email.delivery_delayed` provider
 * callback, which means the provider ACCEPTED the message and is still
 * retrying it to the recipient's mail server. It is a report of slowness, not
 * of failure: the original message may well arrive minutes later. Treating it
 * as a safe retry state authorized a SECOND attempt — and a second attempt
 * mints a second capability under a second idempotency key, so the provider's
 * own deduplication cannot suppress it. The customer receives two different
 * codes for one order, the first of which is superseded and dead.
 *
 * A delay resolves the same way every other ambiguity here resolves: by a
 * later provider event, or by an operator who has definite evidence. Never by
 * this function guessing that enough time has passed.
 */
const UNRESOLVED_STATUSES: ReadonlySet<OTFulfillmentStatus> = new Set([
  "DELIVERY_PENDING",
  "PROVIDER_ACCEPTED",
  "DELAYED",
]);

export function decideDeliverySend(
  input: DeliverySendInput,
): DeliverySendDecision {
  const { status } = input;
  if (status === "DELIVERED")
    return { send: false, reason: "ALREADY_DELIVERED" };
  if (TERMINAL_LOCK_STATUSES.has(status))
    return { send: false, reason: `TERMINAL_${status}` };
  // A distinct reason for DELAYED so an operator console can say "the provider
  // is still trying" rather than the less specific "a send is unresolved".
  if (status === "DELAYED")
    return { send: false, reason: "PROVIDER_DELAY_IN_FLIGHT" };
  if (UNRESOLVED_STATUSES.has(status))
    return { send: false, reason: "UNRESOLVED_SEND" };
  if (!SENDABLE_STATUSES.has(status))
    return { send: false, reason: "NOT_SENDABLE" };

  // Counters must be schema-safe integers BEFORE any attempt number is issued.
  // `maxAttempts` cannot authorize a next value beyond the PostgreSQL Int range.
  if (!isPgIntInRange(input.maxAttempts, 1, PG_INT_MAX)) {
    return { send: false, reason: "INVALID_MAX_ATTEMPTS" };
  }
  // `nextDeliveryAttemptNumber` is the single numbering authority; it fails closed
  // on a malformed / out-of-range attempt count instead of normalizing to 1.
  const next = nextDeliveryAttemptNumber(input.attemptCount);
  if (!next.ok) return { send: false, reason: next.reason };
  if (input.attemptCount >= input.maxAttempts)
    return { send: false, reason: "MAX_ATTEMPTS" };

  return { send: true, attemptNumber: next.value, regenerate: false };
}

export type RegenerationInput = {
  status: OTFulfillmentStatus;
  hasArtifact: boolean;
  artifactValid: boolean;
  currentArtifactVersion: number;
  explicitRequest: boolean;
};

export type RegenerationDecision =
  | {
      regenerate: true;
      nextArtifactVersion: number;
      createsDeliveryAttempt: false;
    }
  | { regenerate: false; reason: string };

/**
 * Statuses from which (re)generation is explicitly valid. DELIVERED, the unresolved
 * send states, NOT_STARTED, and every terminal-lock state are excluded, so a
 * regeneration can never be authorized from a state whose transition contract does
 * not support it.
 */
const REGENERABLE_STATUSES: ReadonlySet<OTFulfillmentStatus> = new Set([
  "NEEDS_RECONCILIATION",
  "INCOMPLETE_INPUT",
  "MANUAL_REVIEW",
  "ARTIFACT_PENDING",
  "ARTIFACT_READY",
  "DELAYED",
]);

export function decideRegeneration(
  input: RegenerationInput,
): RegenerationDecision {
  if (TERMINAL_LOCK_STATUSES.has(input.status))
    return { regenerate: false, reason: `TERMINAL_${input.status}` };
  if (!REGENERABLE_STATUSES.has(input.status))
    return { regenerate: false, reason: "STATUS_NOT_REGENERABLE" };

  // Version must be a schema-safe non-negative Int AND consistent with artifact
  // presence. The next version (current + 1) must stay within the PostgreSQL Int
  // range, so a version already at the ceiling cannot authorize a regeneration.
  const version = input.currentArtifactVersion;
  if (!isPgIntInRange(version, 0, PG_INT_MAX - 1))
    return { regenerate: false, reason: "INVALID_ARTIFACT_VERSION" };
  if (input.hasArtifact && version < 1)
    return { regenerate: false, reason: "INCONSISTENT_ARTIFACT_STATE" };
  if (!input.hasArtifact && version !== 0)
    return { regenerate: false, reason: "INCONSISTENT_ARTIFACT_STATE" };

  const needsArtifact = !input.hasArtifact || !input.artifactValid;
  if (needsArtifact || input.explicitRequest) {
    // Strictly greater than the current version — never an existing/lower version.
    return {
      regenerate: true,
      nextArtifactVersion: version + 1,
      createsDeliveryAttempt: false,
    };
  }
  return { regenerate: false, reason: "NOT_NEEDED" };
}
