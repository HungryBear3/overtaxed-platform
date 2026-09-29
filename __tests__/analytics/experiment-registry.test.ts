/** @jest-environment node */

/**
 * The machine-readable OT experiment registry and its linter.
 *
 * A registry entry names exactly one governed segment (source, medium,
 * canonical campaign, content, Phase-A landing value), its dates, status,
 * integer-minor-unit budget, one primary outcome, its evidence threshold and
 * the owner's decision. There is no free-text field anywhere, and the linter
 * reports codes and JSON paths — never the offending value.
 */
import registry from "@/data/analytics/ot-experiment-registry.v1.json"
import { lintExperimentRegistry, lintExperimentRegistryText } from "@/lib/analytics/experiment-registry"

type Json = Record<string, unknown>

function experiment(overrides: Json = {}): Json {
  return {
    experiment_id: "ot_exp_2026_001",
    business: "ot",
    status: "planned",
    start_date: "2026-10-05",
    end_date: "2026-11-30",
    source: "newsletter",
    medium: "email",
    campaign: "ot_202610_ret_synthreminder",
    content: "eml_a",
    landing_path: "/check",
    budget: { amount_minor: 50000, currency: "USD" },
    primary_outcome: "checkout_start_rate",
    evidence_threshold: { min_denominator: 500, min_events: 20 },
    decision: "pending",
    ...overrides,
  }
}

function doc(experiments: Json[], overrides: Json = {}): Json {
  return {
    schema: "ot.experiment_registry",
    schema_version: 1,
    registry_origin: "synthetic_fixture",
    business: "ot",
    currency: "USD",
    governance_version: "ot-campaign-governance-v1",
    experiments,
    ...overrides,
  }
}

function issues(value: unknown): Array<{ code: string; path: string }> {
  const result = lintExperimentRegistry(value)
  return result.ok ? [] : result.issues
}

describe("the checked-in registry", () => {
  it("lints clean and approves no experiment yet", () => {
    expect(lintExperimentRegistry(registry)).toEqual({ ok: true, experiments: 0 })
    expect(registry.registry_origin).toBe("owner_approved")
  })
})

describe("a valid registry", () => {
  it("accepts two experiments on different segments", () => {
    const value = doc([
      experiment(),
      experiment({
        experiment_id: "ot_exp_2026_002",
        status: "completed",
        start_date: "2026-08-20",
        end_date: "2026-09-27",
        source: "google",
        medium: "cpc",
        campaign: "ot_202608_season_synthappeal",
        content: "srch_a",
        landing_path: "/appeal-deadline/[slug]",
        budget: { amount_minor: 0, currency: "USD" },
        primary_outcome: "paid_per_qualified_rate",
        evidence_threshold: { min_denominator: 5, min_events: 3 },
        decision: "iterate",
      }),
    ])

    expect(lintExperimentRegistry(value)).toEqual({ ok: true, experiments: 2 })
  })

  it("accepts content none for an experiment without a creative variant", () => {
    expect(lintExperimentRegistry(doc([experiment({ content: "none" })]))).toEqual({ ok: true, experiments: 1 })
  })
})

describe("the linter rejects", () => {
  it.each([
    ["a free-text notes field", { notes: "call Jane back" }, "FORBIDDEN_KEY:FREE_TEXT", "$.experiments[0]"],
    ["a utm_term field", { utm_term: "property tax appeal" }, "FORBIDDEN_KEY:UTM_TERM", "$.experiments[0]"],
    ["a term field", { term: "appeal" }, "FORBIDDEN_KEY:UTM_TERM", "$.experiments[0]"],
    ["a landing URL field", { landing_url: "/check" }, "FORBIDDEN_KEY:URL", "$.experiments[0]"],
    ["a customer email field", { customer_email: "x" }, "FORBIDDEN_KEY:EMAIL", "$.experiments[0]"],
    ["a property PIN field", { property_pin: "x" }, "FORBIDDEN_KEY:PROPERTY", "$.experiments[0]"],
    ["an assessment field", { assessment_value: 1 }, "FORBIDDEN_KEY:PROPERTY", "$.experiments[0]"],
    ["a comparable field", { comparable_pins: [] }, "FORBIDDEN_KEY:PROPERTY", "$.experiments[0]"],
    ["an order field", { order_id: "x" }, "FORBIDDEN_KEY:ORDER", "$.experiments[0]"],
    ["a Stripe field", { stripe_price: "x" }, "FORBIDDEN_KEY:PROVIDER", "$.experiments[0]"],
    ["a GA client field", { ga_client_id: "x" }, "FORBIDDEN_KEY:GA_IDENTIFIER", "$.experiments[0]"],
    ["a hypothesis", { hypothesis: "x" }, "FORBIDDEN_KEY:FREE_TEXT", "$.experiments[0]"],
    ["an innocuous unknown field", { priority: 1 }, "UNKNOWN_KEY", "$.experiments[0]"],
    ["a missing decision", { decision: undefined }, "MISSING_KEY:decision", "$.experiments[0]"],
    ["an email as the campaign", { campaign: "owner@example.com" }, "FORBIDDEN_VALUE:EMAIL", "$.experiments[0].campaign"],
    ["query syntax in the campaign", { campaign: "ot_202610_ret_synthreminder&utm_term=x" }, "FORBIDDEN_VALUE:QUERY_STRING", "$.experiments[0].campaign"],
    ["a name as the content", { content: "jane_doe" }, "CONTENT_FORMAT", "$.experiments[0].content"],
    ["a phone number as the content", { content: "312-555-0142" }, "FORBIDDEN_VALUE:PHONE", "$.experiments[0].content"],
    ["a placeholder source", { source: "other" }, "SOURCE_NOT_GOVERNED", "$.experiments[0].source"],
    ["a placeholder medium", { medium: "not_set" }, "MEDIUM_NOT_GOVERNED", "$.experiments[0].medium"],
    ["a raw dynamic path", { landing_path: "/appeal-deadline/cicero" }, "LANDING_NOT_APPROVED", "$.experiments[0].landing_path"],
    ["a full landing URL", { landing_path: "https://www.overtaxed-il.com/check" }, "FORBIDDEN_VALUE:URL", "$.experiments[0].landing_path"],
    ["a landing with a query", { landing_path: "/check?pin=16012160010000" }, "FORBIDDEN_VALUE:QUERY_STRING", "$.experiments[0].landing_path"],
    ["a landing with a fragment", { landing_path: "/check#result" }, "FORBIDDEN_VALUE:QUERY_STRING", "$.experiments[0].landing_path"],
    ["a PIN as the landing", { landing_path: "16-01-216-001-0000" }, "FORBIDDEN_VALUE:PROPERTY_PIN", "$.experiments[0].landing_path"],
    ["a malformed experiment id", { experiment_id: "exp-1" }, "EXPERIMENT_ID_FORMAT", "$.experiments[0].experiment_id"],
    ["another business's experiment id", { experiment_id: "hsb_exp_2026_001" }, "EXPERIMENT_ID_BUSINESS_MISMATCH", "$.experiments[0].experiment_id"],
    ["another business", { business: "hsb" }, "BUSINESS_NOT_OT", "$.experiments[0].business"],
    ["an unknown status", { status: "active" }, "INVALID_ENUM", "$.experiments[0].status"],
    ["an unknown decision", { decision: "ship" }, "INVALID_ENUM", "$.experiments[0].decision"],
    ["a decision before completion", { status: "running", decision: "scale" }, "DECISION_BEFORE_COMPLETION", "$.experiments[0].decision"],
    ["an impossible date", { start_date: "2026-02-30" }, "INVALID_DATE", "$.experiments[0].start_date"],
    ["a US-format date", { end_date: "11/30/2026" }, "INVALID_DATE", "$.experiments[0].end_date"],
    ["an end before the start", { start_date: "2026-12-01" }, "EXPERIMENT_DATES_INVALID", "$.experiments[0]"],
    ["a fractional budget", { budget: { amount_minor: 500.5, currency: "USD" } }, "TYPE_INTEGER", "$.experiments[0].budget.amount_minor"],
    ["a string budget", { budget: { amount_minor: "50000", currency: "USD" } }, "TYPE_INTEGER", "$.experiments[0].budget.amount_minor"],
    ["a negative budget", { budget: { amount_minor: -1, currency: "USD" } }, "INTEGER_OUT_OF_RANGE", "$.experiments[0].budget.amount_minor"],
    ["a budget in another currency", { budget: { amount_minor: 50000, currency: "EUR" } }, "MIXED_CURRENCY", "$.experiments[0].budget.currency"],
    ["a lower-case currency", { budget: { amount_minor: 50000, currency: "usd" } }, "UNKNOWN_CURRENCY", "$.experiments[0].budget.currency"],
    ["an unknown currency", { budget: { amount_minor: 50000, currency: "BTC" } }, "UNKNOWN_CURRENCY", "$.experiments[0].budget.currency"],
    ["a budget note", { budget: { amount_minor: 50000, currency: "USD", note: "x" } }, "FORBIDDEN_KEY:FREE_TEXT", "$.experiments[0].budget"],
    ["two primary outcomes", { primary_outcome: ["checkout_start_rate", "paid_order_rate"] }, "MULTIPLE_PRIMARY_OUTCOMES", "$.experiments[0].primary_outcome"],
    ["an unknown primary outcome", { primary_outcome: "roas" }, "INVALID_ENUM", "$.experiments[0].primary_outcome"],
    ["a zero event threshold", { evidence_threshold: { min_denominator: 500, min_events: 0 } }, "INTEGER_OUT_OF_RANGE", "$.experiments[0].evidence_threshold.min_events"],
    ["a fractional denominator", { evidence_threshold: { min_denominator: 99.5, min_events: 20 } }, "TYPE_INTEGER", "$.experiments[0].evidence_threshold.min_denominator"],
  ])("%s", (_label, overrides, code, path) => {
    const value = experiment(overrides as Json)
    for (const [key, field] of Object.entries(overrides as Json)) if (field === undefined) delete value[key]

    expect(issues(doc([value]))).toContainEqual({ code, path })
  })

  it("a synthetic campaign in the owner-approved registry", () => {
    expect(issues(doc([experiment()], { registry_origin: "owner_approved" }))).toContainEqual({
      code: "CAMPAIGN_SLUG",
      path: "$.experiments[0].campaign",
    })
  })

  it.each([
    ["an unknown top-level key", { comments: "x" }, "FORBIDDEN_KEY:FREE_TEXT", "$"],
    ["another schema", { schema: "decision_packet.experiment_registry" }, "SCHEMA", "$.schema"],
    ["another schema version", { schema_version: 2 }, "SCHEMA", "$.schema_version"],
    ["a non-USD registry currency", { currency: "EUR" }, "INVALID_CURRENCY", "$.currency"],
    ["a stale governance version", { governance_version: "ot-campaign-governance-v0" }, "GOVERNANCE_VERSION", "$.governance_version"],
    ["an unknown origin", { registry_origin: "imported" }, "INVALID_ENUM", "$.registry_origin"],
  ])("%s at the top level", (_label, overrides, code, path) => {
    expect(issues(doc([experiment()], overrides as Json))).toContainEqual({ code, path })
  })
})

describe("segments and identity", () => {
  it("rejects two experiments on the same governed segment with overlapping dates", () => {
    const value = doc([
      experiment(),
      experiment({ experiment_id: "ot_exp_2026_002", start_date: "2026-11-30", end_date: "2026-12-31" }),
    ])

    expect(issues(value)).toEqual([{ code: "EXPERIMENT_OVERLAP", path: "$.experiments[1]" }])
  })

  it("rejects the overlap even when the earlier experiment was cancelled, as the decision packet does", () => {
    const value = doc([
      experiment({ status: "cancelled", decision: "stop" }),
      experiment({ experiment_id: "ot_exp_2026_002", start_date: "2026-11-01" }),
    ])

    expect(issues(value)).toEqual([{ code: "EXPERIMENT_OVERLAP", path: "$.experiments[1]" }])
  })

  it("accepts back-to-back experiments on one segment and concurrent ones on different content", () => {
    const value = doc([
      experiment(),
      experiment({ experiment_id: "ot_exp_2026_002", start_date: "2026-12-01", end_date: "2026-12-31" }),
      experiment({ experiment_id: "ot_exp_2026_003", content: "eml_b" }),
    ])

    expect(lintExperimentRegistry(value)).toEqual({ ok: true, experiments: 3 })
  })

  it("rejects a repeated experiment id", () => {
    const value = doc([experiment(), experiment({ content: "eml_b" })])

    expect(issues(value)).toContainEqual({ code: "DUPLICATE_EXPERIMENT_ID", path: "$.experiments[1].experiment_id" })
  })
})

describe("the text linter", () => {
  it("accepts the checked-in file byte-for-byte", () => {
    expect(lintExperimentRegistryText(JSON.stringify(registry))).toEqual({ ok: true, experiments: 0 })
  })

  it.each([
    ["a float literal that JSON.parse would silently make an integer", '"amount_minor": 50000.0'],
    ["an exponent literal", '"amount_minor": 5e4'],
  ])("rejects %s", (_label, replacement) => {
    const text = JSON.stringify(doc([experiment()]), null, 2).replace('"amount_minor": 50000', replacement)

    expect(lintExperimentRegistryText(text)).toEqual({
      ok: false,
      issues: [{ code: "NON_INTEGER_NUMBER_LITERAL", path: "$" }],
    })
  })

  it("does not mistake a number inside a string for a literal", () => {
    const text = JSON.stringify(doc([experiment({ start_date: "2026-10-05" })]))

    expect(lintExperimentRegistryText(text)).toEqual({ ok: true, experiments: 1 })
  })

  it("rejects text that is not JSON", () => {
    expect(lintExperimentRegistryText("{ experiments: [] }")).toEqual({
      ok: false,
      issues: [{ code: "INVALID_JSON", path: "$" }],
    })
  })
})

describe("the linter never echoes a rejected value", () => {
  it("reports codes and paths only", () => {
    const hostile = doc([
      experiment({
        campaign: "jane.doe@example.com",
        content: "100 W Randolph St",
        landing_path: "/check?pin=16-01-216-001-0000",
        experiment_id: "cus_NffrFeUfNV2Hib",
        notes: "Jane Q Homeowner 312-555-0142",
      }),
    ])

    const serialized = JSON.stringify(lintExperimentRegistry(hostile))

    for (const marker of ["jane", "Randolph", "16-01-216", "NffrFeUfNV2Hib", "Homeowner", "312-555"]) {
      expect(serialized).not.toContain(marker)
    }
  })
})
