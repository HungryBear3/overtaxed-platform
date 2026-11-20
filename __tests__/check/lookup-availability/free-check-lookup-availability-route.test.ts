/**
 * @jest-environment node
 *
 * `/api/free-check` with the REAL `@/lib/cook-county` (getPropertyByPIN,
 * searchPropertiesByAddress), the real address helper and the real outcome
 * evaluator. Only `globalThis.fetch` (synthetic provider), the rate limiter and
 * `readFreeComparison` are replaced, as in the existing route suites.
 *
 * Part 1 characterises the live evidence shapes (no code path is changed by the
 * patch here). Parts 2-3 are the patch's regression tests.
 */
jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, remaining: 100 })),
  getClientIdentifier: jest.fn(() => "test-client"),
}))
jest.mock("@/lib/fulfillment-runtime/free-comparison", () => ({
  readFreeComparison: jest.fn(async () => ({ ok: false, blocker: "NEUTRAL_RAW_SOURCE_UNAVAILABLE" })),
}))

import { POST } from "@/app/api/free-check/route"
import { installFakeSocrata, assessedQueries, SYNTH_PIN, SYNTH_PIN_DASHED, SYNTH_AV, type FakeOptions } from "@/test-support/fake-cook-county-socrata"

const comparison = jest.requireMock("@/lib/fulfillment-runtime/free-comparison") as { readFreeComparison: jest.Mock }

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "OT_FORCE_PREVIEW_STUB", "NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB", "OT_FREE_CHECK_MEASUREMENT_ENABLED"] as const
const saved: Record<string, string | undefined> = {}
beforeAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const k of ENV_KEYS) saved[k] = env[k]
  env.NODE_ENV = "production"
  env.VERCEL_ENV = "production"
  delete env.OT_FORCE_PREVIEW_STUB
  delete env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB
  delete env.OT_FREE_CHECK_MEASUREMENT_ENABLED
})
afterAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k] }
})
beforeEach(() => {
  comparison.readFreeComparison.mockClear()
  jest.spyOn(console, "error").mockImplementation(() => {})
  jest.spyOn(console, "warn").mockImplementation(() => {})
  comparison.readFreeComparison.mockResolvedValue({ ok: false, blocker: "NEUTRAL_RAW_SOURCE_UNAVAILABLE" })
})
afterEach(() => jest.restoreAllMocks())

const INPUTS: Record<string, Record<string, unknown>> = {
  "PIN unformatted": { pin: SYNTH_PIN },
  "PIN dashed": { pin: SYNTH_PIN_DASHED },
  address: { address: "100 Synthetic St", city: "Testville" },
}

function req(body: unknown) {
  return { headers: { get: () => "overtaxed-il.com" }, json: async () => body } as unknown as Parameters<typeof POST>[0]
}
async function run(input: Record<string, unknown>, opts: FakeOptions = {}) {
  const fake = installFakeSocrata(opts)
  const res = await POST(req(input))
  return { status: res.status, body: await res.json(), calls: fake.calls }
}

function comparisonOk(n: number) {
  return {
    ok: true,
    comparison: {
      subject: { propertyClass: "203", township: "Synthetic", neighborhoodCode: "00000", taxYear: 2026, assessedTotalValue: SYNTH_AV },
      comparables: Array.from({ length: n }, (_, i) => ({
        pin: `0102030406${String(i).padStart(4, "0")}`, address: `${200 + i} SYNTHETIC ST`, city: "TESTVILLE",
        assessedValue: 30000 + i, squareFeet: 1500, yearBuilt: 1950, propertyClass: "203",
      })),
      sharedMetric: { version: "ot-shared-metric/v1", comparableMedian: { value: 1900, count: n, minimumCount: 3 } },
      comparisonEvidence: { selectionRuleId: "synthetic" },
      poolDispositions: [],
    },
  }
}

describe("1. characterisation of the live evidence shapes (real evaluator)", () => {
  it("comparison released → PIN-evidence shape: value shown, compCount 10, no_comparable_level", async () => {
    comparison.readFreeComparison.mockResolvedValue(comparisonOk(10))
    const r = await run(INPUTS["PIN dashed"])
    expect(r.status).toBe(200)
    expect(r.body.outcome).toMatchObject({ reason: "no_comparable_level", allowCheckout: false, showRecordComparison: true })
    expect(r.body.subject.assessedTotalValue).toBe(SYNTH_AV)
    expect(r.body.compCount).toBe(10)
  })
  it("comparison REFUSED with a found subject value → address-evidence shape: null value, compCount 0, no_comparables, no noAssessedValue key", async () => {
    const r = await run(INPUTS.address)
    expect(r.status).toBe(200)
    expect(r.body.outcome).toMatchObject({ reason: "no_comparables", allowCheckout: false, showRecordComparison: false })
    expect(r.body.subject.assessedTotalValue).toBeNull()
    expect(r.body.compCount).toBe(0)
    expect(r.body).not.toHaveProperty("noAssessedValue")
    expect(r.body.compSelection.label).toBe("No comparable properties are shown for this property.")
  })
  it("the no-assessed-value branch would instead say no_assessed_value with noAssessedValue true", async () => {
    const r = await run(INPUTS.address, { assessed: "empty" })
    expect(r.status).toBe(200)
    expect(r.body.outcome.reason).toBe("no_assessed_value")
    expect(r.body.noAssessedValue).toBe(true)
  })
})

describe("2. PIN/address convergence through the real lookup", () => {
  it("all three inputs reach the same canonical subject, outcome and assessed-value queries", async () => {
    comparison.readFreeComparison.mockResolvedValue(comparisonOk(10))
    const runs = []
    for (const input of Object.values(INPUTS)) { runs.push(await run(input)); jest.restoreAllMocks() }
    const pins = comparison.readFreeComparison.mock.calls.map((c) => c[0].propertyPin)
    expect(new Set(pins)).toEqual(new Set([SYNTH_PIN]))
    for (const r of runs) {
      expect(r.status).toBe(200)
      expect(r.body.subject.pin).toBe(SYNTH_PIN_DASHED)
      expect(r.body.subject.assessedTotalValue).toBe(SYNTH_AV)
      expect(r.body.outcome).toEqual(runs[0].body.outcome)
      expect(assessedQueries(r.calls).filter((u) => !u.includes("cookcounty.socrata")))
        .toEqual(assessedQueries(runs[0].calls).filter((u) => !u.includes("cookcounty.socrata")))
    }
  })
})

describe("3. outages fail closed as 503, distinct from no-data", () => {
  const cases: Array<[string, FakeOptions, string]> = [
    ["assessed value http500", { assessed: "http500" }, "ASSESSMENT_LOOKUP_UNAVAILABLE"],
    ["assessed value network", { assessed: "network" }, "ASSESSMENT_LOOKUP_UNAVAILABLE"],
    ["assessed value timeout", { assessed: "timeout" }, "ASSESSMENT_LOOKUP_UNAVAILABLE"],
    ["assessed value non-array 200", { assessed: "nonArray" }, "ASSESSMENT_LOOKUP_UNAVAILABLE"],
    ["empty answer contradicted by history", { assessed: "emptyButHistory" }, "ASSESSMENT_LOOKUP_UNAVAILABLE"],
    ["parcel current dataset fails", { parcelCurrent: "fail" }, "PROPERTY_LOOKUP_UNAVAILABLE"],
    ["parcel archived dataset fails", { parcelArchived: "fail" }, "PROPERTY_LOOKUP_UNAVAILABLE"],
    ["history throttled", { history: "fail" }, "PROPERTY_LOOKUP_UNAVAILABLE"],
    ["single-family chars fail", { singleFamily: "fail" }, "PROPERTY_LOOKUP_UNAVAILABLE"],
  ]
  for (const [inputName, input] of Object.entries(INPUTS)) {
    it.each(cases)(`${inputName} / %s → 503 %s`, async (_n, opts, code) => {
      const r = await run(input, opts)
      expect(r.status).toBe(503)
      expect(r.body).toEqual({
        error: "We could not reach the Cook County records service just now. Please try again in a few minutes — this is on our side, not your address.",
        code,
        retryable: true,
      })
      expect(comparison.readFreeComparison).not.toHaveBeenCalled()
    })
  }
  it.each(Object.entries(INPUTS))("%s / genuinely absent → unchanged 200 CC-05 no_assessed_value, checkout closed", async (_n, input) => {
    const r = await run(input, { assessed: "empty" })
    expect(r.status).toBe(200)
    expect(r.body.noAssessedValue).toBe(true)
    expect(r.body.outcome).toMatchObject({ code: "insufficient_evidence", reason: "no_assessed_value", allowCheckout: false })
    expect(r.body.subject.assessedTotalValue).toBeNull()
  })
  it("published zero keeps today's fail-closed no-value body (copy change is PROPOSED only)", async () => {
    const r = await run(INPUTS["PIN unformatted"], { assessed: "zero" })
    expect(r.status).toBe(200)
    expect(r.body.noAssessedValue).toBe(true)
    expect(r.body.outcome.allowCheckout).toBe(false)
  })
})
