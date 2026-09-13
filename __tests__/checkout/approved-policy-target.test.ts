import { APPROVED_UNSIGNED_ELIGIBILITY_TARGET, resolveEligibilityPolicy } from "@/lib/checkout/ot-contract"
import { COOK_COUNTY_OBSERVED_HOLIDAYS_2026, evaluateCheckoutBusinessDayCutoff } from "@/lib/checkout/business-days"
import {
  NON_DIRECTIONAL_RULE_ID,
  SQFT_TOLERANCE,
  YEAR_BUILT_TOLERANCE,
  selectNonDirectionalComparables,
} from "@/lib/fulfillment/t2-comparables"

describe("approved but unsigned A1/B2/C2/D2/E1/F1 target", () => {
  it("pins R2, five comparables, a 30% gap, current-year validation and source-only output", () => {
    expect(APPROVED_UNSIGNED_ELIGIBILITY_TARGET).toMatchObject({
      decision: "A1/B2/C2/D2/E1/F1",
      comparableRule: NON_DIRECTIONAL_RULE_ID,
      evidenceThreshold: { minComparables: 5, minRelativeAssessmentGap: 0.30 },
      currentYearValidationRequired: true,
      artifact: "source-packet-only",
      signed: false,
    })
    expect(SQFT_TOLERANCE).toBe(0.15)
    expect(YEAR_BUILT_TOLERANCE).toBe(10)
    expect(resolveEligibilityPolicy("A1-B2-C2-D2-E1-F1")).toEqual({
      signed: false, version: null, reason: "eligibility_policy_unsigned",
    })
  })

  it("selects every and only same-neighborhood/class/subtype R2 qualifier", () => {
    const subject = { pin: "10000000000000", neighborhoodCode: "N1", propertyClass: "203", residentialSubtype: "single", buildingSqft: 1000, yearBuilt: 1950 }
    const row = (pin: string, buildingSqft: number, yearBuilt: number, neighborhoodCode = "N1") => ({ ...subject, pin, buildingSqft, yearBuilt, neighborhoodCode })
    const result = selectNonDirectionalComparables(subject, [
      row("10000000000001", 850, 1940), row("10000000000002", 1150, 1960),
      row("10000000000003", 849, 1950), row("10000000000004", 1151, 1950),
      row("10000000000005", 1000, 1939), row("10000000000006", 1000, 1961),
      row("10000000000007", 1000, 1950, "N2"),
    ])!
    expect(result.accepted.map(row => row.pin)).toEqual(["10000000000001", "10000000000002"])
  })

  it("uses Cook County observed holidays by default", () => {
    expect(COOK_COUNTY_OBSERVED_HOLIDAYS_2026).toContain("2026-07-03")
    expect(evaluateCheckoutBusinessDayCutoff({
      now: new Date("2026-07-01T17:00:00Z"), closeDate: "2026-07-06",
    })).toMatchObject({ allowed: false, businessDaysRemaining: 2 })
  })

  it("fails closed when any cutoff date falls outside the approved 2026 calendar", () => {
    expect(evaluateCheckoutBusinessDayCutoff({
      now: new Date("2026-12-30T18:00:00Z"), closeDate: "2027-01-06",
    })).toMatchObject({ allowed: false, reason: "unsupported_holiday_calendar" })
    expect(evaluateCheckoutBusinessDayCutoff({
      now: new Date("2027-01-04T18:00:00Z"), closeDate: "2027-01-08",
    })).toMatchObject({ allowed: false, reason: "unsupported_holiday_calendar" })
  })
})
