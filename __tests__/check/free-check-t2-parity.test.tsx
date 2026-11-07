/**
 * @jest-environment node
 *
 * `/api/free-check` against the T2 report process, through the real POST.
 *
 * CONTROLLED SYNTHETIC TRANSPORT. Every parcel, PIN, address and dataset epoch
 * here is invented. This is not a browser run and not live county data, and it
 * proves nothing about either. The only substitute for production code is
 * `globalThis.fetch`: an in-memory Socrata that answers the legacy lookups and
 * the canonical reads from one county, so both are judged on the same facts.
 *
 * The oracle is the report's own code, not a second copy of the arithmetic:
 * `fetchCountyEvidence` into `buildT2ArtifactContent`, on its own simulator
 * instance, so its requests are never counted against the POST.
 *
 * Fault cases mutate canonical reads only (a request carrying `$select`). The
 * legacy subject lookup keeps working, so a failure on code that still uses
 * loose comparables is a wrong output and not a lookup error.
 */

jest.mock("server-only", () => ({}), { virtual: true })

jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, remaining: 100 })),
  getClientIdentifier: jest.fn(() => "synthetic-client"),
}))

jest.mock("@/lib/db/prisma", () => ({
  prisma: { $executeRaw: jest.fn(), $queryRaw: jest.fn() },
}))

jest.mock("pg", () => ({ Pool: jest.fn() }))

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { POST } from "@/app/api/free-check/route"
import { FreeCheckResult, type Result } from "@/components/check/FreeCheckResult"
import {
  buildT2ArtifactContent,
  type DeadlineAuthoritySnapshot,
  type SignedPolicySnapshot,
} from "@/lib/fulfillment/t2-artifact-content"
import { NON_DIRECTIONAL_RULE_ID } from "@/lib/fulfillment/t2-comparables"
import {
  COUNTY_DATASETS,
  fetchCountyEvidence,
  type CountyEvidenceResult,
} from "@/lib/fulfillment-runtime/t2-county-gateway"

const NOW = new Date("2026-09-15T15:00:00.000Z")
const TAX_YEAR = "2026"
const TOWNSHIP = "Lake View"
const TOWNSHIP_CODE = "73"
const NEIGHBORHOOD = "73012"
const OTHER_NEIGHBORHOOD = "73013"

const UNIVERSE = COUNTY_DATASETS.parcelUniverse.id
const CHARACTERISTICS = COUNTY_DATASETS.characteristics.id
const ASSESSED = COUNTY_DATASETS.assessedValues.id
const ADDRESSES = COUNTY_DATASETS.addresses.id
const ARCHIVED_UNIVERSE = "tx2p-k2g9"
const PARCEL_SALES = "wvhk-k5uv"
const NEIGHBORHOODS = "pcdw-pxtg"

const COUNTY_HOSTS = new Set(["datacatalog.cookcountyil.gov", "cookcounty.socrata.com"])

type Row = Record<string, unknown>

type Parcel = {
  n: number
  neighborhood?: string
  propertyClass?: string
  subtype?: string
  sqft: number
  yearBuilt: number
  mailed: number
  certified?: number
  board?: number
}

const pinAt = (n: number) => String(14000000000000 + n)
const dashed = (pin: string) => pin.replace(/^(..)(..)(...)(...)(....)$/, "$1-$2-$3-$4-$5")
const undashed = (pin: string) => pin.replace(/-/g, "")
const addressOf = (pin: string) => `${Number(pin.slice(-4))} N SYNTHETIC ST`

const SUBJECT_N = 50
const SUBJECT_PIN = pinAt(SUBJECT_N)

const SUBJECT: Parcel = { n: SUBJECT_N, sqft: 1500, yearBuilt: 1950, mailed: 30000, certified: 32000, board: 33000 }

/** Qualify under R2. Per building sq ft: $15, $16, $17, $18, $100. */
const PEER_A: Parcel = { n: 10, sqft: 1700, yearBuilt: 1950, mailed: 25500 }
const PEER_B: Parcel = { n: 20, sqft: 1500, yearBuilt: 1945, mailed: 24000 }
const PEER_C: Parcel = { n: 30, sqft: 1600, yearBuilt: 1955, mailed: 27200 }
const PEER_D: Parcel = { n: 60, sqft: 1400, yearBuilt: 1960, mailed: 25200 }
const OUTLIER: Parcel = { n: 70, sqft: 1500, yearBuilt: 1948, mailed: 150000 }

/** In the pool, refused by the selector. Each is inside the old route's looser tolerance. */
const AREA_OUT: Parcel = { n: 40, sqft: 2200, yearBuilt: 1950, mailed: 44000 }
const YEAR_OUT: Parcel = { n: 41, sqft: 1500, yearBuilt: 1962, mailed: 30000 }
const SUBTYPE_OUT: Parcel = { n: 42, sqft: 1500, yearBuilt: 1950, mailed: 27000, subtype: "1 Story" }
const CLASS_OUT: Parcel = { n: 43, sqft: 1500, yearBuilt: 1950, mailed: 26000, propertyClass: "204" }

/** Outside the pool's scope altogether. */
const OTHER_COHORT: Parcel = { n: 80, sqft: 1500, yearBuilt: 1950, mailed: 20000, neighborhood: OTHER_NEIGHBORHOOD }
const CONDO: Parcel = { n: 81, sqft: 1500, yearBuilt: 1950, mailed: 20000, propertyClass: "299" }

const QUALIFIED = [PEER_A, PEER_B, PEER_C, PEER_D, OUTLIER]
const REJECTED = [AREA_OUT, YEAR_OUT, SUBTYPE_OUT, CLASS_OUT]
const PARCELS = [SUBJECT, ...QUALIFIED, ...REJECTED, OTHER_COHORT, CONDO]

/** Sale order puts the loose cohort first, as a recency sort is free to. */
const SALES_ORDER = [OUTLIER, AREA_OUT, YEAR_OUT, SUBTYPE_OUT, CLASS_OUT, OTHER_COHORT].map((p) => p.n)

const QUALIFIED_PINS = QUALIFIED.map((p) => pinAt(p.n)).sort()

type FaultContext = { dataset: string; where: string }

type CountyOptions = {
  parcels?: Parcel[]
  subjectClass?: string
  /** Applied to canonical row reads only. Return null to withhold the row. */
  mutate?: (row: Row, context: FaultContext) => Row | null
  driftCount?: boolean
  driftEpoch?: boolean
  failCanonical?: boolean
}

type Call = { url: string; host: string; dataset: string; method: string; canonical: boolean }

function datasetRows(parcels: Parcel[], subjectClass: string | undefined): Record<string, Row[]> {
  const classOf = (p: Parcel) => (p.n === SUBJECT_N && subjectClass ? subjectClass : (p.propertyClass ?? "203"))
  const nbhdOf = (p: Parcel) => p.neighborhood ?? NEIGHBORHOOD
  const universe = (p: Parcel): Row => ({
    pin: pinAt(p.n),
    year: `${TAX_YEAR}.0`,
    class: classOf(p),
    township_code: TOWNSHIP_CODE,
    township_name: TOWNSHIP,
    nbhd_code: nbhdOf(p),
  })
  const address = (p: Parcel): Row => ({
    pin: pinAt(p.n),
    year: `${TAX_YEAR}.0`,
    prop_address_full: addressOf(pinAt(p.n)),
    prop_address_city_name: "CHICAGO",
    prop_address_state: "IL",
    prop_address_zipcode_1: "60600",
  })
  const land = (p: Parcel) => Math.round(p.mailed * 0.2)
  const byPin = (rows: Row[]) => [...rows].sort((a, b) => (String(a.pin) < String(b.pin) ? -1 : 1))
  return {
    [UNIVERSE]: byPin(parcels.map(universe)),
    [ARCHIVED_UNIVERSE]: byPin(parcels.map((p) => ({ ...universe(p), ...address(p) }))),
    [CHARACTERISTICS]: byPin(
      parcels.map((p) => ({
        pin: pinAt(p.n),
        year: TAX_YEAR,
        card: "1",
        class: classOf(p),
        township_code: TOWNSHIP_CODE,
        pin_num_cards: "1",
        pin_is_multiland: false,
        pin_num_landlines: "1",
        tieback_key_pin: null,
        tieback_proration_rate: "1.0",
        card_proration_rate: "1.0",
        char_bldg_sf: String(p.sqft),
        char_yrblt: String(p.yearBuilt),
        char_type_resd: p.subtype ?? "2 Story",
        char_beds: "3",
        char_fbath: "2",
      })),
    ),
    [ASSESSED]: byPin(
      parcels.map((p) => ({
        pin: pinAt(p.n),
        year: `${TAX_YEAR}.0`,
        class: classOf(p),
        township_code: TOWNSHIP_CODE,
        nbhd: nbhdOf(p),
        mailed_tot: String(p.mailed),
        mailed_land: String(land(p)),
        mailed_bldg: String(p.mailed - land(p)),
        ...(p.certified ? { certified_tot: String(p.certified) } : {}),
        ...(p.board ? { board_tot: String(p.board) } : {}),
      })),
    ),
    [ADDRESSES]: byPin(parcels.map(address)),
    [PARCEL_SALES]: parcels
      .filter((p) => SALES_ORDER.includes(p.n))
      .sort((a, b) => SALES_ORDER.indexOf(a.n) - SALES_ORDER.indexOf(b.n))
      .map((p) => ({
        pin: pinAt(p.n),
        nbhd: nbhdOf(p),
        class: classOf(p),
        sale_date: "2026-01-15T00:00:00.000",
        sale_price: "300000",
      })),
  }
}

function satisfies(row: Row, where: string): boolean {
  const same = (field: string, value: string) => String(row[field]) === value
  const tests: Array<[RegExp, (m: RegExpMatchArray) => boolean]> = [
    [/\bpin='([^']+)'/g, (m) => same("pin", m[1])],
    [/\bpin != '([^']+)'/g, (m) => !same("pin", m[1])],
    [/\bpin in ?\(([^)]*)\)/g, (m) => m[1].includes(`'${String(row.pin)}'`)],
    [/(?:^|[\s(])year='?(\d{4})'?/g, (m) => Number(row.year) === Number(m[1])],
    [/\bnbhd_code='([^']+)'/g, (m) => same("nbhd_code", m[1])],
    [/\bnbhd='([^']+)'/g, (m) => same("nbhd", m[1])],
    [/\btownship_code='([^']+)'/g, (m) => same("township_code", m[1])],
    [/\bclass='([^']+)'/g, (m) => same("class", m[1])],
    [/\bclass != '([^']+)'/g, (m) => !same("class", m[1])],
    [/starts_with\(class, '([^']+)'\)/g, (m) => String(row.class).startsWith(m[1])],
    [/\bmailed_tot > 0/g, () => Number(row.mailed_tot) > 0],
  ]
  return tests.every(([pattern, test]) => [...where.matchAll(pattern)].every(test))
}

function metadata(id: string, rowsUpdatedAt: number): Row {
  const dataset = Object.values(COUNTY_DATASETS).find((d) => d.id === id)
  const fields = [
    ...(dataset?.select.split(",") ?? []),
    ...(id === ASSESSED ? ["mailed_land", "mailed_bldg"] : []),
    ...(id === CHARACTERISTICS ? ["card"] : []),
  ]
  return {
    id,
    provenance: "official",
    rowsUpdatedAt,
    viewLastModified: 1790000000,
    tableId: 12345,
    columns: fields.map((fieldName) => ({
      fieldName,
      dataTypeName: fieldName === "pin_is_multiland" ? "checkbox" : "text",
    })),
  }
}

function respond(url: string, value: unknown, status = 200): Response {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
  Object.defineProperty(response, "url", { value: url })
  return response
}

function createCounty(options: CountyOptions = {}) {
  const tables = datasetRows(options.parcels ?? PARCELS, options.subjectClass)
  const calls: Call[] = []
  const epochReads = new Map<string, number>()
  let countReads = 0

  const fetcher = async (input: unknown, init?: { method?: string }): Promise<Response> => {
    const url = String(input)
    const parsed = new URL(url)
    const dataset = parsed.pathname.split("/").pop()!.replace(".json", "")
    const select = parsed.searchParams.get("$select")
    const where = parsed.searchParams.get("$where") ?? ""
    const isMetadata = parsed.pathname.startsWith("/api/views/")
    const canonical = select !== null || isMetadata
    calls.push({ url, host: parsed.hostname, dataset, method: init?.method ?? "GET", canonical })

    if (!COUNTY_HOSTS.has(parsed.hostname)) throw new Error("synthetic transport: unexpected host")
    if (canonical && options.failCanonical) return respond(url, { error: "synthetic outage" }, 503)

    if (isMetadata) {
      const reads = epochReads.get(dataset) ?? 0
      epochReads.set(dataset, reads + 1)
      return respond(url, metadata(dataset, 1790000000 + (options.driftEpoch && reads > 0 ? 1 : 0)))
    }

    let rows = (tables[dataset] ?? []).filter((row) => satisfies(row, where))

    if (select !== null && /^count\(/.test(select)) {
      countReads += 1
      const n = rows.length + (options.driftCount && countReads > 1 ? 1 : 0)
      return respond(url, [{ n: String(n) }])
    }

    if (select !== null) {
      const fields = select.split(",")
      rows = rows.map((row) => Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]])))
      if (options.mutate) {
        rows = rows.flatMap<Row>((row) => options.mutate!(row, { dataset, where }) ?? [])
      }
    }

    const offset = Number(parsed.searchParams.get("$offset") ?? 0)
    const limit = Number(parsed.searchParams.get("$limit") ?? 1000)
    return respond(url, rows.slice(offset, offset + limit))
  }

  return { fetcher, calls }
}

const TEST_ONLY_POLICY: SignedPolicySnapshot = {
  version: "test-only-parity-oracle",
  ownerDecisions: ["OD-2", "OD-3"],
  signedAt: "2026-06-08",
  // The merits threshold is not under test; the selection and metric are.
  evidenceThreshold: { minRelativeAssessmentGap: -1, minComparables: 3 },
}

const TEST_ONLY_DEADLINE: DeadlineAuthoritySnapshot = {
  trusted: true,
  status: "open",
  closeDate: "2026-10-30",
  sourceName: "Synthetic test authority",
  sourceUrl: "https://example.invalid/deadline",
  retrievedAt: "2026-09-15T15:00:00Z",
  businessDaysRemainingAtGeneration: 30,
  businessDayCutoffAllowed: true,
}

async function readForReport(options: CountyOptions): Promise<CountyEvidenceResult> {
  const county = createCounty(options)
  return fetchCountyEvidence(
    { propertyPin: SUBJECT_PIN, township: TOWNSHIP },
    // Built under the faked `Date`, because the gateway checks `instanceof Date`.
    { fetch: county.fetcher as never, now: () => new Date() },
  )
}

async function buildReport(options: CountyOptions = {}) {
  const read = await readForReport(options)
  if (!read.ok) throw new Error(`report read refused: ${read.blocker}`)
  const evidence = read.evidence
  return buildT2ArtifactContent({
    orderId: "synthetic-parity-oracle",
    orderPropertyPin: evidence.subject.pin,
    orderPropertyAddress: evidence.subject.address,
    subject: evidence.subject,
    comparableCandidates: evidence.comparableCandidates,
    comparableAssessedValues: evidence.comparableAssessedValues,
    comparableAddresses: evidence.comparableAddresses,
    policy: TEST_ONLY_POLICY,
    deadline: TEST_ONLY_DEADLINE,
    sources: evidence.sources,
    generatedAt: "2026-09-15T15:00:00Z",
  })
}

async function reportManifest(options: CountyOptions = {}) {
  const report = await buildReport(options)
  if (!report.ok) throw new Error(`report refused: ${report.blocker}`)
  return report.manifest
}

function req(body: unknown) {
  return {
    headers: { get: () => "overtaxed-il.com" },
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0]
}

/** Run the real POST against one county, and render what it returned. */
async function check(options: CountyOptions = {}) {
  const county = createCounty(options)
  ;(globalThis as { fetch: unknown }).fetch = county.fetcher
  const response = await POST(req({ pin: SUBJECT_PIN }))
  const body = await response.json()
  return {
    status: response.status,
    body,
    calls: county.calls,
    markup: renderToStaticMarkup(createElement(FreeCheckResult, { result: body as Result })),
  }
}

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (value && typeof value === "object") {
    return Object.entries(value as Row).flatMap(([key, nested]) => [key, ...keysOf(nested)])
  }
  return []
}

function expectNoComparison(result: Awaited<ReturnType<typeof check>>) {
  const { status, body, calls, markup } = result
  expect(status).toBe(200)
  expect(body.comps).toEqual([])
  expect(body.compCount).toBe(0)
  expect(body.sharedMetric).toBeNull()
  expect(body.comparisonEvidence).toBeNull()
  expect(body.avgComparableAssessedValue).toBeNull()
  expect(body.assessmentGap).toBeNull()
  expect(body.equityRatio).toBeNull()
  expect(body.avgCompEquityRatio).toBeNull()
  // A figure that did not come through the canonical read is not a mailed figure.
  expect(body.subject.assessedTotalValue).toBeNull()
  expect(body.subject.marketValue).toBeNull()
  expect(["insufficient_evidence", "unsupported_property"]).toContain(body.outcome.code)
  expect(body.outcome.allowCheckout).toBe(false)
  expect(body.outcome.showRecordComparison).toBe(false)
  expect(body.potentialOverpaymentPerYear).toBeNull()
  expect(body.potentialOverpayment3Year).toBeNull()
  expect(body.appealArgumentText).toBeNull()

  // No legacy fallback and no invented cohort stood in for the refused read.
  expect(calls.filter((call) => call.dataset === PARCEL_SALES)).toEqual([])
  expect(calls.filter((call) => call.dataset === NEIGHBORHOODS)).toEqual([])

  expect(markup).toContain('data-testid="free-comparison-unavailable"')
  expect(markup).not.toContain("Comparable median (")
  expect(markup).not.toContain("Avg of")
  for (const peer of [...QUALIFIED, ...REJECTED]) expect(markup).not.toContain(dashed(pinAt(peer.n)))
}

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "OT_FORCE_PREVIEW_STUB",
  "NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB",
  "OT_FREE_CHECK_MEASUREMENT_ENABLED",
] as const
const savedEnv: Record<string, string | undefined> = {}
const savedFetch = globalThis.fetch

beforeAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const key of ENV_KEYS) savedEnv[key] = env[key]
  // The route answers a static sample outside production.
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
  // Only the calendar is fixed, so the 2026 tax-year pin holds. Real timers keep running.
  jest.useFakeTimers({
    now: NOW,
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
})

afterEach(() => {
  jest.useRealTimers()
  ;(globalThis as { fetch: unknown }).fetch = savedFetch
})

describe("controlled synthetic transport: the free check reports what the T2 report reports", () => {
  it("uses the report's selection and median, not a mean of three loose peers", async () => {
    const manifest = await reportManifest()
    expect(manifest.comparablePins).toEqual(QUALIFIED_PINS)

    const { status, body } = await check()
    expect(status).toBe(200)

    expect(body.comps.map((comp: { pin: string }) => undashed(comp.pin))).toEqual(manifest.comparablePins)
    expect(body.compCount).toBe(manifest.comparableCount)

    expect(body.sharedMetric).toEqual({
      version: "ot-shared-metric/v1",
      metric: "MEDIAN_ASSESSED_PER_BUILDING_SQFT",
      unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
      cohortRule: "FREE_ELIGIBLE_POOL_MATCH_V1",
      stage: "mailed",
      taxYear: 2026,
      subjectExcluded: true,
      subjectAssessedCentsPerBuildingSqft: 2000,
      subjectAssessedTotalCents: 3000000,
      comparableMedian: {
        unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
        status: "COMPUTED",
        value: 1700,
        count: 5,
        minimumCount: 3,
      },
      sampleAdequacy: "NOT_QUALIFIED",
      claims: "ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS",
    })

    // The same figures as the report's own manifest strings.
    expect((body.sharedMetric.subjectAssessedCentsPerBuildingSqft / 100).toFixed(4)).toBe(manifest.subjectAssessedPerSqft)
    expect((body.sharedMetric.comparableMedian.value / 100).toFixed(4)).toBe(manifest.comparableMedianAssessedPerSqft)

    // No mean of any kind survives beside the median.
    expect(body.avgComparableAssessedValue).toBeNull()
    expect(body.assessmentGap).toBeNull()
  })

  it("binds the same candidate pool as the report, by digest and by per-reason count", async () => {
    const manifest = await reportManifest()
    const { body } = await check()

    expect(body.comparisonEvidence).toMatchObject({
      selectionRuleId: manifest.selectionRuleId,
      stage: "mailed",
      taxYear: 2026,
      candidateCount: manifest.candidateCount,
      candidateAcceptedCount: manifest.candidateAcceptedCount,
      candidateRejectedByReason: manifest.candidateRejectedByReason,
      candidatePoolSha256: manifest.candidatePoolSha256,
      candidateExcludedCount: 0,
      upstreamAtomicGuarantee: "NOT_ESTABLISHED",
    })
    expect(manifest.candidateCount).toBe(10)
    expect(manifest.candidateRejectedByReason).toMatchObject({
      same_parcel_as_subject: 1,
      building_sqft_out_of_band: 1,
      year_built_out_of_band: 1,
      different_subtype: 1,
      different_class: 1,
    })
    expect(body.comparisonEvidence.collectorProtections).toEqual([
      "POOL_COUNT_BEFORE_AFTER",
      "DATASET_EPOCH_BEFORE_AFTER",
      "MAILED_TOTAL_EQUALS_LAND_PLUS_BUILDING",
    ])
    expect(body.comparisonEvidence.sourceDatasetIds).toEqual([ADDRESSES, UNIVERSE, ASSESSED, CHARACTERISTICS].sort())
    expect(body.comparisonEvidence.sourceResponseCount).toBeGreaterThan(0)
    expect(body.comparisonEvidence.retrievedAt).toMatch(/^2026-09-15T15:00:00(?:\.\d+)?Z$/)
    expect(body.compSelection.basis).toBe(NON_DIRECTIONAL_RULE_ID)
    expect(body.compSelection.distanceRanked).toBe(false)
  })

  it("keeps mailed-stage values only, and states no market value", async () => {
    const { body } = await check()

    expect(body.subject.assessedTotalValue).toBe(SUBJECT.mailed)
    expect(body.subject.taxYear).toBe(2026)
    expect(body.subject.marketValue).toBeNull()
    expect(body.equityRatio).toBeNull()
    expect(body.avgCompEquityRatio).toBeNull()
    expect(body.potentialOverpaymentPerYear).toBeNull()
    expect(body.potentialOverpayment3Year).toBeNull()
    expect(body.appealArgumentText).toBeNull()

    const peerByPin = new Map(QUALIFIED.map((peer) => [pinAt(peer.n), peer]))
    for (const comp of body.comps) {
      const peer = peerByPin.get(undashed(comp.pin))!
      expect(comp).toMatchObject({
        address: addressOf(pinAt(peer.n)),
        assessedValue: peer.mailed,
        marketValue: null,
        squareFeet: peer.sqft,
        yearBuilt: peer.yearBuilt,
      })
      expect(String(comp.propertyClass).replace(/\D/g, "")).toBe("203")
    }

    expect(body.outcome.code).toBe("insufficient_evidence")
    expect(body.outcome.allowCheckout).toBe(false)
    expect(body.outcome.showRecordComparison).toBe(true)
  })

  it("excludes the subject and every rejected parcel from the median", async () => {
    const { body } = await check()
    const pins = body.comps.map((comp: { pin: string }) => undashed(comp.pin))

    expect(pins).not.toContain(SUBJECT_PIN)
    for (const parcel of [...REJECTED, OTHER_COHORT, CONDO]) expect(pins).not.toContain(pinAt(parcel.n))
    // With the subject's $20.00 included this would be $17.50.
    expect(body.sharedMetric?.comparableMedian?.value).toBe(1700)
  })

  it("an outlier moves a mean and leaves the median where the report leaves it", async () => {
    const parcels = PARCELS.map((parcel) => (parcel === OUTLIER ? { ...OUTLIER, mailed: 900000 } : parcel))
    const manifest = await reportManifest({ parcels })
    const { body } = await check({ parcels })

    expect(manifest.comparableMedianAssessedPerSqft).toBe("17.0000")
    expect(body.sharedMetric?.comparableMedian?.value).toBe(1700)
    expect(body.compCount).toBe(5)
    expect(body.avgComparableAssessedValue).toBeNull()
    expect(body.comps.find((comp: { pin: string }) => undashed(comp.pin) === pinAt(OUTLIER.n)).assessedValue).toBe(900000)
  })

  it("renders the same IDs, count, subject figure and median in the brief", async () => {
    const manifest = await reportManifest()
    const { markup } = await check()

    expect(markup).toContain("Your assessed value per building sq ft: $20.00")
    expect(markup).toContain(`Comparable median (${manifest.comparableCount} properties, you excluded): $17.00`)
    expect(markup).toContain("Sample adequacy: NOT QUALIFIED. Assessed values only, not market value or savings.")
    expect(markup).toContain(
      "“NOT QUALIFIED” describes this data sample: whether it is large enough to rely on has not been validated. It does not mean the property or its owner is ineligible for anything.",
    )
    for (const pin of manifest.comparablePins) expect(markup).toContain(dashed(pin))
    for (const parcel of REJECTED) expect(markup).not.toContain(dashed(pinAt(parcel.n)))

    expect(markup).not.toContain("Avg of")
    expect(markup).not.toContain("Comparable avg")
    expect(markup).not.toContain("Difference in assessed value")
    expect(markup).not.toContain("Equity ratio")
    expect(markup).not.toContain("Market value")
  })
})

describe("controlled synthetic transport: the canonical read, and nothing else", () => {
  it("reads the four official datasets by parcel order, without a sales or neighborhood fallback", async () => {
    const { calls } = await check()
    const canonical = calls.filter((call) => call.canonical)

    for (const id of [UNIVERSE, CHARACTERISTICS, ASSESSED, ADDRESSES]) {
      expect(calls.some((call) => call.url.endsWith(`/api/views/${id}.json`))).toBe(true)
      expect(canonical.some((call) => call.url.includes(`/resource/${id}.json`))).toBe(true)
    }
    expect(calls.filter((call) => call.dataset === PARCEL_SALES)).toEqual([])
    expect(calls.filter((call) => call.dataset === NEIGHBORHOODS)).toEqual([])

    for (const call of canonical) {
      const params = new URL(call.url).searchParams
      // The characteristics key is (pin, card). Nothing orders by a value.
      expect(["pin", "pin,card"]).toContain(params.get("$order") ?? "pin")
      expect(params.get("$select") ?? "").not.toMatch(/certified_|board_/)
    }
  })

  it("is compact: no raw evidence, tokens, or order, transfer or download references", async () => {
    const { body } = await check()
    const keys = new Set(keysOf(body))

    for (const key of [
      "exactPages",
      "bytes",
      "pages",
      "receipt",
      "candidatePool",
      "pool",
      "acquisitionSnapshot",
      "snapshotId",
      "resultId",
      "orderId",
      "token",
      "downloadUrl",
      "transferId",
      "dataEvidenceSha256",
    ]) {
      expect(keys.has(key)).toBe(false)
    }
    expect(JSON.stringify(body).length).toBeLessThan(8000)
  })

  it("makes no provider write, opens no database, and sends only GETs to the county", async () => {
    const { calls } = await check()
    const { prisma } = jest.requireMock("@/lib/db/prisma") as {
      prisma: { $executeRaw: jest.Mock; $queryRaw: jest.Mock }
    }
    const { Pool } = jest.requireMock("pg") as { Pool: jest.Mock }

    expect(calls.length).toBeGreaterThan(0)
    expect(calls.filter((call) => !COUNTY_HOSTS.has(call.host))).toEqual([])
    expect(calls.filter((call) => call.method !== "GET")).toEqual([])
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(Pool).not.toHaveBeenCalled()
  })
})

describe("controlled synthetic transport: a refused read or subject withholds the free comparison, as it does the report", () => {
  const peerPin = pinAt(PEER_B.n)
  const onPeer =
    (dataset: string, change: (row: Row) => Row | null) =>
    (row: Row, context: FaultContext): Row | null =>
      context.dataset === dataset && row.pin === peerPin ? change(row) : row

  const reportRefusals: Array<[string, CountyOptions["mutate"]]> = [
    ["a peer has no assessed row", onPeer(ASSESSED, () => null)],
    ["a peer has no address row", onPeer(ADDRESSES, () => null)],
    ["a peer's assessed row is from another year", onPeer(ASSESSED, (row) => ({ ...row, year: "2025.0" }))],
    ["a peer's characteristics are from another year", onPeer(CHARACTERISTICS, (row) => ({ ...row, year: "2025" }))],
    ["a peer has a partly published mailed record", onPeer(ASSESSED, (row) => ({ ...row, mailed_tot: null }))],
    ["a peer's characteristics are from another township", onPeer(CHARACTERISTICS, (row) => ({ ...row, township_code: "71" }))],
    [
      "the pool returns a parcel from another neighborhood",
      (row, context) =>
        context.dataset === UNIVERSE && row.pin === peerPin ? { ...row, nbhd_code: OTHER_NEIGHBORHOOD } : row,
    ],
    [
      "the subject read answers with another parcel",
      (row, context) =>
        context.dataset === UNIVERSE && context.where.includes(`pin='${SUBJECT_PIN}'`) ? { ...row, pin: peerPin } : row,
    ],
  ]

  it.each(reportRefusals)("when %s", async (_name, mutate) => {
    const read = await readForReport({ mutate })
    expect(read.ok).toBe(false)

    expectNoComparison(await check({ mutate }))
  })

  const subjectIneligible: Array<[string, CountyOptions["mutate"]]> = [
    ["no characteristics row", (row, c) => (c.dataset === CHARACTERISTICS && row.pin === SUBJECT_PIN ? null : row)],
    ["two cards", (row, c) => (c.dataset === CHARACTERISTICS && row.pin === SUBJECT_PIN ? { ...row, pin_num_cards: "2" } : row)],
    ["a prorated building", (row, c) => (c.dataset === CHARACTERISTICS && row.pin === SUBJECT_PIN ? { ...row, tieback_proration_rate: "0.5", card_proration_rate: "0.5" } : row)],
    ["no mailed figures", (row, c) => (c.dataset === ASSESSED && row.pin === SUBJECT_PIN ? { ...row, mailed_tot: null, mailed_land: null, mailed_bldg: null } : row)],
    ["no assessed row", (row, c) => (c.dataset === ASSESSED && row.pin === SUBJECT_PIN ? null : row)],
    ["no address row", (row, c) => (c.dataset === ADDRESSES && row.pin === SUBJECT_PIN ? null : row)],
  ]

  it.each(subjectIneligible)("withholds for a subject with %s, which no peer rule forgives", async (_name, mutate) => {
    expectNoComparison(await check({ mutate }))
  })

  it("withholds below the Rule 15 floor, where the report refuses", async () => {
    const parcels = [SUBJECT, PEER_A, PEER_B, ...REJECTED]
    await expect(buildReport({ parcels })).resolves.toEqual({ ok: false, blocker: "INSUFFICIENT_COMPARABLES" })

    expectNoComparison(await check({ parcels }))
  })

  it.each([["299"], ["517"]])("withholds for an unsupported subject class %s", async (subjectClass) => {
    await expect(readForReport({ subjectClass })).resolves.toMatchObject({
      ok: false,
      blocker: "SUBJECT_CLASS_OUT_OF_SCOPE",
    })

    expectNoComparison(await check({ subjectClass }))
  })
})

describe("controlled synthetic transport: an unusable peer is left out and counted, and the paid path still refuses it", () => {
  const peer = PEER_B
  const peerPin = pinAt(peer.n)
  const onPeer =
    (dataset: string, change: (row: Row) => Row | null) =>
    (row: Row, context: FaultContext): Row | null =>
      context.dataset === dataset && row.pin === peerPin ? change(row) : row

  const peerCases: Array<[string, string, CountyOptions["mutate"]]> = [
    ["a peer has no characteristics row", "no_characteristics_record", onPeer(CHARACTERISTICS, () => null)],
    ["a peer is multi-card", "multi_card", onPeer(CHARACTERISTICS, (row) => ({ ...row, pin_num_cards: "2" }))],
    ["a peer is multi-landline", "multi_land", onPeer(CHARACTERISTICS, (row) => ({ ...row, pin_num_landlines: "2" }))],
    ["a peer is multi-land", "multi_land", onPeer(CHARACTERISTICS, (row) => ({ ...row, pin_is_multiland: true }))],
    ["a peer ties back to another parcel", "prorated_or_tied_back", onPeer(CHARACTERISTICS, (row) => ({ ...row, tieback_key_pin: pinAt(99) }))],
    ["a peer carries a partial proration", "prorated_or_tied_back", onPeer(CHARACTERISTICS, (row) => ({ ...row, card_proration_rate: "0.5" }))],
    ["datasets disagree about a peer's class", "class_conflict", onPeer(ASSESSED, (row) => ({ ...row, class: "204" }))],
    ["a peer has zero building area", "invalid_characteristics", onPeer(CHARACTERISTICS, (row) => ({ ...row, char_bldg_sf: "0" }))],
    ["a peer's published assessed row has no mailed figures", "no_mailed_value", onPeer(ASSESSED, (row) => ({ ...row, mailed_tot: null, mailed_land: null, mailed_bldg: null }))],
    ["a peer's published address row has no state", "incomplete_address", onPeer(ADDRESSES, (row) => ({ ...row, prop_address_state: null }))],
  ]

  it.each(peerCases)("when %s", async (_name, reason, mutate) => {
    await expect(readForReport({ mutate })).resolves.toMatchObject({ ok: false })

    const { status, body } = await check({ mutate })
    expect(status).toBe(200)
    const evidence = body.comparisonEvidence
    expect(evidence.candidateCount).toBe(10)
    expect(evidence.candidateExcludedCount).toBe(1)
    expect(evidence.candidateExcludedByReason[reason]).toBe(1)
    expect(evidence.candidateAcceptedCount).toBe(4)
    expect(body.comps.map((c: { pin: string }) => undashed(c.pin)).sort()).toEqual(QUALIFIED_PINS.filter((pin) => pin !== peerPin))
    expect(body.sharedMetric.comparableMedian.count).toBe(4)
    // $17, $18, $15, $100 per sq ft: the median of the four that remain.
    expect(body.sharedMetric.comparableMedian.value).toBeCloseTo(1750, 8)
    expect(body.sharedMetric.subjectAssessedCentsPerBuildingSqft).toBeCloseTo(2000, 8)
    const rejected = Object.values(evidence.candidateRejectedByReason as Record<string, number>).reduce((a, b) => a + b, 0)
    expect(evidence.candidateAcceptedCount + rejected + evidence.candidateExcludedCount).toBe(evidence.candidateCount)
  })

  it("keeps a multi-card peer's two rows from reading as a pagination conflict", async () => {
    const county = createCounty()
    const inner = county.fetcher
    const fetcher = async (input: unknown, init?: { method?: string }) => {
      const response = await inner(input, init)
      const url = String(input)
      if (!url.includes(`/resource/${CHARACTERISTICS}.json`)) return response
      const rows = (await response.clone().json()) as Row[]
      const doubled = rows.flatMap((row) => (row.pin === peerPin ? [{ ...row, pin_num_cards: "2" }, { ...row, card: "2", pin_num_cards: "2" }] : [row]))
      return respond(url, doubled)
    }
    ;(globalThis as { fetch: unknown }).fetch = fetcher
    const response = await POST(req({ pin: SUBJECT_PIN }))
    const body = await response.json()
    expect(body.comparisonEvidence.candidateExcludedByReason.multi_card).toBe(1)
    expect(body.sharedMetric.comparableMedian.count).toBe(4)
  })

  it("withholds when exclusions leave fewer than three, and does not lower the floor", async () => {
    const out = new Set([pinAt(PEER_A.n), pinAt(PEER_B.n), pinAt(PEER_C.n)])
    const mutate = (row: Row, context: FaultContext): Row | null =>
      context.dataset === CHARACTERISTICS && out.has(String(row.pin)) ? null : row
    expectNoComparison(await check({ mutate }))
  })

  it("does not let an excluded peer's value reach the median", async () => {
    const mutate = (row: Row, context: FaultContext): Row | null =>
      context.dataset === CHARACTERISTICS && row.pin === pinAt(OUTLIER.n) ? { ...row, card_proration_rate: "0.5" } : row
    const { body } = await check({ mutate })
    expect(body.comps.map((c: { pin: string }) => undashed(c.pin))).not.toContain(pinAt(OUTLIER.n))
    expect(body.sharedMetric.comparableMedian.value).toBeCloseTo(1650, 8)
  })

  it("names the exclusions in the provenance line", async () => {
    const { markup } = await check({ mutate: peerCases[0][2] })
    expect(markup).toContain("1 could not be compared from the published record and was left out")
  })
})

describe("controlled synthetic transport: read stability and source failure, free-only protections", () => {
  it("withholds when the pool count changes during the read", async () => {
    await expect(readForReport({ driftCount: true })).resolves.toMatchObject({
      ok: false,
      blocker: "CANDIDATE_POOL_UNSTABLE",
    })

    expectNoComparison(await check({ driftCount: true }))
  })

  it("withholds when a dataset epoch changes during the read", async () => {
    expectNoComparison(await check({ driftEpoch: true }))
  })

  it("withholds when a peer's mailed land and building do not sum to its total", async () => {
    const mutate = (row: Row, context: FaultContext): Row =>
      context.dataset === ASSESSED && row.pin === pinAt(PEER_B.n) ? { ...row, mailed_land: "1" } : row

    expectNoComparison(await check({ mutate }))
  })

  it("withholds on a county outage rather than falling back to loose comparables", async () => {
    expectNoComparison(await check({ failCanonical: true }))
  })
})
