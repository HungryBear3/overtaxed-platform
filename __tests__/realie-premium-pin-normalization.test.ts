/**
 * @jest-environment node
 *
 * Issue #17 — normalize 10-digit Realie Cook County base parcel IDs to 14-digit
 * PINs. Re-implemented against current main (NOT cherry-picked from stale PR #5).
 * No live Realie calls: the integration test mocks fetch.
 */
import {
  normalizeCookCountyPinFromRealie,
  fetchRealieComparables,
} from "@/lib/realie/premium-comparables"

describe("normalizeCookCountyPinFromRealie", () => {
  it("keeps a 14-digit PIN unchanged (dashed input, digits out)", () => {
    expect(normalizeCookCountyPinFromRealie("16-17-320-011-0000")).toBe("16173200110000")
  })

  it("keeps a 14-digit PIN unchanged (already normalized)", () => {
    expect(normalizeCookCountyPinFromRealie("16173200110000")).toBe("16173200110000")
  })

  it("expands a 10-digit base parcel ID deterministically to 14 digits (append 0000)", () => {
    expect(normalizeCookCountyPinFromRealie("1617320011")).toBe("16173200110000")
  })

  it("expands a dashed 10-digit base parcel ID to 14 digits", () => {
    expect(normalizeCookCountyPinFromRealie("16-17-320-011")).toBe("16173200110000")
  })

  it("rejects unsupported lengths and junk", () => {
    for (const bad of ["161732001", "1617320011000", "161732001100000", "", "abcdefghij", "1234567"]) {
      expect(normalizeCookCountyPinFromRealie(bad)).toBeNull()
    }
  })
})

describe("fetchRealieComparables — 10-digit Realie comp survives mapping", () => {
  const originalKey = process.env.REALIE_API_KEY
  afterEach(() => {
    process.env.REALIE_API_KEY = originalKey
    jest.restoreAllMocks()
  })

  function mockComps(comparables: unknown[]) {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ comparables }),
    } as Response)
  }

  it("keeps a comp whose parcelId is a 10-digit base parcel ID", async () => {
    process.env.REALIE_API_KEY = "test-key"
    mockComps([{ parcelId: "1617320011", addressFull: "1122 S Lombard Ave", transferPrice: 380000, buildingArea: 1800 }])

    const result = await fetchRealieComparables({ latitude: 41.88, longitude: -87.78, subjectPin: "16173200100000" })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.comps).toHaveLength(1)
    expect(result.comps[0]).toMatchObject({
      pin: "16-17-320-011-0000",
      pinRaw: "16173200110000",
      salePrice: 380000,
      pricePerSqft: 380000 / 1800,
    })
  })

  it("still maps a 14-digit parcelId comp unchanged", async () => {
    process.env.REALIE_API_KEY = "test-key"
    mockComps([{ parcelId: "16-17-320-022-0000", addressFull: "200 Main", transferPrice: 250000, buildingArea: 1000 }])
    const result = await fetchRealieComparables({ latitude: 41.88, longitude: -87.78, subjectPin: "16173200100000" })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.comps[0]?.pinRaw).toBe("16173200220000")
  })

  it("drops a comp whose parcelId has an unsupported length", async () => {
    process.env.REALIE_API_KEY = "test-key"
    mockComps([{ parcelId: "161732001", addressFull: "bad", transferPrice: 1, buildingArea: 1 }])
    const result = await fetchRealieComparables({ latitude: 41.88, longitude: -87.78 })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.comps).toHaveLength(0)
  })
})
