/**
 * @jest-environment node
 *
 * `getPropertyByPIN` (lib/cook-county/api.ts) against a synthetic provider:
 * outage vs no-data classification on the response wrapper (Fable H2/H4/M1-M3),
 * no raw provider text in `error`, and PIN-format convergence.
 * All network is mocked; see ./fake-socrata.
 */
import { getPropertyByPIN, PROPERTY_LOOKUP_UNAVAILABLE } from "@/lib/cook-county"
import { installFakeSocrata, assessedQueries, SYNTH_PIN, SYNTH_PIN_DASHED, SYNTH_AV, type FakeOptions } from "@/test-support/fake-cook-county-socrata"

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {})
  jest.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

async function lookup(opts: FakeOptions, pin = SYNTH_PIN) {
  const fake = installFakeSocrata(opts)
  const res = await getPropertyByPIN(pin)
  return { res, calls: fake.calls }
}

describe("canonical PIN convergence", () => {
  it("unformatted, dashed and spaced PINs issue identical upstream queries and return the same subject", async () => {
    const runs = []
    for (const pin of [SYNTH_PIN, SYNTH_PIN_DASHED, " 01 02 030 405 0000 "]) {
      runs.push(await lookup({}, pin))
      jest.restoreAllMocks()
    }
    for (const r of runs) {
      expect(r.res.data?.pin).toBe(SYNTH_PIN)
      expect(r.res.data?.assessedTotalValue).toBe(SYNTH_AV)
      expect(r.res.assessedValueLookup).toBe("found")
      expect([...r.calls].sort()).toEqual([...runs[0].calls].sort())
    }
  })
})

describe("assessed value classification rides the wrapper, not data (H4)", () => {
  it("found", async () => {
    const { res } = await lookup({ assessed: "found" })
    expect(res.success).toBe(true)
    expect(res.assessedValueLookup).toBe("found")
    expect(Object.keys(res.data ?? {})).not.toContain("assessedValueLookup")
  })
  it("absent: upstream answered, no row, no history value", async () => {
    const { res } = await lookup({ assessed: "empty" })
    expect(res.success).toBe(true)
    expect(res.data?.assessedTotalValue).toBeNull()
    expect(res.assessedValueLookup).toBe("absent")
  })
  it("zero: a published non-positive total is not 'absent' (M3)", async () => {
    const { res } = await lookup({ assessed: "zero" })
    expect(res.data?.assessedTotalValue).toBe(0)
    expect(res.assessedValueLookup).toBe("zero")
  })
  it.each(["http500", "network", "timeout", "nonArray"] as const)(
    "unavailable (%s): value stays null, never invented",
    async (mode) => {
      const { res, calls } = await lookup({ assessed: mode })
      expect(res.success).toBe(true)
      expect(res.data?.assessedTotalValue).toBeNull()
      expect(res.data?.marketValue).toBeNull()
      expect(res.assessedValueLookup).toBe("unavailable")
      expect(assessedQueries(calls).some((u) => u.includes("mailed_tot > 0"))).toBe(true)
    },
  )
  it("unavailable: empty current-value answer contradicted by a positive history row (M2)", async () => {
    const { res } = await lookup({ assessed: "emptyButHistory" })
    expect(res.data?.assessedTotalValue).toBeNull()
    expect(res.assessedValueLookup).toBe("unavailable")
  })
})

describe("subject-lookup outages return the sentinel, never provider text (H2)", () => {
  it.each([
    ["current parcel dataset fails", { parcelCurrent: "fail" }],
    ["archived parcel dataset fails", { parcelArchived: "fail" }],
    ["both parcel datasets fail", { parcelCurrent: "fail", parcelArchived: "fail" }],
    ["history query throttled", { history: "fail" }],
    ["single-family characteristics fail", { singleFamily: "fail" }],
  ] as Array<[string, FakeOptions]>)("%s", async (_name, opts) => {
    const { res } = await lookup(opts)
    expect(res.success).toBe(false)
    expect(res.data).toBeNull()
    expect(res.error).toBe(PROPERTY_LOOKUP_UNAVAILABLE)
    expect(String(res.error)).not.toMatch(/Socrata|aborted|429|500|not found/i)
  })
  it("a genuinely missing parcel is still 'not found', not the outage sentinel", async () => {
    const { res } = await lookup({}, "99999999999999")
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/^Property not found for PIN/)
  })
})
