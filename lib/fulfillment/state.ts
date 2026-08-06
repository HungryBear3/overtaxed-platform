/**
 * OT T2 delivery-evidence foundation — state machine & append-only event folding.
 *
 * Pure and database-free. Two concerns:
 *   1. `canTransition` / `ALLOWED_TRANSITIONS` — the allowed monotonic status
 *      edges, used to model (not perform) admin/worker transitions.
 *   2. `foldDeliveryEvent` / `foldDeliveryEvents` — deterministic folding of an
 *      append-only provider-event log into the summary status. Folding is
 *      idempotent (duplicate provider event ids are ignored), monotonic
 *      (out-of-order/stale events never regress), and terminal-safe (a bounced /
 *      complained / cancelled / failed state is never resurrected).
 *
 * Provider "accepted" is never treated as "delivered". A delivery retry is not
 * modeled here as regeneration (see retry.ts).
 */
import type { OTDeliveryEventType, OTFulfillmentStatus } from "@/lib/fulfillment/types"
import { TERMINAL_LOCK_STATUSES } from "@/lib/fulfillment/types"

/** Allowed status→status edges. Terminal-lock states have no outgoing edges. */
export const ALLOWED_TRANSITIONS: Readonly<Record<OTFulfillmentStatus, readonly OTFulfillmentStatus[]>> = {
  NOT_STARTED: ["INELIGIBLE", "INCOMPLETE_INPUT", "ARTIFACT_PENDING", "NEEDS_RECONCILIATION", "MANUAL_REVIEW", "CANCELLED"],
  NEEDS_RECONCILIATION: ["ARTIFACT_PENDING", "INELIGIBLE", "MANUAL_REVIEW", "CANCELLED"],
  INELIGIBLE: [],
  INCOMPLETE_INPUT: ["ARTIFACT_PENDING", "MANUAL_REVIEW", "INELIGIBLE", "CANCELLED"],
  MANUAL_REVIEW: ["ARTIFACT_PENDING", "INELIGIBLE", "CANCELLED"],
  // ARTIFACT_PENDING as a target of ARTIFACT_READY / DELAYED models regeneration.
  ARTIFACT_PENDING: ["ARTIFACT_READY", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  ARTIFACT_READY: ["DELIVERY_PENDING", "ARTIFACT_PENDING", "MANUAL_REVIEW", "CANCELLED"],
  DELIVERY_PENDING: ["PROVIDER_ACCEPTED", "DELIVERED", "DELAYED", "BOUNCED", "COMPLAINED", "FAILED"],
  PROVIDER_ACCEPTED: ["DELIVERED", "DELAYED", "BOUNCED", "COMPLAINED", "FAILED"],
  // DELIVERY_PENDING as a target of DELAYED models a safe delivery retry.
  DELAYED: ["PROVIDER_ACCEPTED", "DELIVERED", "DELIVERY_PENDING", "ARTIFACT_PENDING", "BOUNCED", "COMPLAINED", "FAILED"],
  DELIVERED: ["COMPLAINED"],
  BOUNCED: [],
  COMPLAINED: [],
  FAILED: [],
  CANCELLED: [],
}

export function canTransition(from: OTFulfillmentStatus, to: OTFulfillmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * The status a provider event would move the fulfillment to, or null if the event
 * does not apply (already terminal-locked, not-yet-delivering, or a no-op). This
 * is the authority for "accepted ≠ delivered" and terminal-resurrection safety.
 */
export function nextStatusForEvent(
  status: OTFulfillmentStatus,
  eventType: OTDeliveryEventType
): OTFulfillmentStatus | null {
  if (TERMINAL_LOCK_STATUSES.has(status)) return null
  switch (status) {
    case "ARTIFACT_READY":
      return eventType === "REQUESTED" ? "DELIVERY_PENDING" : null
    case "DELIVERY_PENDING":
      switch (eventType) {
        case "ACCEPTED":
          return "PROVIDER_ACCEPTED"
        case "DELIVERED":
          return "DELIVERED"
        case "DELAYED":
          return "DELAYED"
        case "BOUNCED":
          return "BOUNCED"
        case "COMPLAINED":
          return "COMPLAINED"
        case "FAILED":
          return "FAILED"
        default:
          return null
      }
    case "PROVIDER_ACCEPTED":
      switch (eventType) {
        case "DELIVERED":
          return "DELIVERED"
        case "DELAYED":
          return "DELAYED"
        case "BOUNCED":
          return "BOUNCED"
        case "COMPLAINED":
          return "COMPLAINED"
        case "FAILED":
          return "FAILED"
        default:
          return null
      }
    case "DELAYED":
      switch (eventType) {
        case "ACCEPTED":
          return "PROVIDER_ACCEPTED"
        case "DELIVERED":
          return "DELIVERED"
        case "BOUNCED":
          return "BOUNCED"
        case "COMPLAINED":
          return "COMPLAINED"
        case "FAILED":
          return "FAILED"
        default:
          return null
      }
    case "DELIVERED":
      // A confirmed delivery may still be superseded by a later complaint, but
      // never regressed by a delayed/bounced signal.
      return eventType === "COMPLAINED" ? "COMPLAINED" : null
    default:
      // NOT_STARTED, NEEDS_RECONCILIATION, INCOMPLETE_INPUT, MANUAL_REVIEW,
      // ARTIFACT_PENDING: no send has occurred, so provider events do not apply.
      return null
  }
}

export type DeliveryEvent = {
  providerEventId: string
  eventType: OTDeliveryEventType
  sequence: number
  occurredAt: string
}

export type FoldState = {
  status: OTFulfillmentStatus
  statusRevision: number
  lastSequence: number | null
  lastOccurredAt: string | null
  seenEventIds: readonly string[]
}

export type FoldStepResult = {
  state: FoldState
  applied: boolean
  reason: string | null
}

export function initialFoldState(status: OTFulfillmentStatus): FoldState {
  return { status, statusRevision: 0, lastSequence: null, lastOccurredAt: null, seenEventIds: [] }
}

/**
 * Fold a single provider event into the state. Never throws. Duplicate event ids
 * are ignored; stale/out-of-order events (sequence ≤ last folded sequence) are
 * ignored; non-applicable events advance the ordering pointer but not the status.
 */
export function foldDeliveryEvent(state: FoldState, event: DeliveryEvent): FoldStepResult {
  if (state.seenEventIds.includes(event.providerEventId)) {
    return { state, applied: false, reason: "DUPLICATE_EVENT" }
  }
  const seenEventIds = [...state.seenEventIds, event.providerEventId]

  if (state.lastSequence !== null && event.sequence <= state.lastSequence) {
    // Stale / out-of-order: record that we saw it, but never regress.
    return { state: { ...state, seenEventIds }, applied: false, reason: "OUT_OF_ORDER" }
  }

  const next = nextStatusForEvent(state.status, event.eventType)
  const base: FoldState = {
    ...state,
    lastSequence: event.sequence,
    lastOccurredAt: event.occurredAt,
    seenEventIds,
  }
  if (next === null) {
    return { state: base, applied: false, reason: "NOT_APPLICABLE" }
  }
  return {
    state: { ...base, status: next, statusRevision: state.statusRevision + 1 },
    applied: true,
    reason: null,
  }
}

/**
 * Fold an append-only event log deterministically. Events are ordered by their
 * monotonic sequence first so the final status is independent of arrival order.
 * This is the canonical status derivation: callers must fold the full event set
 * through this function rather than deriving status from ad-hoc streaming replay,
 * which is arrival-order sensitive for non-terminal states by design.
 */
export function foldDeliveryEvents(initial: FoldState, events: readonly DeliveryEvent[]): FoldState {
  const ordered = [...events].sort((a, b) =>
    a.sequence === b.sequence ? a.occurredAt.localeCompare(b.occurredAt) : a.sequence - b.sequence
  )
  let state = initial
  for (const event of ordered) {
    state = foldDeliveryEvent(state, event).state
  }
  return state
}

/** Delivery attempts are numbered monotonically from 1. Regeneration never calls this. */
export function nextDeliveryAttemptNumber(currentAttemptCount: number): number {
  const n = Number.isInteger(currentAttemptCount) && currentAttemptCount > 0 ? currentAttemptCount : 0
  return n + 1
}
