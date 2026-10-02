/** @jest-environment node */

/**
 * The registry-bound campaign link builder once a campaign slug is
 * owner-approved.
 *
 * The shipped approval list is empty, so this suite simulates a reviewed
 * approval: the fixture slugs are judged as if they were on
 * APPROVED_CAMPAIGN_SLUGS — by the registry linter, GA4's governed page
 * context and the Stripe touch projection alike. Everything else is real.
 */

jest.mock("@/lib/analytics/campaign-governance", () => {
  const actual = jest.requireActual("@/lib/analytics/campaign-governance")
  return {
    ...actual,
    campaignIssues: (value: unknown) => actual.campaignIssues(value, "synthetic_fixture"),
    campaignTupleIssues: (tuple: unknown) => actual.campaignTupleIssues(tuple, "synthetic_fixture"),
  }
})

import { buildCampaignLink } from "@/lib/analytics/campaign-link-builder"
import { governedPageLocation } from "@/lib/analytics/ga4"
import { touchFromLanding, touchesToStripeMetadata } from "@/lib/attribution/touch-contract"
import { main } from "@/scripts/ot-campaign-link"

type Entry = Record<string, unknown>

function registry(experiments: Entry[], origin = "owner_approved"): string {
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

function entry(overrides: Entry = {}): Entry {
  return {
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
    ...overrides,
  }
}

const PILOT_URL =
  "https://www.overtaxed-il.com/?utm_source=reddit&utm_medium=paid_social&utm_campaign=ot_202610_acq_synthappeal&utm_content=img_a"

describe("an active, approved registry entry", () => {
  it.each(["planned", "running"])("yields exactly the canonical internal URL when %s", (status) => {
    expect(buildCampaignLink(registry([entry({ status })]), "ot_exp_2026_001")).toEqual({ ok: true, url: PILOT_URL })
  })

  it("selects the one entry with the exact id", () => {
    const text = registry([
      entry({ experiment_id: "ot_exp_2026_001", content: "img_a" }),
      entry({ experiment_id: "ot_exp_2026_002", content: "img_b" }),
    ])
    expect(buildCampaignLink(text, "ot_exp_2026_002")).toEqual({
      ok: true,
      url: "https://www.overtaxed-il.com/?utm_source=reddit&utm_medium=paid_social&utm_campaign=ot_202610_acq_synthappeal&utm_content=img_b",
    })
  })

  it("omits utm_content when the entry has no content", () => {
    expect(buildCampaignLink(registry([entry({ content: "none" })]), "ot_exp_2026_001")).toEqual({
      ok: true,
      url: "https://www.overtaxed-il.com/?utm_source=reddit&utm_medium=paid_social&utm_campaign=ot_202610_acq_synthappeal",
    })
  })

  it("uses the entry's static landing route as the path", () => {
    expect(buildCampaignLink(registry([entry({ landing_path: "/check" })]), "ot_exp_2026_001")).toEqual({
      ok: true,
      url: "https://www.overtaxed-il.com/check?utm_source=reddit&utm_medium=paid_social&utm_campaign=ot_202610_acq_synthappeal&utm_content=img_a",
    })
  })

  it.each([
    ["/", "img_a"],
    ["/check", "none"],
    ["/pricing", "vid_b2"],
  ])("round-trips through GA4's page context and the Stripe projection unchanged (%s, %s)", (landing, content) => {
    const result = buildCampaignLink(registry([entry({ landing_path: landing, content })]), "ot_exp_2026_001")
    if (!result.ok) throw new Error(result.code)
    const url = new URL(result.url)

    expect(governedPageLocation(result.url)).toBe(result.url)
    const metadata = touchesToStripeMetadata({
      first: touchFromLanding({ search: url.search, pathname: url.pathname, at: Date.parse("2026-10-05T12:00:00Z") }),
      last: null,
    })
    expect(metadata).toEqual({
      firstTouchSource: "reddit",
      firstTouchMedium: "paid_social",
      firstTouchCampaign: "ot_202610_acq_synthappeal",
      ...(content === "none" ? {} : { firstTouchContent: content }),
      firstTouchLanding: landing,
      firstTouchAt: "2026-10-05T12:00:00Z",
    })
  })
})

describe("anything else fails closed", () => {
  it.each(["paused", "completed", "cancelled"])("refuses a %s experiment", (status) => {
    const decision = status === "paused" ? "pending" : "stop"
    expect(buildCampaignLink(registry([entry({ status, decision })]), "ot_exp_2026_001")).toEqual({
      ok: false,
      code: "EXPERIMENT_NOT_ACTIVE",
    })
  })

  it.each([
    ["an unknown id", "ot_exp_2026_002"],
    ["a differently cased id", "OT_EXP_2026_001"],
    ["a padded id", " ot_exp_2026_001"],
    ["a prefix of the id", "ot_exp_2026_00"],
    ["an empty id", ""],
  ])("refuses %s", (_label, id) => {
    expect(buildCampaignLink(registry([entry()]), id)).toEqual({ ok: false, code: "EXPERIMENT_NOT_FOUND" })
  })

  it("refuses an ambiguous registry with two entries under one id", () => {
    const text = registry([entry({ content: "img_a" }), entry({ content: "img_b" })])
    expect(buildCampaignLink(text, "ot_exp_2026_001")).toEqual({
      ok: false,
      code: "REGISTRY_INVALID",
      issues: [{ code: "DUPLICATE_EXPERIMENT_ID", path: "$.experiments[1].experiment_id" }],
    })
  })

  it("refuses a synthetic-fixture registry even when its slug would be approved", () => {
    expect(buildCampaignLink(registry([entry()], "synthetic_fixture"), "ot_exp_2026_001")).toEqual({
      ok: false,
      code: "REGISTRY_NOT_OWNER_APPROVED",
    })
  })

  it("refuses a dynamic landing template, which names no page", () => {
    expect(buildCampaignLink(registry([entry({ landing_path: "/townships/[slug]" })]), "ot_exp_2026_001")).toEqual({
      ok: false,
      code: "LANDING_NOT_CONCRETE",
    })
  })

  it("refuses a registry an unrelated entry makes invalid", () => {
    const text = registry([entry(), entry({ experiment_id: "ot_exp_2026_002", source: "partner" })])
    expect(buildCampaignLink(text, "ot_exp_2026_001")).toMatchObject({ ok: false, code: "REGISTRY_INVALID" })
  })
})

describe("the CLI", () => {
  it("prints only the URL for an active approved entry", () => {
    const out: string[] = []
    const err: string[] = []
    const reads: string[] = []
    const code = main(["--experiment", "ot_exp_2026_001"], {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      readFile: (path) => {
        reads.push(path)
        return registry([entry({ status: "running" })])
      },
    })

    expect(code).toBe(0)
    expect(out).toEqual([`${PILOT_URL}\n`])
    expect(err).toEqual([])
    expect(reads[0].endsWith("data/analytics/ot-experiment-registry.v1.json")).toBe(true)
  })

  it("prints the refusal code and the value-free lint findings, and nothing on stdout", () => {
    const out: string[] = []
    const err: string[] = []
    const code = main(["--experiment", "ot_exp_2026_001"], {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      readFile: () => registry([entry({ source: "partner" })]),
    })

    expect(code).toBe(2)
    expect(out).toEqual([])
    expect(err).toEqual(["refused: REGISTRY_INVALID SOURCE_NOT_GOVERNED@$.experiments[0].source"])
  })
})
