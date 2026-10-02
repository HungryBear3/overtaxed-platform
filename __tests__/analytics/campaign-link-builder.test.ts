/** @jest-environment node */

/**
 * The registry-bound campaign link builder under the real governance, whose
 * approval list ships empty: no registry entry can name an approved campaign,
 * so no link can be built. The positive path, with an approval simulated, is in
 * campaign-link-builder-approved.test.ts.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { buildCampaignLink } from "@/lib/analytics/campaign-link-builder"
import { lintExperimentRegistryText } from "@/lib/analytics/experiment-registry"
import { main } from "@/scripts/ot-campaign-link"

const SHIPPED_REGISTRY = readFileSync(join(__dirname, "../../data/analytics/ot-experiment-registry.v1.json"), "utf8")

function registry(origin: string, experiments: unknown[]): string {
  return JSON.stringify({
    schema: "ot.experiment_registry",
    schema_version: 1,
    registry_origin: origin,
    business: "ot",
    currency: "USD",
    governance_version: "ot-campaign-governance-v1",
    experiments,
  })
}

const entry = {
  experiment_id: "ot_exp_2026_001",
  business: "ot",
  status: "planned",
  start_date: "2026-10-05",
  end_date: "2026-10-19",
  source: "reddit",
  medium: "paid_social",
  campaign: "ot_202610_acq_synthappeal",
  content: "img_a",
  landing_path: "/",
  budget: { amount_minor: 50000, currency: "USD" },
  primary_outcome: "checkout_start_rate",
  evidence_threshold: { min_denominator: 30, min_events: 5 },
  decision: "pending",
}

function io(files: Record<string, string> = {}) {
  const out: string[] = []
  const err: string[] = []
  const reads: string[] = []
  return {
    out,
    err,
    reads,
    io: {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
      readFile: (path: string) => {
        reads.push(path)
        if (path in files) return files[path]
        return readFileSync(path, "utf8")
      },
    },
  }
}

describe("the shipped registry", () => {
  it("is valid and empty, so it yields no link", () => {
    expect(lintExperimentRegistryText(SHIPPED_REGISTRY)).toEqual({ ok: true, experiments: 0 })
    expect(buildCampaignLink(SHIPPED_REGISTRY, "ot_exp_2026_001")).toEqual({ ok: false, code: "EXPERIMENT_NOT_FOUND" })
  })
})

describe("the builder fails closed", () => {
  it("refuses a registry that is not JSON", () => {
    expect(buildCampaignLink("{", "ot_exp_2026_001")).toEqual({
      ok: false,
      code: "REGISTRY_INVALID",
      issues: [{ code: "INVALID_JSON", path: "$" }],
    })
  })

  it("refuses an owner-approved registry naming a slug that is not approved", () => {
    expect(buildCampaignLink(registry("owner_approved", [entry]), "ot_exp_2026_001")).toEqual({
      ok: false,
      code: "REGISTRY_INVALID",
      issues: [{ code: "CAMPAIGN_SLUG", path: "$.experiments[0].campaign" }],
    })
  })

  it("refuses a synthetic-fixture registry even though it lints", () => {
    const text = registry("synthetic_fixture", [entry])
    expect(lintExperimentRegistryText(text)).toEqual({ ok: true, experiments: 1 })
    expect(buildCampaignLink(text, "ot_exp_2026_001")).toEqual({ ok: false, code: "REGISTRY_NOT_OWNER_APPROVED" })
  })

  it.each([undefined, null, 2026, ["ot_exp_2026_001"]])("refuses a non-string experiment id (%p)", (id) => {
    expect(buildCampaignLink(SHIPPED_REGISTRY, id)).toEqual({ ok: false, code: "EXPERIMENT_ID_INVALID" })
  })

  it("never echoes a registry value or the requested id in a refusal", () => {
    const refusal = JSON.stringify([
      buildCampaignLink(registry("owner_approved", [entry]), "jane_doe"),
      buildCampaignLink(registry("synthetic_fixture", [entry]), "ot_exp_2026_001"),
    ])
    for (const value of ["synthappeal", "reddit", "jane_doe", "ot_exp_2026_001"]) expect(refusal).not.toContain(value)
  })
})

describe("the CLI", () => {
  it("reads only the checked-in registry and refuses an id it does not hold", () => {
    const run = io()
    expect(main(["--experiment", "ot_exp_2026_001"], run.io)).toBe(2)
    expect(run.reads).toHaveLength(1)
    expect(run.reads[0].endsWith("data/analytics/ot-experiment-registry.v1.json")).toBe(true)
    expect(run.out).toEqual([])
    expect(run.err).toEqual(["refused: EXPERIMENT_NOT_FOUND"])
  })

  it.each([
    ["no arguments", []],
    ["a missing id", ["--experiment"]],
    ["an unknown flag", ["--registry", "x.json"]],
    ["a repeated flag", ["--experiment", "ot_exp_2026_001", "--experiment", "ot_exp_2026_002"]],
    ["an extra argument", ["--experiment", "ot_exp_2026_001", "extra"]],
  ])("prints usage for %s", (_label, argv) => {
    const run = io()
    expect(main(argv, run.io)).toBe(64)
    expect(run.out).toEqual([])
    expect(run.reads).toEqual([])
  })
})
