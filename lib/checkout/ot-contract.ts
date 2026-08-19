import { createHash } from "node:crypto"

import {
  otSnapshotIdentity,
  type CheckoutWindowSnapshot,
} from "@/lib/checkout/window-gate-token"

export const OT_ANALYSIS_ACK_VERSION = "analysis_ack_v1"
export const OT_CHECKOUT_CREATING_LEASE_MS = 10 * 60 * 1000
export const STRIPE_MIN_CHECKOUT_SECONDS = 30 * 60
export const STRIPE_MAX_CHECKOUT_SECONDS = 24 * 60 * 60

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

export function normalizeEmail(value: string): string {
  return normalizeWhitespace(value).toLowerCase()
}

export function normalizedOtAddress(value: string): string {
  return normalizeWhitespace(value).toUpperCase()
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export type OtContractInput = {
  tier: "T2" | "T3"
  email: string
  name: string
  propertyAddress: string
  propertyPin: string
  township: string
  snapshot: CheckoutWindowSnapshot
  noticeEvidence: { date: string | null; address: string | null }
  acknowledgmentEvidence: { acknowledged: boolean; version: string | null }
  priceId: string
  productId: string
  amountCents: number
  currency: string
}

export function buildOtContractKey(input: OtContractInput): string {
  return sha256Hex(canonicalJson({
    tier: input.tier,
    email: normalizeEmail(input.email),
    name: normalizeWhitespace(input.name),
    propertyAddress: normalizedOtAddress(input.propertyAddress),
    propertyPin: input.propertyPin,
    township: input.township,
    // The snapshot IDENTITY, not the snapshot: `freshnessExpiresAt` is anchored
    // to the instant of the request that produced it, so hashing the whole
    // snapshot gave every attempt at the same purchase a different contract
    // key — a new order row per retry and a Stripe idempotency key that
    // deduplicated nothing. See [[otSnapshotIdentity]].
    snapshot: otSnapshotIdentity(input.snapshot),
    noticeEvidence: {
      date: input.noticeEvidence.date,
      address: input.noticeEvidence.address ? normalizedOtAddress(input.noticeEvidence.address) : null,
    },
    acknowledgmentEvidence: input.acknowledgmentEvidence,
    stripe: {
      priceId: input.priceId,
      productId: input.productId,
      amountCents: input.amountCents,
      currency: input.currency.toLowerCase(),
    },
  }))
}

/**
 * Is a persisted checkout snapshot still fresh enough to charge against?
 *
 * This used to be an independent TTL: `OT_WINDOW_FRESHNESS_TTL_HOURS`,
 * defaulting to 48 and settable from the environment, measured against a minted
 * `verifiedAt`. Two things were wrong with that. The frozen default is 24 hours,
 * not 48, and the same-day rule tightens it further inside an open or
 * nearly-open window — so the checkout path was the most permissive freshness
 * authority on the branch, guarding the one operation that takes money. And it
 * was tunable by deployment configuration, which means a filing window could be
 * widened for payments without a code change or an owner decision.
 *
 * The canonical evaluator already applied the 24-hour default, the same-day
 * requirement, and the 900-second serving-age ceiling when it produced
 * `freshnessExpiresAt`. This reads that boundary rather than restating it, so
 * there is exactly one freshness rule and checkout cannot be the loose one.
 *
 * A snapshot with no retrieval or no boundary is not fresh. That is the pending
 * case, and pending fails closed.
 */
export function isWindowSnapshotFresh(
  snapshot: Pick<CheckoutWindowSnapshot, "retrievedAt" | "freshnessExpiresAt">,
  now: Date = new Date(),
) {
  if (!snapshot.retrievedAt || !snapshot.freshnessExpiresAt) return false

  const retrievedAt = new Date(snapshot.retrievedAt)
  const expiresAt = new Date(snapshot.freshnessExpiresAt)
  if (Number.isNaN(retrievedAt.getTime()) || Number.isNaN(expiresAt.getTime())) return false

  // A retrieval stamped in the future is a broken clock or a fabricated
  // timestamp. Either way it is not evidence, and accepting it would make the
  // expiry boundary arbitrarily distant.
  if (retrievedAt.getTime() > now.getTime()) return false

  return now.getTime() <= expiresAt.getTime()
}

/**
 * The eligibility policy in force.
 *
 * OD-2 (paid eligibility criteria) and OD-3 (evidence threshold) are UNSIGNED
 * in the Owner Decision Register. There is therefore no policy that says which
 * properties may be sold a packet, and the honest resolution of the free check
 * is CC-05 — insufficient evidence — with checkout suppressed.
 *
 * The registry below is deliberately empty. It is keyed rather than boolean so
 * that signing is a code change carrying the owner's decision IDs and date, and
 * not something a deployment can switch on: `OT_ELIGIBILITY_POLICY_VERSION`
 * selects among signed policies, it cannot create one. With the registry empty,
 * no value of that variable opens paid eligibility.
 *
 * Nothing here encodes a dollar figure, percentage, comp count, score,
 * probability, or merits threshold. Those are OD-3's content, and OD-3 is
 * exactly what has not been signed.
 */
const SIGNED_ELIGIBILITY_POLICIES: Record<string, SignedEligibilityPolicyEntry> = {}

/**
 * OD-3's content, carried only by a signed entry.
 *
 * The free check cannot say "the evidence appears to support closer review"
 * without a rule for what "supports" means. That rule is a merits threshold, it
 * is OD-3, and it is unsigned — so the field is optional on the signed arm and
 * absent everywhere today. A free check that cannot read one resolves CC-05.
 *
 * It is expressed as a relative assessment gap rather than an estimated dollar
 * saving on purpose: the dollar figure requires a tax rate and an equalizer the
 * public record does not always carry, and the comparison of a subject's
 * assessment level against its comparables is the argument an appeal actually
 * makes.
 */
export interface EvidenceThreshold {
  /**
   * Minimum proportion by which the subject's assessment level must exceed the
   * comparable set's before the evidence is described as supportive. `0.15`
   * means 15% above the comparable level.
   */
  minRelativeAssessmentGap: number
  /** Minimum accepted comparables before any conclusion is drawn. */
  minComparables: number
}

interface SignedEligibilityPolicyEntry {
  ownerDecisions: string[]
  signedAt: string
  evidenceThreshold: EvidenceThreshold
}

export type EligibilityPolicy =
  | {
      signed: true
      version: string
      ownerDecisions: string[]
      signedAt: string
      evidenceThreshold: EvidenceThreshold
    }
  | { signed: false; version: null; reason: "eligibility_policy_unsigned" }

export function resolveEligibilityPolicy(
  requested: string | null = process.env.OT_ELIGIBILITY_POLICY_VERSION?.trim() || null,
): EligibilityPolicy {
  const entry = requested ? SIGNED_ELIGIBILITY_POLICIES[requested] : undefined
  if (!requested || !entry) {
    return { signed: false, version: null, reason: "eligibility_policy_unsigned" }
  }
  return {
    signed: true,
    version: requested,
    ownerDecisions: entry.ownerDecisions,
    signedAt: entry.signedAt,
    evidenceThreshold: entry.evidenceThreshold,
  }
}

/** The version string to bind into a snapshot, or null when none is signed. */
export function signedPolicyVersion(): string | null {
  const policy = resolveEligibilityPolicy()
  return policy.signed ? policy.version : null
}

export function dateKey(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}
