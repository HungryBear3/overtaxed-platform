/**
 * @jest-environment jsdom
 *
 * The homepage's inline result and the `/check` cache, fed the route's new shape.
 *
 * Rendered in jsdom, not a real browser, from a stubbed route with invented
 * parcels. The homepage normalizes the response into its own `Result`, so a field
 * that normalization forgets is lost with no error anywhere. `normalizeCheckResult`
 * is not exported, which is why this drives the real form instead.
 */
import React from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("@/components/check/FreeCheckForm", () => ({
  FreeCheckForm: () => <div data-testid="free-check-form" />,
}))

import { FreeCheckFormWrapper } from "@/components/check/FreeCheckFormWrapper"
import { FreeCheckResult, type Result } from "@/components/check/FreeCheckResult"
import HomePage from "@/components/ot-design/HomePage"
import { CC_02, CC_05 } from "@/lib/copy/canonical"
import { FREE_COMPARISON_NO_CONCLUSION_TEXT } from "@/lib/free-check-comparison-contract"
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract"

const COMPARABLE_PINS = ["14-00-000-000-0010", "14-00-000-000-0020", "14-00-000-000-0030"]
const SUBJECT_TOTAL = "Your mailed assessed value, tax year 2026: $30,000"
const REVIEW_STEP = "Review the public-record comparison above."

const METRIC = {
  version: "ot-shared-metric/v1",
  metric: "MEDIAN_ASSESSED_PER_BUILDING_SQFT",
  unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
  cohortRule: "FREE_ELIGIBLE_POOL_MATCH_V1",
  stage: "mailed",
  taxYear: 2026,
  subjectExcluded: true,
  subjectAssessedCentsPerBuildingSqft: 2000,
  subjectAssessedTotalCents: 3000000,
  comparableMedian: {
    unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
    status: "COMPUTED",
    value: 1600,
    count: 3,
    minimumCount: 3,
  },
  sampleAdequacy: "NOT_QUALIFIED",
  claims: "ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS",
}

const EVIDENCE = {
  selectionRuleId: "synthetic-rule",
  stage: "mailed",
  taxYear: 2026,
  candidateCount: 9,
  candidateAcceptedCount: 3,
  candidateRejectedByReason: {},
  candidateExcludedCount: 0,
  candidateExcludedByReason: {},
  candidatePoolSha256: "0".repeat(64),
  poolDispositionsSha256: "0".repeat(64),
  sourceDatasetIds: [],
  sourceResponseCount: 12,
  collectorProtections: [],
  retrievedAt: "2026-09-15T15:00:00.000Z",
  upstreamAtomicGuarantee: "NOT_ESTABLISHED",
}

function available(over: Record<string, unknown> = {}) {
  return {
    success: true,
    disclosure: CC_02,
    outcome: canonicalFreeCheckOutcome("insufficient_evidence", "no_comparable_level"),
    subject: {
      pin: "14-00-000-000-0050",
      address: "1234 N SAMPLE ST",
      city: "CHICAGO",
      zipCode: "60600",
      township: "Lake View",
      neighborhoodCode: "73012",
      taxYear: 2026,
      assessedTotalValue: 30000,
      marketValue: null,
    },
    compCount: 3,
    comps: COMPARABLE_PINS.map((pin) => ({
      pin,
      address: `${pin.slice(-4)} N SAMPLE ST`,
      city: "CHICAGO",
      assessedValue: 24000,
      marketValue: null,
      squareFeet: 1500,
      yearBuilt: 1950,
      propertyClass: "203",
    })),
    sharedMetric: METRIC,
    comparisonEvidence: EVIDENCE,
    avgComparableAssessedValue: null,
    equityRatio: null,
    targetEquityRatio: 10,
    avgCompEquityRatio: null,
    assessmentGap: null,
    potentialOverpaymentPerYear: null,
    potentialOverpayment3Year: null,
    appealArgumentText: null,
    appealWindowStatus: { township: "Lake View", status: "unknown", openDate: null, closeDate: null },
    propertyCharacteristics: null,
    compSelection: { basis: "synthetic-rule", distanceRanked: false, label: "Synthetic selection label." },
    source: "Cook County Open Data",
    ...over,
  }
}

function unavailable(over: Record<string, unknown> = {}) {
  return available({
    outcome: canonicalFreeCheckOutcome("insufficient_evidence", "no_comparables"),
    compCount: 0,
    comps: [],
    sharedMetric: null,
    comparisonEvidence: null,
    subject: { ...available().subject, assessedTotalValue: null },
    ...over,
  })
}

function older(over: Record<string, unknown> = {}) {
  const { sharedMetric: _metric, comparisonEvidence: _evidence, ...payload } = available(over)
  return payload
}

async function heroResult(payload: unknown) {
  Object.defineProperty(global, "fetch", {
    value: jest.fn().mockResolvedValue({ ok: true, json: async () => payload }),
    writable: true,
  })
  render(<HomePage />)
  fireEvent.change(screen.getAllByPlaceholderText("123 S Sample Ave, La Grange IL")[1], {
    target: { value: "1234 N Sample St, Chicago IL 60600" },
  })
  fireEvent.click(screen.getByRole("button", { name: /check my assessment/i }))
  await waitFor(() => expect(document.querySelector(".ot-check-result")).not.toBeNull())
  return document.querySelector(".ot-check-result") as HTMLElement
}

describe("jsdom: the homepage keeps the report's figures through normalization", () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    Object.defineProperty(window, "scrollTo", { value: jest.fn(), writable: true })
  })

  it("renders the same brief, IDs and disclosures as /check", async () => {
    const panel = await heroResult(available())
    const text = panel.textContent ?? ""

    expect(within(panel).getByText(SUBJECT_TOTAL)).toBeTruthy()
    expect(within(panel).queryByText("Your assessed value")).toBeNull()
    expect(text).toContain("Your assessed value per building sq ft: $20.00")
    expect(text).toContain("Comparable median (3 properties, you excluded): $16.00")
    expect(text).toContain("Sample adequacy: NOT QUALIFIED. Assessed values only, not market value or savings.")
    expect(text).toContain("“NOT QUALIFIED” describes this data sample")
    expect(text).toContain("3 of 9 parcels in the neighborhood pool met the selection rule")
    for (const pin of COMPARABLE_PINS) expect(text).toContain(pin)
  })

  it("states the total from the brief, not from the subject field beside it", async () => {
    const panel = await heroResult(available({ subject: { ...available().subject, assessedTotalValue: 31000 } }))

    expect(within(panel).getByText(SUBJECT_TOTAL)).toBeTruthy()
    expect(panel.textContent).not.toContain("$31,000")
  })

  it("keeps the bare label on an older payload, which has no stage or year to state", async () => {
    const panel = await heroResult(older())

    expect(within(panel).getByText("Your assessed value")).toBeTruthy()
    expect(within(panel).getByText("$30,000")).toBeTruthy()
  })

  it("shows no mean, gap or level beside it, whatever the payload carries", async () => {
    const panel = await heroResult(available({ avgComparableAssessedValue: 35100, equityRatio: 12.1 }))
    const text = panel.textContent ?? ""

    expect(text).not.toContain("Avg of")
    expect(text).not.toContain("Assessment gap")
    expect(text).not.toContain("$35,100")
    expect(text).not.toContain("Assessment level")
  })

  it("says the comparison was withheld, and shows no figure, when the route refused", async () => {
    const panel = await heroResult(unavailable())
    const text = panel.textContent ?? ""

    expect(within(panel).getByTestId("free-comparison-unavailable")).toBeTruthy()
    expect(text).not.toContain("Comparable median (")
    expect(text).not.toContain("Your assessed value")
    for (const pin of COMPARABLE_PINS) expect(text).not.toContain(pin)
  })

  it("treats a malformed metric as withheld, not as a figure to print", async () => {
    const panel = await heroResult(
      available({ sharedMetric: { ...METRIC, comparableMedian: { ...METRIC.comparableMedian, minimumCount: 1 } } }),
    )

    expect(within(panel).getByTestId("free-comparison-unavailable")).toBeTruthy()
    expect(panel.textContent).not.toContain("Comparable median (")
  })

  it("does not call an older payload withheld", async () => {
    const { sharedMetric: _metric, comparisonEvidence: _evidence, ...older } = available({
      avgComparableAssessedValue: 35100,
    })
    const panel = await heroResult(older)

    expect(within(panel).queryByTestId("free-comparison-unavailable")).toBeNull()
    expect(panel.textContent).toContain("Avg of 3 comparables on record")
  })

  it("shows nothing from a capability tuple the shared matrix rejects", async () => {
    const panel = await heroResult(
      available({ outcome: { ...canonicalFreeCheckOutcome("insufficient_evidence", "no_comparable_level"), allowCheckout: true } }),
    )

    expect(panel.textContent).not.toContain("Comparable median (")
    expect(panel.textContent).not.toContain("$30,000")
  })
})

describe("jsdom: the /check result when the comparison is unavailable", () => {
  const renderResult = (payload: unknown) => render(<FreeCheckResult result={payload as Result} />).container

  it.each<[string, Record<string, unknown>]>([
    ["the route refused", unavailable()],
    ["the metric is malformed", available({ sharedMetric: { version: "ot-shared-metric/v1" } })],
  ])("does not point at a comparison above when %s", (_name, payload) => {
    const container = renderResult(payload)

    expect(screen.getByTestId("free-comparison-unavailable")).toBeTruthy()
    expect(container.textContent).not.toContain(REVIEW_STEP)
    expect(container.textContent).toContain("Confirm your own filing deadline with the Cook County Assessor.")
  })

  it.each<[string, unknown]>([
    ["a brief", available()],
    ["an older payload", older()],
  ])("keeps the step beside %s", (_name, payload) => {
    expect(renderResult(payload).textContent).toContain(REVIEW_STEP)
  })

  // The heading is the assertion that counts. Without a brief the list sits behind
  // a toggle, so its PINs are absent from the markup even when the card renders.
  it.each<[string, Record<string, unknown>]>([
    ["a null metric", { sharedMetric: null }],
    ["a malformed metric", { sharedMetric: { version: "ot-shared-metric/v1" } }],
  ])("offers no comparable list beside %s, however populated the payload", (_name, over) => {
    const container = renderResult(available(over))

    expect(screen.getByTestId("free-comparison-unavailable")).toBeTruthy()
    expect(container.textContent).not.toContain("Comparable properties")
    expect(container.textContent).not.toContain("$24,000")
    for (const pin of COMPARABLE_PINS) expect(container.textContent).not.toContain(pin)
  })

  it("still offers an older payload its list", () => {
    const container = renderResult(older())

    fireEvent.click(screen.getByRole("button", { name: /Comparable properties \(3\)/ }))
    for (const pin of COMPARABLE_PINS) expect(container.textContent).toContain(pin)
  })
})

describe("jsdom: the no-conclusion line under the Insufficient evidence headline", () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    Object.defineProperty(window, "scrollTo", { value: jest.fn(), writable: true })
  })

  const renderResult = (payload: unknown) => render(<FreeCheckResult result={payload as Result} />).container
  const line = (container: HTMLElement) => container.querySelector('[data-testid="free-comparison-no-conclusion"]')

  it("leaves the headline and the wording byte-exact", () => {
    expect(CC_05).toBe("Insufficient evidence")
    expect(FREE_COMPARISON_NO_CONCLUSION_TEXT).toBe(
      "“Insufficient evidence” here means this check draws no conclusion from the figures below. It does not mean the county records are missing, and it is not a finding about your property.",
    )
    expect(canonicalFreeCheckOutcome("insufficient_evidence", "no_comparable_level")).toMatchObject({
      headline: CC_05,
      showFigures: false,
      showRecordComparison: true,
      allowCheckout: false,
    })
  })

  it("sits directly under the headline on /check, beside a brief", () => {
    const shown = line(renderResult(available()))

    expect(shown?.textContent).toBe(FREE_COMPARISON_NO_CONCLUSION_TEXT)
    expect(shown?.previousElementSibling?.textContent).toBe(CC_05)
  })

  it("sits directly under the headline on the homepage, beside a brief", async () => {
    const shown = line(await heroResult(available()))

    expect(shown?.textContent).toBe(FREE_COMPARISON_NO_CONCLUSION_TEXT)
    expect(shown?.previousElementSibling?.textContent).toBe(CC_05)
  })

  it.each<[string, Record<string, unknown>]>([
    ["the route refused", {}],
    ["the outcome allowed a comparison but no metric came", { outcome: canonicalFreeCheckOutcome("insufficient_evidence", "no_comparable_level") }],
  ])("is absent when the comparison is unavailable: %s", async (_name, over) => {
    expect(line(renderResult(unavailable(over)))).toBeNull()
    expect(screen.getByTestId("free-comparison-unavailable")).toBeTruthy()
    expect(line(await heroResult(unavailable(over)))).toBeNull()
  })

  it("is absent beside a brief under any other headline", async () => {
    const outcome = canonicalFreeCheckOutcome("not_supportive", "below_evidence_threshold")

    expect(line(renderResult(available({ outcome })))).toBeNull()
    expect(line(await heroResult(available({ outcome })))).toBeNull()
  })
})

describe("jsdom: the /check session cache", () => {
  beforeEach(() => sessionStorage.clear())

  const LIST = available().comps

  const restoreRaw = async (raw: string) => {
    sessionStorage.setItem("freeCheckResult_v2", raw)
    const view = render(<FreeCheckFormWrapper />)
    await waitFor(() => expect(screen.getByTestId("free-check-form")).toBeTruthy())
    return view.container
  }
  const restore = (entry: unknown) => restoreRaw(JSON.stringify(entry))

  it("restores a result in the new shape, comparable PINs visible", async () => {
    const container = await restore(available())

    await waitFor(() => expect(container.textContent).toContain("Comparable median (3 properties, you excluded): $16.00"))
    for (const pin of COMPARABLE_PINS) expect(container.textContent).toContain(pin)
  })

  it("restores a withheld result as withheld", async () => {
    const container = await restore(unavailable())

    await waitFor(() => expect(screen.getByTestId("free-comparison-unavailable")).toBeTruthy())
    expect(container.textContent).not.toContain("Comparable median (")
  })

  it.each([
    ["an entry with a mean", { avgComparableAssessedValue: 35100 }],
    ["an entry from before the metric", { sharedMetric: undefined }],
    ["an entry with a malformed metric", { sharedMetric: { version: "ot-shared-metric/v1" } }],
  ])("refuses %s", async (_name, over) => {
    const container = await restore(available(over))

    expect(container.textContent).not.toContain("Your free check result")
    expect(sessionStorage.getItem("freeCheckResult_v2")).not.toBeNull()
  })

  it("restores comparables that carry only what the route guarantees, in the words the homepage uses", async () => {
    const bare = LIST.map((comp) => ({ ...comp, address: "", city: "", squareFeet: null, yearBuilt: null, propertyClass: null }))
    const container = await restore(available({ comps: bare }))

    await waitFor(() => expect(container.textContent).toContain(SUBJECT_TOTAL))
    for (const pin of COMPARABLE_PINS) expect(container.textContent).toContain(pin)
  })

  it.each<[string, Record<string, unknown>]>([
    ["with a comparison outcome", available({ sharedMetric: null })],
    ["with a refused outcome", unavailable({ comps: LIST })],
  ])("refuses a null metric beside populated comparables, %s", async (_name, entry) => {
    const container = await restore(entry)

    expect(container.textContent).not.toContain("Your free check result")
  })

  it.each<[string, unknown[]]>([
    ["a null entry", [null, LIST[1], LIST[2]]],
    ["a string entry", ["14-00-000-000-0010", LIST[1], LIST[2]]],
    ["an array entry", [[], LIST[1], LIST[2]]],
    ["a numeric PIN", [{ ...LIST[0], pin: 14000000000010 }, LIST[1], LIST[2]]],
    ["a missing PIN", [{ ...LIST[0], pin: undefined }, LIST[1], LIST[2]]],
    ["a null assessed value", [{ ...LIST[0], assessedValue: null }, LIST[1], LIST[2]]],
    ["a string assessed value", [{ ...LIST[0], assessedValue: "24000" }, LIST[1], LIST[2]]],
  ])("refuses %s without crashing", async (_name, comps) => {
    const container = await restore(available({ comps }))

    expect(container.textContent).not.toContain("Your free check result")
    expect(screen.getByTestId("free-check-form")).toBeTruthy()
  })

  it("refuses an assessed value that parsed to infinity", async () => {
    // `JSON.stringify` cannot write this, so the entry is written by hand.
    const raw = JSON.stringify(available()).replace('"assessedValue":24000', '"assessedValue":1e999')
    expect(JSON.parse(raw).comps[0].assessedValue).toBe(Infinity)

    const container = await restoreRaw(raw)

    expect(container.textContent).not.toContain("Your free check result")
  })

  it.each<[string, unknown[]]>([
    ["fewer comparables than the median counted", LIST.slice(0, 2)],
    ["more comparables than the median counted", [...LIST, { ...LIST[0], pin: "14-00-000-000-0040" }]],
    ["no comparables behind the median", []],
  ])("refuses %s", async (_name, comps) => {
    const container = await restore(available({ comps }))

    expect(container.textContent).not.toContain("Your free check result")
  })
})
