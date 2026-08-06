/**
 * OT T2 delivery-evidence foundation — worker lease decision.
 *
 * Pure decision only: it inspects a lease snapshot and returns whether the lease
 * is claimable / renewable / held / expired / invalid. It performs NO database
 * claim and has no side effects. A later phase performs the atomic claim itself.
 *
 * Fail-closed: a malformed `now`, a malformed expiry, or malformed identities are
 * never claimable/reclaimable/renewable — they return INVALID. Times use the strict
 * canonical UTC instant parser (no permissive `Date.parse`); owners/tokens are
 * bounded single-line opaque values (whitespace/newline/control/over-bound rejected).
 * Renewal requires BOTH a matching owner AND possession of the matching non-empty
 * token. The result exposes a bounded reason code and never echoes raw input.
 */
import {
  isBoundedOpaqueString,
  parseStrictInstant,
} from "@/lib/fulfillment/validation";

export type LeaseSnapshot = {
  owner: string;
  token: string;
  expiresAt: string;
} | null;

export type LeaseInput = {
  lease: LeaseSnapshot;
  now: string;
  requester: string;
  requesterToken?: string;
};

export type LeaseDecisionKind =
  | "CLAIMABLE"
  | "EXPIRED_RECLAIMABLE"
  | "RENEWABLE"
  | "HELD_BY_OTHER"
  | "INVALID";

export type LeaseDecision = {
  decision: LeaseDecisionKind;
  reason: string | null;
};

export function evaluateLease(input: LeaseInput): LeaseDecision {
  // Requester identity and the clock must be well-formed before any decision.
  if (!isBoundedOpaqueString(input.requester))
    return { decision: "INVALID", reason: "INVALID_REQUESTER" };
  const nowMs = parseStrictInstant(input.now);
  if (nowMs === null) return { decision: "INVALID", reason: "INVALID_NOW" };

  const { lease } = input;
  if (lease === null) return { decision: "CLAIMABLE", reason: null };

  // A malformed lease snapshot is NOT reclaimable — fail closed.
  if (
    !isBoundedOpaqueString(lease.owner) ||
    !isBoundedOpaqueString(lease.token)
  ) {
    return { decision: "INVALID", reason: "INVALID_LEASE" };
  }
  const expiresMs = parseStrictInstant(lease.expiresAt);
  if (expiresMs === null)
    return { decision: "INVALID", reason: "INVALID_LEASE_EXPIRY" };

  // Only a valid, at-or-before-now expiry is reclaimable.
  if (expiresMs <= nowMs)
    return { decision: "EXPIRED_RECLAIMABLE", reason: "EXPIRED" };

  // Active lease: renewal requires the requester to both own it and hold a valid
  // matching token. A missing or malformed provided token can never renew.
  const ownedByRequester = lease.owner === input.requester;
  const tokenMatches =
    isBoundedOpaqueString(input.requesterToken) &&
    input.requesterToken === lease.token;
  if (ownedByRequester && tokenMatches)
    return { decision: "RENEWABLE", reason: null };

  return { decision: "HELD_BY_OTHER", reason: "HELD" };
}
