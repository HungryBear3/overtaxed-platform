/**
 * @jest-environment node
 *
 * `readFreeComparison` over one authentic whole-pool county read, anonymized.
 *
 * The rows in `free-check-authentic-pool.json` are real: every proration marker,
 * card count, class, area, year, mailed figure and null is as the county published
 * it on 2026-11-06, including the 1.0 / 0.0 pattern no earlier fixture carried.
 * Only PIN, address, township and neighborhood are replaced, so no parcel here
 * identifies a home. The expected numbers were computed by a separate exact-decimal
 * script over the same rows, not by this code. The transport is an in-memory stub.
 */
jest.mock("server-only", () => ({}), { virtual: true })

import { candidatePoolSha256 } from "@/lib/fulfillment/t2-comparables"
import { readFreeComparison } from "@/lib/fulfillment-runtime/free-comparison"
import { COUNTY_DATASETS, parcelJoinRefusal } from "@/lib/fulfillment-runtime/t2-county-gateway"
import fixture from "../fixtures/free-check-authentic-pool.json"

type Row = Record<string, unknown>

const IDS = {
  universe: COUNTY_DATASETS.parcelUniverse.id,
  characteristics: COUNTY_DATASETS.characteristics.id,
  assessed: COUNTY_DATASETS.assessedValues.id,
  addresses: COUNTY_DATASETS.addresses.id,
}
const tables: Record<string, Row[]> = {
  [IDS.universe]: fixture.universe,
  [IDS.characteristics]: fixture.characteristics,
  [IDS.assessed]: fixture.assessed,
  [IDS.addresses]: fixture.addresses,
}
const EXTRA_COLUMNS = ["card", "mailed_land", "mailed_bldg"]

function respond(url: string, value: unknown): Response {
  const response = new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })
  Object.defineProperty(response, "url", { value: url })
  return response
}

type Fault = (url: URL, rows: Row[]) => Row[]

function county(fault?: Fault) {
  const calls: string[] = []
  const fetcher = async (raw: string) => {
    calls.push(raw)
    const url = new URL(raw)
    const id = url.pathname.split("/").pop()!.replace(".json", "")
    if (url.pathname.startsWith("/api/views/")) {
      const dataset = Object.values(COUNTY_DATASETS).find((d) => d.id === id)!
      return respond(raw, {
        id,
        provenance: "official",
        rowsUpdatedAt: 1793552580,
        viewLastModified: 1793552580,
        tableId: 1,
        columns: [...dataset.select.split(","), ...EXTRA_COLUMNS].map((fieldName) => ({
          fieldName,
          dataTypeName: fieldName === "pin_is_multiland" ? "checkbox" : "text",
        })),
      })
    }
    const where = url.searchParams.get("$where") ?? ""
    const select = url.searchParams.get("$select") ?? ""
    if (select.startsWith("count(")) return respond(raw, [{ n: String(tables[id].length) }])
    const single = where.match(/pin='(\d{14})'/)?.[1]
    const listed = where.match(/pin in\(([^)]*)\)/)?.[1]
    let rows = tables[id]
    if (single) rows = rows.filter((row) => row.pin === single)
    else if (listed) rows = rows.filter((row) => listed.includes(`'${row.pin}'`))
    const offset = Number(url.searchParams.get("$offset") ?? 0)
    const limit = Number(url.searchParams.get("$limit") ?? 1000)
    const page = rows.slice(offset, offset + limit)
    return respond(raw, fault ? fault(url, page) : page)
  }
  return { fetcher, calls }
}

async function run(propertyPin: string, fault?: Fault) {
  const { fetcher, calls } = county(fault)
  ;(globalThis as { fetch: unknown }).fetch = fetcher
  const result = await readFreeComparison({ propertyPin, expectedTownship: "Synthetic", deadline: Date.now() + 22_000 })
  return { result, calls }
}

const savedFetch = globalThis.fetch

beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-11-06T20:00:00.000Z"), doNotFake: ["nextTick", "queueMicrotask", "setTimeout", "clearTimeout", "setImmediate", "clearImmediate"] })
})

afterEach(() => {
  jest.useRealTimers()
  ;(globalThis as { fetch: unknown }).fetch = savedFetch
})

const NO_CHARACTERISTICS = "14990000000013"
const MULTI_CARD = "14990000000022"
const PRORATED = "14990000000064"
const INCOMPLETE_ADDRESS = "14990000000092"

describe("the county's real rows", () => {
  it("publish the unprorated pattern the paid rule refuses, on every ordinary parcel", () => {
    const whole = fixture.characteristics.filter((row) => row.tieback_proration_rate === "1.0" && row.card_proration_rate === "0.0")
    expect(whole.length).toBeGreaterThan(170)
    expect(fixture.characteristics.some((row) => row.card_proration_rate === "1.0")).toBe(false)
    const row = fixture.characteristics.find((candidate) => candidate.pin === fixture.subjectPin)!
    expect(
      parcelJoinRefusal(
        fixture.subjectPin,
        {
          characteristics: [row],
          assessed: fixture.assessed.filter((candidate) => candidate.pin === fixture.subjectPin),
          address: fixture.addresses.filter((candidate) => candidate.pin === fixture.subjectPin),
        },
        fixture.universe.find((candidate) => candidate.pin === fixture.subjectPin)!.class,
        { neighborhoodCode: "99001", townshipCode: "99" },
      ),
    ).toBe("CANDIDATE_CHARACTERISTICS_AMBIGUOUS")
  })

  it("yield the independently computed comparison", async () => {
    const { result } = await run(fixture.subjectPin)
    if (!result.ok) throw new Error(result.blocker)
    const { sharedMetric, comparisonEvidence, comparables } = result.comparison
    expect(comparables).toHaveLength(10)
    expect(sharedMetric.comparableMedian.count).toBe(10)
    expect(sharedMetric.comparableMedian.minimumCount).toBe(3)
    expect(sharedMetric.comparableMedian.value).toBeCloseTo(1886.7686056372017, 8)
    expect(sharedMetric.subjectAssessedCentsPerBuildingSqft).toBeCloseTo(2029.520295202952, 8)
    expect(sharedMetric.unit).toBe("ASSESSED_USD_CENTS_PER_BUILDING_SQFT")
    expect(comparisonEvidence.candidateCount).toBe(195)
    expect(comparisonEvidence.candidateExcludedCount).toBe(28)
    expect(comparisonEvidence.candidateExcludedByReason).toEqual({
      no_characteristics_record: 16,
      multi_card: 2,
      multi_land: 0,
      prorated_or_tied_back: 9,
      class_conflict: 0,
      invalid_characteristics: 0,
      no_mailed_value: 0,
      incomplete_address: 1,
    })
  })

  it("page the characteristics on their published key, so a parcel's cards cannot move between pages", async () => {
    const { calls } = await run(fixture.subjectPin)
    const reads = calls.map((raw) => new URL(raw)).filter((url) => url.pathname.endsWith(`/resource/${IDS.characteristics}.json`))
    expect(reads.length).toBeGreaterThan(0)
    for (const url of reads) {
      expect(url.searchParams.get("$order")).toBe("pin,card")
      expect(url.searchParams.get("$select")?.split(",")).toContain("card")
    }
  })

  it("accounts for every parcel in the pool exactly once", async () => {
    const { result } = await run(fixture.subjectPin)
    if (!result.ok) throw new Error(result.blocker)
    const { poolDispositions, comparisonEvidence } = result.comparison
    expect(poolDispositions.map(({ pin }) => pin)).toEqual(fixture.universe.map((row) => row.pin))
    const tally = (name: string) => poolDispositions.filter(({ disposition }) => disposition === name).length
    expect(tally("accepted")).toBe(comparisonEvidence.candidateAcceptedCount)
    expect(tally("multi_card")).toBe(2)
    expect(tally("same_parcel_as_subject")).toBe(1)
    expect(poolDispositions.find(({ pin }) => pin === NO_CHARACTERISTICS)?.disposition).toBe("no_characteristics_record")
    expect(poolDispositions.find(({ pin }) => pin === MULTI_CARD)?.disposition).toBe("multi_card")
    expect(poolDispositions.find(({ pin }) => pin === PRORATED)?.disposition).toBe("prorated_or_tied_back")
    expect(poolDispositions.find(({ pin }) => pin === INCOMPLETE_ADDRESS)?.disposition).toBe("incomplete_address")
  })

  it("binds the whole pool, so a quietly pruned pool has a different digest", async () => {
    const whole = await run(fixture.subjectPin)
    const pruned = fixture.universe.filter((row) => row.pin !== NO_CHARACTERISTICS)
    const saved = tables[IDS.universe]
    tables[IDS.universe] = pruned
    const smaller = await run(fixture.subjectPin)
    tables[IDS.universe] = saved
    if (!whole.result.ok || !smaller.result.ok) throw new Error("expected both reads to compare")
    expect(whole.result.comparison.comparisonEvidence.candidatePoolSha256).not.toBe(smaller.result.comparison.comparisonEvidence.candidatePoolSha256)
    expect(whole.result.comparison.comparisonEvidence.candidatePoolSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(candidatePoolSha256([])).not.toBe(whole.result.comparison.comparisonEvidence.candidatePoolSha256)
  })

  it("shows a comparison at exactly three comparables", async () => {
    const { result } = await run("14990000000002")
    if (!result.ok) throw new Error(result.blocker)
    expect(result.comparison.sharedMetric.comparableMedian.count).toBe(3)
    expect(result.comparison.sharedMetric.comparableMedian.value).toBeCloseTo(1797.5402081362347, 8)
  })

  it("refuses at two comparables", async () => {
    await expect(run("14990000000001")).resolves.toMatchObject({ result: { ok: false, blocker: "INSUFFICIENT_COMPARABLES" } })
  })

  it.each([
    ["no characteristics record", NO_CHARACTERISTICS, "FREE_SUBJECT_NO_CHARACTERISTICS_RECORD"],
    ["two cards", MULTI_CARD, "FREE_SUBJECT_MULTI_CARD"],
    ["a prorated building", PRORATED, "FREE_SUBJECT_PRORATED_OR_TIED_BACK"],
    ["an incomplete address", INCOMPLETE_ADDRESS, "FREE_SUBJECT_INCOMPLETE_ADDRESS"],
  ])("refuse a subject with %s, though the same parcel is only excluded as a peer", async (_name, pin, blocker) => {
    await expect(run(pin)).resolves.toMatchObject({ result: { ok: false, blocker } })
  })

  it("does not change the comparable set when every mailed value is permuted", async () => {
    const before = await run(fixture.subjectPin)
    const originals = tables[IDS.assessed]
    const peers = originals.filter((row) => row.pin !== fixture.subjectPin)
    const rotated = originals.map((row) => {
      if (row.pin === fixture.subjectPin) return row
      const donor = peers[(peers.findIndex((peer) => peer.pin === row.pin) + 7) % peers.length]
      return { ...row, mailed_tot: donor.mailed_tot, mailed_land: donor.mailed_land, mailed_bldg: donor.mailed_bldg }
    })
    tables[IDS.assessed] = rotated
    const after = await run(fixture.subjectPin)
    tables[IDS.assessed] = originals
    if (!before.result.ok || !after.result.ok) throw new Error("expected both reads to compare")
    const pins = (r: typeof before.result) => (r.ok ? r.comparison.comparables.map(({ pin }) => pin) : [])
    expect(pins(after.result)).toEqual(pins(before.result))
    expect(after.result.comparison.comparisonEvidence.candidateExcludedByReason).toEqual(before.result.comparison.comparisonEvidence.candidateExcludedByReason)
  })
})

describe("a damaged read of the same rows still refuses outright", () => {
  const resource = (url: URL, id: string) => url.pathname.endsWith(`/resource/${id}.json`)
  const isJoin = (url: URL) => (url.searchParams.get("$where") ?? "").includes("pin in(")

  const faults: Array<[string, Fault, string]> = [
    ["a repeated card on one parcel", (url, rows) => (resource(url, IDS.characteristics) && rows.length ? [rows[0], ...rows] : rows), "NEUTRAL_RAW_PAGINATION_CONFLICT"],
    ["characteristics out of key order", (url, rows) => (resource(url, IDS.characteristics) ? [...rows].reverse() : rows), "NEUTRAL_RAW_PAGINATION_CONFLICT"],
    ["a row with no card number", (url, rows) => (resource(url, IDS.characteristics) ? rows.map((row, i) => (i === 0 ? { ...row, card: null } : row)) : rows), "NEUTRAL_RAW_RESPONSE_INVALID"],
    ["a repeated assessed row", (url, rows) => (resource(url, IDS.assessed) && rows.length ? [rows[0], ...rows] : rows), "NEUTRAL_RAW_PAGINATION_CONFLICT"],
    ["a parcel nobody asked for", (url, rows) => (resource(url, IDS.addresses) && isJoin(url) ? rows.map((row, i) => (i === rows.length - 1 ? { ...row, pin: "14990000009999" } : row)) : rows), "NEUTRAL_RAW_IDENTITY_CONFLICT"],
    ["a row from another year", (url, rows) => (resource(url, IDS.assessed) ? rows.map((row, i) => (i === 0 ? { ...row, year: "2025" } : row)) : rows), "NEUTRAL_RAW_IDENTITY_CONFLICT"],
    ["a malformed PIN", (url, rows) => (resource(url, IDS.characteristics) ? rows.map((row, i) => (i === 0 ? { ...row, pin: "1" } : row)) : rows), "NEUTRAL_RAW_IDENTITY_CONFLICT"],
    ["an assessed row from another township", (url, rows) => (resource(url, IDS.assessed) ? rows.map((row, i) => (i === 0 ? { ...row, township_code: "10" } : row)) : rows), "FREE_LOCALITY_CONFLICT"],
  ]

  it.each(faults)("on %s", async (_name, fault, blocker) => {
    const { result } = await run(fixture.subjectPin, fault)
    expect(result).toEqual({ ok: false, blocker })
  })

  it("issues no further reads once a parallel read has refused", async () => {
    const { calls } = await run(fixture.subjectPin, (url, rows) => {
      if (resource(url, IDS.characteristics) && isJoin(url)) throw new Error("synthetic outage")
      return rows
    })
    // 195 parcels is two chunks per dataset. The second never starts, and neither do the after-reads.
    expect(calls.filter((url) => url.includes(`/resource/${IDS.assessed}`))).toHaveLength(1)
    expect(calls.filter((url) => decodeURIComponent(url).includes("count(*)"))).toHaveLength(1)
    expect(calls.filter((url) => url.includes("/api/views/"))).toHaveLength(4)
  })

  it("refuses a short final page rather than a smaller pool", async () => {
    const { result } = await run(fixture.subjectPin, (url, rows) =>
      resource(url, IDS.universe) && !(url.searchParams.get("$where") ?? "").includes("pin=") ? rows.slice(0, -1) : rows,
    )
    expect(result).toEqual({ ok: false, blocker: "NEUTRAL_RAW_PAGINATION_CONFLICT" })
  })

  it("names no parcel in a refusal", async () => {
    const { result } = await run(NO_CHARACTERISTICS)
    expect(JSON.stringify(result)).not.toMatch(/\d{14}/)
  })
})
