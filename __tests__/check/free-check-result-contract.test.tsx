/**
 * @jest-environment ./test-support/factual-jsdom-environment.cjs
 */
import React from "react"
import { render, screen } from "@testing-library/react"

import {
  FreeCheckResult,
  isCanonicalResultOutcome,
  type Result,
  type ResultOutcome,
} from "@/components/check/FreeCheckResult"
import { CC_02, CC_03, CC_04, CC_05, CC_06, CC_07 } from "@/lib/copy/canonical"
import { FREE_CHECK_OUTCOME_MATRIX } from "@/lib/free-check-outcome-contract"
import { createFactualLocalRuntime, SYNTHETIC_SUBJECT_PIN } from "@/test-support/factual-local-fixture"

const ALLOWED_OUTCOMES = [...FREE_CHECK_OUTCOME_MATRIX]

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
    comps: [
      {
        pin: "10-25-107-046-0000",
        address: "125 Main St",
        city: "Evanston",
        assessedValue: 35100,
        marketValue: 351000,
        squareFeet: 1200,
        yearBuilt: 1925,
        propertyClass: "2-03",
      },
    ],
    avgComparableAssessedValue: 35100,
    equityRatio: 12.1,
    targetEquityRatio: 10,
    avgCompEquityRatio: 9.8,
    assessmentGap: 7400,
    potentialOverpaymentPerYear: null,
    potentialOverpayment3Year: null,
    appealArgumentText: "hostile replay text should never render unless the matrix allows it",
    appealWindowStatus: null,
    propertyCharacteristics: null,
    source: "Cook County Open Data",
    disclosure: CC_02,
    sourceCaveat: CC_07,
    outcome,
  }
}

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

const DENIED_OUTCOMES: Array<[string, unknown]> = [
  [
    "not_supportive null reason",
    {
      code: "not_supportive",
      headline: CC_04,
      allowCheckout: false,
      showFigures: true,
      showRecordComparison: true,
      reason: null,
    },
  ],
  [
    "insufficient no_assessed_value record leak",
    {
      code: "insufficient_evidence",
      headline: CC_05,
      allowCheckout: false,
      showFigures: false,
      showRecordComparison: true,
      reason: "no_assessed_value",
    },
  ],
  [
    "supportive contradictory flags",
    {
      code: "supportive",
      headline: CC_03,
      allowCheckout: false,
      showFigures: true,
      showRecordComparison: false,
      reason: "window_not_open",
    },
  ],
  [
    "missing capability",
    {
      code: "insufficient_evidence",
      headline: CC_05,
      allowCheckout: false,
      showFigures: false,
      reason: "no_comparable_level",
    },
  ],
  [
    "unknown reason",
    {
      code: "supportive",
      headline: CC_03,
      allowCheckout: false,
      showFigures: true,
      showRecordComparison: true,
      reason: "made_up_reason",
    },
  ],
  [
    "old reason reused on new tuple",
    {
      code: "insufficient_evidence",
      headline: CC_05,
      allowCheckout: false,
      showFigures: true,
      showRecordComparison: true,
      reason: "no_comparables",
    },
  ],
]

describe("server-owned factual record contract", () => {
  async function mount(rewrite?: (b: any) => any) {
    const rt = createFactualLocalRuntime()
    const receipt = await (await rt.route.POST(new Request('http://local/api/free-check', { method: 'POST', body: JSON.stringify({ pin: SYNTHETIC_SUBJECT_PIN }) }))).json()
    global.fetch = jest.fn(async (url: any) => {
      const res = await rt.route.GET(new Request(new URL(String(url), 'http://local')))
      return rewrite ? new Response(JSON.stringify(rewrite(await res.json()))) : res
    }) as any
    render(<FreeCheckResult result={receipt} />)
    return receipt
  }
  it('renders the actual server result ID, complete records, limitations and source links', async () => {
    const receipt = await mount()
    const summary = await screen.findByTestId('factual-summary')
    expect(summary.getAttribute('data-result-id')).toBe(receipt.resultId)
    expect(summary.textContent).toContain('$42,500.00')
    expect(screen.getAllByRole('row')).toHaveLength(5)
    expect(summary.textContent).toContain('No conclusion about your assessment is drawn')
    expect(summary.textContent).toContain('Filing window: UNKNOWN')
    expect(summary.querySelectorAll('a[href^="https://datacatalog.cookcountyil.gov/"]')).toHaveLength(2)
    for (const pattern of BANNED) expect(summary.textContent).not.toMatch(pattern)
  })
  it.each([
    ['missing limitations', (b: any) => ({ ...b, limitations: [] })],
    ['wrong snapshot binding', (b: any) => ({ ...b, snapshotId: 'snap_' + 'z'.repeat(24) })],
    ['normalized claims', (b: any) => ({ ...b, validationRef: 1, status: 'VALIDATED', relativeGap: 0.4 })],
  ])('rejects %s in the real GET consumer', async (_n, rewrite) => {
    await mount(rewrite)
    await screen.findByTestId('factual-refused')
    expect(screen.queryByTestId('factual-summary')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\$42,500|40%/)
  })
})

describe("free-check result outcome matrix", () => {
  it.each(ALLOWED_OUTCOMES)(
    "accepts the allowed tuple %s/%s",
    (outcome) => {
      expect(isCanonicalResultOutcome(outcome)).toBe(true)
    },
  )

  it.each(DENIED_OUTCOMES)("rejects %s", (_label, outcome) => {
    expect(isCanonicalResultOutcome(outcome)).toBe(false)
  })
})

describe("free-check result rendering", () => {
  it.each(ALLOWED_OUTCOMES)("refuses retired estimator outcome %s/%s rather than adopting its headline", (outcome) => {
    render(<FreeCheckResult result={buildResult(outcome)} />)
    const present = [CC_03, CC_04, CC_05, CC_06].filter((copy) => screen.queryAllByText(copy).length > 0)
    expect(present).toEqual([])
    expect(screen.getByTestId("factual-refused")).toBeTruthy()
  })

  it.each(ALLOWED_OUTCOMES)("renders no banned merits or savings copy in %s/%s", (outcome) => {
    const { container } = render(<FreeCheckResult result={buildResult(outcome)} />)
    for (const pattern of BANNED) {
      expect(container.textContent ?? "").not.toMatch(pattern)
    }
  })

  it.each(ALLOWED_OUTCOMES)("retired capability flags cannot release records or checkout for %s/%s", (outcome) => {
    const { container } = render(<FreeCheckResult result={buildResult(outcome)} />)
    const text = container.textContent ?? ""
    expect(screen.getByTestId("factual-refused")).toBeTruthy()
    expect(text).not.toMatch(/\$42,500|Comparable properties \(/)
    expect(container.querySelectorAll('a[href^="/auth/signup"]')).toHaveLength(0)
    expect(container.querySelectorAll('a[href^="/pricing"]')).toHaveLength(0)
  })

  it.each(DENIED_OUTCOMES)("fails closed on hostile payload %s", (_label, outcome) => {
    const { container } = render(<FreeCheckResult result={buildResult(outcome as ResultOutcome)} />)
    expect(screen.getByTestId("factual-refused")).toBeTruthy()
    expect(container.textContent ?? "").not.toMatch(/\$42,500/)
    expect(container.textContent ?? "").not.toMatch(/Comparable properties \(/)
    expect(container.querySelector("textarea")).toBeNull()
    expect(container.querySelectorAll('a[href^="/auth/signup"]')).toHaveLength(0)
    expect(container.querySelectorAll('a[href^="/pricing"]')).toHaveLength(0)
  })

  it("refuses an unbound legacy response without synthesizing an outcome", () => {
    const { container } = render(<FreeCheckResult result={buildResult(null)} />)
    expect(screen.getByTestId("factual-refused")).toBeTruthy()
    expect(container.querySelectorAll('a[href^="/auth/signup"]')).toHaveLength(0)
    expect(container.querySelectorAll('a[href^="/pricing"]')).toHaveLength(0)
  })

  it("cites only the canonical .gov Assessor host", () => {
    const { container } = render(<FreeCheckResult result={buildResult(ALLOWED_OUTCOMES[0])} />)
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "")
    expect(hrefs.some((href) => href.includes("cookcountyassessor.com"))).toBe(false)
    expect(container.textContent ?? "").not.toMatch(/cookcountyassessor\.com/)
  })
})
