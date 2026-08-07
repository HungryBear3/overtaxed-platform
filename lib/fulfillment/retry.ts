/**
 * OT T2 delivery-evidence foundation — retry & regeneration decisions.
 *
 * Two strictly separated decisions:
 *   - `decideDeliverySend`: may we (re)send using the CURRENT artifact? It never
 *     regenerates (`regenerate: false` always) and fails closed on an unresolved
 *     in-flight send to avoid duplicate delivery.
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

/** States from which a fresh delivery attempt is safe (an initial or a retry). */
const SENDABLE_STATUSES: ReadonlySet<OTFulfillmentStatus> = new Set([
  "ARTIFACT_READY",
  "DELAYED",
]);

/** States representing an unresolved in-flight send — never auto-retry (dup caution). */
const UNRESOLVED_STATUSES: ReadonlySet<OTFulfillmentStatus> = new Set([
  "DELIVERY_PENDING",
  "PROVIDER_ACCEPTED",
]);

export function decideDeliverySend(
  input: DeliverySendInput,
): DeliverySendDecision {
  const { status } = input;
  if (status === "DELIVERED")
    return { send: false, reason: "ALREADY_DELIVERED" };
  if (TERMINAL_LOCK_STATUSES.has(status))
    return { send: false, reason: `TERMINAL_${status}` };
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
