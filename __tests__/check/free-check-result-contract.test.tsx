/**
 * @jest-environment jsdom
 */
import React from "react"
import { render, screen } from "@testing-library/react"

import { FreeCheckResult, type Result, type ResultOutcome } from "@/components/check/FreeCheckResult"
import { CC_02, CC_03, CC_04, CC_05, CC_06, CC_07 } from "@/lib/copy/canonical"

/**
 * The four-state contract on `/check`.
 *
 * This surface had no test. It was the last consumer still deciding the
 * result for itself: a hard-coded `MEANINGFUL_SAVINGS_THRESHOLD = 100`
 * rendered "Estimated savings $X/year", an "Est. overpayment" card, and
 * "An appeal could lower your taxes — and a win in 2026 locks in savings
 * through 2029" above a "Start Your Appeal" button. The 52-route acceptance
 * corpus does not cover `/check`, so none of it was caught.
 */

const OUTCOMES: Record<string, ResultOutcome> = {
  A: { code: "supportive", headline: CC_03, allowCheckout: true, showFigures: true, reason: null },
  B: { code: "not_supportive", headline: CC_04, allowCheckout: false, showFigures: true, reason: null },
  C: {
    code: "insufficient_evidence",
    headline: CC_05,
    allowCheckout: false,
    showFigures: false,
    reason: "eligibility_policy_unsigned",
  },
  D: {
    code: "unsupported_property",
    headline: CC_06,
    allowCheckout: false,
    showFigures: false,
    reason: "property_class_unsupported",
  },
}

function buildResult(outcome: ResultOutcome | null): Result {
  return {
    subject: {
      pin: "10-25-107-045-0000",
      address: "123 Main St",
      city: "Evanston",
      zipCode: "60201",
      township: "Evanston",
      neighborhoodCode: "70",
      taxYear: 2026,
      assessedTotalValue: 42500,
      marketValue: 425000,
    },
    compCount: 3,
    comps: [],
    avgComparableAssessedValue: 35100,
    equityRatio: 12.1,
    targetEquityRatio: 10,
    avgCompEquityRatio: 9.8,
    assessmentGap: 7400,
    potentialOverpaymentPerYear: null,
    potentialOverpayment3Year: null,
    appealArgumentText: null,
    appealWindowStatus: null,
    propertyCharacteristics: null,
    source: "Cook County Open Data",
    disclosure: CC_02,
    sourceCaveat: CC_07,
    outcome,
  }
}

/** Banned across every state — BL-A5, BL-B1/B3/B4/B6, BL-C1/C2/C3/C4. */
const BANNED = [
  /estimated savings/i,
  /potential savings/i,
  /est\. overpayment/i,
  /overpaying/i,
  /over-assessed/i,
  /fairly assessed/i,
  /unlikely to succeed/i,
  /confidence threshold/i,
  /could lower your taxes/i,
  /locks in savings/i,
  /\ba win\b/i,
  /no lawyer required/i,
  /no attorney needed/i,
]

describe("free-check result — four-state contract", () => {
  it.each(Object.entries(OUTCOMES))("renders CC-02 byte-exact above the %s result", (_key, outcome) => {
    render(<FreeCheckResult result={buildResult(outcome)} />)

    const disclosure = screen.getByText(CC_02)
    const headline = screen.getByText(outcome.headline)

    // Byte-exact and in one element — not split, not truncated, not reworded.
    expect(disclosure.textContent).toBe(CC_02)
    // "Above" is positional, not merely present: CC-02 must precede the verdict.
    expect(disclosure.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(Object.entries(OUTCOMES))("renders exactly one of CC-03…CC-06 for %s", (_key, outcome) => {
    render(<FreeCheckResult result={buildResult(outcome)} />)
    const all = [CC_03, CC_04, CC_05, CC_06]
    const present = all.filter((s) => screen.queryAllByText(s).length > 0)
    expect(present).toEqual([outcome.headline])
  })

  it.each(Object.entries(OUTCOMES))("renders no savings or merits claim in state %s", (_key, outcome) => {
    const { container } = render(<FreeCheckResult result={buildResult(outcome)} />)
    for (const pattern of BANNED) {
      expect(container.textContent ?? "").not.toMatch(pattern)
    }
  })

  it("offers no paid entry point in states B, C, or D", () => {
    for (const key of ["B", "C", "D"] as const) {
      const { container, unmount } = render(<FreeCheckResult result={buildResult(OUTCOMES[key])} />)
      expect(container.querySelectorAll('a[href^="/auth/signup"]')).toHaveLength(0)
      expect(container.querySelectorAll('a[href^="/pricing"]')).toHaveLength(0)
      unmount()
    }
  })

  it("falls back to CC-05 with no offer when the response carries no outcome", () => {
    // A malformed or older cached response must not read as permission.
    const { container } = render(<FreeCheckResult result={buildResult(null)} />)
    expect(screen.getByText(CC_05)).toBeTruthy()
    expect(container.querySelectorAll('a[href^="/auth/signup"]')).toHaveLength(0)
  })

  it("cites only the canonical .gov Assessor host", () => {
    const { container } = render(<FreeCheckResult result={buildResult(OUTCOMES.A)} />)
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "")
    expect(hrefs.some((h) => h.includes("cookcountyassessor.com"))).toBe(false)
    expect(container.textContent ?? "").not.toMatch(/cookcountyassessor\.com/)
  })
})
