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
  const fixtures = generateSyntheticDecisionFixtures()

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
