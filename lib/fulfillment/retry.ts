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
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types"
import { TERMINAL_LOCK_STATUSES } from "@/lib/fulfillment/types"

export type DeliverySendInput = {
  status: OTFulfillmentStatus
  attemptCount: number
  maxAttempts: number
}

export type DeliverySendDecision =
  | { send: true; attemptNumber: number; regenerate: false }
  | { send: false; reason: string }

/** States from which a fresh delivery attempt is safe (an initial or a retry). */
const SENDABLE_STATUSES: ReadonlySet<OTFulfillmentStatus> = new Set(["ARTIFACT_READY", "DELAYED"])

/** States representing an unresolved in-flight send — never auto-retry (dup caution). */
const UNRESOLVED_STATUSES: ReadonlySet<OTFulfillmentStatus> = new Set(["DELIVERY_PENDING", "PROVIDER_ACCEPTED"])

export function decideDeliverySend(input: DeliverySendInput): DeliverySendDecision {
  const { status } = input
  if (status === "DELIVERED") return { send: false, reason: "ALREADY_DELIVERED" }
  if (TERMINAL_LOCK_STATUSES.has(status)) return { send: false, reason: `TERMINAL_${status}` }
  if (UNRESOLVED_STATUSES.has(status)) return { send: false, reason: "UNRESOLVED_SEND" }
  if (!SENDABLE_STATUSES.has(status)) return { send: false, reason: "NOT_SENDABLE" }

  // Counters must be well-formed BEFORE any attempt number is issued. A malformed
  // attempt count no longer normalizes to zero and authorizes attempt 1.
  if (!Number.isInteger(input.attemptCount) || input.attemptCount < 0) {
    return { send: false, reason: "INVALID_ATTEMPT_COUNT" }
  }
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
    return { send: false, reason: "INVALID_MAX_ATTEMPTS" }
  }
  if (input.attemptCount >= input.maxAttempts) return { send: false, reason: "MAX_ATTEMPTS" }

  return { send: true, attemptNumber: input.attemptCount + 1, regenerate: false }
}

export type RegenerationInput = {
  status: OTFulfillmentStatus
  hasArtifact: boolean
  artifactValid: boolean
  currentArtifactVersion: number
  explicitRequest: boolean
}

export type RegenerationDecision =
  | { regenerate: true; nextArtifactVersion: number; createsDeliveryAttempt: false }
  | { regenerate: false; reason: string }

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
])

export function decideRegeneration(input: RegenerationInput): RegenerationDecision {
  if (TERMINAL_LOCK_STATUSES.has(input.status)) return { regenerate: false, reason: `TERMINAL_${input.status}` }
  if (!REGENERABLE_STATUSES.has(input.status)) return { regenerate: false, reason: "STATUS_NOT_REGENERABLE" }

  // Version must be a non-negative integer AND consistent with artifact presence.
  const version = input.currentArtifactVersion
  if (!Number.isInteger(version) || version < 0) return { regenerate: false, reason: "INVALID_ARTIFACT_VERSION" }
  if (input.hasArtifact && version < 1) return { regenerate: false, reason: "INCONSISTENT_ARTIFACT_STATE" }
  if (!input.hasArtifact && version !== 0) return { regenerate: false, reason: "INCONSISTENT_ARTIFACT_STATE" }

  const needsArtifact = !input.hasArtifact || !input.artifactValid
  if (needsArtifact || input.explicitRequest) {
    // Strictly greater than the current version — never an existing/lower version.
    return { regenerate: true, nextArtifactVersion: version + 1, createsDeliveryAttempt: false }
  }
  return { regenerate: false, reason: "NOT_NEEDED" }
}
