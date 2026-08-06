/**
 * OT T2 delivery-evidence foundation — eligibility & historical classification.
 *
 * Pure, fail-closed decision functions. They never read a database and never
 * infer delivery. Only an exact paid T2 order with complete inputs is ELIGIBLE;
 * every other case maps to an explicit, named ineligible/boundary outcome.
 */
import type { OTFulfillmentStatus, T2EligibilityOutcome } from "@/lib/fulfillment/types"

/** Recognized OT order tiers. Anything outside this set fails closed. */
const KNOWN_TIERS: ReadonlySet<string> = new Set(["T1", "T2", "T3", "T4"])

export type OTOrderEligibilityInput = {
  tier: string
  status: string
  hasRequiredInputs: boolean
  refunded?: boolean
  disputed?: boolean
}

export type T2EligibilityResult = {
  outcome: T2EligibilityOutcome
  eligible: boolean
  initialStatus: OTFulfillmentStatus
}

function statusFor(outcome: T2EligibilityOutcome): OTFulfillmentStatus {
  if (outcome === "ELIGIBLE") return "ARTIFACT_PENDING"
  if (outcome === "INCOMPLETE_INPUT") return "INCOMPLETE_INPUT"
  return "INELIGIBLE"
}

function result(outcome: T2EligibilityOutcome): T2EligibilityResult {
  return { outcome, eligible: outcome === "ELIGIBLE", initialStatus: statusFor(outcome) }
}

/**
 * Decide whether an OT order is eligible for automatic T2 fulfillment-evidence
 * kickoff. Fail-closed: unknown tiers and unknown/unpaid statuses are ineligible,
 * and a refund/dispute overrides a PAID status.
 */
export function evaluateT2Eligibility(input: OTOrderEligibilityInput): T2EligibilityResult {
  const tier = String(input.tier ?? "").trim()
  if (!KNOWN_TIERS.has(tier)) return result("INELIGIBLE_UNKNOWN_TIER")
  if (tier === "T1") return result("INELIGIBLE_NOT_T2")
  if (tier === "T3" || tier === "T4") return result("INELIGIBLE_T3_MANUAL")

  // tier === "T2" from here.
  if (input.refunded === true) return result("INELIGIBLE_REFUNDED")
  if (input.disputed === true) return result("INELIGIBLE_DISPUTED")

  switch (String(input.status ?? "").trim()) {
    case "REFUNDED":
      return result("INELIGIBLE_REFUNDED")
    case "CANCELLED":
      return result("INELIGIBLE_CANCELLED")
    case "PAID_RECOVERY_REQUIRED":
      return result("INELIGIBLE_RECOVERY_REQUIRED")
    case "PAID":
      return result(input.hasRequiredInputs ? "ELIGIBLE" : "INCOMPLETE_INPUT")
    default:
      // PENDING, CHECKOUT_CREATED, NOTICE_REVIEW_REQUIRED, or anything unknown:
      // never inferred as paid.
      return result("INELIGIBLE_UNPAID")
  }
}

export type HistoricalOrderInput = {
  status: string
  amountPaid: number
  hasFulfillment: boolean
}

const PAID_STATUSES: ReadonlySet<string> = new Set(["PAID", "PAID_RECOVERY_REQUIRED"])

/**
 * Classify an existing order that has no fulfillment record. A historical paid
 * order must surface as NEEDS_RECONCILIATION (checkout success ≠ delivery); it is
 * never classified as DELIVERED. Unpaid history is simply NOT_STARTED.
 */
export function classifyHistoricalOrder(input: HistoricalOrderInput): OTFulfillmentStatus {
  if (input.hasFulfillment) return "NOT_STARTED"
  const paid = PAID_STATUSES.has(String(input.status ?? "").trim()) || Number(input.amountPaid) > 0
  return paid ? "NEEDS_RECONCILIATION" : "NOT_STARTED"
}
