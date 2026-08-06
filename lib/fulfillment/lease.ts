/**
 * OT T2 delivery-evidence foundation — worker lease decision.
 *
 * Pure decision only: it inspects a lease snapshot and returns whether the lease
 * is claimable / renewable / held / expired. It performs NO database claim and
 * has no side effects. A later phase performs the atomic claim itself.
 */

export type LeaseSnapshot = { owner: string; token: string; expiresAt: string } | null

export type LeaseInput = {
  lease: LeaseSnapshot
  now: string
  requester: string
  requesterToken?: string
}

export type LeaseDecisionKind = "CLAIMABLE" | "EXPIRED_RECLAIMABLE" | "RENEWABLE" | "HELD_BY_OTHER"

export type LeaseDecision = { decision: LeaseDecisionKind; owner: string | null }

/**
 * Decide the lease status. An absent lease is CLAIMABLE. A lease whose expiry is
 * at-or-before `now` is EXPIRED_RECLAIMABLE (stale — anyone may reclaim). An
 * active lease owned by the requester (with a matching token when supplied) is
 * RENEWABLE; otherwise it is HELD_BY_OTHER.
 */
export function evaluateLease(input: LeaseInput): LeaseDecision {
  const { lease } = input
  if (lease === null) return { decision: "CLAIMABLE", owner: null }

  const nowMs = Date.parse(input.now)
  const expiresMs = Date.parse(lease.expiresAt)
  const expired = Number.isNaN(expiresMs) ? true : expiresMs <= (Number.isNaN(nowMs) ? expiresMs + 1 : nowMs)
  if (expired) return { decision: "EXPIRED_RECLAIMABLE", owner: lease.owner }

  const ownedByRequester = lease.owner === input.requester
  const tokenMatches = input.requesterToken === undefined || input.requesterToken === lease.token
  if (ownedByRequester && tokenMatches) return { decision: "RENEWABLE", owner: lease.owner }

  return { decision: "HELD_BY_OTHER", owner: lease.owner }
}
