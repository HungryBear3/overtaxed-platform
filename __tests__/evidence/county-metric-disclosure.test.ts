/** @jest-environment node */
/**
 * B2: a county result that carries the saved per-building-square-foot shared
 * metric must disclose truthfully that building area (and the characteristics
 * used to pick the comparable cohort) came from the saved acquisition snapshot.
 * It must not also claim area is "not reported or used". A county result with
 * no snapshot keeps the original area-unknown limitation.
 *
 * Drives the REAL default county adapter (canonical snapshot path), the REAL
 * neutral raw gateway with shared-snapshot protections, the REAL acquisition
 * snapshot builder, analysis, public decoder and shared presentation. Only two
 * seams are substituted, as approved: the snapshot-store env factory returns
 * the real in-memory store, and global fetch serves an inert synthetic county
 * dataset. No provider, database, payment or paid state is involved.
 */
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

let mockEnvStore: unknown = null
jest.mock("@/lib/evidence/server/acquisition-snapshot", () => {
  const actual = jest.requireActual("@/lib/evidence/server/acquisition-snapshot")
  return { ...actual, createAcquisitionSnapshotStoreFromEnv: () => mockEnvStore }
})

import { createInMemoryAcquisitionSnapshotStore } from "@/lib/evidence/server/acquisition-snapshot"
import { createCountyFactualAdapter } from "@/lib/evidence/server/county-factual-acquisition"
import { analyzeAcquisition } from "@/lib/evidence/server/factual-analysis"
import { createInMemoryAnalysisStore } from "@/lib/evidence/server/analysis-store"
import { decodeFactualResultJson } from "@/lib/evidence/public-factual-contract"
import { SharedEvidenceSummary } from "@/components/check/SharedEvidenceSummary"

const ORIGIN = "https://datacatalog.cookcountyil.gov"
const SUBJECT = "18062140110000"
const PARCELS = [
  { pin: SUBJECT, sqft: "1200", total: "42500", land: "10000", bldg: "32500", address: "100 SYNTHETIC PREVIEW AVE" },
  { pin: "18062140120000", sqft: "1250", total: "40000", land: "10000", bldg: "30000", address: "104 SYNTHETIC PREVIEW AVE" },
  { pin: "18062140130000", sqft: "1150", total: "39000", land: "9000", bldg: "30000", address: "108 SYNTHETIC PREVIEW AVE" },
]
/** Per-test override of the subject's published building area (string, null, or omitted). */
let subjectSqft: string | null | undefined = undefined
const FIELDS = [
  "pin", "year", "class", "township_code", "township_name", "nbhd_code", "nbhd", "pin_num_cards", "pin_is_multiland",
  "pin_num_landlines", "tieback_key_pin", "tieback_proration_rate", "card_proration_rate", "char_bldg_sf", "char_yrblt",
  "char_type_resd", "mailed_tot", "mailed_land", "mailed_bldg", "prop_address_full", "prop_address_city_name", "prop_address_state",
]

function rowsFor(url: URL): unknown {
  const meta = /^\/api\/views\/([a-z0-9-]+)\.json$/.exec(url.pathname)
  if (meta) return { id: meta[1], provenance: "official", rowsUpdatedAt: 1, viewLastModified: 1, tableId: 1, columns: FIELDS.map((fieldName) => ({ fieldName, dataTypeName: "text" })) }
  const id = url.pathname.replace(/^\/resource\//, "").replace(/\.json$/, "")
  const where = url.searchParams.get("$where") ?? ""
  if ((url.searchParams.get("$select") ?? "").startsWith("count(")) return [{ n: String(PARCELS.length) }]
  if ((url.searchParams.get("$offset") ?? "0") !== "0") return []
  const named = new Set(Array.from(where.matchAll(/'(\d{14})'/g), (m) => m[1]))
  const parcels = named.size ? PARCELS.filter((p) => named.has(p.pin)) : PARCELS
  const common = (p: (typeof PARCELS)[number]) => ({ pin: p.pin, year: "2026" })
  if (id === "pabr-t5kh") return parcels.map((p) => ({ ...common(p), class: "203", township_code: "77", township_name: "Cicero", nbhd_code: "78120" }))
  if (id === "x54s-btds") return parcels.map((p) => ({ ...common(p), class: "203", township_code: "77", pin_num_cards: "1", pin_is_multiland: "0", pin_num_landlines: "1", tieback_key_pin: null, tieback_proration_rate: null, card_proration_rate: "0", char_bldg_sf: p.pin === SUBJECT && subjectSqft !== undefined ? subjectSqft : p.sqft, char_yrblt: "1925", char_type_resd: "1 Story" }))
  if (id === "uzyt-m557") return parcels.map((p) => ({ ...common(p), class: "203", township_code: "77", nbhd: "78120", mailed_tot: p.total, mailed_land: p.land, mailed_bldg: p.bldg }))
  if (id === "3723-97qp") return parcels.map((p) => ({ ...common(p), prop_address_full: p.address, prop_address_city_name: "Cicero", prop_address_state: "IL" }))
  return []
}

const inertCountyFetch = async (input: unknown) => {
  const url = String(input)
  const body = JSON.stringify(rowsFor(new URL(url)))
  return {
    ok: true, status: 200, redirected: false, url,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null) },
    body: null,
    text: async () => body,
  } as unknown as Response
}

const TRUTHFUL_METRIC_CAVEAT = "used only to select the comparable cohort and compute the per-building-square-foot metric"
const AREA_UNKNOWN_TEXT = "are not reported or used"

const render = (result: unknown) => renderToStaticMarkup(React.createElement(SharedEvidenceSummary, { result } as never))

let priorFetch: typeof fetch
beforeEach(() => {
  priorFetch = global.fetch
  global.fetch = inertCountyFetch as unknown as typeof fetch
  const store = createInMemoryAcquisitionSnapshotStore()
  mockEnvStore = { ...store, close: async () => {} }
})
afterEach(() => {
  global.fetch = priorFetch
  mockEnvStore = null
  subjectSqft = undefined
})

async function produceCountyResult() {
  const acquisition = await createCountyFactualAdapter().acquire({ pin: SUBJECT })
  expect(acquisition.ok).toBe(true)
  const analysis = await analyzeAcquisition(createInMemoryAnalysisStore(), acquisition)
  expect(analysis.ok).toBe(true)
  if (!analysis.ok) throw new Error("analysis refused")
  return analysis.result
}

const withLimitations = (body: any, keys: string[]) => ({ ...body, limitations: [...body.limitations.filter((k: string) => k !== "area_unknown" && k !== "area_snapshot_metric_only"), ...keys] })

describe("county result with the saved shared metric discloses its area provenance truthfully", () => {
  it("producer persists the shared metric; decoder and presentation carry it with the truthful caveat", async () => {
    const result = await produceCountyResult()
    expect(result.dataOrigin).toBe("COUNTY_RECORD")
    const ref = result.acquisitionSnapshot!
    expect(ref).toBeTruthy()
    const stored = await (mockEnvStore as any).readPrivileged(ref.id)
    expect(stored.snapshot.sharedMetric).toEqual(ref.sharedMetric)
    expect(ref.sharedMetric.metric).toBe("MEDIAN_ASSESSED_PER_BUILDING_SQFT")

    expect(result.limitations).toContain("area_snapshot_metric_only")
    expect(result.limitations).not.toContain("area_unknown")

    const decoded = decodeFactualResultJson(JSON.stringify(result))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const html = render(decoded.value)
    expect(html).toContain("Your assessed value per building sq ft")
    expect(html).toContain(TRUTHFUL_METRIC_CAVEAT)
    expect(html).not.toContain(AREA_UNKNOWN_TEXT)

    // The saved metric is the fixed-input arithmetic, and the screen shows exactly those numbers.
    const m = ref.sharedMetric
    expect(m.subjectAssessedCentsPerBuildingSqft).toBeCloseTo(4_250_000 / 1200, 6)
    expect(m.comparableMedian.status).toBe("COMPUTED")
    if (m.comparableMedian.status !== "COMPUTED") return
    expect(m.comparableMedian.count).toBe(2)
    expect(m.comparableMedian.value).toBeCloseTo((4_000_000 / 1250 + 3_900_000 / 1150) / 2, 6)
    const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
    expect(dollars(m.subjectAssessedCentsPerBuildingSqft)).toBe("$35.42")
    expect(html).toContain(`Your assessed value per building sq ft: ${dollars(m.subjectAssessedCentsPerBuildingSqft)}`)
    expect(html).toContain(`Comparable median (2 properties, you excluded): ${dollars(m.comparableMedian.value)}`)
  })

  it.each([["zero", "0"], ["missing", null]])("the real county producer refuses a subject with %s building area", async (_label, sqft) => {
    subjectSqft = sqft
    const acquisition = await createCountyFactualAdapter().acquire({ pin: SUBJECT })
    expect(acquisition.ok).toBe(false)
  })

  it("decoder rejects inaccurate area disclosures around the metric", async () => {
    const body = JSON.parse(JSON.stringify(await produceCountyResult()))
    // The metric with the old "not reported or used" caveat.
    expect(decodeFactualResultJson(JSON.stringify(withLimitations(body, ["area_unknown"]))).ok).toBe(false)
    // Both caveats at once.
    expect(decodeFactualResultJson(JSON.stringify(withLimitations(body, ["area_unknown", "area_snapshot_metric_only"]))).ok).toBe(false)
    // The metric caveat without any metric.
    const noMetric = { ...body }
    delete noMetric.acquisitionSnapshot
    expect(decodeFactualResultJson(JSON.stringify(withLimitations(noMetric, ["area_snapshot_metric_only"]))).ok).toBe(false)
  })

  it("decoder/presentation only: a county body with its snapshot removed accepts area-unknown and shows no metric", async () => {
    const body = JSON.parse(JSON.stringify(await produceCountyResult()))
    delete body.acquisitionSnapshot
    const decoded = decodeFactualResultJson(JSON.stringify(withLimitations(body, ["area_unknown"])))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const html = render(decoded.value)
    expect(html).toContain(AREA_UNKNOWN_TEXT)
    expect(html).not.toContain("per building sq ft")
    expect(html).not.toContain(TRUTHFUL_METRIC_CAVEAT)
  })

  it("the producer refuses when no snapshot store is configured", async () => {
    mockEnvStore = null
    const acquisition = await createCountyFactualAdapter().acquire({ pin: SUBJECT })
    expect(acquisition.ok).toBe(false)
  })
})
