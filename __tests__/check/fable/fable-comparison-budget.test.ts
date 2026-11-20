/**
 * @jest-environment node
 *
 * FABLE REVIEW (2026-11-19) — mechanism test, not a root-cause proof.
 *
 * `/api/free-check` end to end with the REAL subject lookup, REAL address helper,
 * REAL outcome evaluator and the REAL comparison reader (`readFreeComparison` →
 * `readFreePoolRuntime`). Only `globalThis.fetch`, the clock and the rate limiter
 * are replaced. The pool is the repo's own anonymized authentic fixture.
 *
 * What it establishes: with identical county data and an identical comparison
 * cost, the address path can refuse where the PIN path answers, purely because
 * the 22 s budget is counted from request start and the address search spends it
 * first. What it does NOT establish: that this is what happened in production.
 * Latency here is simulated by advancing a fake clock.
 */
jest.mock("server-only", () => ({}), { virtual: true })
jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, remaining: 100 })),
  getClientIdentifier: jest.fn(() => "test-client"),
}))

import { POST } from "@/app/api/free-check/route"
import { install, SUBJECT_DASHED, PIN_INPUT, ADDRESS_INPUT, type Latency } from "@/test-support/fable-free-check-county"

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "OT_FORCE_PREVIEW_STUB", "NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB", "OT_FREE_CHECK_MEASUREMENT_ENABLED"] as const
const saved: Record<string, string | undefined> = {}
let warn: jest.SpyInstance
beforeAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const k of ENV_KEYS) saved[k] = env[k]
  env.NODE_ENV = "production"; env.VERCEL_ENV = "production"
  delete env.OT_FORCE_PREVIEW_STUB; delete env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB; delete env.OT_FREE_CHECK_MEASUREMENT_ENABLED
})
afterAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k] }
})
beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-11-06T20:00:00.000Z"), doNotFake: ["nextTick", "queueMicrotask", "setTimeout", "clearTimeout", "setImmediate", "clearImmediate"] })
  jest.spyOn(console, "error").mockImplementation(() => {})
  jest.spyOn(console, "info").mockImplementation(() => {})
  warn = jest.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

async function run(input: Record<string, unknown>, latency: Latency = {}) {
  const fake = install(latency)
  const req = { headers: { get: () => "overtaxed-il.com" }, json: async () => input } as unknown as Parameters<typeof POST>[0]
  const res = await POST(req)
  return { status: res.status, body: await res.json(), ...fake }
}
const blockers = () => warn.mock.calls.filter((c) => c[0] === "[free-check] comparison unavailable:").map((c) => c[1])

/** The fields REPORT §1 lists, for the released (PIN-evidence) shape. */
function expectReleased(body: any) {
  expect(body.outcome).toEqual({ code: "insufficient_evidence", headline: expect.any(String), allowCheckout: false, reason: "no_comparable_level", showFigures: false, showRecordComparison: true })
  expect(body.subject.assessedTotalValue).toBe(33000)
  expect(body.compCount).toBe(10)
  expect(body.sharedMetric.comparableMedian).toMatchObject({ status: "COMPUTED", count: 10, minimumCount: 3 })
  expect(body.sharedMetric.comparableMedian.value).toBeCloseTo(1886.7686056372015, 8)
  expect(body.sharedMetric.subjectAssessedCentsPerBuildingSqft).toBeCloseTo(2029.520295202952, 8)
  expect(body.comparisonEvidence).toMatchObject({ candidateCount: 195, candidateAcceptedCount: 10, candidateExcludedCount: 28, sourceResponseCount: 18 })
  expect(body).not.toHaveProperty("noAssessedValue")
}
/** The address-evidence shape: every key evidence/address-recheck.json carries. */
function expectRefusedShape(body: any) {
  expect(body.success).toBe(true)
  expect(body.outcome).toEqual({ code: "insufficient_evidence", headline: expect.any(String), allowCheckout: false, reason: "no_comparables", showFigures: false, showRecordComparison: false })
  expect(body.subject.assessedTotalValue).toBeNull()
  expect(body.subject.marketValue).toBeNull()
  expect(body.subject.taxYear).toBe(2026)
  expect(body.compCount).toBe(0)
  expect(body.comps).toEqual([])
  expect(body.sharedMetric).toBeNull()
  expect(body.comparisonEvidence).toBeNull()
  expect(body.compSelection.label).toBe("No comparable properties are shown for this property.")
  expect(body).not.toHaveProperty("noAssessedValue")
  expect(body).not.toHaveProperty("message")
}

describe("same data, same reader: PIN and address agree when the budget is not spent", () => {
  it("PIN → released comparison with the live PIN evidence's figures", async () => {
    const r = await run(PIN_INPUT)
    expect(r.status).toBe(200)
    expectReleased(r.body)
    expect(r.addressCalls).toHaveLength(0)
    expect(r.comparisonCalls).toHaveLength(18)
    expect(blockers()).toEqual([])
  })
  it("address → the same released comparison", async () => {
    const pin = await run(PIN_INPUT)
    jest.restoreAllMocks(); warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const address = await run(ADDRESS_INPUT)
    expect(address.status).toBe(200)
    expectReleased(address.body)
    expect(address.body.subject.pin).toBe(SUBJECT_DASHED)
    expect(address.body.outcome).toEqual(pin.body.outcome)
    expect(address.body.sharedMetric).toEqual(pin.body.sharedMetric)
    expect(address.body.comparisonEvidence.candidatePoolSha256).toBe(pin.body.comparisonEvidence.candidatePoolSha256)
    expect(address.addressCalls.length).toBeGreaterThan(0)
  })
})

describe("the request-start budget: address search time is taken from the comparison", () => {
  it("address search uses the whole 22 s → zero comparison requests, NEUTRAL_RAW_SOURCE_UNAVAILABLE, address-evidence shape", async () => {
    const r = await run(ADDRESS_INPUT, { addressQueryMs: 22_000 })
    expect(r.status).toBe(200)
    expectRefusedShape(r.body)
    expect(r.comparisonCalls).toHaveLength(0)
    expect(blockers()).toEqual(["NEUTRAL_RAW_SOURCE_UNAVAILABLE"])
  })
  it("identical comparison cost: PIN answers, address refuses part-way", async () => {
    // 1 s per comparison request, serialised by the fake clock: 18 s in all.
    const pin = await run(PIN_INPUT, { comparisonRequestMs: 1_000 })
    expectReleased(pin.body)
    jest.restoreAllMocks(); warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    jest.setSystemTime(new Date("2026-11-06T21:00:00.000Z"))
    const address = await run(ADDRESS_INPUT, { addressQueryMs: 6_000, comparisonRequestMs: 1_000 })
    expectRefusedShape(address.body)
    expect(address.comparisonCalls.length).toBeGreaterThan(0)
    expect(address.comparisonCalls.length).toBeLessThan(18)
    expect(blockers()).toEqual(["NEUTRAL_RAW_SOURCE_UNAVAILABLE"])
  })
  it("the blocker name alone does not identify the cause: an upstream 429 logs the same name", async () => {
    const fake = install()
    const real = (globalThis.fetch as jest.Mock).getMockImplementation()!
    ;(globalThis.fetch as jest.Mock).mockImplementation(async (input: unknown, init?: unknown) => {
      const raw = String(input)
      if (raw.includes("/api/views/")) {
        const response = new Response("{}", { status: 429, headers: { "content-type": "application/json" } })
        Object.defineProperty(response, "url", { value: raw })
        return response
      }
      return real(input, init)
    })
    const req = { headers: { get: () => "overtaxed-il.com" }, json: async () => PIN_INPUT } as unknown as Parameters<typeof POST>[0]
    const body = await (await POST(req)).json()
    expectRefusedShape(body)
    expect(blockers()).toEqual(["NEUTRAL_RAW_SOURCE_UNAVAILABLE"])
    expect(fake.addressCalls).toHaveLength(0)
  })
})

describe("stages that ignore the budget", () => {
  it("address search and subject lookup run to completion even after the 22 s has gone", async () => {
    const r = await run(ADDRESS_INPUT, { addressQueryMs: 30_000 })
    // Nothing stops the request: the subject lookup still issues its queries
    // and the route still answers 200 after a simulated 30 s, past maxDuration.
    expect(r.lookupCalls.length).toBeGreaterThan(0)
    expect(r.status).toBe(200)
    expectRefusedShape(r.body)
  })
})
