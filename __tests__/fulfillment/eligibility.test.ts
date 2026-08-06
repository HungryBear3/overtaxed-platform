/**
 * @jest-environment node
 *
 * Matrix rows 2 & 3: T2 eligibility fails closed for every non-eligible case,
 * and historical paid orders classify as NEEDS_RECONCILIATION — never delivered.
 */
import {
  evaluateT2Eligibility,
  classifyHistoricalOrder,
} from "@/lib/fulfillment/eligibility"

const paidT2 = { tier: "T2", status: "PAID", hasRequiredInputs: true }

describe("evaluateT2Eligibility", () => {
  it("ELIGIBLE only for paid T2 with complete inputs → initial ARTIFACT_PENDING", () => {
    const r = evaluateT2Eligibility(paidT2)
    expect(r.outcome).toBe("ELIGIBLE")
    expect(r.eligible).toBe(true)
    expect(r.initialStatus).toBe("ARTIFACT_PENDING")
  })

  it("paid T2 missing required inputs → INCOMPLETE_INPUT (boundary, not eligible)", () => {
    const r = evaluateT2Eligibility({ ...paidT2, hasRequiredInputs: false })
    expect(r.outcome).toBe("INCOMPLETE_INPUT")
    expect(r.eligible).toBe(false)
    expect(r.initialStatus).toBe("INCOMPLETE_INPUT")
  })

  it("T3 is manual and ineligible for automatic kickoff", () => {
    const r = evaluateT2Eligibility({ ...paidT2, tier: "T3" })
    expect(r.outcome).toBe("INELIGIBLE_T3_MANUAL")
    expect(r.eligible).toBe(false)
    expect(r.initialStatus).toBe("INELIGIBLE")
  })

  it("T4 is manual/ineligible", () => {
    expect(evaluateT2Eligibility({ ...paidT2, tier: "T4" }).outcome).toBe("INELIGIBLE_T3_MANUAL")
  })

  it("T1 is not a T2 order", () => {
    expect(evaluateT2Eligibility({ ...paidT2, tier: "T1" }).outcome).toBe("INELIGIBLE_NOT_T2")
  })

  it("unknown / unrecognized tier fails closed as UNKNOWN_TIER", () => {
    expect(evaluateT2Eligibility({ ...paidT2, tier: "COMPS_ONLY" }).outcome).toBe("INELIGIBLE_UNKNOWN_TIER")
    expect(evaluateT2Eligibility({ ...paidT2, tier: "" }).outcome).toBe("INELIGIBLE_UNKNOWN_TIER")
    expect(evaluateT2Eligibility({ ...paidT2, tier: "t2x" }).outcome).toBe("INELIGIBLE_UNKNOWN_TIER")
  })

  it("unpaid statuses fail closed (never inferred paid)", () => {
    for (const status of ["PENDING", "CHECKOUT_CREATED", "NOTICE_REVIEW_REQUIRED", "WHATEVER"]) {
      const r = evaluateT2Eligibility({ ...paidT2, status })
      expect(r.outcome).toBe("INELIGIBLE_UNPAID")
      expect(r.eligible).toBe(false)
    }
  })

  it("recovery-required is a distinct ineligible outcome", () => {
    expect(evaluateT2Eligibility({ ...paidT2, status: "PAID_RECOVERY_REQUIRED" }).outcome).toBe(
      "INELIGIBLE_RECOVERY_REQUIRED"
    )
  })

  it("refunded / disputed / cancelled are distinct ineligible outcomes and override PAID", () => {
    expect(evaluateT2Eligibility({ ...paidT2, status: "REFUNDED" }).outcome).toBe("INELIGIBLE_REFUNDED")
    expect(evaluateT2Eligibility({ ...paidT2, status: "CANCELLED" }).outcome).toBe("INELIGIBLE_CANCELLED")
    expect(evaluateT2Eligibility({ ...paidT2, refunded: true }).outcome).toBe("INELIGIBLE_REFUNDED")
    expect(evaluateT2Eligibility({ ...paidT2, disputed: true }).outcome).toBe("INELIGIBLE_DISPUTED")
  })

  it("never returns DELIVERED as an initial status for any input", () => {
    for (const tier of ["T1", "T2", "T3", "T4", "X"]) {
      for (const status of ["PAID", "PENDING", "REFUNDED", "CANCELLED", "PAID_RECOVERY_REQUIRED"]) {
        expect(evaluateT2Eligibility({ tier, status, hasRequiredInputs: true }).initialStatus).not.toBe("DELIVERED")
      }
    }
  })
})

describe("classifyHistoricalOrder", () => {
  it("historical paid order with no fulfillment → NEEDS_RECONCILIATION (not delivered)", () => {
    expect(classifyHistoricalOrder({ status: "PAID", amountPaid: 149, hasFulfillment: false })).toBe(
      "NEEDS_RECONCILIATION"
    )
    expect(classifyHistoricalOrder({ status: "PAID_RECOVERY_REQUIRED", amountPaid: 0, hasFulfillment: false })).toBe(
      "NEEDS_RECONCILIATION"
    )
    expect(classifyHistoricalOrder({ status: "CHECKOUT_CREATED", amountPaid: 149, hasFulfillment: false })).toBe(
      "NEEDS_RECONCILIATION"
    )
  })

  it("historical unpaid order → NOT_STARTED", () => {
    expect(classifyHistoricalOrder({ status: "PENDING", amountPaid: 0, hasFulfillment: false })).toBe("NOT_STARTED")
    expect(classifyHistoricalOrder({ status: "CHECKOUT_CREATED", amountPaid: 0, hasFulfillment: false })).toBe(
      "NOT_STARTED"
    )
  })

  it("never classifies a historical row as DELIVERED", () => {
    for (const status of ["PAID", "PAID_RECOVERY_REQUIRED", "PENDING", "REFUNDED", "CANCELLED"]) {
      for (const amountPaid of [0, 149]) {
        expect(classifyHistoricalOrder({ status, amountPaid, hasFulfillment: false })).not.toBe("DELIVERED")
      }
    }
  })
})
