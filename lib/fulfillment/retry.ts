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
import { nextDeliveryAttemptNumber } from "@/lib/fulfillment/state"

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

  const attemptCount = Number.isInteger(input.attemptCount) && input.attemptCount > 0 ? input.attemptCount : 0
  // Fail closed on a malformed ceiling (NaN/undefined/<1) rather than sending.
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || attemptCount >= input.maxAttempts) {
    return { send: false, reason: "MAX_ATTEMPTS" }
  }

  return { send: true, attemptNumber: nextDeliveryAttemptNumber(attemptCount), regenerate: false }
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

export function decideRegeneration(input: RegenerationInput): RegenerationDecision {
  if (TERMINAL_LOCK_STATUSES.has(input.status)) return { regenerate: false, reason: `TERMINAL_${input.status}` }

  const current = Number.isInteger(input.currentArtifactVersion) && input.currentArtifactVersion > 0
    ? input.currentArtifactVersion
    : 0
  const needsArtifact = !input.hasArtifact || !input.artifactValid
  if (needsArtifact || input.explicitRequest) {
    return { regenerate: true, nextArtifactVersion: current + 1, createsDeliveryAttempt: false }
  }
  return { regenerate: false, reason: "NOT_NEEDED" }
}
