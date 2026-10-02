/** @jest-environment node */

/**
 * Canonical closed campaign naming for OT.
 *
 *   campaign: ot_<yyyymm>_<objective>_<slug>    e.g. ot_202610_ret_synthreminder
 *   content:  <format>_<variant>                e.g. eml_a
 *   source/medium: closed vocabularies
 *   landing: a Phase-A landing value (lib/attribution/landing-paths)
 *
 * Every canonical value must also survive the Phase-A touch contract and the
 * approved attribution code shape, so a governed campaign is never dropped at
 * capture or at checkout revalidation.
 */
import { ATTRIBUTION_CODE_PATTERN } from "@/lib/attribution/registry"
import { sanitizeUtmValue } from "@/lib/attribution/touch-contract"
import {
  APPROVED_CAMPAIGN_SLUGS,
  CAMPAIGN_MEDIUMS,
  CAMPAIGN_SOURCES,
  campaignIssues,
  campaignTupleIssues,
  contentIssues,
  forbiddenValueCode,
  landingIssues,
  mediumIssues,
  sourceIssues,
} from "@/lib/analytics/campaign-governance"

describe("canonical campaign names", () => {
  it("ships no owner-approved OT campaign slug", () => {
    expect(APPROVED_CAMPAIGN_SLUGS).toEqual([])
  })

  it("accepts a synthetic campaign only in a synthetic fixture", () => {
    expect(campaignIssues("ot_202610_ret_synthreminder", "synthetic_fixture")).toEqual([])
    expect(campaignIssues("ot_202610_ret_synthreminder", "owner_approved")).toEqual(["CAMPAIGN_SLUG"])
  })

  it.each([
    ["the wrong business", "hsb_202610_acq_synthappeal", "CAMPAIGN_BUSINESS"],
    ["a non-month", "ot_202613_acq_synthappeal", "CAMPAIGN_MONTH"],
    ["a year-only date", "ot_2026_acq_synthappeal", "CAMPAIGN_MONTH"],
    ["an unknown objective", "ot_202610_promo_synthappeal", "CAMPAIGN_OBJECTIVE"],
    ["an unreviewed slug", "ot_202610_acq_cicero", "CAMPAIGN_SLUG"],
    ["a person's name as the slug", "ot_202610_acq_janedoe", "CAMPAIGN_SLUG"],
    ["too few parts", "ot_2026_cicero", "CAMPAIGN_SHAPE"],
    ["a legacy dated campaign", "hoa_resident_resource_20260723", "FORBIDDEN_VALUE:NUMERIC_IDENTIFIER"],
    ["a legacy undated campaign", "ot_2026_cicero_deadline", "CAMPAIGN_MONTH"],
    ["upper case", "OT_202610_ACQ_SYNTHAPPEAL", "CAMPAIGN_SHAPE"],
    ["an email", "jane@example.com", "FORBIDDEN_VALUE:EMAIL"],
    ["a URL", "https://example.com/x", "FORBIDDEN_VALUE:URL"],
    ["query syntax", "ot_202610_acq_synthappeal?utm_term=x", "FORBIDDEN_VALUE:QUERY_STRING"],
    ["a fragment", "ot_202610_acq_synthappeal#x", "FORBIDDEN_VALUE:QUERY_STRING"],
    ["a street address", "100 W Randolph St", "FORBIDDEN_VALUE:FREE_TEXT"],
    ["a dashed PIN", "16-01-216-001-0000", "FORBIDDEN_VALUE:PROPERTY_PIN"],
    ["an undashed PIN", "16012160010000", "FORBIDDEN_VALUE:NUMERIC_IDENTIFIER"],
    ["a phone number", "312-555-0142", "FORBIDDEN_VALUE:PHONE"],
    ["a Stripe customer id", "cus_NffrFeUfNV2Hib", "FORBIDDEN_VALUE:STRIPE_ID"],
    ["a Checkout Session id", "cs_live_a1B2c3D4e5F6g7H8", "FORBIDDEN_VALUE:STRIPE_ID"],
    ["a GA client id", "1234567890.1724102400", "FORBIDDEN_VALUE:GA_CLIENT_ID"],
    ["a UUID", "57dc81a6-1329-4a85-9210-0d6f574ea65d", "FORBIDDEN_VALUE:UUID"],
    ["a record id", "clx1abc2def3ghi4jkl5", "FORBIDDEN_VALUE:IDENTIFIER_SHAPE"],
    ["non-ASCII text", "ot_202610_acq_ñ", "FORBIDDEN_VALUE:NON_ASCII"],
  ])("rejects %s", (_label, value, code) => {
    expect(campaignIssues(value, "synthetic_fixture")).toContain(code)
  })

  it("rejects a value that is not a string", () => {
    expect(campaignIssues(202610, "synthetic_fixture")).toEqual(["TYPE_STRING"])
  })
})

describe("canonical content, source, medium and landing", () => {
  it.each(["vid_a", "img_b", "eml_b2", "srch_v2", "car_a", "txt_b"])("accepts content %s", (value) => {
    expect(contentIssues(value)).toEqual([])
  })

  it.each([
    ["an unknown format", "gif_a", "CONTENT_FORMAT"],
    ["an unknown variant", "vid_c", "CONTENT_VARIANT"],
    ["the legacy creative label", "v1_video", "CONTENT_FORMAT"],
    ["a name", "jane_doe", "CONTENT_FORMAT"],
    ["an email", "jane@example.com", "FORBIDDEN_VALUE:EMAIL"],
  ])("rejects content with %s", (_label, value, code) => {
    expect(contentIssues(value)).toContain(code)
  })

  it("governs sources and mediums as closed sets without placeholders", () => {
    expect(sourceIssues("facebook")).toEqual([])
    expect(mediumIssues("paid_social")).toEqual([])
    for (const placeholder of ["other", "not_set", "direct", "(direct)", "referral_other"]) {
      expect(sourceIssues(placeholder)).toEqual(["SOURCE_NOT_GOVERNED"])
    }
    for (const placeholder of ["other", "not_set", "none", "(none)"]) {
      expect(mediumIssues(placeholder)).toEqual(["MEDIUM_NOT_GOVERNED"])
    }
    expect(sourceIssues("owner@example.com")).toEqual(["FORBIDDEN_VALUE:EMAIL"])
  })

  it.each([
    ["/check", []],
    ["/appeal-deadline/[slug]", []],
    ["/", []],
    ["/appeal-deadline/cicero", ["LANDING_NOT_APPROVED"]],
    ["/clients/jane-doe-123-main-st", ["LANDING_NOT_APPROVED"]],
    ["/check?pin=16012160010000", ["FORBIDDEN_VALUE:QUERY_STRING"]],
    ["https://www.overtaxed-il.com/check", ["FORBIDDEN_VALUE:URL"]],
    ["/packet", ["LANDING_NOT_APPROVED"]],
  ])("landing %s", (value, issues) => {
    expect(landingIssues(value)).toEqual(issues)
  })
})

describe("consistency with the Phase-A allowlists", () => {
  const canonicalCampaigns = ["ot_202610_ret_synthreminder", "ot_202608_season_synthappeal"]
  const canonicalContent = ["vid_a", "srch_a", "eml_b2", "car_v2"]

  it("every canonical campaign and content value passes the touch contract unchanged", () => {
    for (const campaign of canonicalCampaigns) expect(sanitizeUtmValue("utm_campaign", campaign)).toBe(campaign)
    for (const content of canonicalContent) expect(sanitizeUtmValue("utm_content", content)).toBe(content)
  })

  it("every governed source and medium passes the touch contract unchanged", () => {
    for (const source of CAMPAIGN_SOURCES) expect(sanitizeUtmValue("utm_source", source)).toBe(source)
    for (const medium of CAMPAIGN_MEDIUMS) expect(sanitizeUtmValue("utm_medium", medium)).toBe(medium)
  })

  it("every canonical campaign and content value is a well-formed approved-code shape", () => {
    for (const value of [...canonicalCampaigns, ...canonicalContent]) expect(ATTRIBUTION_CODE_PATTERN.test(value)).toBe(true)
  })
})

describe("a campaign tuple judged as a whole", () => {
  const tuple = { source: "reddit", medium: "paid_social", campaign: "ot_202610_acq_synthappeal", content: "img_a" }

  it("accepts a complete governed tuple, with or without content", () => {
    expect(campaignTupleIssues(tuple, "synthetic_fixture")).toEqual([])
    expect(campaignTupleIssues({ ...tuple, content: undefined }, "synthetic_fixture")).toEqual([])
  })

  it("refuses an otherwise governed tuple whose slug is not owner-approved", () => {
    expect(campaignTupleIssues(tuple, "owner_approved")).toEqual(["campaign:CAMPAIGN_SLUG"])
  })

  it.each([
    ["no source", { source: undefined }, ["source:MISSING"]],
    ["no medium", { medium: undefined }, ["medium:MISSING"]],
    ["no campaign", { campaign: undefined }, ["campaign:MISSING"]],
    ["an ungoverned source", { source: "partner" }, ["source:SOURCE_NOT_GOVERNED"]],
    ["a capitalized source", { source: "Reddit" }, ["source:SOURCE_NOT_GOVERNED"]],
    ["an ungoverned medium", { medium: "bogus" }, ["medium:MEDIUM_NOT_GOVERNED"]],
    ["an unknown campaign slug", { campaign: "ot_202610_acq_cicero" }, ["campaign:CAMPAIGN_SLUG"]],
    [
      "a legacy campaign",
      { campaign: "ot_2026_cicero_deadline" },
      ["campaign:CAMPAIGN_MONTH", "campaign:CAMPAIGN_OBJECTIVE", "campaign:CAMPAIGN_SLUG"],
    ],
    ["ungoverned content", { content: "v1_video" }, ["content:CONTENT_FORMAT", "content:CONTENT_VARIANT"]],
    ["the registry's no-content sentinel as a value", { content: "none" }, ["content:CONTENT_SHAPE"]],
    ["an email as content", { content: "jane@example.com" }, ["content:FORBIDDEN_VALUE:EMAIL"]],
    ["two broken fields", { source: undefined, content: "gif_a" }, ["source:MISSING", "content:CONTENT_FORMAT"]],
  ])("refuses a tuple with %s", (_label, change, issues) => {
    expect(campaignTupleIssues({ ...tuple, ...change }, "synthetic_fixture")).toEqual(issues)
  })
})

describe("the forbidden-value detector", () => {
  it("does not flag an ordinary governed token", () => {
    for (const value of ["ot_202610_acq_synthappeal", "vid_a", "paid_social", "/appeal-deadline/[slug]"]) {
      expect(forbiddenValueCode(value)).toBeNull()
    }
  })
})
