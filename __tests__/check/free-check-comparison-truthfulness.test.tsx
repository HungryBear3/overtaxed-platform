/**
 * @jest-environment jsdom
 *
 * What the two free-check surfaces may say about the comparison they render.
 *
 * Two things are proven here:
 *
 *  1. The public-record assessed-value comparison renders when the county
 *     carries no market value. On the released parent `showFigures` was the only
 *     gate, and it is false whenever the assessment *level* cannot be computed,
 *     so a blank market-value column suppressed assessed values that were on
 *     file and validated.
 *  2. No surface claims the comparables are the nearest, the closest, or nearby.
 *     Nothing in the free-check path computes a distance: `getComparableSales`
 *     filters on the CCAO neighbourhood code and building class and orders by
 *     sale date, and `getComparableEquity` fills the shortfall from the same
 *     cohort or the township. `haversineMiles` exists but is imported only by
 *     the paid packet builder.
 *
 * All fixtures are synthetic.
 */
import React from "react"
import fs from "node:fs"
import path from "node:path"
import { render, screen } from "@testing-library/react"

import { FreeCheckResult, type Result, type ResultOutcome } from "@/components/check/FreeCheckResult"
import { evaluateFreeCheckOutcome, type FreeCheckAppealWindowStatus } from "@/lib/free-check-appeal-window"
import { CC_02, CC_05, CC_06, CC_07 } from "@/lib/copy/canonical"

const NO_LEVEL: ResultOutcome = {
  code: "insufficient_evidence",
  headline: CC_05,
  allowCheckout: false,
  showFigures: false,
  showRecordComparison: true,
  reason: "no_comparable_level",
}

/** The same state as it was on the parent: one gate, so nothing rendered. */
const PARENT_SHAPED: ResultOutcome = { ...NO_LEVEL, showRecordComparison: false }

function assessedOnlyResult(outcome: ResultOutcome): Result {
  return {
    subject: {
      pin: "18-06-214-001-0000",
      address: "1234 N SAMPLE ST",
      city: "Chicago",
      zipCode: "60600",
      township: "Lake View",
      neighborhoodCode: "70",
      taxYear: 2026,
      assessedTotalValue: 42500,
      // The whole point: the county published no market value for this parcel.
      marketValue: null,
    },
    compCount: 3,
    comps: [
      { pin: "18-06-214-002-0000", address: "1236 N SAMPLE ST", city: "Chicago", assessedValue: 36400, marketValue: null, squareFeet: 1200, yearBuilt: 1925, propertyClass: "2-03" },
      { pin: "18-06-214-003-0000", address: "1238 N SAMPLE ST", city: "Chicago", assessedValue: 34800, marketValue: null, squareFeet: 1180, yearBuilt: 1923, propertyClass: "2-03" },
      { pin: "18-06-214-004-0000", address: "1240 N SAMPLE ST", city: "Chicago", assessedValue: 34100, marketValue: null, squareFeet: 1210, yearBuilt: 1924, propertyClass: "2-03" },
    ],
    avgComparableAssessedValue: 35100,
    equityRatio: null,
    targetEquityRatio: 10,
    avgCompEquityRatio: null,
    assessmentGap: 7400,
    potentialOverpaymentPerYear: null,
    potentialOverpayment3Year: null,
    appealArgumentText: null,
    appealWindowStatus: null,
    propertyCharacteristics: null,
    compSelection: {
      basis: "cohort_recency",
      distanceRanked: false,
      label: "Selected from available Cook County records for similar properties in the same assessment cohort.",
    },
    source: "Cook County Open Data",
    disclosure: CC_02,
    sourceCaveat: CC_07,
    outcome,
  }
}

describe("the evaluator separates the level from the record", () => {
  const window: FreeCheckAppealWindowStatus = {
    township: "Lake View",
    status: "unknown",
    openDate: null,
    closeDate: null,
    filingUrl: "https://www.cookcountyassessoril.gov/online-appeals",
    note: null,
    pendingReason: "township_unresolved",
    allowCheckout: false,
    showDates: false,
    showCountdown: false,
    allowDeadlineCta: false,
    allowReminderSignup: false,
  }

  const evidence = {
    propertyClass: "2-03",
    pinCount: 1,
    inCookCounty: true,
    assessedTotalValue: 42500,
    equityRatio: null,
    avgCompEquityRatio: null,
    compCount: 3,
  }

  it("withholds the level and releases the record when no market value exists", () => {
    const outcome = evaluateFreeCheckOutcome({ window, evidence })
    expect(outcome.reason).toBe("no_comparable_level")
    expect(outcome.showFigures).toBe(false)
    expect(outcome.showRecordComparison).toBe(true)
  })

  it("withholds both when there is no comparable at all", () => {
    const outcome = evaluateFreeCheckOutcome({ window, evidence: { ...evidence, compCount: 0 } })
    expect(outcome.reason).toBe("no_comparables")
    expect(outcome.showRecordComparison).toBe(false)
  })

  it("withholds both when the subject has no assessed value", () => {
    const outcome = evaluateFreeCheckOutcome({ window, evidence: { ...evidence, assessedTotalValue: null } })
    expect(outcome.reason).toBe("no_assessed_value")
    expect(outcome.showRecordComparison).toBe(false)
  })

  it("withholds both for a property the packet is not defined for", () => {
    const outcome = evaluateFreeCheckOutcome({ window, evidence: { ...evidence, inCookCounty: false } })
    expect(outcome.code).toBe("unsupported_property")
    expect(outcome.showRecordComparison).toBe(false)
  })

  it("never releases the level without the record it was computed from", () => {
    for (const inCookCounty of [true, false]) {
      for (const compCount of [0, 1, 3]) {
        for (const equityRatio of [null, 12.1]) {
          for (const avgCompEquityRatio of [null, 10.3]) {
            const outcome = evaluateFreeCheckOutcome({
              window,
              evidence: { ...evidence, inCookCounty, compCount, equityRatio, avgCompEquityRatio },
            })
            if (outcome.showFigures) expect(outcome.showRecordComparison).toBe(true)
          }
        }
      }
    }
  })
})

describe("/check renders the assessed-value comparison without a market value", () => {
  it("shows the subject value, the comparable average and the difference", () => {
    render(<FreeCheckResult result={assessedOnlyResult(NO_LEVEL)} />)

    expect(screen.getAllByText("$42,500").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$35,100").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$7,400").length).toBeGreaterThan(0)
    // The verdict is unchanged: CC-05, no offer.
    expect(screen.getByText(CC_05)).toBeTruthy()
  })

  it("renders every accepted comparable and no promised fourth", () => {
    const { container } = render(<FreeCheckResult result={assessedOnlyResult(NO_LEVEL)} />)
    expect(screen.getByText(/Comparable properties \(3\)/)).toBeTruthy()
    expect(container.textContent).toMatch(/Avg of 3 comparables on record/)
  })

  it("labels a single surviving comparable in the singular, promising no three", () => {
    const one = assessedOnlyResult(NO_LEVEL)
    const { container } = render(
      <FreeCheckResult result={{ ...one, compCount: 1, comps: one.comps.slice(0, 1), avgComparableAssessedValue: 36400 }} />,
    )
    expect(container.textContent).toMatch(/Avg of 1 comparable on record/)
    expect(container.textContent).not.toMatch(/Avg of 1 comparables/)
    expect(container.textContent).not.toMatch(/\b3 comparables\b/)
  })

  it("leaves the assessment-level row absent rather than filling it with the county's target", () => {
    const { container } = render(<FreeCheckResult result={assessedOnlyResult(NO_LEVEL)} />)
    expect(container.textContent).not.toMatch(/10\.0% \(target\)/)
    expect(container.textContent).not.toMatch(/Equity ratio/)
  })

  it("says how the comparables were selected, using the route's own label", () => {
    const { container } = render(<FreeCheckResult result={assessedOnlyResult(NO_LEVEL)} />)
    expect(container.textContent).toMatch(/same assessment cohort/i)
  })

  it("renders none of it under the parent's single-gate outcome", () => {
    // The mutation proof for this fix: flip the new capability back off and the
    // whole comparison disappears again, exactly as it did on 1f2d7aae.
    const { container } = render(<FreeCheckResult result={assessedOnlyResult(PARENT_SHAPED)} />)
    expect(container.textContent).not.toMatch(/\$35,100/)
    expect(container.textContent).not.toMatch(/\$7,400/)
    expect(screen.queryByText(/Comparable properties \(/)).toBeNull()
  })
})

describe("the outcome trust boundary requires the new capability", () => {
  /**
   * `isCanonicalResultOutcome` guards route responses *and* `sessionStorage`.
   * A payload written before the assessed-value comparison had its own gate
   * carries no `showRecordComparison`, and there is no honest default for it:
   * absent cannot be told from "withheld deliberately". Absent is untrusted,
   * and untrusted resolves to CC-05 with nothing shown and nothing offered.
   */
  function withOutcome(outcome: unknown): Result {
    return { ...assessedOnlyResult(NO_LEVEL), outcome: outcome as ResultOutcome | null }
  }

  it("rejects an outcome that omits showRecordComparison entirely", () => {
    const { code, headline, allowCheckout, showFigures, reason } = NO_LEVEL
    const { container } = render(
      <FreeCheckResult result={withOutcome({ code, headline, allowCheckout, showFigures, reason })} />,
    )
    expect(screen.getByText(CC_05)).toBeTruthy()
    expect(container.textContent).not.toMatch(/\$35,100/)
    expect(container.textContent).not.toMatch(/\$42,500/)
    expect(screen.queryByText(/Comparable properties \(/)).toBeNull()
  })

  it("rejects an outcome carrying it as something other than a boolean", () => {
    const { container } = render(
      <FreeCheckResult result={withOutcome({ ...NO_LEVEL, showRecordComparison: "true" })} />,
    )
    expect(container.textContent).not.toMatch(/\$35,100/)
  })

  it("rejects a level released without the record it was computed from", () => {
    const { container } = render(
      <FreeCheckResult
        result={withOutcome({ ...NO_LEVEL, showFigures: true, showRecordComparison: false })}
      />,
    )
    expect(screen.getByText(CC_05)).toBeTruthy()
    expect(container.textContent).not.toMatch(/\$35,100/)
  })

  it("rejects an unsupported-property outcome that leaves the record released", () => {
    const { container } = render(
      <FreeCheckResult
        result={withOutcome({
          code: "unsupported_property",
          headline: CC_06,
          allowCheckout: false,
          showFigures: false,
          showRecordComparison: true,
          reason: "property_class_unsupported",
        })}
      />,
    )
    // Rejected, so the headline falls back to CC-05 rather than rendering CC-06
    // from an outcome the boundary did not accept.
    expect(screen.getByText(CC_05)).toBeTruthy()
    expect(container.textContent).not.toMatch(/\$35,100/)
  })
})

describe("no surface claims a distance ranking it does not perform", () => {
  const repoRoot = path.join(__dirname, "..", "..")
  const SURFACES = [
    "components/check/FreeCheckResult.tsx",
    "components/check/FreeCheckForm.tsx",
    "components/ot-design/HomePage.tsx",
    "app/check/page.tsx",
    "app/api/free-check/route.ts",
  ]

  /**
   * Comments carry the reasons these claims were removed, and those reasons have
   * to be able to quote the words. Only rendered text is checked.
   */
  function renderedText(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
  }

  it.each(SURFACES)("%s makes no nearest/nearby/closest comparable claim", (relative) => {
    const source = renderedText(fs.readFileSync(path.join(repoRoot, relative), "utf8"))
    expect(source).not.toMatch(/\bnearest\b/i)
    expect(source).not.toMatch(/\bclosest\b/i)
    // "Nearby townships" is geography, not a comparable ranking, and does not
    // appear on any of these files; anything else matching is the claim.
    expect(source).not.toMatch(/\bnearby\b/i)
  })

  it.each(SURFACES)("%s promises no overpayment or savings figure", (relative) => {
    const source = renderedText(fs.readFileSync(path.join(repoRoot, relative), "utf8"))
    expect(source).not.toMatch(/estimated annual overpayment/i)
    expect(source).not.toMatch(/estimated savings/i)
    expect(source).not.toMatch(/potential savings/i)
  })

  it("computes no distance anywhere in the free-check path", () => {
    for (const relative of [...SURFACES, "lib/free-check-address.ts", "lib/free-check-appeal-window.ts"]) {
      const source = fs.readFileSync(path.join(repoRoot, relative), "utf8")
      expect(source).not.toMatch(/haversineMiles/)
    }
  })
})
