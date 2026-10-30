/**
 * @jest-environment ./test-support/factual-jsdom-environment.cjs
 *
 * `/check` against the payload a returning visitor actually carries.
 *
 * Historical regression fixture below reproduces the old normalized cache.
 * Under FACTUAL_ONLY, every legacy body is refused outright; no CC-02/CC-05
 * repair is synthesized. Positive v3 controls reload actual server receipts,
 * while the retained hostile rows ensure old capabilities cannot release data.
 *
 * The four-state contract was proven on `/check` with payloads built to the
 * *new* shape: `disclosure: CC_02`, `appealArgumentText: null`, an explicit
 * `outcome`. The shape that reaches the component in the field is the one the
 * previous build wrote into `sessionStorage`, and it is a different object:
 *
 *   - no `disclosure` — the base route emits no such field, anywhere;
 *   - no `outcome`;
 *   - no capability flags on `appealWindowStatus`;
 *   - a populated `appealArgumentText` ending "...resulting in an estimated
 *     overpayment of $1,420/year";
 *   - `potentialOverpaymentPerYear: 1420`.
 *
 * `FreeCheckFormWrapper` restored any entry with `success` and `subject.pin`
 * from a key that was never bumped, and `FreeCheckResult` rendered CC-02 only
 * `if (result.disclosure)` and the appeal-argument card on the mere presence of
 * `appealArgumentText`. So a tab left open across the deploy showed a dollar
 * overpayment claim, in a copyable textarea, under a CC-05 "Insufficient
 * evidence" headline, with no disclosure above it.
 *
 * These tests construct that exact object and assert what it may render.
 */
import React from "react"
import { render, screen } from "@testing-library/react"

import { FreeCheckResult, type Result, type ResultOutcome } from "@/components/check/FreeCheckResult"
import { CC_02, CC_03, CC_04, CC_05, CC_06 } from "@/lib/copy/canonical"
import { FreeCheckFormWrapper } from "@/components/check/FreeCheckFormWrapper"
import { createFactualLocalRuntime, SYNTHETIC_SUBJECT_PIN } from "@/test-support/factual-local-fixture"

/** Verbatim from the base build's `buildAppealArgument`. */
const LEGACY_ARGUMENT = `The subject property at 123 Main St, Evanston (CCAO neighborhood 70) has been assessed at $42,500, resulting in an assessment level of 12.1% — above Cook County's 10% residential target.

Comparable properties in Evanston township average $35,100 in assessed value, giving a separate uniformity benchmark for similar homes.

Under Illinois law (35 ILCS 200/9-5) and the Cook County Assessor's rules, property assessments should reflect 10% of fair market value and be uniform with comparable properties. This property's assessment exceeds comparable properties by approximately $7,400, resulting in an estimated overpayment of $1,420/year.

We request a reduction in the assessed value to $35,100, consistent with the $425,000 market value and comparable properties in the neighborhood.`

/**
 * The `_v1` payload, field for field.
 *
 * Typed through `unknown` on purpose: the point is that this object does *not*
 * satisfy the current `Result` contract, and a cast that hid the mismatch would
 * be testing the new shape again.
 */
const LEGACY_PAYLOAD = {
  success: true,
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
  potentialOverpaymentPerYear: 1420,
  potentialOverpayment3Year: 4260,
  appealArgumentText: LEGACY_ARGUMENT,
  appealWindowStatus: {
    township: "Evanston",
    status: "open",
    openDate: "2026-07-01",
    closeDate: "2026-08-31",
    filingUrl: "https://www.cookcountyassessoril.gov/online-appeals",
    note: null,
    // No pendingReason, no showDates, no showCountdown, no allowDeadlineCta,
    // no allowReminderSignup, no allowCheckout. The base build had none.
  },
  propertyCharacteristics: null,
  source: "Cook County Open Data",
} as unknown as Result

/** BL-A5, BL-B1/B3/B4/B6, BL-C1/C2/C3/C4. */
const BANNED = [
  /estimated savings/i,
  /potential savings/i,
  /estimated overpayment/i,
  /est\. overpayment/i,
  /overpaying/i,
  /overpayment/i,
  /over-assessed/i,
  /fairly assessed/i,
  /unlikely to succeed/i,
  /confidence threshold/i,
  /could lower your taxes/i,
  /locks in savings/i,
  /\ba win\b/i,
  /no lawyer required/i,
  /no attorney needed/i,
  /\$1,420/,
  /\$4,260/,
]

describe("the legacy `_v1` cached payload", () => {
  it("refuses the legacy body rather than supplying a missing disclosure", () => {
    render(<FreeCheckResult result={LEGACY_PAYLOAD} />)
    expect(screen.getByTestId("factual-refused")).toBeTruthy()
    expect(screen.queryByTestId("factual-summary")).toBeNull()
    expect(screen.queryByText(CC_02)).toBeNull()
  })

  it("does not synthesize any retired outcome, including CC-05", () => {
    render(<FreeCheckResult result={LEGACY_PAYLOAD} />)
    const present = [CC_03, CC_04, CC_05, CC_06].filter((s) => screen.queryAllByText(s).length > 0)
    expect(present).toEqual([])
    expect(screen.getByTestId("factual-refused")).toBeTruthy()
  })

  it("renders no banned claim, including the legacy argument text", () => {
    const { container } = render(<FreeCheckResult result={LEGACY_PAYLOAD} />)
    const text = container.textContent ?? ""
    for (const pattern of BANNED) {
      expect({ pattern: String(pattern), matched: pattern.test(text) }).toEqual({
        pattern: String(pattern),
        matched: false,
      })
    }
    // The card itself is gone, not merely emptied.
    expect(container.querySelector("textarea")).toBeNull()
    expect(screen.queryByText(/Your appeal argument/i)).toBeNull()
  })

  it("suppresses the stale date, countdown, filing CTA, reminder and checkout together", () => {
    const { container } = render(<FreeCheckResult result={LEGACY_PAYLOAD} />)
    const text = container.textContent ?? ""

    // The payload carries openDate 2026-07-01 and closeDate 2026-08-31 and
    // claims status "open". Without capability flags none of it may render.
    expect(text).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/)
    expect(text).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}\b/,
    )
    expect(text).not.toMatch(/\bdays?\s*(left|remaining|until|to file)/i)
    expect(text).not.toMatch(/File your appeal|File at CCAO/i)
    expect(container.querySelector('input[type="email"]')).toBeNull()
    expect(container.querySelectorAll('a[href^="/auth/signup"]')).toHaveLength(0)
    expect(container.querySelectorAll('a[href^="/pricing"]')).toHaveLength(0)
    expect(container.querySelectorAll('a[href*="online-appeals"]')).toHaveLength(0)
  })
})

describe("a supplied disclosure is checked, not trusted", () => {
  const OUTCOMES: Record<string, ResultOutcome> = {
    A: { code: "supportive", headline: CC_03, allowCheckout: true, showFigures: true, showRecordComparison: true, reason: null },
    B: { code: "not_supportive", headline: CC_04, allowCheckout: false, showFigures: true, showRecordComparison: true, reason: "below_evidence_threshold" },
    C: { code: "insufficient_evidence", headline: CC_05, allowCheckout: false, showFigures: false, showRecordComparison: false, reason: "no_assessed_value" },
    D: { code: "unsupported_property", headline: CC_06, allowCheckout: false, showFigures: false, showRecordComparison: false, reason: "property_class_unsupported" },
  }

  function build(outcome: ResultOutcome | null, disclosure: string | null | undefined): Result {
    return {
      ...(LEGACY_PAYLOAD as unknown as Result),
      appealArgumentText: null,
      potentialOverpaymentPerYear: null,
      potentialOverpayment3Year: null,
      appealWindowStatus: null,
      disclosure,
      outcome,
    } as Result
  }

  it.each(Object.entries(OUTCOMES))(
    "even a correct legacy disclosure cannot authorize state %s",
    (_key, outcome) => {
      const { container } = render(<FreeCheckResult result={build(outcome, CC_02)} />)
      const matches = Array.from(container.querySelectorAll("p")).filter(
        (p) => p.textContent === CC_02,
      )
      expect(matches).toHaveLength(0)
      expect(screen.getByTestId("factual-refused")).toBeTruthy()
    },
  )

  it.each(Object.entries(OUTCOMES))("absent legacy disclosure does not authorize state %s", (_key, outcome) => {
    render(<FreeCheckResult result={build(outcome, undefined)} />)
    expect(screen.queryByText(CC_02)).toBeNull()
    expect(screen.queryByText(outcome.headline)).toBeNull()
    expect(screen.getByTestId("factual-refused")).toBeTruthy()
  })

  it.each([
    ["truncated", CC_02.slice(0, 60)],
    ["reworded", CC_02.replace("does not predict", "cannot predict")],
    ["whitespace-drifted", ` ${CC_02}`],
    ["empty", ""],
  ])("fails closed on a %s disclosure", (_label, drifted) => {
    // The disclosure is the one string on this surface whose exact bytes are
    // mandated. A response that disagrees with it did not come from a build
    // that agrees with the copy contract, so its verdict is not trusted either.
    const { container } = render(<FreeCheckResult result={build(OUTCOMES.A, drifted)} />)
    expect(screen.queryByText(CC_02)).toBeNull()
    expect(screen.queryAllByText(CC_03)).toHaveLength(0)
    expect(screen.getByTestId("factual-refused")).toBeTruthy()
    expect(container.querySelectorAll('a[href^="/auth/signup"]')).toHaveLength(0)
    expect(container.querySelectorAll('a[href^="/pricing"]')).toHaveLength(0)
    // The drifted string is never rendered as its own node. A truncation is a
    // prefix of the canonical sentence, so a substring check would always
    // "find" it inside the canonical paragraph; what matters is that no element
    // carries the drifted text as its content.
    const nodes = Array.from(container.querySelectorAll("p, span, div"))
    expect(nodes.filter((n) => n.textContent === drifted)).toHaveLength(0)
    const disclosureParagraphs = Array.from(container.querySelectorAll("p")).filter((n) =>
      (n.textContent ?? "").includes("This free check compares"),
    )
    expect(disclosureParagraphs).toHaveLength(0)
  })
})

describe("the session key retires the payloads that carry the claim", () => {
  it.each(['freeCheckResult_v1', 'freeCheckResult_v2'])('removes %s unread in the actual wrapper', key => {
    sessionStorage.clear()
    sessionStorage.setItem(key, JSON.stringify(LEGACY_PAYLOAD))
    global.fetch = jest.fn() as any
    render(<FreeCheckFormWrapper />)
    expect(sessionStorage.getItem(key)).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('factual-summary')).toBeNull()
    for (const pattern of BANNED) expect(document.body.textContent).not.toMatch(pattern)
  })
  it.each(['valid', 'limitations omitted', 'wrong binding', 'normalized claim'])('reloads cached receipt with %s server body', async kind => {
    sessionStorage.clear()
    const rt = createFactualLocalRuntime()
    const receipt = await (await rt.route.POST(new Request('http://local/api/free-check', { method: 'POST', body: JSON.stringify({ pin: SYNTHETIC_SUBJECT_PIN }) }))).json()
    sessionStorage.setItem('freeCheckReceipt_v3', JSON.stringify(receipt))
    global.fetch = jest.fn(async (url: any) => {
      const res = await rt.route.GET(new Request(new URL(String(url), 'http://local')))
      const b = await res.json()
      if (kind === 'limitations omitted') b.limitations = []
      if (kind === 'wrong binding') b.resultId = 'res_' + 'z'.repeat(24)
      if (kind === 'normalized claim') b.potentialOverpaymentPerYear = 1420
      return new Response(JSON.stringify(b))
    }) as any
    render(<FreeCheckFormWrapper />)
    if (kind === 'valid') {
      const summary = await screen.findByTestId('factual-summary')
      expect(summary.getAttribute('data-result-id')).toBe(receipt.resultId)
      expect(summary.textContent).toContain('$42,500.00')
      expect(summary.textContent).toContain('No conclusion about your assessment is drawn')
    } else {
      await screen.findByTestId('factual-refused')
      expect(screen.queryByTestId('factual-summary')).toBeNull()
    }
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('freeCheckReceipt_v3')).toBe(JSON.stringify(receipt))
    for (const pattern of BANNED) expect(document.body.textContent).not.toMatch(pattern)
    sessionStorage.clear()
  })
  it("is bumped past the version that wrote them", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../components/check/FreeCheckFormWrapper.tsx"),
      "utf8",
    ) as string
    expect(src).toContain('const SESSION_KEY = "freeCheckReceipt_v3"')
    expect(src).toContain('const RETIRED_KEYS = ["freeCheckResult_v1", "freeCheckResult_v2"]')
  })
})
