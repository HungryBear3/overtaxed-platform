/**
 * @jest-environment jsdom
 *
 * `/check` against the payload a returning visitor actually carries.
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
  it("renders CC-02 byte-exact above the headline even though it carries none", () => {
    render(<FreeCheckResult result={LEGACY_PAYLOAD} />)
    const disclosure = screen.getByText(CC_02)
    const headline = screen.getByText(CC_05)
    expect(disclosure.textContent).toBe(CC_02)
    expect(disclosure.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("resolves to CC-05 and nothing else", () => {
    render(<FreeCheckResult result={LEGACY_PAYLOAD} />)
    const present = [CC_03, CC_04, CC_05, CC_06].filter((s) => screen.queryAllByText(s).length > 0)
    expect(present).toEqual([CC_05])
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
    "renders exactly one CC-02, from the canonical module, in state %s",
    (_key, outcome) => {
      const { container } = render(<FreeCheckResult result={build(outcome, CC_02)} />)
      const matches = Array.from(container.querySelectorAll("p")).filter(
        (p) => p.textContent === CC_02,
      )
      expect(matches).toHaveLength(1)
    },
  )

  it.each(Object.entries(OUTCOMES))("renders CC-02 with an absent disclosure in state %s", (_key, outcome) => {
    render(<FreeCheckResult result={build(outcome, undefined)} />)
    expect(screen.getByText(CC_02).textContent).toBe(CC_02)
    // Absence is not drift: the outcome still stands.
    expect(screen.getByText(outcome.headline)).toBeTruthy()
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
    expect(screen.getByText(CC_02).textContent).toBe(CC_02)
    expect(screen.queryAllByText(CC_03)).toHaveLength(0)
    expect(screen.getByText(CC_05)).toBeTruthy()
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
    expect(disclosureParagraphs.map((n) => n.textContent)).toEqual([CC_02])
  })
})

describe("the session key retires the payloads that carry the claim", () => {
  it("is bumped past the version that wrote them", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../components/check/FreeCheckFormWrapper.tsx"),
      "utf8",
    ) as string
    expect(src).toContain('const SESSION_KEY = "freeCheckResult_v2"')
    expect(src).not.toContain('"freeCheckResult_v1"')
  })
})
