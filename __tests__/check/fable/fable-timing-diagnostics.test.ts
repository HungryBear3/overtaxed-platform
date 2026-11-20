/**
 * @jest-environment node
 *
 * FABLE REVIEW (2026-11-19) — acceptance test for FABLE-DIAGNOSTICS.diff only.
 * The timing line must exist on every check that reaches the comparison, carry
 * nothing but an input kind, a bounded blocker name and millisecond counts, and
 * change no response.
 */
jest.mock("server-only", () => ({}), { virtual: true })
jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, remaining: 100 })),
  getClientIdentifier: jest.fn(() => "test-client"),
}))

import { POST } from "@/app/api/free-check/route"
import { install, SUBJECT, PIN_INPUT, ADDRESS_INPUT, type Latency } from "@/test-support/fable-free-check-county"

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "OT_FORCE_PREVIEW_STUB", "NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB", "OT_FREE_CHECK_MEASUREMENT_ENABLED"] as const
const saved: Record<string, string | undefined> = {}
let info: jest.SpyInstance
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
  jest.spyOn(console, "warn").mockImplementation(() => {})
  info = jest.spyOn(console, "info").mockImplementation(() => {})
})
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

async function run(input: Record<string, unknown>, latency: Latency = {}) {
  install(latency)
  const req = { headers: { get: () => "overtaxed-il.com" }, json: async () => input } as unknown as Parameters<typeof POST>[0]
  const res = await POST(req)
  return { status: res.status, body: await res.json() }
}
const timing = () => info.mock.calls.filter((c) => c[0] === "[free-check] timing").map((c) => c[1] as Record<string, unknown>)

describe("[free-check] timing", () => {
  it("PIN, comparison ok: one line, addressMs null", async () => {
    await run(PIN_INPUT, { comparisonRequestMs: 1_000 })
    expect(timing()).toEqual([{ input: "pin", addressMs: null, lookupMs: 0, budgetLeftMs: 22_000, comparisonMs: 18_000, comparison: "ok" }])
  })
  it("address, budget spent by the search: the line shows where the time went", async () => {
    await run(ADDRESS_INPUT, { addressQueryMs: 22_000 })
    expect(timing()).toEqual([{ input: "address", addressMs: 22_000, lookupMs: 0, budgetLeftMs: 0, comparisonMs: 0, comparison: "NEUTRAL_RAW_SOURCE_UNAVAILABLE" }])
  })
  it("address, refused part-way: budget left and time spent are both visible", async () => {
    await run(ADDRESS_INPUT, { addressQueryMs: 6_000, comparisonRequestMs: 1_000 })
    const [line] = timing()
    expect(line).toMatchObject({ input: "address", addressMs: 6_000, budgetLeftMs: 16_000, comparison: "NEUTRAL_RAW_SOURCE_UNAVAILABLE" })
    expect(line.comparisonMs).toBeGreaterThanOrEqual(16_000)
  })
  it("carries only the six bounded fields: no PIN, address, city or figure anywhere in any log call", async () => {
    await run(ADDRESS_INPUT)
    await run(PIN_INPUT)
    for (const line of timing()) expect(Object.keys(line).sort()).toEqual(["addressMs", "budgetLeftMs", "comparison", "comparisonMs", "input", "lookupMs"])
    const everything = JSON.stringify(info.mock.calls)
    expect(everything).not.toContain(SUBJECT)
    expect(everything).not.toMatch(/SYNTHETIC|Synthetic St|33000|\d{2}-\d{2}-\d{3}-\d{3}-\d{4}/)
  })
  it("no line when the check never reaches the comparison (sample address short-circuit)", async () => {
    const r = await run({ address: "123 S Sample Ave" })
    expect(r.status).toBe(200)
    expect(timing()).toEqual([])
  })
})
