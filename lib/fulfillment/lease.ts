/**
 * OT T2 delivery-evidence foundation — worker lease decision.
 *
 * Pure decision only: it inspects a lease snapshot and returns whether the lease
 * is claimable / renewable / held / expired / invalid. It performs NO database
 * claim and has no side effects. A later phase performs the atomic claim itself.
 *
 * Fail-closed: a malformed `now`, a malformed expiry, or malformed identities are
 * never claimable/reclaimable/renewable — they return INVALID. Renewal requires
 * BOTH a matching owner AND possession of the matching non-empty token. The result
 * exposes a bounded reason code and never echoes raw input (owner/token/times).
 */

export type LeaseSnapshot = { owner: string; token: string; expiresAt: string } | null

export type LeaseInput = {
  lease: LeaseSnapshot
  now: string
  requester: string
  requesterToken?: string
}

export type LeaseDecisionKind =
  | "CLAIMABLE"
  | "EXPIRED_RECLAIMABLE"
  | "RENEWABLE"
  | "HELD_BY_OTHER"
  | "INVALID"

export type LeaseDecision = { decision: LeaseDecisionKind; reason: string | null }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

export function evaluateLease(input: LeaseInput): LeaseDecision {
  // Requester identity and the clock must be well-formed before any decision.
  if (!isNonEmptyString(input.requester)) return { decision: "INVALID", reason: "INVALID_REQUESTER" }
  const nowMs = parseInstant(input.now)
  if (nowMs === null) return { decision: "INVALID", reason: "INVALID_NOW" }

  const { lease } = input
  if (lease === null) return { decision: "CLAIMABLE", reason: null }

  // A malformed lease snapshot is NOT reclaimable — fail closed.
  if (!isNonEmptyString(lease.owner) || !isNonEmptyString(lease.token)) {
    return { decision: "INVALID", reason: "INVALID_LEASE" }
  }
  const expiresMs = parseInstant(lease.expiresAt)
  if (expiresMs === null) return { decision: "INVALID", reason: "INVALID_LEASE_EXPIRY" }

  // Only a valid, at-or-before-now expiry is reclaimable.
  if (expiresMs <= nowMs) return { decision: "EXPIRED_RECLAIMABLE", reason: "EXPIRED" }

  // Active lease: renewal requires the requester to both own it and hold the token.
  const ownedByRequester = lease.owner === input.requester
  const tokenMatches = isNonEmptyString(input.requesterToken) && input.requesterToken === lease.token
  if (ownedByRequester && tokenMatches) return { decision: "RENEWABLE", reason: null }

  return { decision: "HELD_BY_OTHER", reason: "HELD" }
}
