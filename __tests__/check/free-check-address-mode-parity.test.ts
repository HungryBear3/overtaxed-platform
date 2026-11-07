/**
 * @jest-environment node
 *
 * Address mode and the remaining route boundaries, through the real POST, the
 * real reader and the real selector.
 *
 * CONTROLLED SYNTHETIC TRANSPORT. Every parcel here is invented. It proves
 * nothing about live county data or a real browser. The address search and the
 * subject lookup are stubbed, because their own behaviour belongs to
 * `free-check-route-address.test.ts`; what is proven here is that the parcel they
 * settle on is the parcel the comparison is read for, and nothing else.
 */

jest.mock("@/lib/cook-county", () => ({
  ...jest.requireActual("@/lib/cook-county"),
  getPropertyByPIN: jest.fn(),
  searchPropertiesByAddress: jest.fn(),
}))

jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, remaining: 100 })),
  getClientIdentifier: jest.fn(() => "synthetic-client"),
}))

jest.mock("@/lib/db/prisma", () => ({
  prisma: { $executeRaw: jest.fn(), $queryRaw: jest.fn() },
}))

import fs from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { POST } from "@/app/api/free-check/route"
import { FreeCheckResult, type Result } from "@/components/check/FreeCheckResult"
import { COUNTY_DATASETS } from "@/lib/fulfillment-runtime/t2-county-gateway"

const cookCounty = jest.requireMock("@/lib/cook-county") as {
  getPropertyByPIN: jest.Mock
  searchPropertiesByAddress: jest.Mock
}

const UNIVERSE = COUNTY_DATASETS.parcelUniverse.id
const CHARACTERISTICS = COUNTY_DATASETS.characteristics.id
const ASSESSED = COUNTY_DATASETS.assessedValues.id
const ADDRESSES = COUNTY_DATASETS.addresses.id

const SUBJECT_PIN = "14000000000050"
const SIBLING_PIN = "14000000000051"
const PEERS: Array<[string, number]> = [
  ["14000000000010", 22500],
  ["14000000000020", 24000],
  ["14000000000030", 25500],
]
const SUBJECT_ADDRESS = "1234 N SAMPLE ST"

type Row = Record<string, unknown>

/** Every parcel 1500 sq ft: $15, $16, $17 peers, so the median is $16.00. */
function parcels(): Array<[string, number]> {
  return [...PEERS, [SUBJECT_PIN, 30000], [SIBLING_PIN, 60000]]
}

function rowsFor(id: string): Row[] {
  const sorted = parcels().sort(([a], [b]) => (a < b ? -1 : 1))
  if (id === UNIVERSE) {
    return sorted.map(([pin]) => ({ pin, year: "2026", class: "203", township_code: "73", township_name: "Lake View", nbhd_code: "73012" }))
  }
  if (id === CHARACTERISTICS) {
    return sorted.map(([pin]) => ({
      pin,
      year: "2026",
      class: "203",
      township_code: "73",
      card: "1",
      pin_num_cards: "1",
      tieback_proration_rate: "1.0",
      card_proration_rate: "0.0",
      pin_num_landlines: "1",
      pin_is_multiland: false,
      char_bldg_sf: "1500",
      char_yrblt: "1950",
      // In the pool, refused by subtype, so its value cannot reach the median.
      char_type_resd: pin === SIBLING_PIN ? "1 Story" : "2 Story",
    }))
  }
  if (id === ASSESSED) {
    return sorted.map(([pin, mailed]) => ({
      pin,
      year: "2026",
      class: "203",
      township_code: "73",
      nbhd: "73012",
      mailed_tot: String(mailed),
      mailed_land: "1000",
      mailed_bldg: String(mailed - 1000),
    }))
  }
  if (id === ADDRESSES) {
    return sorted.map(([pin]) => ({
      pin,
      year: "2026",
      prop_address_full: pin === SUBJECT_PIN ? SUBJECT_ADDRESS : `${Number(pin.slice(-4))} N SAMPLE ST`,
      prop_address_city_name: "CHICAGO",
      prop_address_state: "IL",
    }))
  }
  return []
}

function metadata(id: string): Row {
  const dataset = Object.values(COUNTY_DATASETS).find((d) => d.id === id)!
  const fields = [...dataset.select.split(","), ...(id === ASSESSED ? ["mailed_land", "mailed_bldg"] : []), ...(id === CHARACTERISTICS ? ["card"] : [])]
  return {
    id,
    provenance: "official",
    rowsUpdatedAt: 1790000000,
    viewLastModified: 1790000000,
    tableId: 1,
    columns: fields.map((fieldName) => ({ fieldName, dataTypeName: fieldName === "pin_is_multiland" ? "checkbox" : "text" })),
  }
}

function respond(url: string, value: unknown): Response {
  const response = new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })
  Object.defineProperty(response, "url", { value: url })
  return response
}

function countyTransport() {
  const urls: string[] = []
  const fetcher = async (input: unknown): Promise<Response> => {
    const url = String(input)
    urls.push(url)
    const parsed = new URL(url)
    const id = parsed.pathname.split("/").pop()!.replace(".json", "")
    if (parsed.pathname.startsWith("/api/views/")) return respond(url, metadata(id))

    const where = parsed.searchParams.get("$where") ?? ""
    const select = parsed.searchParams.get("$select") ?? ""
    const one = /pin='(\d{14})'/.exec(where)?.[1]
    const some = /pin in\(([^)]*)\)/.exec(where)?.[1]
    const rows = rowsFor(id).filter((row) => (one ? row.pin === one : some ? some.includes(`'${String(row.pin)}'`) : true))
    if (select.startsWith("count(")) return respond(url, [{ n: String(rows.length) }])
    const offset = Number(parsed.searchParams.get("$offset") ?? 0)
    return respond(url, rows.slice(offset, offset + Number(parsed.searchParams.get("$limit") ?? 1000)))
  }
  ;(globalThis as { fetch: unknown }).fetch = fetcher
  return urls
}

function propertyRecord(pin: string, over: Record<string, unknown> = {}) {
  return {
    pin,
    address: SUBJECT_ADDRESS,
    city: "Chicago",
    zipCode: "60600",
    county: "Cook",
    township: "Lake View",
    neighborhood: "73012",
    buildingClass: "203",
    // Board-first, as the lookup reads it. Never the figure that reaches the brief.
    assessedTotalValue: 33000,
    marketValue: 330000,
    assessmentHistory: [{ year: 2026 }],
    livingArea: 1500,
    yearBuilt: 1950,
    bedrooms: 3,
    bathrooms: 2,
    exteriorWall: null,
    basement: null,
    garage: null,
    ...over,
  }
}

function req(body: unknown) {
  return {
    headers: { get: () => "overtaxed-il.com" },
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0]
}

const searchRow = (pin: string, property_address = SUBJECT_ADDRESS) => ({
  pin,
  property_address,
  property_city: "Chicago",
  property_zip: "60600",
})

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "OT_FORCE_PREVIEW_STUB", "NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB", "OT_FREE_CHECK_MEASUREMENT_ENABLED"] as const
const savedEnv: Record<string, string | undefined> = {}
const savedFetch = globalThis.fetch

const fakeClock = (now: string) =>
  jest.useFakeTimers({
    now: new Date(now),
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  })

beforeAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const key of ENV_KEYS) savedEnv[key] = env[key]
  env.NODE_ENV = "production"
  env.VERCEL_ENV = "production"
  delete env.OT_FORCE_PREVIEW_STUB
  delete env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB
  delete env.OT_FREE_CHECK_MEASUREMENT_ENABLED
})

afterAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete env[key]
    else env[key] = savedEnv[key]
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  fakeClock("2026-09-15T15:00:00.000Z")
})

afterEach(() => {
  jest.useRealTimers()
  ;(globalThis as { fetch: unknown }).fetch = savedFetch
})

describe("controlled synthetic transport: address mode reaches the same comparison", () => {
  it("reads the comparison for the parcel the address resolved to", async () => {
    const urls = countyTransport()
    cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [searchRow(SUBJECT_PIN)], error: null, source: "x" })
    cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord(SUBJECT_PIN), error: null })

    const response = await POST(req({ address: `${SUBJECT_ADDRESS}, Chicago IL 60600` }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(SUBJECT_PIN)
    expect(urls.some((url) => decodeURIComponent(url).includes(`pin='${SUBJECT_PIN}'`))).toBe(true)
    expect(body.subject.assessedTotalValue).toBe(30000)
    expect(body.sharedMetric.comparableMedian).toMatchObject({ value: 1600, count: 3 })
    expect(body.outcome.showRecordComparison).toBe(true)
  })

  it("reads for the posted selection and never for the other parcel at the address", async () => {
    const urls = countyTransport()
    cookCounty.searchPropertiesByAddress.mockResolvedValue({
      success: true,
      data: [searchRow(SUBJECT_PIN, `${SUBJECT_ADDRESS} APT 3B`), searchRow(SIBLING_PIN, `${SUBJECT_ADDRESS} APT 4A`)],
      error: null,
      source: "x",
    })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord(SUBJECT_PIN, { address: `${SUBJECT_ADDRESS} APT 3B` }),
      error: null,
    })

    const unselected = await POST(req({ address: `${SUBJECT_ADDRESS}, Chicago IL 60600` }))
    expect(unselected.status).toBe(409)
    expect(urls).toEqual([])

    const selected = await POST(req({ address: `${SUBJECT_ADDRESS}, Chicago IL 60600`, selectedPin: SUBJECT_PIN }))
    const body = await selected.json()

    expect(selected.status).toBe(200)
    expect(urls.some((url) => decodeURIComponent(url).includes(`pin='${SUBJECT_PIN}'`))).toBe(true)
    expect(urls.some((url) => decodeURIComponent(url).includes(`pin='${SIBLING_PIN}'`))).toBe(false)
    expect(body.subject.assessedTotalValue).toBe(30000)
    // The sibling is a peer of the subject, and is listed as one.
    expect(body.compCount).toBe(3)
  })

  it("makes no county read at all when the address evidence disagrees", async () => {
    const urls = countyTransport()
    cookCounty.searchPropertiesByAddress.mockResolvedValue({ success: true, data: [searchRow(SUBJECT_PIN)], error: null, source: "x" })
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord(SUBJECT_PIN, { address: "9876 S OTHER AVE" }),
      error: null,
    })

    const response = await POST(req({ address: `${SUBJECT_ADDRESS}, Chicago IL 60600` }))

    expect(response.status).toBe(409)
    expect(urls).toEqual([])
  })
})

describe("controlled synthetic transport: refusals the frozen suite does not reach", () => {
  it("withholds when the subject lookup and the county read name different townships", async () => {
    countyTransport()
    cookCounty.getPropertyByPIN.mockResolvedValue({
      success: true,
      data: propertyRecord(SUBJECT_PIN, { township: "Hyde Park" }),
      error: null,
    })

    const body = await (await POST(req({ pin: SUBJECT_PIN }))).json()

    expect(body.sharedMetric).toBeNull()
    expect(body.subject.assessedTotalValue).toBeNull()
    expect(body.outcome.reason).toBe("no_comparables")
  })

  it("makes no county read after the tax-year rollover, as the report refuses to", async () => {
    jest.useRealTimers()
    fakeClock("2027-01-15T15:00:00.000Z")
    const urls = countyTransport()
    cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord(SUBJECT_PIN), error: null })

    const body = await (await POST(req({ pin: SUBJECT_PIN }))).json()

    expect(urls).toEqual([])
    expect(body.sharedMetric).toBeNull()
    expect(body.compCount).toBe(0)
  })

  it("does not let a stale budget start a county read", async () => {
    const urls = countyTransport()
    const dateNow = jest.spyOn(Date, "now")
    // The deadline is taken from the first reading, which is already spent.
    dateNow.mockReturnValueOnce(Date.parse("2026-09-15T14:00:00.000Z"))
    cookCounty.getPropertyByPIN.mockResolvedValue({ success: true, data: propertyRecord(SUBJECT_PIN), error: null })

    const body = await (await POST(req({ pin: SUBJECT_PIN }))).json()
    dateNow.mockRestore()

    expect(urls).toEqual([])
    expect(body.sharedMetric).toBeNull()
  })
})

describe("the preview sample is synthetic and says so", () => {
  const preview = async () => {
    const env = process.env as Record<string, string | undefined>
    env.OT_FORCE_PREVIEW_STUB = "true"
    try {
      return await (await POST(req({ pin: SUBJECT_PIN }))).json()
    } finally {
      delete env.OT_FORCE_PREVIEW_STUB
    }
  }

  it("carries the report's shape, with no county evidence and no mean", async () => {
    const urls = countyTransport()
    const body = await preview()

    expect(urls).toEqual([])
    expect(body.comparisonEvidence).toBeNull()
    expect(body.avgComparableAssessedValue).toBeNull()
    expect(body.assessmentGap).toBeNull()
    expect(body.subject.marketValue).toBeNull()
    expect(body.compSelection.label).toMatch(/^Sample data/)
  })

  it("states a median that is the median of its own listed rows", async () => {
    const body = await preview()
    const perSqft = body.comps
      .map((comp: { assessedValue: number; squareFeet: number }) => comp.assessedValue / comp.squareFeet)
      .sort((a: number, b: number) => a - b)

    expect(body.sharedMetric.comparableMedian.value).toBeCloseTo(perSqft[1] * 100, 6)
  })

  it("renders the brief and no provenance line for the sample", async () => {
    const markup = renderToStaticMarkup(createElement(FreeCheckResult, { result: (await preview()) as Result }))

    expect(markup).toContain("Comparable median (3 properties, you excluded): $29.49")
    expect(markup).not.toContain("Avg of")
    expect(markup).not.toContain("public datasets")
    expect(markup).toContain("Sample data")
  })
})

describe("the request-scope reader stays out of storage", () => {
  const source = (relative: string) => fs.readFileSync(path.join(__dirname, "..", "..", relative), "utf8")

  it("imports nothing that can persist", () => {
    for (const relative of ["lib/fulfillment-runtime/free-comparison.ts", "lib/fulfillment-runtime/neutral-raw-gateway.ts"]) {
      const imports = [...source(relative).matchAll(/from "([^"]+)"/g)].map((match) => match[1])
      expect(imports.filter((name) => /^pg$|prisma|storage|store|blob|acquisition-snapshot|snapshot/i.test(name))).toEqual([])
    }
  })

  it("leaves the loose comparable lookups out of the route", () => {
    const route = source("app/api/free-check/route.ts")
    expect(route).not.toMatch(/getComparableSales|getComparableEquity/)
    expect(route).not.toMatch(/factualVersion/)
    expect(route).not.toMatch(/\/ ?compValues|\* 10\b/)
  })
})
