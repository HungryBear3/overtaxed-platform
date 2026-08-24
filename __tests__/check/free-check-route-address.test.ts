/**
 * @jest-environment node
 *
 * `/api/free-check`, address mode, against the released parent's two defects.
 *
 * Every address, PIN, city and ZIP in this file is synthetic. PINs are built
 * from a fixed prefix and an index, and the residential street is "Sample". The
 * numbered-route guard block names generic route forms — "US HIGHWAY 20",
 * "OLD ROAD 66" — because that is the record shape being guarded against; they
 * are route names, not anyone's address. No real homeowner input appears here,
 * and the log assertions at the bottom prove the route does not put any of it
 * into a console line either.
 *
 * Against `1f2d7aae`:
 *   - a provider outage and an address that is not on file produced the same
 *     400 telling the reader to go find their PIN;
 *   - a building with several parcels resolved to `search.data[0]`;
 *   - the record loaded for the chosen PIN was never checked against the
 *     address that was asked about;
 *   - a subject with no market value suppressed the entire assessed-value
 *     comparison, comps included.
 */

jest.mock("@/lib/cook-county", () => {
  const actual = jest.requireActual("@/lib/free-check-address")
  void actual
  return {
    getPropertyByPIN: jest.fn(),
    searchPropertiesByAddress: jest.fn(),
    getComparableSales: jest.fn(),
    getComparableEquity: jest.fn(),
    formatPIN: (v: string) => String(v),
    normalizePIN: (v: string) => String(v).replace(/\D/g, ""),
    isValidPIN: (v: string) => /^\d{14}$/.test(String(v).replace(/\D/g, "")),
    ADDRESS_LOOKUP_UNAVAILABLE: "address_lookup_unavailable",
  }
})

jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, remaining: 100 })),
  getClientIdentifier: jest.fn(() => "test-client"),
}))

import { POST } from "@/app/api/free-check/route"

const cookCounty = jest.requireMock("@/lib/cook-county") as {
  getPropertyByPIN: jest.Mock
  searchPropertiesByAddress: jest.Mock
  getComparableSales: jest.Mock
  getComparableEquity: jest.Mock
}

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "OT_FORCE_PREVIEW_STUB", "NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB"] as const
const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const key of ENV_KEYS) savedEnv[key] = env[key]
  // The route short-circuits to a static sample outside production, which would
  // make every assertion below a test of the fixture rather than of the flow.
  env.NODE_ENV = "production"
  env.VERCEL_ENV = "production"
  delete env.OT_FORCE_PREVIEW_STUB
  delete env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB
})

afterAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete env[key]
    else env[key] = savedEnv[key]
  }
})

beforeEach(() => jest.clearAllMocks())

const SUBJECT_ADDRESS = "1234 N Sample St, Chicago IL 60600"
const pinAt = (n: number) => `1806214${String(n).padStart(3, "0")}0000`

function req(body: unknown) {
  return {
    headers: { get: () => "overtaxed-il.com" },
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0]
}

function searchRow(over: Partial<Record<string, unknown>> & { pin: string }) {
  return { property_address: "1234 N SAMPLE ST", property_city: "Chicago", property_zip: "60600", ...over }
}

function propertyRecord(over: Record<string, unknown> = {}) {
  return {
    pin: pinAt(1),
    address: "1234 N SAMPLE ST",
    city: "Chicago",
    zipCode: "60600",
    county: "Cook",
    township: "Lake View",
    neighborhood: "70",
    buildingClass: "2-03",
    assessedTotalValue: 42500,
    marketValue: 425000,
    assessmentHistory: [{ year: 2026 }],
    livingArea: 1200,
    yearBuilt: 1925,
    bedrooms: 3,
    bathrooms: 2,
    exteriorWall: null,
    basement: null,
    garage: null,
    ...over,
  }
}

/** Equity comps carry an assessed market value and, by default, no sale. */
function equityComp(n: number, assessedMarketValue: number | null) {
  return {
    pin: pinAt(n),
    address: `12${n} N SAMPLE ST`,
    city: "Chicago",
    assessedMarketValue,
    livingArea: 1180,
    yearBuilt: 1924,
    buildingClass: "2-03",
  }
}

function stubComps(equity: unknown[], sales: unknown[] = []) {
  cookCounty.getComparableSales.mockResolvedValue({ success: true, data: sales, error: null, source: "Cook County Open Data - Parcel Sales" })
  cookCounty.getComparableEquity.mockResolvedValue({ success: true, data: equity, error: null, source: "Cook County Open Data" })
}

describe("address lookup — provider failure is not a fact about the address", () => {
  it("answers 503 and says the fault is ours when every dataset attempt failed", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: false,
      data: null,
      error: "address_lookup_unavailable",
      source: "Cook County Open Data",
    })

    const res = await POST(req({ address: SUBJECT_ADDRESS }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe("ADDRESS_LOOKUP_UNAVAILABLE")
    expect(body.retryable).toBe(true)
    expect(body.error).toMatch(/on our side, not your address/i)
    // The parent's sentence, which is now reserved for a genuine miss.
    expect(body.error).not.toMatch(/Try your 14-digit PIN/i)
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })

  it("answers 404 with the Assessor's own search when the county has no such address", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [], error: null, source: "x" })

    const res = await POST(req({ address: SUBJECT_ADDRESS }))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.code).toBe("ADDRESS_NOT_FOUND")
    expect(body.assessorAddressSearchUrl).toBe("https://www.cookcountyassessoril.gov/address-search")
    expect(body.retryable).toBeUndefined()
  })

  it("gives the two failures different codes and different sentences", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: false, data: null, error: "address_lookup_unavailable", source: "x" })
    const outage = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()
    cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [], error: null, source: "x" })
    const miss = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()

    expect(outage.code).not.toBe(miss.code)
    expect(outage.error).not.toBe(miss.error)
  })
})

describe("address lookup — the widened query and the ranker", () => {
  it("passes the widening fragments through to the dataset search", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [], error: null, source: "x" })
    await POST(req({ address: "1234 North Sample Street", city: "Chicago" }))

    const [address, city, limit, options] = cookCounty.searchPropertiesByAddress.mock.calls[0]
    expect(address).toBe("1234 N SAMPLE ST")
    expect(city).toBe("Chicago")
    expect(limit).toBeGreaterThanOrEqual(25)
    expect(options.fragments).toEqual(["1234 N SAMPLE ST", "1234 N SAMPLE", "1234%SAMPLE"])
  })

  it("retries once without the city when the strict search answered empty", async () => {
    cookCounty.searchPropertiesByAddress
      .mockResolvedValueOnce({ success: true, data: [], error: null, source: "x" })
      .mockResolvedValueOnce({
        success: true,
        data: [searchRow({ pin: pinAt(1), property_city: "Evanston", property_zip: "60201" })],
        error: null,
        source: "x",
      })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ city: "Evanston", zipCode: "60201" }),
      error: null,
    })
    stubComps([equityComp(2, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS, city: "Chcago" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(cookCounty.searchPropertiesByAddress).toHaveBeenNthCalledWith(
      1,
      "1234 N SAMPLE ST",
      "Chcago",
      expect.any(Number),
      expect.objectContaining({ fragments: ["1234 N SAMPLE ST", "1234 N SAMPLE", "1234%SAMPLE"] }),
    )
    expect(cookCounty.searchPropertiesByAddress).toHaveBeenNthCalledWith(
      2,
      "1234 N SAMPLE ST",
      undefined,
      expect.any(Number),
      expect.objectContaining({ fragments: ["1234 N SAMPLE ST", "1234 N SAMPLE", "1234%SAMPLE"] }),
    )
  })

  it("returns a retryable 503 when the city-relaxed provider attempt fails", async () => {
    cookCounty.searchPropertiesByAddress
      .mockResolvedValueOnce({ success: true, data: [], error: null, source: "x" })
      .mockResolvedValueOnce({
        success: false,
        data: null,
        error: "address_lookup_unavailable",
        source: "Cook County Open Data",
      })

    const res = await POST(req({ address: SUBJECT_ADDRESS, city: "Chcago" }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe("ADDRESS_LOOKUP_UNAVAILABLE")
    expect(body.retryable).toBe(true)
    expect(body.error).toMatch(/on our side, not your address/i)
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })

  it("does not let the city-relaxed retry create a cross-street match", async () => {
    cookCounty.searchPropertiesByAddress
      .mockResolvedValueOnce({ success: true, data: [], error: null, source: "x" })
      .mockResolvedValueOnce({
        success: true,
        data: [searchRow({ pin: pinAt(1), property_address: "1234 N OTHER ST", property_city: "Evanston" })],
        error: null,
        source: "x",
      })

    const res = await POST(req({ address: SUBJECT_ADDRESS, city: "Chcago" }))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.code).toBe("ADDRESS_NOT_FOUND")
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })

  it("resolves a spelled-out address whose record stores the abbreviated form", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord(), error: null })
    stubComps([equityComp(2, 364000), equityComp(3, 348000)])

    const res = await POST(req({ address: "1234 North Sample Street, Chicago, Illinois 60600" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(pinAt(1))
  })

  it("refuses to pick between the parcels of one building", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [pinAt(1), pinAt(2), pinAt(3)].map((pin) => searchRow({ pin })),
      error: null,
      source: "x",
    })

    const res = await POST(req({ address: SUBJECT_ADDRESS }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_AMBIGUOUS")
    expect(body.candidateCount).toBe(3)
    expect(body.candidates).toHaveLength(3)
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })

  it("offers only public-record fragments, never a score or the reader's input", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1), property_address: "1234 N SAMPLE ST APT 1" }), searchRow({ pin: pinAt(2) }), searchRow({ pin: pinAt(3) })],
      error: null,
      source: "x",
    })

    const body = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()
    for (const candidate of body.candidates) {
      expect(Object.keys(candidate).sort()).toEqual(["address", "city", "pin", "unit", "zipCode"])
    }
  })

  it("continues on a selectedPin that is one of the offered matches", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [pinAt(1), pinAt(2), pinAt(3)].map((pin) => searchRow({ pin })),
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord({ pin: pinAt(2) }), error: null })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS, selectedPin: pinAt(2) }))
    expect(res.status).toBe(200)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(pinAt(2))
  })

  it("rejects a selectedPin that is not one of them, without loading it", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [pinAt(1), pinAt(2), pinAt(3)].map((pin) => searchRow({ pin })),
      error: null,
      source: "x",
    })

    const res = await POST(req({ address: SUBJECT_ADDRESS, selectedPin: pinAt(99) }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_AMBIGUOUS")
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })

  /**
   * The county lookup is repeated on the selection round trip, and it can come
   * back narrower than it was: a partial dataset response, a cache difference,
   * a changed widening fragment. A posted selection is an authority boundary,
   * and none of those events transfers it to a parcel the reader never picked.
   */
  it("never loads a newly unique parcel in place of the posted selection", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(2) })],
      error: null,
      source: "x",
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS, selectedPin: pinAt(1) }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_AMBIGUOUS")
    expect(body.candidates.map((c: { pin: string }) => c.pin)).toEqual([pinAt(2)])
    // The parcel the second lookup found on its own is never the parcel loaded.
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
    expect(cookCounty.getComparableEquity).not.toHaveBeenCalled()
    expect(cookCounty.getComparableSales).not.toHaveBeenCalled()
  })

  it("selects the posted parcel even when another survivor now outscores it", async () => {
    // Same street and number, so both survive the ranker; only the stored
    // directional separates them, so the second lookup resolves as unique.
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [
        searchRow({ pin: pinAt(7), property_address: "1234 SAMPLE ST" }),
        searchRow({ pin: pinAt(8) }),
      ],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockImplementation(async (pin: string) =>
      pin === pinAt(7)
        ? { success: true, data: propertyRecord({ pin: pinAt(7), address: "1234 SAMPLE ST" }), error: null }
        : { success: true, data: propertyRecord({ pin: pinAt(8) }), error: null }
    )
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS, selectedPin: pinAt(7) }))

    expect(res.status).toBe(200)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(pinAt(7))
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalledWith(pinAt(8))
  })

  it("honors a posted selection that is the only parcel still matching", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord({ pin: pinAt(1) }), error: null })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS, selectedPin: pinAt(1) }))

    expect(res.status).toBe(200)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(pinAt(1))
  })
})

describe("address lookup — the county record appends the unit the index omits", () => {
  it("completes the selected parcel when only a bare terminal unit differs", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) }), searchRow({ pin: pinAt(2) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: "1234 N SAMPLE ST C23" }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS, selectedPin: pinAt(1) }))

    expect(res.status).toBe(200)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(pinAt(1))
  })

  it("still fails closed when the bare-unit record is a different building", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) }), searchRow({ pin: pinAt(2) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: "9876 N SAMPLE ST C23" }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS, selectedPin: pinAt(1) }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_EVIDENCE_MISMATCH")
    expect(cookCounty.getComparableEquity).not.toHaveBeenCalled()
  })
})

describe("address lookup — a numbered route is not a condo unit", () => {
  /**
   * The county's address index can carry `1234 W US HIGHWAY` while the record
   * for the same PIN reads `1234 W US HIGHWAY 20`. Those are two different
   * roads, and the parent fails the pair closed. Reading `20` as an
   * undesignated unit would corroborate them as one address — an exact PIN
   * match says the parcel was not swapped, it does not say the address agrees.
   */
  // [ homeowner input, index row the county offers, record the PIN loads ]
  const routes: Array<[string, string, string]> = [
    ["1234 W US Highway, Chicago IL 60600", "1234 W US HIGHWAY 20", "1234 W US HIGHWAY"],
    ["1234 W State Highway, Chicago IL 60600", "1234 W STATE HIGHWAY 20", "1234 W STATE HIGHWAY"],
    ["1234 N Old Road, Chicago IL 60600", "1234 N OLD ROAD 66", "1234 N OLD ROAD"],
    ["1234 N County Road, Chicago IL 60600", "1234 N COUNTY ROAD 12", "1234 N COUNTY ROAD"],
    ["1234 N Route, Chicago IL 60600", "1234 N ROUTE 53", "1234 N ROUTE"],
    // Lettered route numbers: the same token shape as a real condo unit, so
    // only the street identity left behind can tell them apart.
    ["1234 W State Highway, Chicago IL 60600", "1234 W STATE HIGHWAY 20A", "1234 W STATE HIGHWAY"],
    ["1234 W US Highway, Chicago IL 60600", "1234 W US HIGHWAY 12B", "1234 W US HIGHWAY"],
    ["1234 N Old Road, Chicago IL 60600", "1234 N OLD ROAD 66A", "1234 N OLD ROAD"],
    ["1234 N County Road, Chicago IL 60600", "1234 N COUNTY ROAD 12B", "1234 N COUNTY ROAD"],
    ["1234 N Route, Chicago IL 60600", "1234 N ROUTE 12B", "1234 N ROUTE"],
  ]

  it.each(routes)("keeps %s fail-closed when the record reads %s", async (input, recordAddress, indexAddress) => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1), property_address: indexAddress })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: recordAddress }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: input }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_EVIDENCE_MISMATCH")
    expect(body.subject).toBeUndefined()
    expect(cookCounty.getComparableEquity).not.toHaveBeenCalled()
    expect(cookCounty.getComparableSales).not.toHaveBeenCalled()
  })

  it.each([
    ["1234 N Old Orchard Rd, Chicago IL 60600", "1234 N OLD ORCHARD RD", "1234 N OLD ORCHARD RD B4"],
    ["1234 N County Line Rd, Chicago IL 60600", "1234 N COUNTY LINE RD", "1234 N COUNTY LINE RD PH2"],
  ])("completes %s, whose name only starts with a qualifier word", async (input, indexAddress, recordAddress) => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1), property_address: indexAddress })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: recordAddress }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: input }))
    expect(res.status).toBe(200)
  })

  it("still completes a letter-prefix unit the index row omits", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: "1234 N SAMPLE ST B4" }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS }))
    expect(res.status).toBe(200)
  })

  it("still completes a designated numeric unit on the record", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1), property_address: "1234 N SAMPLE ST APT 20" })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: "1234 N SAMPLE ST APT 20" }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: "1234 N Sample St Apt 20, Chicago IL 60600" }))
    expect(res.status).toBe(200)
  })
})

/**
 * The pair list above enumerates route identities, and an enumeration cannot be
 * shown complete: probes against `103308b` found route shapes it does not name
 * — `FEDERAL HWY 20A`, `TOWNSHIP RD 12B`, `FRONTAGE RD 66A` — resolving to a
 * 200 with a subject. What closes those is the shape of the terminal token
 * itself: an undesignated county terminal is a letter prefix followed by
 * digits, so a digit-prefix token is never read as a unit no matter what street
 * identity precedes it.
 */
describe("address lookup — an unenumerated route qualifier is not a condo unit", () => {
  // [ homeowner input, index row the county offers, record the PIN loads ]
  const routes: Array<[string, string, string]> = [
    ["1234 W Federal Hwy, Chicago IL 60600", "1234 W FEDERAL HWY", "1234 W FEDERAL HWY 20A"],
    ["1234 N Township Rd, Chicago IL 60600", "1234 N TOWNSHIP RD", "1234 N TOWNSHIP RD 12B"],
    ["1234 N Frontage Rd, Chicago IL 60600", "1234 N FRONTAGE RD", "1234 N FRONTAGE RD 66A"],
    ["1234 W Interstate Hwy, Chicago IL 60600", "1234 W INTERSTATE HWY", "1234 W INTERSTATE HWY 90A"],
    ["1234 N US Rd, Chicago IL 60600", "1234 N US RD", "1234 N US RD 12B"],
    ["1234 N State Rd, Chicago IL 60600", "1234 N STATE RD", "1234 N STATE RD 20A"],
    ["1234 N County Hwy, Chicago IL 60600", "1234 N COUNTY HWY", "1234 N COUNTY HWY 12B"],
  ]

  it.each(routes)("keeps %s fail-closed when the record reads %s", async (input, indexAddress, recordAddress) => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1), property_address: indexAddress })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: recordAddress }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: input }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_EVIDENCE_MISMATCH")
    expect(body.subject).toBeUndefined()
    expect(cookCounty.getComparableEquity).not.toHaveBeenCalled()
    expect(cookCounty.getComparableSales).not.toHaveBeenCalled()
  })
})

/**
 * The accepted availability trade. A real, undesignated county unit written
 * `4B` or `12E` has the shape of a lettered route number, and nothing on the
 * street line separates the two, so it now fails closed rather than risk
 * corroborating a different property. The designated forms are unaffected, and
 * a direct PIN remains the fallback.
 */
describe("address lookup — an undesignated digit-prefix unit fails closed", () => {
  const unrecognized: Array<[string, string, string]> = [
    ["1234 N Sample St, Chicago IL 60600", "1234 N SAMPLE ST", "1234 N SAMPLE ST 4B"],
    ["1234 N Old Orchard Rd, Chicago IL 60600", "1234 N OLD ORCHARD RD", "1234 N OLD ORCHARD RD 4B"],
    ["1234 N County Line Rd, Chicago IL 60600", "1234 N COUNTY LINE RD", "1234 N COUNTY LINE RD 12E"],
    ["1234 N US Cellular Plz, Chicago IL 60600", "1234 N US CELLULAR PLZ", "1234 N US CELLULAR PLZ 4B"],
  ]

  it.each(unrecognized)("stops %s when the record reads %s", async (input, indexAddress, recordAddress) => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1), property_address: indexAddress })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: recordAddress }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    const res = await POST(req({ address: input }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_EVIDENCE_MISMATCH")
    expect(body.subject).toBeUndefined()
    expect(cookCounty.getComparableEquity).not.toHaveBeenCalled()
    expect(cookCounty.getComparableSales).not.toHaveBeenCalled()
  })

  const designated: Array<[string, string]> = [
    ["1234 N Sample St Apt 4B, Chicago IL 60600", "1234 N SAMPLE ST APT 4B"],
    ["1234 N Sample St Unit 12E, Chicago IL 60600", "1234 N SAMPLE ST UNIT 12E"],
    ["1234 N Sample St #20, Chicago IL 60600", "1234 N SAMPLE ST #20"],
  ]

  it.each(designated)("still completes the designated form %s", async (input, address) => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1), property_address: address })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address }),
      error: null,
    })
    stubComps([equityComp(4, 364000)])

    expect((await POST(req({ address: input }))).status).toBe(200)
  })

  it.each(["1234 N SAMPLE ST C23", "1234 N SAMPLE ST PH2"])(
    "still completes the letter-prefix record %s the index row omits",
    async (recordAddress) => {
      cookCounty.searchPropertiesByAddress.mockResolvedValue({
        success: true,
        data: [searchRow({ pin: pinAt(1) })],
        error: null,
        source: "x",
      })
      cookCounty.getPropertyByPIN.mockResolvedValue({
        success: true,
        data: propertyRecord({ pin: pinAt(1), address: recordAddress }),
        error: null,
      })
      stubComps([equityComp(4, 364000)])

      expect((await POST(req({ address: SUBJECT_ADDRESS }))).status).toBe(200)
    },
  )
})

describe("address lookup — failing closed", () => {
  it("stops when the loaded record no longer describes the address asked about", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ address: "9876 S OTHER AVE" }),
      error: null,
    })
    stubComps([equityComp(2, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_EVIDENCE_MISMATCH")
    expect(cookCounty.getComparableEquity).not.toHaveBeenCalled()
  })

  it("stops when a selected unit loads a different unit on the second lookup", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [
        searchRow({ pin: pinAt(1), property_address: "1234 N SAMPLE ST APT 3B" }),
        searchRow({ pin: pinAt(2), property_address: "1234 N SAMPLE ST APT 4A" }),
      ],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ pin: pinAt(1), address: "1234 N SAMPLE ST APT 4A" }),
      error: null,
    })
    stubComps([equityComp(2, 364000)])

    const res = await POST(req({ address: SUBJECT_ADDRESS, selectedPin: pinAt(1) }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("ADDRESS_EVIDENCE_MISMATCH")
    expect(JSON.stringify(body)).not.toMatch(/score|matchedOn|buildingIdentity/i)
  })

  it("drops a malformed row rather than resolving it to a short PIN", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: "123" }), { property_address: "1234 N SAMPLE ST" }],
      error: null,
      source: "x",
    })

    const res = await POST(req({ address: SUBJECT_ADDRESS }))
    expect(res.status).toBe(404)
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })

  it("returns CC-06 with no figures for a record outside Cook County", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ county: "DuPage" }),
      error: null,
    })
    stubComps([equityComp(2, 364000), equityComp(3, 348000)])

    const body = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()
    expect(body.outcome.code).toBe("unsupported_property")
    expect(body.outcome.showFigures).toBe(false)
    expect(body.outcome.showRecordComparison).toBe(false)
    expect(body.comps).toEqual([])
    expect(body.avgComparableAssessedValue).toBeNull()
    expect(body.compCount).toBe(0)
  })
})

describe("the assessed-value comparison survives a missing market value", () => {
  beforeEach(() => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) })],
      error: null,
      source: "x",
    })
  })

  it("releases assessed values and their average when no market value is on file", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ marketValue: null }),
      error: null,
    })
    // 364000/10, 348000/10, 341000/10 → 36400, 34800, 34100 → avg 35100.
    stubComps([equityComp(2, 364000), equityComp(3, 348000), equityComp(4, 341000)])

    const body = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()

    expect(body.outcome.code).toBe("insufficient_evidence")
    expect(body.outcome.reason).toBe("no_comparable_level")
    // The level is withheld — it cannot be computed — but the record is not.
    expect(body.outcome.showFigures).toBe(false)
    expect(body.outcome.showRecordComparison).toBe(true)
    expect(body.equityRatio).toBeNull()
    expect(body.avgCompEquityRatio).toBeNull()
    expect(body.compCount).toBe(3)
    expect(body.comps).toHaveLength(3)
    expect(body.avgComparableAssessedValue).toBe(35100)
    expect(body.assessmentGap).toBe(42500 - 35100)
  })

  it("averages only the comps that validated, and reports that count", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ marketValue: null }),
      error: null,
    })
    // Two usable, two with nothing to read. 36400 and 34800 → 35600.
    stubComps([
      equityComp(2, 364000),
      equityComp(3, null),
      equityComp(4, 348000),
      equityComp(5, 0),
    ])

    const body = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()

    expect(body.compCount).toBe(2)
    expect(body.comps).toHaveLength(2)
    expect(body.avgComparableAssessedValue).toBe(35600)
    expect(body.comps.map((c: { assessedValue: number }) => c.assessedValue)).toEqual([36400, 34800])
  })

  it("says nothing about three when fewer than three survive", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ marketValue: null }),
      error: null,
    })
    stubComps([equityComp(2, 364000)])

    const body = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()
    expect(body.compCount).toBe(1)
    expect(body.comps).toHaveLength(1)
    expect(body.avgComparableAssessedValue).toBe(36400)
  })

  it("withholds the comparison when there is nothing to compare", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord({ marketValue: null }),
      error: null,
    })
    stubComps([])

    const body = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()
    expect(body.outcome.reason).toBe("no_comparables")
    expect(body.outcome.showRecordComparison).toBe(false)
    expect(body.compCount).toBe(0)
    expect(body.avgComparableAssessedValue).toBeNull()
  })
})

describe("the response describes how comparables were chosen, truthfully", () => {
  it("declares the selection as cohort-and-recency and not distance-ranked", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord(), error: null })
    stubComps([equityComp(2, 364000), equityComp(3, 348000)])

    const body = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()

    expect(body.compSelection.distanceRanked).toBe(false)
    expect(body.compSelection.basis).toBe("cohort_recency")
    expect(body.compSelection.label).not.toMatch(/nearest|nearby|closest/i)
    expect(JSON.stringify(body)).not.toMatch(/\bnearest\b|\bnearby\b/i)
  })

  it("still projects no overpayment on any path", async () => {
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow({ pin: pinAt(1) })],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord(), error: null })
    stubComps([equityComp(2, 364000), equityComp(3, 348000)])

    const body = await (await POST(req({ address: SUBJECT_ADDRESS }))).json()
    expect(body.potentialOverpaymentPerYear).toBeNull()
    expect(body.potentialOverpayment3Year).toBeNull()
  })
})

describe("the route writes no property input to a console line", () => {
  const SPIED = ["log", "warn", "error", "info", "debug"] as const

  it("logs neither the submitted address nor the resolved PIN on any branch", async () => {
    const seen: string[] = []
    const spies = SPIED.map((level) =>
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        seen.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      }),
    )
    try {
      // Success, ambiguity, mismatch, miss and outage in turn.
      cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [searchRow({ pin: pinAt(1) })], error: null, source: "x" })
      cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord(), error: null })
      stubComps([equityComp(2, 364000)])
      await POST(req({ address: SUBJECT_ADDRESS }))

      cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [pinAt(1), pinAt(2)].map((pin) => searchRow({ pin })), error: null, source: "x" })
      await POST(req({ address: SUBJECT_ADDRESS }))

      cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [searchRow({ pin: pinAt(1) })], error: null, source: "x" })
      cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord({ address: "9876 S OTHER AVE" }), error: null })
      await POST(req({ address: SUBJECT_ADDRESS }))

      cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [], error: null, source: "x" })
      await POST(req({ address: SUBJECT_ADDRESS }))

      cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: false, data: null, error: "address_lookup_unavailable", source: "x" })
      await POST(req({ address: SUBJECT_ADDRESS }))
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }

    const logged = seen.join("\n")
    expect(logged).not.toMatch(/SAMPLE/i)
    expect(logged).not.toMatch(/1234/)
    expect(logged).not.toMatch(/\d{14}/)
    expect(logged).not.toMatch(/\d{2}-\d{2}-\d{3}-\d{3}-\d{4}/)
  })
})
