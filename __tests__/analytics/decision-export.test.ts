/** @jest-environment node */

/**
 * The source-side export contract that feeds the offline decision-packet tool.
 *
 * Raw GA4 dimension values are untrusted text. The adapter maps each one into
 * the tool's closed vocabulary or its fixed sentinels (`other`, `not_set`,
 * `none`) and never passes a raw string through, so an email, a PIN, a URL or
 * a partner's path in a GA4 row cannot reach an export. Output is
 * deterministic: the same input, in any row order, gives the same bytes.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import approvedRegistry from "@/data/analytics/ot-experiment-registry.v1.json"
import mappingContract from "@/data/analytics/ot-decision-export-mapping.v1.json"
import { forbiddenValueCode } from "@/lib/analytics/campaign-governance"
import {
  DOWNSTREAM_VOCABULARY,
  buildDecisionExportMappingContract,
  buildGa4BehaviorDocument,
  generateSyntheticDecisionFixtures,
  mapCampaign,
  mapContent,
  mapLanding,
  mapMedium,
  mapSource,
  projectExperimentRegistry,
  serializeDecisionDocument,
} from "@/lib/analytics/decision-export"

type Json = Record<string, unknown>

const FIXTURE_DIR = resolve(__dirname, "../../fixtures/analytics/decision-packet")

describe("raw GA4 values map into the closed vocabulary or a sentinel", () => {
  it.each([
    ["(direct)", "(none)", "direct"],
    ["google", "organic", "google"],
    ["Facebook", "paid_social", "facebook"],
    ["l.facebook.com", "referral", "facebook"],
    ["t.co", "social", "x"],
    ["chatgpt.com", "referral", "chatgpt"],
    ["(not set)", "(not set)", "not_set"],
    ["", "referral", "not_set"],
    ["(other)", "referral", "other"],
    ["partner.example.test", "referral", "referral_other"],
    ["partner.example.test", "cpc", "other"],
    ["owner@example.com", "referral", "referral_other"],
    ["16-01-216-001-0000", "email", "other"],
  ])("source %j with medium %j -> %s", (source, medium, expected) => {
    expect(mapSource(source, mapMedium(medium))).toBe(expected)
  })

  it.each([
    ["(none)", "none"],
    ["organic", "organic"],
    ["CPC", "cpc"],
    ["ppc", "cpc"],
    ["paidsocial", "paid_social"],
    ["Email", "email"],
    ["(not set)", "not_set"],
    ["internal", "other"],
    ["jane@example.com", "other"],
  ])("medium %j -> %s", (medium, expected) => {
    expect(mapMedium(medium)).toBe(expected)
  })

  it.each([
    ["ot_202608_season_synthappeal", "synthetic_fixture", "ot_202608_season_synthappeal"],
    ["ot_202608_season_synthappeal", "operator_export", "other"],
    ["(organic)", "operator_export", "none"],
    ["(direct)", "operator_export", "none"],
    ["(referral)", "operator_export", "none"],
    ["(not set)", "operator_export", "not_set"],
    ["(other)", "operator_export", "other"],
    ["ot_2026_cicero_deadline", "operator_export", "other"],
    ["hoa_resident_resource_20260723", "operator_export", "other"],
    ["owner@example.com", "synthetic_fixture", "other"],
  ])("campaign %j in a %s export -> %s", (campaign, origin, expected) => {
    expect(mapCampaign(campaign, origin as "synthetic_fixture" | "operator_export")).toBe(expected)
  })

  it.each([
    ["srch_a", "srch_a"],
    ["(not set)", "none"],
    ["(other)", "other"],
    ["v1_video", "other"],
    ["100 W Randolph St", "other"],
  ])("content %j -> %s", (content, expected) => {
    expect(mapContent(content)).toBe(expected)
  })

  it.each([
    ["/", "/"],
    ["/check", "other"],
    ["/townships/cicero", "other"],
    ["/check?pin=16012160010000", "other"],
    ["https://www.overtaxed-il.com/", "other"],
    ["/clients/jane-doe-123-main-st", "other"],
    ["(not set)", "not_set"],
    ["(other)", "other"],
  ])("landing %j -> %s", (landing, expected) => {
    expect(mapLanding(landing)).toBe(expected)
  })
})

function rawRow(overrides: Json = {}): Json {
  return {
    date: "20260920",
    session_source: "google",
    session_medium: "cpc",
    session_campaign: "ot_202608_season_synthappeal",
    session_content: "srch_a",
    landing_page: "/",
    sessions: 30,
    checkout_starts: 4,
    purchase_events: 2,
    ...overrides,
  }
}

function exportInput(rows: Json[], overrides: Json = {}): Json {
  return {
    data_origin: "synthetic_fixture",
    generated_at: "2026-09-30T12:00:00Z",
    timezone: "America/Chicago",
    coverage: { start: "2026-09-20", end: "2026-09-21" },
    attested_complete_ranges: [{ start: "2026-09-20", end: "2026-09-21" }],
    quality: { sampled: false, thresholded: false, other_row: false },
    rows,
    ...overrides,
  }
}

function built(input: Json) {
  const result = buildGa4BehaviorDocument(input)
  if (!result.ok) throw new Error(`unexpected rejection ${JSON.stringify(result.issues)}`)
  return result.document
}

describe("the GA4 behavior adapter", () => {
  it("aggregates raw rows that normalize to one segment and emits the decision-packet document", () => {
    const document = built(
      exportInput([
        rawRow(),
        rawRow({ session_source: "partner.example.test", session_medium: "referral", session_campaign: "(referral)", session_content: "(not set)", landing_page: "/townships/cicero", sessions: 3, checkout_starts: 0, purchase_events: 0 }),
        rawRow({ session_source: "blog.example.org", session_medium: "referral", session_campaign: "(referral)", session_content: "(not set)", landing_page: "/check", sessions: 2, checkout_starts: 1, purchase_events: 0 }),
        rawRow({ date: "20260921", session_source: "(direct)", session_medium: "(none)", session_campaign: "(direct)", session_content: "(not set)", landing_page: "/", sessions: 9, checkout_starts: 1, purchase_events: 0 }),
      ]),
    )

    expect(document).toEqual({
      schema: "decision_packet.ga4_behavior",
      schema_version: 1,
      data_origin: "synthetic_fixture",
      business: "ot",
      timezone: "America/Chicago",
      generated_at: "2026-09-30T12:00:00Z",
      coverage: { start: "2026-09-20", end: "2026-09-21" },
      attested_complete_ranges: [{ start: "2026-09-20", end: "2026-09-21" }],
      quality: { sampled: false, thresholded: false, other_row: false },
      rows: [
        { date: "2026-09-20", source: "google", medium: "cpc", campaign: "ot_202608_season_synthappeal", content: "srch_a", landing_path: "/", sessions: 30, checkout_starts: 4, purchase_events: 2 },
        { date: "2026-09-20", source: "referral_other", medium: "referral", campaign: "none", content: "none", landing_path: "other", sessions: 5, checkout_starts: 1, purchase_events: 0 },
        { date: "2026-09-21", source: "direct", medium: "none", campaign: "none", content: "none", landing_path: "/", sessions: 9, checkout_starts: 1, purchase_events: 0 },
      ],
    })
  })

  it("is byte-identical whatever order the raw rows arrive in", () => {
    const rows = [rawRow(), rawRow({ date: "20260921", sessions: 7, checkout_starts: 0, purchase_events: 0 })]
    const forward = serializeDecisionDocument(built(exportInput(rows)))
    const backward = serializeDecisionDocument(built(exportInput([...rows].reverse())))

    expect(backward).toBe(forward)
  })

  it("never lets a hostile raw value into the document", () => {
    const document = built(
      exportInput([
        rawRow({
          session_source: "owner@example.com",
          session_medium: "referral",
          session_campaign: "16-01-216-001-0000",
          session_content: "Jane Q Homeowner",
          landing_page: "/clients/jane-doe-123-main-st?order=ord_123#cs_live_a1B2c3D4e5F6g7H8",
          sessions: 1,
          checkout_starts: 0,
          purchase_events: 0,
        }),
      ]),
    )

    const serialized = JSON.stringify(document)
    for (const marker of ["owner", "example", "16-01", "Jane", "Homeowner", "clients", "ord_123", "cs_live", "?", "#"]) {
      expect(serialized).not.toContain(marker)
    }
  })

  it("flags GA4's (other) row in the quality block", () => {
    const document = built(exportInput([rawRow({ session_campaign: "(other)" })]))

    expect(document.quality).toEqual({ sampled: false, thresholded: false, other_row: true })
  })

  it.each([
    ["an unknown raw field", { rows: [rawRow({ session_term: "appeal" })] }, "UNKNOWN_FIELD", "$.rows[0]"],
    ["a client id field", { rows: [rawRow({ client_id: "1234567890.1724102400" })] }, "UNKNOWN_FIELD", "$.rows[0]"],
    ["a page location field", { rows: [rawRow({ page_location: "https://x.test/?pin=1" })] }, "UNKNOWN_FIELD", "$.rows[0]"],
    ["a fractional count", { rows: [rawRow({ sessions: 30.5 })] }, "INVALID_COUNT", "$.rows[0].sessions"],
    ["a negative count", { rows: [rawRow({ purchase_events: -1 })] }, "INVALID_COUNT", "$.rows[0].purchase_events"],
    ["an ISO date where GA4 sends YYYYMMDD", { rows: [rawRow({ date: "2026-09-20" })] }, "INVALID_DATE", "$.rows[0].date"],
    ["a row outside coverage", { rows: [rawRow({ date: "20260925" })] }, "ROW_OUTSIDE_COVERAGE", "$.rows[0].date"],
    ["more checkout starts than sessions", { rows: [rawRow({ sessions: 1, checkout_starts: 2 })] }, "METRIC_INVARIANT", "$.rows"],
    ["coverage that ends after generation", { generated_at: "2026-09-20T12:00:00Z" }, "COVERAGE_AFTER_GENERATED_AT", "$.coverage.end"],
    ["an attested range outside coverage", { attested_complete_ranges: [{ start: "2026-09-19", end: "2026-09-21" }] }, "ATTESTED_RANGE_INVALID", "$.attested_complete_ranges[0]"],
    ["an unknown timezone", { timezone: "Europe/Paris" }, "INVALID_TIMEZONE", "$.timezone"],
    ["a timezone no zone database has", { timezone: "Not/A_Zone" }, "INVALID_TIMEZONE", "$.timezone"],
    ["an unknown data origin", { data_origin: "production_db" }, "INVALID_DATA_ORIGIN", "$.data_origin"],
    ["a reversed coverage", { coverage: { start: "2026-09-21", end: "2026-09-20" } }, "COVERAGE_RANGE_INVALID", "$.coverage"],
    ["a quality note", { quality: { sampled: false, thresholded: false, other_row: false, note: "x" } }, "UNKNOWN_FIELD", "$.quality"],
  ])("rejects %s", (_label, overrides, code, path) => {
    const input = exportInput([rawRow()], overrides as Json)

    const result = buildGa4BehaviorDocument(input)

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues).toContainEqual({ code, path })
  })

  it("reports no value in a rejection", () => {
    const result = buildGa4BehaviorDocument(exportInput([rawRow({ customer_email: "owner@example.com" })]))

    expect(JSON.stringify(result)).not.toContain("owner@example.com")
    expect(JSON.stringify(result)).not.toContain("customer_email")
  })

  /** Like the registry: one read of the input, and only what it validated leaves. */
  it("exports the generated_at it validated, whatever a getter answers later", () => {
    const input = exportInput([rawRow()])
    const reads = answersOnceThen(input, "generated_at", "2026-09-30T12:00:00Z", "0000-01-01T00:00:00Z")

    const document = built(input)

    expect(reads()).toBe(1)
    expect(document.generated_at).toBe("2026-09-30T12:00:00Z")
  })

  it("exports the attested range it validated, whatever a getter answers later", () => {
    const range: Json = { end: "2026-09-21" }
    const reads = answersOnceThen(range, "start", "2026-09-20", "0000-01-01")

    const document = built(exportInput([rawRow()], { attested_complete_ranges: [range] }))

    expect(reads()).toBe(1)
    expect(document.attested_complete_ranges).toEqual([{ start: "2026-09-20", end: "2026-09-21" }])
  })

  it("exports the quality flag it validated, whatever a getter answers later", () => {
    const quality: Json = { thresholded: false, other_row: false }
    const reads = answersOnceThen(quality, "sampled", false, "jane-doe")

    const document = built(exportInput([rawRow()], { quality }))

    expect(reads()).toBe(1)
    expect(document.quality).toEqual({ sampled: false, thresholded: false, other_row: false })
  })

  it("exports the count it validated, whatever a getter answers later", () => {
    const row = rawRow()
    const reads = answersOnceThen(row, "sessions", 30, -1)

    const document = built(exportInput([row]))

    expect(reads()).toBe(1)
    expect(document.rows).toMatchObject([{ sessions: 30 }])
  })

  it("refuses attested ranges with a hole", () => {
    const ranges: unknown[] = new Array(2)
    ranges[1] = { start: "2026-09-20", end: "2026-09-21" }

    const result = buildGa4BehaviorDocument(exportInput([rawRow()], { attested_complete_ranges: ranges }))

    expect(result).toEqual({ ok: false, issues: [{ code: "ATTESTED_RANGE_INVALID", path: "$.attested_complete_ranges[0]" }] })
  })

  it("refuses rows with a hole", () => {
    const rows: Json[] = new Array(2)
    rows[1] = rawRow()

    const result = buildGa4BehaviorDocument(exportInput(rows))

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues).toContainEqual({ code: "TYPE_OBJECT", path: "$.rows[0]" })
  })

  it("refuses, without throwing or echoing, an input it cannot read once", () => {
    const input = exportInput([rawRow()])
    Object.defineProperty(input, "timezone", { enumerable: true, get: () => { throw new Error("jane-doe") } })

    expect(buildGa4BehaviorDocument(input)).toEqual({ ok: false, issues: [{ code: "TYPE_OBJECT", path: "$" }] })
  })
})

/** Defines `key` to answer `first` on its first read and `later` on every read after; returns the read count. */
function answersOnceThen(target: object, key: string, first: unknown, later: unknown): () => number {
  let reads = 0
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1
      return reads === 1 ? first : later
    },
  })
  return () => reads
}

/**
 * The downstream tool rejects a missing dimension, a non-string dimension and
 * an instant that is not on the calendar. Each of these once left the adapter
 * as `ok: true`: `constructor` and `__proto__` resolved to inherited members of
 * the alias tables, and `Date.parse` silently rolls `2026-02-30` to March 2.
 */
describe("hostile object keys and impossible instants", () => {
  it.each(["constructor", "__proto__", "Constructor", " __proto__ ", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"])(
    "maps the raw source and medium %j to a closed sentinel, never an inherited member",
    (raw) => {
      expect(mapMedium(raw)).toBe("other")
      expect(mapSource(raw, "cpc")).toBe("other")
      expect(mapSource(raw, "referral")).toBe("referral_other")
      expect(mapCampaign(raw, "synthetic_fixture")).toBe("other")
      expect(mapContent(raw)).toBe("other")
      expect(mapLanding(raw)).toBe("other")
    },
  )

  it.each(["constructor", "__proto__"])("exports %j as exact string sentinels the tool accepts", (raw) => {
    const document = built(exportInput([rawRow({ session_source: raw, session_medium: raw })]))

    expect(JSON.parse(serializeDecisionDocument(document)).rows).toEqual([
      {
        date: "2026-09-20",
        source: "other",
        medium: "other",
        campaign: "ot_202608_season_synthappeal",
        content: "srch_a",
        landing_path: "/",
        sessions: 30,
        checkout_starts: 4,
        purchase_events: 2,
      },
    ])
  })

  const february = (generatedAt: string) =>
    exportInput([rawRow({ date: "20260220" })], {
      generated_at: generatedAt,
      coverage: { start: "2026-02-20", end: "2026-02-21" },
      attested_complete_ranges: [],
    })

  it.each([
    ["a day February does not have", "2026-02-30T12:00:00Z"],
    ["hour 24", "2026-02-28T24:00:00Z"],
    ["second 60", "2026-03-01T12:00:60Z"],
    ["month 13", "2026-13-01T12:00:00Z"],
    ["fractional seconds", "2026-03-01T12:00:00.000Z"],
    ["an explicit offset", "2026-03-01T12:00:00+00:00"],
    ["a local time", "2026-03-01T12:00:00"],
  ])("refuses a generated_at that is %s", (_label, generatedAt) => {
    const result = buildGa4BehaviorDocument(february(generatedAt))

    expect(result).toEqual({ ok: false, issues: [{ code: "INVALID_TIMESTAMP", path: "$.generated_at" }] })
  })

  it("still accepts a real leap day", () => {
    const result = buildGa4BehaviorDocument(
      exportInput([rawRow({ date: "20240228" })], {
        generated_at: "2024-02-29T23:59:59Z",
        coverage: { start: "2024-02-28", end: "2024-02-28" },
        attested_complete_ranges: [],
      }),
    )

    expect(result.ok).toBe(true)
  })

  it("refuses year zero, which the tool's calendar does not have", () => {
    const result = buildGa4BehaviorDocument(
      exportInput([rawRow({ date: "00000101" })], {
        generated_at: "0000-01-05T00:00:00Z",
        coverage: { start: "0000-01-01", end: "0000-01-02" },
        attested_complete_ranges: [],
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues).toEqual(
      expect.arrayContaining([
        { code: "INVALID_TIMESTAMP", path: "$.generated_at" },
        { code: "INVALID_DATE", path: "$.coverage" },
        { code: "INVALID_DATE", path: "$.rows[0].date" },
      ]),
    )
  })

  it("requires own fields: a field inherited through a prototype is missing", () => {
    const row = Object.assign(Object.create({ sessions: 30 }), rawRow())
    delete row.sessions

    const result = buildGa4BehaviorDocument(exportInput([row]))

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues).toContainEqual({ code: "MISSING_KEY:sessions", path: "$.rows[0]" })
  })
})

/**
 * The tool's calendar runs 0001-01-01..9999-12-31 and it does exact zoned
 * arithmetic at both ends. `Date.UTC` once moved years 0001-0099 into the
 * 1900s, so coverage ending after generation left as `ok: true`; and the tool
 * raises OverflowError settling an attested day whose settlement instant
 * (next local midnight + 48h) falls past 9999-12-31.
 */
describe("the decision-packet calendar at its edges", () => {
  /** When each packet zone's local midnight falls in UTC, per the tool's zoneinfo: local mean time before 1883. */
  const EARLY_MIDNIGHT_UTC: Record<string, string> = {
    UTC: "00:00:00",
    "America/New_York": "04:56:02",
    "America/Chicago": "05:50:36",
    "America/Denver": "06:59:56",
    "America/Los_Angeles": "07:52:58",
  }
  const ZONES = Object.keys(EARLY_MIDNIGHT_UTC)

  const emptyDay = (day: string, generatedAt: string, timezone = "UTC", attested = true) =>
    exportInput([], {
      generated_at: generatedAt,
      timezone,
      coverage: { start: day, end: day },
      attested_complete_ranges: attested ? [{ start: day, end: day }] : [],
    })

  it("refuses year-0001 coverage that ends after generation", () => {
    expect(buildGa4BehaviorDocument(emptyDay("0001-01-02", "0001-01-01T12:00:00Z"))).toEqual({
      ok: false,
      issues: [{ code: "COVERAGE_AFTER_GENERATED_AT", path: "$.coverage.end" }],
    })
  })

  const earlyDays = ["0001-01-01", "0001-01-02", "0004-02-29", "0099-12-31", "0100-01-01", "0100-03-01", "0101-01-01"]
  const shift = (instant: string, seconds: number) => new Date(Date.parse(instant) + seconds * 1000).toISOString().replace(".000Z", "Z")

  it.each(ZONES.flatMap((zone) => earlyDays.map((day) => [day, zone] as const)))(
    "places the start of %s in %s at its exact instant",
    (day, zone) => {
      const midnight = `${day}T${EARLY_MIDNIGHT_UTC[zone]}Z`

      for (const generatedAt of [shift(midnight, -1), midnight].filter((instant) => !instant.startsWith("0000"))) {
        expect(buildGa4BehaviorDocument(emptyDay(day, generatedAt, zone, false))).toEqual({
          ok: false,
          issues: [{ code: "COVERAGE_AFTER_GENERATED_AT", path: "$.coverage.end" }],
        })
      }
      expect(buildGa4BehaviorDocument(emptyDay(day, shift(midnight, 1), zone, false)).ok).toBe(true)
    },
  )

  it("exports a real year-0001 day with its rows", () => {
    const document = built(
      exportInput([rawRow({ date: "00010102" })], {
        generated_at: "0001-01-05T00:00:00Z",
        coverage: { start: "0001-01-01", end: "0001-01-02" },
        attested_complete_ranges: [{ start: "0001-01-01", end: "0001-01-02" }],
      }),
    )

    expect(document).toMatchObject({ coverage: { start: "0001-01-01", end: "0001-01-02" }, rows: [{ date: "0001-01-02" }] })
  })

  const realFormatToParts = Intl.DateTimeFormat.prototype.formatToParts
  it.each([
    ["no date parts at all", () => []],
    ["an era it does not know", function (this: Intl.DateTimeFormat, date?: Date | number) {
      return realFormatToParts.call(this, date).map((part) => (part.type === "era" ? { ...part, value: "CE" } : part))
    }],
  ])("fails closed when the zone data yields %s", (_label, parts) => {
    const formatToParts = jest.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(parts as () => Intl.DateTimeFormatPart[])
    try {
      const result = buildGa4BehaviorDocument(emptyDay("2026-09-20", "2026-09-30T12:00:00Z", "America/Chicago"))

      expect(result.ok).toBe(false)
      expect(result.ok ? [] : result.issues).toEqual([
        { code: "COVERAGE_AFTER_GENERATED_AT", path: "$.coverage.end" },
        { code: "ATTESTED_RANGE_UNSETTLEABLE", path: "$.attested_complete_ranges[0]" },
      ])
    } finally {
      formatToParts.mockRestore()
    }
  })

  it("refuses to attest 9999-12-31, whose settlement the tool cannot compute", () => {
    expect(buildGa4BehaviorDocument(emptyDay("9999-12-31", "9999-12-31T12:00:00Z"))).toEqual({
      ok: false,
      issues: [{ code: "ATTESTED_RANGE_UNSETTLEABLE", path: "$.attested_complete_ranges[0]" }],
    })
  })

  it.each(ZONES)("attests through 9999-12-28 and no later in %s", (zone) => {
    const lastDays = (end: string) =>
      exportInput([], {
        generated_at: "9999-12-31T23:59:59Z",
        timezone: zone,
        coverage: { start: "9999-12-24", end: "9999-12-31" },
        attested_complete_ranges: [{ start: "9999-12-24", end }],
      })

    expect(buildGa4BehaviorDocument(lastDays("9999-12-28")).ok).toBe(true)
    for (const end of ["9999-12-29", "9999-12-30", "9999-12-31"]) {
      expect(buildGa4BehaviorDocument(lastDays(end))).toEqual({
        ok: false,
        issues: [{ code: "ATTESTED_RANGE_UNSETTLEABLE", path: "$.attested_complete_ranges[0]" }],
      })
    }
  })

  it.each(ZONES)("still exports unattested coverage through 9999-12-31 in %s", (zone) => {
    for (const day of ["9999-12-29", "9999-12-30", "9999-12-31"]) {
      expect(buildGa4BehaviorDocument(emptyDay(day, "9999-12-31T23:59:59Z", zone, false)).ok).toBe(true)
    }
  })

  it.each([
    [
      "an unordered range does not move the ordering baseline",
      "2026-09-21T12:00:00Z",
      { start: "2026-09-19", end: "2026-09-21" },
      [{ start: "2026-09-19", end: "2026-09-20" }, { start: "2026-09-21", end: "2026-09-19" }, { start: "2026-09-20", end: "2026-09-21" }],
      [1, 2],
    ],
    [
      "a reversed range is invalid, not also unsettleable",
      "9999-12-31T23:59:59Z",
      { start: "9999-12-24", end: "9999-12-31" },
      [{ start: "9999-12-30", end: "9999-12-29" }],
      [0],
    ],
  ])("%s", (_label, generatedAt, coverage, ranges, invalid) => {
    const result = buildGa4BehaviorDocument(exportInput([], { generated_at: generatedAt, timezone: "UTC", coverage, attested_complete_ranges: ranges }))

    expect(result).toEqual({
      ok: false,
      issues: (invalid as number[]).map((index) => ({ code: "ATTESTED_RANGE_INVALID", path: `$.attested_complete_ranges[${index}]` })),
    })
  })

  it("names only the range the tool cannot settle", () => {
    const result = buildGa4BehaviorDocument(
      exportInput([], {
        generated_at: "9999-12-31T23:59:59Z",
        timezone: "America/Chicago",
        coverage: { start: "9999-12-20", end: "9999-12-31" },
        attested_complete_ranges: [
          { start: "9999-12-20", end: "9999-12-21" },
          { start: "9999-12-27", end: "9999-12-29" },
        ],
      }),
    )

    expect(result).toEqual({ ok: false, issues: [{ code: "ATTESTED_RANGE_UNSETTLEABLE", path: "$.attested_complete_ranges[1]" }] })
  })
})

describe("projecting the experiment registry", () => {
  const syntheticRegistry = () => ({
    schema: "ot.experiment_registry",
    schema_version: 1,
    registry_origin: "synthetic_fixture",
    business: "ot",
    currency: "USD",
    governance_version: "ot-campaign-governance-v1",
    experiments: [
      {
        experiment_id: "ot_exp_2026_001",
        business: "ot",
        status: "running",
        start_date: "2026-08-20",
        end_date: "2026-10-15",
        source: "google",
        medium: "cpc",
        campaign: "ot_202608_season_synthappeal",
        content: "srch_a",
        landing_path: "/",
        budget: { amount_minor: 300000, currency: "USD" },
        primary_outcome: "paid_per_qualified_rate",
        evidence_threshold: { min_denominator: 5, min_events: 3 },
        decision: "pending",
      },
    ],
  })

  it("projects a representable registry into the decision-packet registry", () => {
    expect(projectExperimentRegistry(syntheticRegistry())).toEqual({
      ok: true,
      document: {
        schema: "decision_packet.experiment_registry",
        schema_version: 1,
        data_origin: "synthetic_fixture",
        experiments: [syntheticRegistry().experiments[0]],
      },
    })
  })

  it("fails closed when an experiment's landing has no downstream representation yet", () => {
    const registry = syntheticRegistry()
    registry.experiments[0].landing_path = "/check"

    expect(projectExperimentRegistry(registry)).toEqual({
      ok: false,
      issues: [{ code: "DOWNSTREAM_VOCABULARY_EXTENSION_REQUIRED", path: "$.experiments[0].landing_path" }],
    })
  })

  it("does not project a registry the linter rejects", () => {
    const registry = syntheticRegistry()
    registry.experiments[0].campaign = "owner@example.com"

    expect(projectExperimentRegistry(registry)).toEqual({
      ok: false,
      issues: [{ code: "FORBIDDEN_VALUE:EMAIL", path: "$.experiments[0].campaign" }],
    })
  })

  /**
   * The decision-packet tool's calendar, written out independently of the code
   * under test: `\d{4}-\d{2}-\d{2}` naming a proleptic Gregorian day from
   * 0001-01-01 to 9999-12-31 (Python's `date`). A registry the exporter
   * projects successfully may carry no other date.
   */
  function toolCalendarHasDay(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return false
    const [year, month, day] = match.slice(1).map(Number)
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    return year >= 1 && days !== undefined && day >= 1 && day <= days
  }

  function withDates(start_date: string, end_date: string) {
    const registry = syntheticRegistry()
    registry.experiments[0].start_date = start_date
    registry.experiments[0].end_date = end_date
    return registry
  }

  it.each([
    ["a year-zero start", "0000-01-01", "2026-10-15", "$.experiments[0].start_date"],
    ["a year-zero end", "0000-01-01", "0000-12-31", "$.experiments[0].end_date"],
    ["a year-zero leap day", "0000-02-29", "2026-10-15", "$.experiments[0].start_date"],
    ["February 29 of a common year", "2025-02-29", "2026-10-15", "$.experiments[0].start_date"],
    ["April 31", "2026-08-20", "2026-04-31", "$.experiments[0].end_date"],
  ])("refuses to export %s, a date the decision-packet calendar has no day for", (_label, start, end, path) => {
    const result = projectExperimentRegistry(withDates(start, end))

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues).toContainEqual({ code: "INVALID_DATE", path })
  })

  it("exports the first and last days of the decision-packet calendar", () => {
    const result = projectExperimentRegistry(withDates("0001-01-01", "9999-12-31"))

    expect(result).toMatchObject({ ok: true, document: { experiments: [{ start_date: "0001-01-01", end_date: "9999-12-31" }] } })
  })

  it("exports a registry date exactly when the decision-packet calendar has that day", () => {
    const disagreements: string[] = []
    for (const year of ["0000", "0001", "0004", "0100", "0400", "1900", "2000", "2024", "2025", "2100", "9999"]) {
      for (let month = 0; month <= 13; month += 1) {
        for (let day = 0; day <= 32; day += 1) {
          const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
          for (const [start, end] of [[date, "9999-12-31"], ["0001-01-01", date]]) {
            const result = projectExperimentRegistry(withDates(start, end))
            if (result.ok !== toolCalendarHasDay(date)) disagreements.push(`${start}..${end}`)
          }
        }
      }
    }

    expect(disagreements).toEqual([])
  })

  /**
   * The exporter emits what it validated, never a later read of the input: a
   * getter or Proxy that answers one value to the linter and another to the
   * projection once exported a year-zero date and a free-text experiment id
   * as `ok: true`, and an array hole the linter skipped left as `null`.
   */
  it.each([
    ["start_date", "2026-08-20", "0000-01-01"],
    ["end_date", "2026-10-15", "2026-02-30"],
    ["experiment_id", "ot_exp_2026_001", "jane-doe-123-main-st"],
    ["status", "running", "not_a_status"],
  ])("exports the %s it validated, whatever a getter answers later", (field, first, later) => {
    const registry = syntheticRegistry()
    const reads = answersOnceThen(registry.experiments[0], field, first, later)

    const result = projectExperimentRegistry(registry)

    expect(reads()).toBe(1)
    expect(result).toMatchObject({ ok: true, document: { experiments: [{ [field]: first }] } })
  })

  it("exports the budget it validated, whatever a getter answers later", () => {
    const registry = syntheticRegistry()
    const reads = answersOnceThen(registry.experiments[0].budget, "amount_minor", 300000, -5)

    const result = projectExperimentRegistry(registry)

    expect(reads()).toBe(1)
    expect(result).toMatchObject({ ok: true, document: { experiments: [{ budget: { amount_minor: 300000 } }] } })
  })

  it("exports the experiment list it validated, whatever the registry answers later", () => {
    const registry = syntheticRegistry()
    const later = syntheticRegistry().experiments
    later[0].start_date = "0000-01-01"
    const reads = answersOnceThen(registry, "experiments", syntheticRegistry().experiments, later)

    const result = projectExperimentRegistry(registry)

    expect(reads()).toBe(1)
    expect(result).toMatchObject({ ok: true, document: { experiments: [{ start_date: "2026-08-20" }] } })
  })

  it("exports what a Proxy answered to validation", () => {
    const registry = syntheticRegistry()
    let reads = 0
    const experiment = new Proxy(registry.experiments[0], {
      get(target, key, receiver) {
        if (key !== "start_date") return Reflect.get(target, key, receiver)
        reads += 1
        return reads === 1 ? "2026-08-20" : "0000-01-01"
      },
    })

    const result = projectExperimentRegistry({ ...registry, experiments: [experiment] })

    expect(reads).toBe(1)
    expect(result).toMatchObject({ ok: true, document: { experiments: [{ start_date: "2026-08-20" }] } })
  })

  it.each([
    ["a leading hole", [1], [0]],
    ["a trailing hole", [0], [1]],
    ["only holes", [], [0, 1]],
  ])("refuses an experiment list with %s", (_label, filled, holes) => {
    const experiments: unknown[] = new Array(2)
    for (const index of filled) experiments[index] = syntheticRegistry().experiments[0]

    const result = projectExperimentRegistry({ ...syntheticRegistry(), experiments })

    expect(result.ok).toBe(false)
    for (const index of holes) {
      expect(result.ok ? [] : result.issues).toContainEqual({ code: "TYPE_OBJECT", path: `$.experiments[${index}]` })
    }
  })

  it.each([
    ["a cycle", () => {
      const registry: Json = syntheticRegistry()
      registry.self = registry
      return registry
    }],
    ["a BigInt", () => ({ ...syntheticRegistry(), schema_version: BigInt(1) })],
    ["a throwing getter", () => {
      const registry = syntheticRegistry()
      Object.defineProperty(registry, "business", { enumerable: true, get: () => { throw new Error("jane-doe") } })
      return registry
    }],
  ])("refuses, without throwing or echoing, a registry with %s", (_label, make) => {
    const result = projectExperimentRegistry(make())

    expect(result).toEqual({ ok: false, issues: [{ code: "TYPE_OBJECT", path: "$" }] })
  })

  it("projects the checked-in approved registry as an empty operator export", () => {
    expect(projectExperimentRegistry(approvedRegistry)).toEqual({
      ok: true,
      document: {
        schema: "decision_packet.experiment_registry",
        schema_version: 1,
        data_origin: "operator_export",
        experiments: [],
      },
    })
  })
})

function everyString(value: unknown, visit: (text: string, key: string) => void, key = "$"): void {
  if (typeof value === "string") visit(value, key)
  else if (Array.isArray(value)) value.forEach((item) => everyString(item, visit, key))
  else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) everyString(child, visit, childKey)
  }
}

describe("the synthetic fixture generator", () => {
  let fixtures: ReturnType<typeof generateSyntheticDecisionFixtures>
  beforeAll(() => {
    fixtures = generateSyntheticDecisionFixtures()
  })

  it("produces the four decision-packet documents for OT", () => {
    expect(Object.keys(fixtures).sort()).toEqual([
      "ot_app_outcomes",
      "ot_experiment_registry",
      "ot_ga4_behavior",
      "ot_payment_ledger",
    ])
    expect(fixtures.ot_ga4_behavior.schema).toBe("decision_packet.ga4_behavior")
    expect(fixtures.ot_app_outcomes.schema).toBe("decision_packet.app_outcomes")
    expect(fixtures.ot_payment_ledger.schema).toBe("decision_packet.payment_ledger")
    expect(fixtures.ot_experiment_registry.schema).toBe("decision_packet.experiment_registry")
  })

  it("is deterministic and matches the checked-in fixtures byte-for-byte", () => {
    const again = generateSyntheticDecisionFixtures()
    for (const [name, document] of Object.entries(fixtures)) {
      const bytes = serializeDecisionDocument(document)
      expect(serializeDecisionDocument(again[name as keyof typeof again])).toBe(bytes)
      expect(readFileSync(resolve(FIXTURE_DIR, `${name}.synthetic.json`), "utf8")).toBe(bytes)
    }
  })

  it("is labelled synthetic and carries only closed vocabulary, sentinels and synthetic refs", () => {
    for (const document of Object.values(fixtures)) {
      expect(document.data_origin).toBe("synthetic_fixture")
      everyString(document, (text, key) => {
        if (key === "conversion_ref") {
          expect(text).toMatch(/^cr1_k01_SYNTH[0-9A-HJKMNP-TV-Z]{21}$/)
        } else if (key === "date" || key === "start" || key === "end" || key === "start_date" || key === "end_date") {
          expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        } else if (key !== "generated_at") {
          expect(forbiddenValueCode(text)).toBeNull()
        }
      })
    }
    for (const row of fixtures.ot_ga4_behavior.rows as Json[]) {
      expect(DOWNSTREAM_VOCABULARY.sources).toContain(row.source)
      expect(DOWNSTREAM_VOCABULARY.mediums).toContain(row.medium)
      expect([...DOWNSTREAM_VOCABULARY.landingPaths, "other", "not_set"]).toContain(row.landing_path)
    }
  })
})

describe("the checked-in mapping contract", () => {
  it("is exactly what the code maps", () => {
    expect(mappingContract).toEqual(buildDecisionExportMappingContract())
  })

  it("lists every Phase-A landing that still needs a downstream vocabulary extension", () => {
    expect(mappingContract.landing.represented).toEqual(["/"])
    expect(mappingContract.landing.pending_downstream_extension).toContain("/check")
    expect(mappingContract.landing.pending_downstream_extension).toContain("/appeal-deadline/[slug]")
  })
})
