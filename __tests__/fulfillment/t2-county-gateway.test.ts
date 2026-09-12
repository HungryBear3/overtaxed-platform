/**
 * The strict official county reader.
 *
 * Every test drives an in-memory Socrata simulator through the injected `fetch`,
 * so nothing here opens a socket. The simulator deliberately does NOT apply the
 * tax-year predicate: the point of most of these cases is that the reader
 * re-verifies what came back instead of trusting the `$where` clause it sent, so
 * the simulator has to be able to answer with rows the query asked it to exclude.
 */
import { createHash } from "node:crypto"

import {
  COUNTY_DATASETS,
  JOIN_CHUNK_SIZE,
  MAX_RESPONSE_BYTES,
  MAX_RETRIEVAL_WINDOW_MS,
  OFFICIAL_TAX_YEAR,
  POOL_MAX_ROWS,
  POOL_PAGE_SIZE,
  fetchCountyEvidence,
  loadOfficialCountyData,
  parseOrderPin,
  type CountyBody,
  type CountyGatewayBlocker,
  type CountyGatewayDeps,
  type CountyResponse,
} from "@/lib/fulfillment-runtime/t2-county-gateway"

const TOWNSHIP_NAME = "Hyde Park"
const TOWNSHIP_CODE = "70"
const NBHD_CODE = "10011"
const SUBJECT_CLASS = "203"

type Row = Record<string, unknown>
type County = Record<string, Row[]>

/** Fourteen ascending digits, so the pool's ordering checks have something real to judge. */
function pinAt(index: number): string {
  return String(14000000000000 + index)
}

const SUBJECT_PIN = pinAt(0)

/**
 * A neighbourhood in which every parcel is fully evidenced on all four datasets.
 *
 * Values, areas and years vary across the pool so that a value-ordered read or a
 * lower-valued selection would be visible in the assertions.
 */
function makeCounty(size: number): County {
  const universe: Row[] = []
  const chars: Row[] = []
  const values: Row[] = []
  const addresses: Row[] = []

  for (let i = 0; i < size; i += 1) {
    const pin = pinAt(i)
    universe.push({
      pin,
      // Socrata renders whole values of a number column with a trailing `.0`.
      year: `${OFFICIAL_TAX_YEAR}.0`,
      class: SUBJECT_CLASS,
      township_code: TOWNSHIP_CODE,
      township_name: TOWNSHIP_NAME,
      nbhd_code: NBHD_CODE,
    })
    chars.push({
      pin,
      year: String(OFFICIAL_TAX_YEAR),
      class: SUBJECT_CLASS,
      township_code: TOWNSHIP_CODE,
      pin_num_cards: "1",
      pin_is_multiland: "false",
      pin_num_landlines: "1",
      tieback_key_pin: "",
      tieback_proration_rate: "",
      card_proration_rate: "",
      char_bldg_sf: String(1700 + (i % 7) * 25),
      char_yrblt: String(1950 + (i % 5)),
      char_type_resd: "2 Story",
    })
    values.push({
      pin,
      year: `${OFFICIAL_TAX_YEAR}.0`,
      class: SUBJECT_CLASS,
      township_code: TOWNSHIP_CODE,
      nbhd: NBHD_CODE,
      mailed_tot: String(25000 + i * 1000),
    })
    addresses.push({
      pin,
      year: `${OFFICIAL_TAX_YEAR}.0`,
      prop_address_full: `${1200 + i} S BLACKSTONE AVE`,
      prop_address_city_name: "CHICAGO",
      prop_address_state: "IL",
    })
  }

  return {
    [COUNTY_DATASETS.parcelUniverse.id]: universe,
    [COUNTY_DATASETS.characteristics.id]: chars,
    [COUNTY_DATASETS.assessedValues.id]: values,
    [COUNTY_DATASETS.addresses.id]: addresses,
  }
}

function rowsFor(county: County, datasetId: string): Row[] {
  return county[datasetId]
}

function findRow(county: County, datasetId: string, pin: string): Row {
  const row = rowsFor(county, datasetId).find((candidate) => candidate.pin === pin)
  if (!row) throw new Error(`fixture row missing: ${datasetId} ${pin}`)
  return row
}

function dropRow(county: County, datasetId: string, pin: string): void {
  county[datasetId] = rowsFor(county, datasetId).filter((row) => row.pin !== pin)
}

/** A body that yields its bytes in small chunks, so the streaming bound is exercised. */
function bodyOf(text: string): CountyBody {
  const bytes = Buffer.from(text, "utf8")
  let offset = 0
  let cancelled = false
  return {
    getReader: () => ({
      async read() {
        if (cancelled || offset >= bytes.length) return { done: true }
        const slice = bytes.subarray(offset, offset + 64)
        offset += 64
        return { done: false, value: new Uint8Array(slice) }
      },
      async cancel() {
        cancelled = true
      },
    }),
  }
}

type SimOptions = {
  /** Skip the class predicate, modelling a source that ignored what was sent. */
  applyClassFilter?: boolean
  /** Skip the neighbourhood and township predicates. */
  applyLocalityFilter?: boolean
  /** Return the pool unordered, modelling an unstable `$order`. */
  sort?: boolean
  /** Rewrite a count result. Receives the true count and the 0-based call index. */
  countOverride?: (datasetId: string, trueCount: number, callIndex: number) => number
  /** Rewrite a data page after filtering and before ordering. */
  transform?: (datasetId: string, rows: Row[], callIndex: number) => Row[]
  /** Replace the whole response. Returning `null` keeps the default. */
  respond?: (
    url: string,
    body: string,
    callIndex: number,
  ) => Partial<CountyResponse> | null
}

type Sim = {
  fetch: CountyGatewayDeps["fetch"]
  calls: Array<{ url: string; body: string }>
}

function makeSim(county: County, options: SimOptions = {}): Sim {
  const calls: Array<{ url: string; body: string }> = []
  const applyClassFilter = options.applyClassFilter ?? true
  const applyLocalityFilter = options.applyLocalityFilter ?? true
  const sort = options.sort ?? true

  const fetch: CountyGatewayDeps["fetch"] = async (url) => {
    const callIndex = calls.length
    const parsed = new URL(url)
    const datasetId = /\/resource\/([^/]+)\.json$/.exec(parsed.pathname)?.[1] ?? ""
    const select = parsed.searchParams.get("$select") ?? ""
    const where = parsed.searchParams.get("$where") ?? ""
    const limit = Number(parsed.searchParams.get("$limit") ?? "0")
    const offset = Number(parsed.searchParams.get("$offset") ?? "0")

    const pinEq = /pin='(\d+)'/.exec(where)?.[1]
    const pinIn = /pin in \(([^)]*)\)/.exec(where)?.[1]
    const nbhd = /nbhd_code='([^']*)'/.exec(where)?.[1]
    const township = /township_code='([^']*)'/.exec(where)?.[1]
    const wantsClass2 = where.includes("starts_with(class, '2')")

    const pinSet = pinIn
      ? new Set(pinIn.split(",").map((part) => part.trim().replace(/'/g, "")))
      : null

    // NOTE: the tax-year predicate is intentionally not applied here.
    let matched = rowsFor(county, datasetId).filter((row) => {
      const pin = String(row.pin ?? "")
      if (pinEq && pin !== pinEq) return false
      if (pinSet && !pinSet.has(pin)) return false
      if (applyLocalityFilter && nbhd != null && String(row.nbhd_code ?? "") !== nbhd) return false
      if (applyLocalityFilter && township != null && String(row.township_code ?? "") !== township) {
        return false
      }
      if (applyClassFilter && wantsClass2) {
        const rowClass = String(row.class ?? "")
        if (!rowClass.startsWith("2") || rowClass === "299") return false
      }
      return true
    })

    if (options.transform) matched = options.transform(datasetId, matched, callIndex)

    let payload: unknown
    if (select.startsWith("count(1)")) {
      const trueCount = matched.length
      const reported = options.countOverride
        ? options.countOverride(datasetId, trueCount, callIndex)
        : trueCount
      payload = [{ n: String(reported) }]
    } else {
      const ordered = sort
        ? [...matched].sort((a, b) => String(a.pin).localeCompare(String(b.pin)))
        : [...matched].reverse()
      payload = ordered.slice(offset, limit > 0 ? offset + limit : undefined)
    }

    const body = JSON.stringify(payload)
    calls.push({ url, body })

    const override = options.respond?.(url, body, callIndex) ?? null
    return {
      ok: true,
      status: 200,
      redirected: false,
      body: bodyOf(body),
      text: async () => body,
      ...(override ?? {}),
    }
  }

  return { fetch, calls }
}

/** A monotonic clock. `stepMs` advances it on every reading. */
function makeClock(startIso = "2026-09-12T15:00:00Z", stepMs = 0) {
  let current = new Date(startIso).getTime()
  return {
    now: () => {
      const value = new Date(current)
      current += stepMs
      return value
    },
    set: (iso: string) => {
      current = new Date(iso).getTime()
    },
  }
}

function makeDeps(sim: Sim, now: CountyGatewayDeps["now"] = makeClock().now): CountyGatewayDeps {
  return { fetch: sim.fetch, now }
}

const ORDER = { propertyPin: SUBJECT_PIN, township: TOWNSHIP_NAME }

async function run(county: County, options: SimOptions = {}, now?: CountyGatewayDeps["now"]) {
  const sim = makeSim(county, options)
  const result = await fetchCountyEvidence(ORDER, makeDeps(sim, now))
  return { result, sim }
}

async function expectBlocker(
  county: County,
  blocker: CountyGatewayBlocker,
  options: SimOptions = {},
  now?: CountyGatewayDeps["now"],
) {
  const { result } = await run(county, options, now)
  expect(result).toMatchObject({ ok: false, blocker })
}

/* --------------------------------------------------------------- happy path */

describe("fetchCountyEvidence — fully evidenced neighbourhood", () => {
  it("returns the subject, the whole pool, values and addresses", async () => {
    const county = makeCounty(6)
    const { result } = await run(county)

    if (!result.ok) throw new Error(`expected success, got ${result.blocker}`)
    const { evidence } = result

    expect(evidence.subject).toEqual({
      pin: SUBJECT_PIN,
      address: "1200 S BLACKSTONE AVE",
      city: "CHICAGO",
      township: TOWNSHIP_NAME,
      neighborhoodCode: NBHD_CODE,
      propertyClass: SUBJECT_CLASS,
      residentialSubtype: "2 Story",
      buildingSqft: 1700,
      yearBuilt: 1950,
      assessedTotalValue: 25000,
      assessmentStage: "mailed",
      taxYear: OFFICIAL_TAX_YEAR,
      pinCount: 1,
      inCookCounty: true,
    })

    // The WHOLE neighbourhood, subject included. The value-blind selector
    // downstream is what removes the subject, and it records doing so.
    expect(evidence.comparableCandidates).toHaveLength(6)
    expect(evidence.comparableCandidates.map((c) => c.pin)).toContain(SUBJECT_PIN)
    expect(evidence.comparableAssessedValues.size).toBe(6)
    expect(evidence.comparableAddresses.size).toBe(6)
    expect(evidence.comparableAddresses.get(pinAt(3))).toBe("1203 S BLACKSTONE AVE")
  })

  it("keeps candidates assessed far above the subject and applies no lower-valued filter", async () => {
    const county = makeCounty(6)
    // An order of magnitude above the subject: a directional selector would drop
    // it, and this reader has no direction to drop it by.
    findRow(county, COUNTY_DATASETS.assessedValues.id, pinAt(4)).mailed_tot = "900000"
    const { result, sim } = await run(county)

    if (!result.ok) throw new Error(`expected success, got ${result.blocker}`)
    expect(result.evidence.comparableAssessedValues.get(pinAt(4))).toBe(900000)
    expect(result.evidence.comparableCandidates.map((c) => c.pin)).toContain(pinAt(4))

    // Nothing about a value ever reaches the wire.
    for (const { url } of sim.calls) {
      const where = new URL(url).searchParams.get("$where") ?? ""
      const order = new URL(url).searchParams.get("$order")
      expect(where).not.toMatch(/mailed_tot|certified|board|av_|sale_price/)
      expect(order === null || order === "pin").toBe(true)
    }
  })

  it("never selects certified, board, owner, taxpayer or mailing columns", async () => {
    const county = makeCounty(4)
    const { sim } = await run(county)
    for (const { url } of sim.calls) {
      const select = new URL(url).searchParams.get("$select") ?? ""
      // `township_name` is a locality label and is fine; owner, taxpayer and
      // mailing columns are the ones that must never appear, as are the
      // certified and board assessment stages.
      expect(select).not.toMatch(/certified|board_|owner|taxpayer|mailing|mail_addr/)
    }
  })

  it("is reachable through the producer-facing adapter", async () => {
    const county = makeCounty(5)
    const sim = makeSim(county)
    const result = await loadOfficialCountyData(ORDER, makeDeps(sim))
    expect("blocker" in result).toBe(false)
    if ("blocker" in result) return
    expect(result.subject.pin).toBe(SUBJECT_PIN)
    expect(result.comparableAddresses.size).toBe(5)
    expect(result.sources.length).toBe(sim.calls.length)
  })
})

/* ------------------------------------------------------------------ receipts */

describe("source receipts", () => {
  it("records one receipt per request, each bound to its own page URL and bytes", async () => {
    const county = makeCounty(POOL_PAGE_SIZE + 20)
    const { result, sim } = await run(county)
    if (!result.ok) throw new Error(`expected success, got ${result.blocker}`)

    expect(result.evidence.sources).toHaveLength(sim.calls.length)
    result.evidence.sources.forEach((source, index) => {
      const call = sim.calls[index]
      expect(source.url).toBe(call.url)
      expect(source.contentSha256).toBe(createHash("sha256").update(call.body, "utf8").digest("hex"))
      expect(source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      expect(source.datasetTitle).not.toBe("")
    })

    // Paged reads produce distinct page URLs; one dataset URL standing in for a
    // set of paged responses would claim provenance the bytes do not have.
    const poolPages = sim.calls.filter(({ url }) => url.includes("%24offset"))
    expect(new Set(poolPages.map((call) => call.url)).size).toBe(poolPages.length)
    expect(poolPages.length).toBeGreaterThan(1)
  })

  it("dates each receipt from the clock reading that followed its response", async () => {
    const county = makeCounty(4)
    const { result } = await run(county, {}, makeClock("2026-09-12T15:00:00Z", 1_000).now)
    if (!result.ok) throw new Error(`expected success, got ${result.blocker}`)

    const stamps = result.evidence.sources.map((source) => source.retrievedAt)
    expect(stamps[0]).not.toBe(stamps[stamps.length - 1])
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i] >= stamps[i - 1]).toBe(true)
    }
  })
})

/* ------------------------------------------------------------ parcel identity */

describe("parseOrderPin", () => {
  it("accepts exactly fourteen digits and the county's canonical hyphenation", () => {
    expect(parseOrderPin("14054000010000")).toBe("14054000010000")
    expect(parseOrderPin("14-05-400-001-0000")).toBe("14054000010000")
    expect(parseOrderPin("  14054000010000  ")).toBe("14054000010000")
  })

  it("rejects anything else rather than stripping it into a plausible PIN", () => {
    for (const input of [
      "PIN: 14054000010000",
      "14054000010000x",
      "1405400001000",
      "140540000100001",
      "14-05-4000-01-0000",
      "14 05 400 001 0000",
      "",
    ]) {
      expect(parseOrderPin(input)).toBeNull()
    }
  })
})

describe("subject identity", () => {
  it("refuses a malformed order PIN before any request", async () => {
    const sim = makeSim(makeCounty(4))
    const result = await fetchCountyEvidence(
      { propertyPin: "not-a-pin", township: TOWNSHIP_NAME },
      makeDeps(sim),
    )
    expect(result).toMatchObject({ ok: false, blocker: "SUBJECT_PIN_INVALID" })
    expect(sim.calls).toHaveLength(0)
  })

  it("refuses when the parcel is absent", async () => {
    const county = makeCounty(4)
    dropRow(county, COUNTY_DATASETS.parcelUniverse.id, SUBJECT_PIN)
    await expectBlocker(county, "SUBJECT_PARCEL_NOT_FOUND")
  })

  it("refuses when the universe returns more than one row for the parcel", async () => {
    const county = makeCounty(4)
    const duplicate = { ...findRow(county, COUNTY_DATASETS.parcelUniverse.id, SUBJECT_PIN) }
    rowsFor(county, COUNTY_DATASETS.parcelUniverse.id).push(duplicate)
    await expectBlocker(county, "SUBJECT_PARCEL_AMBIGUOUS")
  })

  it("refuses when the row returned is not the parcel that was requested", async () => {
    const county = makeCounty(4)
    await expectBlocker(county, "SUBJECT_PARCEL_AMBIGUOUS", {
      transform: (datasetId, rows, callIndex) =>
        datasetId === COUNTY_DATASETS.parcelUniverse.id && callIndex === 0
          ? [{ ...rows[0], pin: pinAt(2) }]
          : rows,
    })
  })

  it("refuses when the subject row and its pool row disagree about class", async () => {
    const county = makeCounty(4)
    // The universe answers the by-PIN read and the pool read differently.
    await expectBlocker(county, "SUBJECT_RECORD_INCONSISTENT", {
      transform: (datasetId, rows, callIndex) =>
        datasetId === COUNTY_DATASETS.parcelUniverse.id && callIndex === 0
          ? [{ ...rows[0], class: "202" }]
          : rows,
    })
  })
})

/* ----------------------------------------------------------------- tax year */

describe("tax year", () => {
  it("refuses when the clock's Chicago year is not the authorised year", async () => {
    const county = makeCounty(4)
    await expectBlocker(county, "COUNTY_TAX_YEAR_UNVERIFIED", {}, makeClock("2027-01-05T12:00:00Z").now)
    await expectBlocker(county, "COUNTY_TAX_YEAR_UNVERIFIED", {}, makeClock("2025-12-31T12:00:00Z").now)
  })

  it("refuses a subject row carrying another year, even though the query filtered on one", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.parcelUniverse.id, SUBJECT_PIN).year = "2025.0"
    await expectBlocker(county, "COUNTY_RESPONSE_YEAR_MISMATCH")
  })

  it("refuses a joined characteristics row carrying another year", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(2)).year = "2025"
    await expectBlocker(county, "COUNTY_RESPONSE_YEAR_MISMATCH")
  })

  it("refuses a joined address row carrying another year", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.addresses.id, pinAt(1)).year = "2027.0"
    await expectBlocker(county, "COUNTY_RESPONSE_YEAR_MISMATCH")
  })

  it("accepts the trailing-zero rendering but not a fractional year", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.assessedValues.id, pinAt(1)).year = "2026.000"
    const { result } = await run(county)
    expect(result.ok).toBe(true)

    const fractional = makeCounty(4)
    findRow(fractional, COUNTY_DATASETS.assessedValues.id, pinAt(1)).year = "2026.5"
    await expectBlocker(fractional, "COUNTY_RESPONSE_YEAR_MISMATCH")
  })
})

/* --------------------------------------------------------- class and township */

describe("class and locality", () => {
  it("refuses a subject outside class 2, and condominium class 299", async () => {
    for (const propertyClass of ["299", "301", "100"]) {
      const county = makeCounty(4)
      findRow(county, COUNTY_DATASETS.parcelUniverse.id, SUBJECT_PIN).class = propertyClass
      await expectBlocker(county, "SUBJECT_CLASS_OUT_OF_SCOPE")
    }
  })

  it("refuses a pool row the class predicate should have excluded", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.parcelUniverse.id, pinAt(2)).class = "299"
    await expectBlocker(county, "CANDIDATE_POOL_UNSTABLE", { applyClassFilter: false })
  })

  it("refuses when the three datasets disagree about a parcel's class", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(1)).class = "204"
    await expectBlocker(county, "CANDIDATE_CLASS_AMBIGUOUS")
  })

  it("refuses when the order's township is not the county's township", async () => {
    const sim = makeSim(makeCounty(4))
    const result = await fetchCountyEvidence(
      { propertyPin: SUBJECT_PIN, township: "Lake View" },
      makeDeps(sim),
    )
    expect(result).toMatchObject({ ok: false, blocker: "SUBJECT_TOWNSHIP_MISMATCH" })
  })

  it("refuses a pool row from another township sharing the neighbourhood code", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.parcelUniverse.id, pinAt(3)).township_code = "71"
    await expectBlocker(county, "CANDIDATE_LOCALITY_MISMATCH", { applyLocalityFilter: false })
  })

  it("refuses a characteristics row from another township", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(2)).township_code = "71"
    await expectBlocker(county, "CANDIDATE_LOCALITY_MISMATCH")
  })

  it("refuses an assessed-value row whose neighbourhood is not the universe's", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.assessedValues.id, pinAt(2)).nbhd = "10099"
    await expectBlocker(county, "CANDIDATE_LOCALITY_MISMATCH")
  })

  it("refuses an absent neighbourhood, and a non-numeric one, without interpolating it", async () => {
    const missing = makeCounty(4)
    findRow(missing, COUNTY_DATASETS.parcelUniverse.id, SUBJECT_PIN).nbhd_code = ""
    await expectBlocker(missing, "SUBJECT_NEIGHBORHOOD_UNAVAILABLE")

    const injected = makeCounty(4)
    const hostile = "10011' OR '1'='1"
    findRow(injected, COUNTY_DATASETS.parcelUniverse.id, SUBJECT_PIN).nbhd_code = hostile
    const { result, sim } = await run(injected)
    expect(result).toMatchObject({ ok: false, blocker: "SUBJECT_LOCALITY_UNRECOGNIZED" })
    for (const { url } of sim.calls) expect(decodeURIComponent(url)).not.toContain("OR '1'='1")
  })

  it("refuses a non-numeric township code", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.parcelUniverse.id, SUBJECT_PIN).township_code = "70-A"
    await expectBlocker(county, "SUBJECT_LOCALITY_UNRECOGNIZED")
  })
})

/* --------------------------------------------------------- characteristics */

describe("improvement characteristics", () => {
  it("refuses a parcel with no characteristics row rather than dropping it", async () => {
    const county = makeCounty(5)
    dropRow(county, COUNTY_DATASETS.characteristics.id, pinAt(3))
    await expectBlocker(county, "CANDIDATE_CHARACTERISTICS_INCOMPLETE")
  })

  it("refuses duplicate improvement rows for one parcel", async () => {
    const county = makeCounty(4)
    rowsFor(county, COUNTY_DATASETS.characteristics.id).push({
      ...findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(2)),
    })
    await expectBlocker(county, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS")
  })

  it("requires every multi-parcel marker to be explicitly singular", async () => {
    const cases: Array<[string, unknown]> = [
      ["pin_num_cards", "2"],
      ["pin_num_cards", ""],
      ["pin_num_landlines", "2"],
      ["pin_num_landlines", ""],
      ["pin_is_multiland", "true"],
      ["pin_is_multiland", ""],
      ["pin_is_multiland", "maybe"],
    ]
    for (const [field, value] of cases) {
      const county = makeCounty(4)
      findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(1))[field] = value
      await expectBlocker(county, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS")
    }
  })

  it("treats an absent multi-parcel marker as absent, never as false", async () => {
    const county = makeCounty(4)
    delete findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(1)).pin_is_multiland
    await expectBlocker(county, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS")
  })

  it("refuses a tieback to another parcel or a proration below a whole share", async () => {
    const foreign = makeCounty(4)
    findRow(foreign, COUNTY_DATASETS.characteristics.id, pinAt(2)).tieback_key_pin = pinAt(3)
    await expectBlocker(foreign, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS")

    for (const field of ["tieback_proration_rate", "card_proration_rate"]) {
      const county = makeCounty(4)
      findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(2))[field] = "0.5"
      await expectBlocker(county, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS")
    }
  })

  it("permits an absent tieback and a whole-share proration", async () => {
    const county = makeCounty(4)
    const row = findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(2))
    delete row.tieback_key_pin
    row.tieback_proration_rate = "1.0"
    row.card_proration_rate = "1"
    const { result } = await run(county)
    expect(result.ok).toBe(true)
  })

  it("refuses missing, non-positive or unparseable features without imputing them", async () => {
    const cases: Array<[string, unknown]> = [
      ["char_bldg_sf", ""],
      ["char_bldg_sf", "0"],
      ["char_bldg_sf", "1,800"],
      ["char_bldg_sf", "about 1800"],
      ["char_yrblt", ""],
      ["char_yrblt", "1955.5"],
      ["char_type_resd", ""],
    ]
    for (const [field, value] of cases) {
      const county = makeCounty(4)
      findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(1))[field] = value
      await expectBlocker(county, "CANDIDATE_CHARACTERISTICS_INCOMPLETE")
    }
  })

  it("refuses a year built after the tax year being assessed", async () => {
    const county = makeCounty(4)
    findRow(county, COUNTY_DATASETS.characteristics.id, pinAt(1)).char_yrblt = String(
      OFFICIAL_TAX_YEAR + 1,
    )
    await expectBlocker(county, "CANDIDATE_CHARACTERISTICS_INCOMPLETE")
  })
})

/* --------------------------------------------------------- values, addresses */

describe("assessed values", () => {
  it("refuses a parcel with no mailed value rather than dropping it from the pool", async () => {
    const county = makeCounty(5)
    dropRow(county, COUNTY_DATASETS.assessedValues.id, pinAt(2))
    await expectBlocker(county, "CANDIDATE_ASSESSED_VALUE_INCOMPLETE")
  })

  it("refuses an empty or non-positive mailed total", async () => {
    for (const value of ["", "0", "-5", "n/a"]) {
      const county = makeCounty(4)
      findRow(county, COUNTY_DATASETS.assessedValues.id, pinAt(1)).mailed_tot = value
      await expectBlocker(county, "CANDIDATE_ASSESSED_VALUE_INCOMPLETE")
    }
  })

  it("refuses duplicate assessed-value rows for one parcel", async () => {
    const county = makeCounty(4)
    rowsFor(county, COUNTY_DATASETS.assessedValues.id).push({
      ...findRow(county, COUNTY_DATASETS.assessedValues.id, pinAt(1)),
    })
    await expectBlocker(county, "CANDIDATE_ASSESSED_VALUE_AMBIGUOUS")
  })
})

describe("published addresses", () => {
  it("refuses a parcel with no address row", async () => {
    const county = makeCounty(5)
    dropRow(county, COUNTY_DATASETS.addresses.id, pinAt(4))
    await expectBlocker(county, "CANDIDATE_ADDRESS_INCOMPLETE")
  })

  it("refuses an empty address, an empty city, or a state outside Illinois", async () => {
    const cases: Array<[string, unknown]> = [
      ["prop_address_full", ""],
      ["prop_address_city_name", ""],
      ["prop_address_state", "IN"],
      ["prop_address_state", ""],
    ]
    for (const [field, value] of cases) {
      const county = makeCounty(4)
      findRow(county, COUNTY_DATASETS.addresses.id, pinAt(1))[field] = value
      await expectBlocker(county, "CANDIDATE_ADDRESS_INCOMPLETE")
    }
  })

  it("refuses duplicate address rows for one parcel", async () => {
    const county = makeCounty(4)
    rowsFor(county, COUNTY_DATASETS.addresses.id).push({
      ...findRow(county, COUNTY_DATASETS.addresses.id, pinAt(2)),
    })
    await expectBlocker(county, "CANDIDATE_ADDRESS_AMBIGUOUS")
  })
})

/* --------------------------------------------------------------- pagination */

describe("pagination and pool stability", () => {
  it("walks a single short page", async () => {
    const { result, sim } = await run(makeCounty(6))
    expect(result.ok).toBe(true)
    const pages = sim.calls.filter(({ url }) => url.includes("%24offset"))
    expect(pages).toHaveLength(1)
  })

  it("continues past a full page and stops on the short one", async () => {
    const { result, sim } = await run(makeCounty(POOL_PAGE_SIZE + 7))
    if (!result.ok) throw new Error(`expected success, got ${result.blocker}`)
    expect(result.evidence.comparableCandidates).toHaveLength(POOL_PAGE_SIZE + 7)

    const offsets = sim.calls
      .filter(({ url }) => url.includes("%24offset"))
      .map(({ url }) => Number(new URL(url).searchParams.get("$offset")))
    expect(offsets).toEqual([0, POOL_PAGE_SIZE])
  })

  it("issues one further page when the result set ends exactly on a page boundary", async () => {
    const { result, sim } = await run(makeCounty(POOL_PAGE_SIZE))
    if (!result.ok) throw new Error(`expected success, got ${result.blocker}`)
    expect(result.evidence.comparableCandidates).toHaveLength(POOL_PAGE_SIZE)

    const offsets = sim.calls
      .filter(({ url }) => url.includes("%24offset"))
      .map(({ url }) => Number(new URL(url).searchParams.get("$offset")))
    expect(offsets).toEqual([0, POOL_PAGE_SIZE])
  })

  it("rejects a pool larger than the bound instead of truncating it", async () => {
    const county = makeCounty(8)
    await expectBlocker(county, "CANDIDATE_POOL_TOO_LARGE", {
      countOverride: (_datasetId, trueCount) => Math.max(trueCount, POOL_MAX_ROWS + 1),
    })
  })

  it("rejects a walk that outruns a count which under-reported the pool", async () => {
    const county = makeCounty(POOL_PAGE_SIZE + 7)
    await expectBlocker(county, "CANDIDATE_POOL_UNSTABLE", {
      countOverride: (datasetId, trueCount) =>
        datasetId === COUNTY_DATASETS.parcelUniverse.id ? 12 : trueCount,
    })
  })

  it("rejects a pool whose count drifts across the walk", async () => {
    const county = makeCounty(6)
    let counts = 0
    await expectBlocker(county, "CANDIDATE_POOL_UNSTABLE", {
      countOverride: (_datasetId, trueCount) => {
        counts += 1
        return counts === 1 ? trueCount : trueCount + 1
      },
    })
  })

  it("rejects duplicated parcels inside the pool", async () => {
    const county = makeCounty(6)
    rowsFor(county, COUNTY_DATASETS.parcelUniverse.id).push({
      ...findRow(county, COUNTY_DATASETS.parcelUniverse.id, pinAt(2)),
    })
    await expectBlocker(county, "CANDIDATE_POOL_UNSTABLE")
  })

  it("rejects a pool that is not returned in stable ascending parcel order", async () => {
    await expectBlocker(makeCounty(6), "CANDIDATE_POOL_UNSTABLE", { sort: false })
  })

  it("rejects an empty neighbourhood", async () => {
    const county = makeCounty(1)
    // The subject alone is a pool; removing it would fail the by-PIN read first,
    // so drive the empty case through a pool read that returns nothing.
    await expectBlocker(county, "CANDIDATE_POOL_EMPTY", {
      transform: (datasetId, rows, callIndex) =>
        datasetId === COUNTY_DATASETS.parcelUniverse.id && callIndex > 0 ? [] : rows,
    })
  })

  it("validates each join chunk against that chunk's own parcels", async () => {
    const county = makeCounty(JOIN_CHUNK_SIZE + 5)
    // The source answers a chunk with a parcel from a different chunk.
    await expectBlocker(county, "CANDIDATE_CHARACTERISTICS_AMBIGUOUS", {
      transform: (datasetId, rows) => {
        if (datasetId !== COUNTY_DATASETS.characteristics.id || rows.length === 0) return rows
        const foreign = rows.some((row) => row.pin === pinAt(0))
        return foreign ? [...rows, { ...rows[0], pin: pinAt(JOIN_CHUNK_SIZE + 1) }] : rows
      },
    })
  })
})

/* ---------------------------------------------------------- upstream failure */

describe("upstream failures", () => {
  const county = () => makeCounty(4)

  it("refuses a non-200 response", async () => {
    await expectBlocker(county(), "COUNTY_SOURCE_UNAVAILABLE", {
      respond: () => ({ ok: false, status: 503 }),
    })
  })

  it("refuses a response that reports having been redirected", async () => {
    await expectBlocker(county(), "COUNTY_SOURCE_UNAVAILABLE", {
      respond: () => ({ redirected: true }),
    })
  })

  it("refuses a body that is not JSON, and one that is not an array", async () => {
    await expectBlocker(county(), "COUNTY_SOURCE_UNAVAILABLE", {
      respond: () => ({ body: bodyOf("<html>nope</html>"), text: async () => "<html>nope</html>" }),
    })
    await expectBlocker(county(), "COUNTY_SOURCE_UNAVAILABLE", {
      respond: () => ({ body: bodyOf('{"error":true}'), text: async () => '{"error":true}' }),
    })
  })

  it("refuses when fetch itself rejects", async () => {
    const result = await fetchCountyEvidence(ORDER, {
      fetch: async () => {
        throw new Error("network down")
      },
      now: makeClock().now,
    })
    expect(result).toMatchObject({ ok: false, blocker: "COUNTY_SOURCE_UNAVAILABLE" })
  })

  it("sends GET only, with no credentials, no cache and redirects rejected", async () => {
    const seen: Array<Record<string, unknown>> = []
    await fetchCountyEvidence(ORDER, {
      fetch: async (_url, init) => {
        seen.push(init as unknown as Record<string, unknown>)
        throw new Error("stop after recording")
      },
      now: makeClock().now,
    })
    expect(seen[0]).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
    })
  })

  it("cancels and refuses a streamed body that exceeds the bound", async () => {
    const oversized = "x".repeat(MAX_RESPONSE_BYTES + 1024)
    let cancelled = false
    const streaming: CountyBody = {
      getReader: () => ({
        async read() {
          return { done: false, value: new Uint8Array(Buffer.from(oversized, "utf8")) }
        },
        async cancel() {
          cancelled = true
        },
      }),
    }
    await expectBlocker(county(), "COUNTY_SOURCE_UNAVAILABLE", {
      respond: () => ({ body: streaming }),
    })
    expect(cancelled).toBe(true)
  })

  it("refuses an oversized body on a response modelled without a stream", async () => {
    const oversized = "x".repeat(MAX_RESPONSE_BYTES + 1)
    await expectBlocker(county(), "COUNTY_SOURCE_UNAVAILABLE", {
      respond: () => ({ body: null, text: async () => oversized }),
    })
  })

  it("refuses a page carrying more rows than were requested", async () => {
    // The subject read is bounded at two rows; answer it with three.
    const oversized = JSON.stringify([{ pin: pinAt(0) }, { pin: pinAt(1) }, { pin: pinAt(2) }])
    await expectBlocker(makeCounty(4), "CANDIDATE_POOL_UNSTABLE", {
      respond: (_url, _body, callIndex) =>
        callIndex === 0 ? { body: bodyOf(oversized), text: async () => oversized } : null,
    })
  })
})

/* ------------------------------------------------------- freshness and clock */

describe("retrieval freshness", () => {
  it("refuses when the retrieval outruns its window", async () => {
    const county = makeCounty(4)
    await expectBlocker(
      county,
      "COUNTY_RETRIEVAL_WINDOW_EXCEEDED",
      {},
      makeClock("2026-09-12T15:00:00Z", MAX_RETRIEVAL_WINDOW_MS).now,
    )
  })

  it("refuses a clock that steps backwards mid-retrieval", async () => {
    const clock = makeClock("2026-09-12T15:00:00Z")
    let readings = 0
    const now = () => {
      readings += 1
      if (readings > 4) clock.set("2026-09-12T14:00:00Z")
      return clock.now()
    }
    await expectBlocker(makeCounty(4), "COUNTY_CLOCK_UNRELIABLE", {}, now)
  })

  it("refuses an unreadable clock", async () => {
    const result = await fetchCountyEvidence(ORDER, {
      fetch: makeSim(makeCounty(4)).fetch,
      now: () => new Date(Number.NaN),
    })
    expect(result).toMatchObject({ ok: false, blocker: "COUNTY_CLOCK_UNRELIABLE" })
  })

  it("completes inside the window for an ordinary neighbourhood", async () => {
    const { result } = await run(makeCounty(20), {}, makeClock("2026-09-12T15:00:00Z", 50).now)
    expect(result.ok).toBe(true)
  })
})

// Independent-review regressions: malformed source types and stalled response bodies.
describe("independent county gateway review", () => {
  it("does not coerce boolean residential subtype or numeric street address into evidence", async () => {
    const malformedFeature = makeCounty(4)
    malformedFeature[COUNTY_DATASETS.characteristics.id][0].char_type_resd = true
    await expectBlocker(malformedFeature, "CANDIDATE_CHARACTERISTICS_INCOMPLETE")
    const malformedAddress = makeCounty(4)
    malformedAddress[COUNTY_DATASETS.addresses.id][0].prop_address_full = 12345
    await expectBlocker(malformedAddress, "CANDIDATE_ADDRESS_INCOMPLETE")
  })

  it("aborts a stalled body at the remaining global budget rather than granting a new 15 seconds", async () => {
    jest.useFakeTimers()
    try {
      let calls = 0
      let aborted = false
      const start = new Date("2026-09-12T15:00:00Z").getTime()
      const pending = fetchCountyEvidence(ORDER, {
        now: () => new Date(start + (++calls >= 3 ? MAX_RETRIEVAL_WINDOW_MS - 1000 : 0)),
        fetch: async (_url, init) => ({
          ok: true, status: 200,
          text: async () => { throw new Error("must stream") },
          body: { getReader: () => ({
            read: () => new Promise((_, reject) => {
              init.signal.addEventListener("abort", () => {
                aborted = true
                reject(new Error("body aborted"))
              }, { once: true })
            }),
            cancel: async () => {},
          }) },
        }),
      })
      await jest.advanceTimersByTimeAsync(999)
      expect(aborted).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      expect(aborted).toBe(true)
      await expect(pending).resolves.toMatchObject({ ok: false, blocker: "COUNTY_SOURCE_UNAVAILABLE" })
    } finally { jest.useRealTimers() }
  })
})

it("rejects invalid UTF-8 rather than recording a hash of replacement bytes", async () => {
  let read = false
  const result = await fetchCountyEvidence(ORDER, {
    now: makeClock().now,
    fetch: async () => ({
      ok: true, status: 200, text: async () => "",
      body: { getReader: () => ({
        read: async () => {
          if (read) return { done: true }
          read = true
          return { done: false, value: new Uint8Array([91, 34, 255, 34, 93]) }
        },
        cancel: async () => {},
      }) },
    }),
  })
  expect(result).toMatchObject({ ok: false, blocker: "COUNTY_SOURCE_UNAVAILABLE", sources: [] })
})
