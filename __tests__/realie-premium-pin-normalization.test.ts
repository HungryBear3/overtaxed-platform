/**
 * @jest-environment node
 */
import { normalizeCookCountyPinFromRealie } from "@/lib/realie/premium-comparables"
import { fetchRealieComparables } from "@/lib/realie/premium-comparables"

describe("Realie Premium Cook County PIN normalization", () => {
  const originalApiKey = process.env.REALIE_API_KEY

  afterEach(() => {
    process.env.REALIE_API_KEY = originalApiKey
    jest.restoreAllMocks()
  })

  it("keeps 14-digit Cook County PINs unchanged", () => {
    expect(normalizeCookCountyPinFromRealie("16-17-320-011-0000")).toBe("16173200110000")
  })

  it("expands Realie 10-digit base parcel IDs to 14-digit Cook County PINs", () => {
    expect(normalizeCookCountyPinFromRealie("1617320011")).toBe("16173200110000")
  })

  it("rejects unsupported parcel ID lengths", () => {
    expect(normalizeCookCountyPinFromRealie("161732001")).toBeNull()
  })

  it("keeps Realie Premium comps with 10-digit base parcel IDs", async () => {
    process.env.REALIE_API_KEY = "test-key"
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        comparables: [
          {
            parcelId: "1617320011",
            addressFull: "1122 S Lombard Ave",
            transferPrice: 380000,
            buildingArea: 1800,
          },
        ],
      }),
    } as Response)

    const result = await fetchRealieComparables({
      latitude: 41.88,
      longitude: -87.78,
      subjectPin: "16173200100000",
    })

    expect(result).toEqual({
      success: true,
      comps: [
        expect.objectContaining({
          pin: "16-17-320-011-0000",
          pinRaw: "16173200110000",
          salePrice: 380000,
          pricePerSqft: 380000 / 1800,
        }),
      ],
    })
  })
})
