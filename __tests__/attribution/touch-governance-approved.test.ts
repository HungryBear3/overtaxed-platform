/** @jest-environment node */

/**
 * The Stripe touch projection once a campaign slug is owner-approved.
 *
 * The shipped approval list is empty, so this suite simulates a reviewed
 * approval: the fixture slugs (`synthappeal`, `synthreminder`) are judged as if
 * they were on APPROVED_CAMPAIGN_SLUGS. Nothing else about the governance
 * changes — the closed source, medium and content lists and the campaign
 * grammar are the real ones. touch-contract.test.ts proves the same tuples are
 * refused under the real, empty list.
 */

jest.mock("@/lib/analytics/campaign-governance", () => {
  const actual = jest.requireActual("@/lib/analytics/campaign-governance")
  return {
    ...actual,
    campaignIssues: (value: unknown) => actual.campaignIssues(value, "synthetic_fixture"),
    campaignTupleIssues: (tuple: unknown) => actual.campaignTupleIssues(tuple, "synthetic_fixture"),
  }
})

import { revalidateCheckoutAttribution, touchesToStripeMetadata, type AttributionTouch } from "@/lib/attribution/touch-contract"

const NOW = Date.parse("2026-09-28T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

const first: AttributionTouch = {
  source: "newsletter",
  medium: "email",
  campaign: "ot_202610_ret_synthreminder",
  content: "eml_a",
  term: "appeal",
  landing: "/check",
  at: Date.parse("2026-09-20T08:30:15.987Z"),
}

const last: AttributionTouch = {
  source: "reddit",
  medium: "paid_social",
  campaign: "ot_202610_acq_synthappeal",
  landing: "/",
  at: Date.parse("2026-09-27T21:05:00.000Z"),
}

describe("a governed campaign tuple", () => {
  it("projects source, medium, campaign, content, landing and instant — never the term", () => {
    expect(touchesToStripeMetadata({ first, last })).toEqual({
      firstTouchSource: "newsletter",
      firstTouchMedium: "email",
      firstTouchCampaign: "ot_202610_ret_synthreminder",
      firstTouchContent: "eml_a",
      firstTouchLanding: "/check",
      firstTouchAt: "2026-09-20T08:30:15Z",
      lastTouchSource: "reddit",
      lastTouchMedium: "paid_social",
      lastTouchCampaign: "ot_202610_acq_synthappeal",
      lastTouchLanding: "/",
      lastTouchAt: "2026-09-27T21:05:00Z",
    })
  })

  it("survives server revalidation of the submitted touches unchanged", () => {
    const submitted = { first: { ...first, at: NOW - 3 * DAY }, last: { ...last, at: NOW - DAY } }
    const metadata = touchesToStripeMetadata(revalidateCheckoutAttribution(submitted, NOW))
    expect(metadata).toMatchObject({
      firstTouchCampaign: "ot_202610_ret_synthreminder",
      lastTouchCampaign: "ot_202610_acq_synthappeal",
    })
    expect(metadata).not.toHaveProperty("firstTouchTerm")
  })
})

describe("a tuple that is not governed as a whole is projected as nothing", () => {
  it.each<[string, Partial<Record<keyof AttributionTouch, string | undefined>>]>([
    ["no source", { source: undefined }],
    ["no medium", { medium: undefined }],
    ["no campaign", { campaign: undefined }],
    ["an ungoverned source", { source: "partner" }],
    ["a capitalized source", { source: "Reddit" }],
    ["an ungoverned medium", { medium: "bogus" }],
    ["an unapproved campaign slug", { campaign: "ot_202610_acq_cicero" }],
    ["a legacy campaign", { campaign: "ot_2026_cicero_deadline" }],
    ["ungoverned content", { content: "v1_video" }],
    ["a person-chosen word as content", { content: "jane_doe" }],
  ])("drops every field of a touch with %s, landing and instant included", (_label, change) => {
    const broken = { ...last, ...change } as AttributionTouch
    const metadata = touchesToStripeMetadata({ first, last: broken })

    expect(Object.keys(metadata).filter((key) => key.startsWith("lastTouch"))).toEqual([])
    expect(metadata).toMatchObject({ firstTouchCampaign: "ot_202610_ret_synthreminder" })
  })

  it("drops a touch that carries only a search term", () => {
    expect(touchesToStripeMetadata({ first: { term: "appeal", landing: "/", at: NOW }, last: null })).toEqual({})
  })

  it("keeps a direct first touch beside a governed last touch", () => {
    expect(touchesToStripeMetadata({ first: { landing: "/", at: NOW }, last })).toEqual({
      firstTouchLanding: "/",
      firstTouchAt: "2026-09-28T12:00:00Z",
      lastTouchSource: "reddit",
      lastTouchMedium: "paid_social",
      lastTouchCampaign: "ot_202610_acq_synthappeal",
      lastTouchLanding: "/",
      lastTouchAt: "2026-09-27T21:05:00Z",
    })
  })
})
