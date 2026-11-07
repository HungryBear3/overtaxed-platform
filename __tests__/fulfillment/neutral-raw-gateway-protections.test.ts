/**
 * @jest-environment node
 *
 * The two gateway changes the free comparison needed, and proof the paid paths
 * did not move.
 *
 * Synthetic rows and a stubbed transport. `neutral-raw-gateway.test.ts` and
 * `t2-county-gateway.test.ts` stay unchanged and carry the existing behaviour;
 * this file adds the default-path request sequence, the opt-in protections, and
 * the extracted row rule.
 */
import { readNeutralOfficialBytesRuntime, verifyAndCopyNeutralEvidence, SHARED_COLLECTOR_PROTECTIONS } from "@/lib/fulfillment-runtime/neutral-raw-gateway"
import { COUNTY_DATASETS, parcelJoinRefusal } from "@/lib/fulfillment-runtime/t2-county-gateway"

const subjectPin = "14000000000000"
const otherPin = "14000000000001"
const PINS = [subjectPin, otherPin]

const UNIVERSE = COUNTY_DATASETS.parcelUniverse.id
const CHARACTERISTICS = COUNTY_DATASETS.characteristics.id
const ASSESSED = COUNTY_DATASETS.assessedValues.id
const ADDRESSES = COUNTY_DATASETS.addresses.id

type Row = Record<string, unknown>

function rowsFor(url: URL): Row[] {
  const id = url.pathname.split("/").pop()!.replace(".json", "")
  const select = url.searchParams.get("$select") ?? ""
  const where = url.searchParams.get("$where") ?? ""
  const universe = (pin: string) => ({ pin, year: "2026", class: "203", township_code: "70", township_name: "Lake", nbhd_code: "12" })
  if (select.startsWith("count(")) return [{ n: "2" }]
  if (id === UNIVERSE) return where.includes(`pin='${subjectPin}'`) ? [universe(subjectPin)] : PINS.map(universe)
  if (id === CHARACTERISTICS) return PINS.map((pin) => ({ pin, year: "2026", class: "203", township_code: "70", char_bldg_sf: "1200", char_yrblt: "1950", char_type_resd: "1 Story", pin_num_cards: "1" }))
  if (id === ASSESSED) return PINS.map((pin) => ({ pin, year: "2026", class: "203", township_code: "70", nbhd: "12", mailed_tot: "30000", mailed_land: "5000", mailed_bldg: "25000" }))
  if (id === ADDRESSES) return PINS.map((pin, i) => ({ pin, year: "2026", prop_address_full: `${i + 1} TEST ST`, prop_address_city_name: "Chicago", prop_address_state: "IL" }))
  return []
}

function metadata(id: string): Row {
  const dataset = Object.values(COUNTY_DATASETS).find((d) => d.id === id)!
  const fields = [...dataset.select.split(","), "mailed_land", "mailed_bldg"]
  return {
    id,
    provenance: "official",
    rowsUpdatedAt: 1790000000,
    viewLastModified: 1790000000,
    tableId: 1,
    columns: fields.map((fieldName) => ({ fieldName, dataTypeName: fieldName === "pin_is_multiland" ? "checkbox" : "text" })),
  }
}

async function read(options: { sharedSnapshotProtections?: boolean; change?: (url: URL, rows: Row[]) => Row[] } = {}) {
  const urls: URL[] = []
  const prior = globalThis.fetch
  ;(globalThis as { fetch: unknown }).fetch = async (raw: string) => {
    const url = new URL(raw)
    urls.push(url)
    const isMetadata = url.pathname.startsWith("/api/views/")
    const id = url.pathname.split("/").pop()!.replace(".json", "")
    const rows = rowsFor(url)
    const body = JSON.stringify(isMetadata ? metadata(id) : (options.change?.(url, rows) ?? rows))
    return { ok: true, status: 200, redirected: false, url: raw, headers: { get: () => "application/json" }, body: null, text: async () => body }
  }
  try {
    const result = await readNeutralOfficialBytesRuntime({ propertyPin: subjectPin, sharedSnapshotProtections: options.sharedSnapshotProtections })
    return { result, urls }
  } finally {
    ;(globalThis as { fetch: unknown }).fetch = prior
  }
}

const ANOTHER_NEIGHBORHOOD = (url: URL, rows: Row[]) =>
  url.pathname.includes(UNIVERSE) ? rows.map((row) => (row.pin === otherPin ? { ...row, nbhd_code: "99" } : row)) : rows

describe("the default path the paid report uses", () => {
  it("issues the same five requests, with no metadata, count or land and building read", async () => {
    const { result, urls } = await read()

    expect(result.ok).toBe(true)
    expect(urls.map((url) => url.pathname.split("/").pop())).toEqual([
      `${UNIVERSE}.json`,
      `${UNIVERSE}.json`,
      `${CHARACTERISTICS}.json`,
      `${ASSESSED}.json`,
      `${ADDRESSES}.json`,
    ])
    expect(urls.some((url) => url.pathname.startsWith("/api/views/"))).toBe(false)
    for (const url of urls) expect(url.searchParams.get("$select")).not.toMatch(/count\(|mailed_land|mailed_bldg/)
  })

  it("claims no protection it did not apply", async () => {
    const { result } = await read()
    if (!result.ok) throw new Error(result.blocker)
    expect(result.evidence.collectorProtections).toBeUndefined()
  })

  it("keeps its existing answer for a pool row outside the requested scope", async () => {
    const { result } = await read({ change: ANOTHER_NEIGHBORHOOD })
    expect(result.ok).toBe(true)
  })

  it("still passes the persistence boundary", async () => {
    const { result } = await read()
    if (!result.ok) throw new Error(result.blocker)
    expect(verifyAndCopyNeutralEvidence(result.evidence)).not.toBeNull()
  })
})

describe("the opt-in protections", () => {
  it("names every protection, and the persistence boundary refuses its evidence", async () => {
    const { result, urls } = await read({ sharedSnapshotProtections: true })
    if (!result.ok) throw new Error(result.blocker)

    expect(result.evidence.collectorProtections).toEqual([...SHARED_COLLECTOR_PROTECTIONS])
    expect(urls.filter((url) => url.pathname.startsWith("/api/views/"))).toHaveLength(8)
    expect(urls.filter((url) => url.searchParams.get("$select")?.startsWith("count("))).toHaveLength(2)
    // Free holds these bytes for one response. Requesting the protections grants
    // no transfer into the paid boundary, which admits resource URLs only.
    expect(verifyAndCopyNeutralEvidence(result.evidence)).toBeNull()
  })

  it("refuses a pool row outside the requested scope", async () => {
    const { result } = await read({ sharedSnapshotProtections: true, change: ANOTHER_NEIGHBORHOOD })
    expect(result).toEqual({ ok: false, blocker: "NEUTRAL_RAW_IDENTITY_CONFLICT" })
  })

  it("refuses a mailed total that is not its land plus its building", async () => {
    const { result } = await read({
      sharedSnapshotProtections: true,
      change: (url, rows) => (url.pathname.includes(ASSESSED) ? rows.map((row) => ({ ...row, mailed_land: "1" })) : rows),
    })
    expect(result).toEqual({ ok: false, blocker: "NEUTRAL_RAW_INCOMPLETE" })
  })
})

describe("parcelJoinRefusal is the report's own row rule", () => {
  const locality = { neighborhoodCode: "12", townshipCode: "70" }
  const characteristics: Row = {
    pin: otherPin,
    year: "2026",
    class: "203",
    township_code: "70",
    pin_num_cards: "1",
    pin_num_landlines: "1",
    pin_is_multiland: false,
    tieback_key_pin: null,
    tieback_proration_rate: null,
    card_proration_rate: null,
    char_bldg_sf: "1200",
    char_yrblt: "1950",
    char_type_resd: "1 Story",
  }
  const assessed: Row = { pin: otherPin, year: "2026", class: "203", township_code: "70", nbhd: "12", mailed_tot: "30000" }
  const address: Row = { pin: otherPin, year: "2026", prop_address_full: "2 TEST ST", prop_address_city_name: "Chicago", prop_address_state: "IL" }
  const refusal = (over: { characteristics?: Row; assessed?: Row; address?: Row } = {}, universeClass = "203") =>
    parcelJoinRefusal(
      otherPin,
      {
        characteristics: [{ ...characteristics, ...over.characteristics }],
        assessed: [{ ...assessed, ...over.assessed }],
        address: [{ ...address, ...over.address }],
      },
      universeClass,
      locality,
    )

  it("accepts a complete single-improvement parcel", () => {
    expect(refusal()).toBeNull()
  })

  it.each<[string, Parameters<typeof refusal>[0], string]>([
    ["a second landline", { characteristics: { pin_num_landlines: "2" } }, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS"],
    ["a multi-land flag", { characteristics: { pin_is_multiland: true } }, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS"],
    ["a foreign tieback", { characteristics: { tieback_key_pin: subjectPin } }, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS"],
    ["a partial proration", { characteristics: { card_proration_rate: "0.5" } }, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS"],
    ["a year built after the tax year", { characteristics: { char_yrblt: "2027" } }, "CANDIDATE_CHARACTERISTICS_INCOMPLETE"],
    ["a non-positive mailed total", { assessed: { mailed_tot: "0" } }, "CANDIDATE_ASSESSED_VALUE_INCOMPLETE"],
    ["an address outside Illinois", { address: { prop_address_state: "IN" } }, "CANDIDATE_ADDRESS_INCOMPLETE"],
    ["another year", { assessed: { year: "2025" } }, "COUNTY_RESPONSE_YEAR_MISMATCH"],
    ["another neighborhood", { assessed: { nbhd: "99" } }, "CANDIDATE_LOCALITY_MISMATCH"],
    ["a class the datasets disagree on", { assessed: { class: "204" } }, "CANDIDATE_CLASS_AMBIGUOUS"],
  ])("refuses %s", (_name, over, blocker) => {
    expect(refusal(over)).toBe(blocker)
  })

  it("refuses a parcel with no improvement row", () => {
    expect(parcelJoinRefusal(otherPin, { characteristics: [], assessed: [assessed], address: [address] }, "203", locality)).toBe(
      "CANDIDATE_CHARACTERISTICS_AMBIGUOUS",
    )
  })
})
