/**
 * @jest-environment node
 *
 * `searchPropertiesByAddress` at the dataset boundary.
 *
 * Socrata is mocked at `fetch`; no network call is made and no real address is
 * queried. The URLs asserted below are the ones the function builds, and the
 * fixtures are synthetic Cook County-shaped rows.
 *
 * Against the released parent this function had one attempt and two swallowed
 * `catch` blocks, so a total outage returned `{ success: true, data: [] }` —
 * identical, to every caller, to an address the county does not carry.
 */
import { searchPropertiesByAddress, ADDRESS_LOOKUP_UNAVAILABLE } from "@/lib/cook-county"

const PIN_ADDRESS_INDEX = "c49d-89sn"
const PARCEL_UNIVERSE = "tx2p-k2g9"

type Reply = { dataset: string; rows?: unknown[]; fail?: boolean }

let calls: string[] = []

/**
 * Answer per (dataset, attempt-index). `replies` is consumed in order; an
 * exhausted list answers with an empty row set, which is what Socrata does for
 * a query that matched nothing.
 */
function mockSocrata(replies: Reply[]) {
  calls = []
  const queue = [...replies]
  global.fetch = jest.fn(async (url: string) => {
    calls.push(url)
    const next = queue.shift()
    if (next?.fail) {
      return { ok: false, status: 503, statusText: "Service Unavailable", text: async () => "down" } as never
    }
    return { ok: true, status: 200, json: async () => next?.rows ?? [] } as never
  }) as unknown as typeof fetch
}

const row = (pin: string) => ({
  pin,
  property_address: "1234 N SAMPLE ST",
  property_city: "Chicago",
  property_zip: "60600",
})

const archivedRow = (pin: string, year = "2026") => ({
  pin,
  year,
  prop_address_full: "1234 N SAMPLE ST",
  prop_address_city_name: "Chicago",
  prop_address_zipcode_1: "60600",
})

const originalFetch = global.fetch
afterAll(() => { global.fetch = originalFetch })

function decodedWhere(url: string): string {
  return decodeURIComponent(new URL(url).search)
}

describe("searchPropertiesByAddress — widening", () => {
  it("stops at the first fragment that returns rows", async () => {
    mockSocrata([{ dataset: PIN_ADDRESS_INDEX, rows: [row("18062140010000")] }])

    const res = await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 25, {
      fragments: ["1234 N SAMPLE ST", "1234 N SAMPLE", "1234%SAMPLE"],
    })

    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(1)
    // One call: the caller's own string matched, so nothing widened.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(PIN_ADDRESS_INDEX)
  })

  it("widens to the next fragment only after both datasets return nothing", async () => {
    mockSocrata([
      { dataset: PIN_ADDRESS_INDEX, rows: [] },
      { dataset: PARCEL_UNIVERSE, rows: [] },
      { dataset: PIN_ADDRESS_INDEX, rows: [] },
      { dataset: PARCEL_UNIVERSE, rows: [] },
      { dataset: PIN_ADDRESS_INDEX, rows: [row("18062140010000")] },
    ])

    const res = await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 25, {
      fragments: ["1234 N SAMPLE ST", "1234 N SAMPLE", "1234%SAMPLE"],
    })

    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(1)
    expect(calls).toHaveLength(5)
    // The widest fragment is the one that matched, and it carries the wildcard
    // between house number and street name — the shape that finds a stored
    // directional the homeowner left out.
    expect(decodedWhere(calls[4])).toContain("%1234%SAMPLE%")
  })

  it("keeps the single-attempt behaviour when no fragments are supplied", async () => {
    mockSocrata([{ dataset: PIN_ADDRESS_INDEX, rows: [] }, { dataset: PARCEL_UNIVERSE, rows: [] }])

    const res = await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 5)

    expect(res.success).toBe(true)
    expect(res.data).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it("never lets a quote or a metacharacter reach the query literal", async () => {
    mockSocrata([{ dataset: PIN_ADDRESS_INDEX, rows: [row("18062140010000")] }])
    await searchPropertiesByAddress("1234 O'SAMPLE ST'; DROP TABLE parcels--", "Chicago", 5)

    const where = decodedWhere(calls[0])
    expect(where).not.toContain(";")
    expect(where).not.toContain("--")
    // A lone quote would close the literal; the escaped pair does not.
    expect(where).toContain("O''SAMPLE")
  })
})

describe("searchPropertiesByAddress — the authoritative fallback", () => {
  it("falls back to the archived Parcel Universe and normalizes its columns", async () => {
    mockSocrata([
      { dataset: PIN_ADDRESS_INDEX, fail: true },
      { dataset: PARCEL_UNIVERSE, rows: [archivedRow("18062140010000"), archivedRow("18062140010000", "2025")] },
    ])

    const res = await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 5)

    expect(res.success).toBe(true)
    expect(res.source).toContain("archived")
    // Deduped by PIN across tax years, and mapped onto the standard columns the
    // caller ranks against.
    expect(res.data).toHaveLength(1)
    expect(res.data?.[0].property_address).toBe("1234 N SAMPLE ST")
    expect(res.data?.[0].property_city).toBe("Chicago")
    expect(res.data?.[0].property_zip).toBe("60600")
  })

  it("queries the archived dataset on its own column names", async () => {
    mockSocrata([{ dataset: PIN_ADDRESS_INDEX, rows: [] }, { dataset: PARCEL_UNIVERSE, rows: [] }])
    await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 5)

    expect(decodedWhere(calls[1])).toContain("prop_address_full")
    expect(decodedWhere(calls[1])).toContain("prop_address_city_name")
  })
})

describe("searchPropertiesByAddress — outage is not a miss", () => {
  it("reports a service failure when every attempt against every dataset threw", async () => {
    mockSocrata([
      { dataset: PIN_ADDRESS_INDEX, fail: true },
      { dataset: PARCEL_UNIVERSE, fail: true },
      { dataset: PIN_ADDRESS_INDEX, fail: true },
      { dataset: PARCEL_UNIVERSE, fail: true },
    ])

    const res = await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 25, {
      fragments: ["1234 N SAMPLE ST", "1234%SAMPLE"],
    })

    expect(res.success).toBe(false)
    expect(res.error).toBe(ADDRESS_LOOKUP_UNAVAILABLE)
    expect(res.data).toBeNull()
  })

  it("reports a genuine miss when the datasets answered and had nothing", async () => {
    mockSocrata([{ dataset: PIN_ADDRESS_INDEX, rows: [] }, { dataset: PARCEL_UNIVERSE, rows: [] }])

    const res = await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 5)

    expect(res.success).toBe(true)
    expect(res.error).toBeNull()
    expect(res.data).toEqual([])
  })

  it("reports a miss, not an outage, when one dataset answered and the other failed", async () => {
    mockSocrata([{ dataset: PIN_ADDRESS_INDEX, rows: [] }, { dataset: PARCEL_UNIVERSE, fail: true }])

    const res = await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 5)

    expect(res.success).toBe(true)
    expect(res.data).toEqual([])
  })
})

describe("searchPropertiesByAddress — logging", () => {
  it("keeps the queried address out of the Socrata error line", async () => {
    const seen: string[] = []
    const spies = (["log", "warn", "error"] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        seen.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      }),
    )
    try {
      mockSocrata([{ dataset: PIN_ADDRESS_INDEX, fail: true }, { dataset: PARCEL_UNIVERSE, fail: true }])
      await searchPropertiesByAddress("1234 N SAMPLE ST", "Chicago", 5)
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }

    const logged = seen.join("\n")
    expect(logged).not.toMatch(/SAMPLE/i)
    expect(logged).not.toMatch(/1234/)
    expect(logged).not.toContain("$where")
  })
})
