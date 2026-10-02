/** @jest-environment node */

/**
 * The attribution touch contract: what one first/last touch may carry, as it is
 * stored in the browser, submitted to checkout and projected onto Stripe
 * metadata. Every expectation below is a hand-written literal.
 */

import { isAllowlistedLanding, normalizeLandingPath } from "@/lib/attribution/landing-paths"
import {
  revalidateCheckoutAttribution,
  sanitizeTouch,
  sanitizeUtmValue,
  touchesToStripeMetadata,
} from "@/lib/attribution/touch-contract"

const NOW = Date.parse("2026-09-28T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000

describe("landing pathname", () => {
  it.each([
    ["/", "/"],
    ["/check", "/check"],
    ["/hoa", "/hoa"],
    ["/pricing/", "/pricing"],
    ["/townships/cicero", "/townships/[slug]"],
    ["/township/elk-grove", "/township/[slug]"],
    ["/appeal-deadline/elk-grove", "/appeal-deadline/[slug]"],
    ["/blog/how-to-appeal", "/blog/[slug]"],
  ])("keeps %s as %s", (pathname, expected) => {
    expect(normalizeLandingPath(pathname)).toBe(expected)
  })

  it.each([
    ["an unlisted route whose path is free text", "/clients/jane-doe-123-main-st"],
    ["the private packet surface", "/packet"],
    ["a record route", "/appeals/clx1abc2def3ghi4jkl5mno6"],
    ["an account route", "/account/packets/inv_123"],
    ["a query string", "/check?pin=16012160010000"],
    ["a fragment", "/check#result"],
    ["an extra dynamic segment", "/townships/cicero/extra"],
    ["a dynamic segment that is not a slug", "/townships/Jane Doe"],
    ["an absolute URL", "https://www.overtaxed-il.com/check"],
    ["a relative path", "check"],
    ["an empty string", ""],
    ["an overlong path", `/${"a".repeat(300)}`],
    ["null", null],
    ["a number", 42],
  ])("refuses %s", (_label, pathname) => {
    expect(normalizeLandingPath(pathname)).toBeNull()
  })

  it("recognizes only already-normalized landing values", () => {
    expect(isAllowlistedLanding("/check")).toBe(true)
    expect(isAllowlistedLanding("/townships/[slug]")).toBe(true)
    expect(isAllowlistedLanding("/townships/cicero")).toBe(false)
    expect(isAllowlistedLanding("/clients/jane-doe")).toBe(false)
    expect(isAllowlistedLanding(undefined)).toBe(false)
  })
})

describe("utm value contract", () => {
  it("accepts real campaign values verbatim", () => {
    expect(sanitizeUtmValue("utm_source", "property_manager")).toBe("property_manager")
    expect(sanitizeUtmValue("utm_medium", "email")).toBe("email")
    expect(sanitizeUtmValue("utm_campaign", "hoa_resident_resource_20260723")).toBe("hoa_resident_resource_20260723")
    expect(sanitizeUtmValue("utm_campaign", "ot_2026_cicero_deadline")).toBe("ot_2026_cicero_deadline")
    expect(sanitizeUtmValue("utm_source", "m.facebook.com")).toBe("m.facebook.com")
    expect(sanitizeUtmValue("utm_content", "footer_check_link")).toBe("footer_check_link")
  })

  it("bounds each key independently", () => {
    expect(sanitizeUtmValue("utm_source", "s".repeat(40))).toBe("s".repeat(40))
    expect(sanitizeUtmValue("utm_source", "s".repeat(41))).toBeNull()
    expect(sanitizeUtmValue("utm_medium", "m".repeat(40))).toBe("m".repeat(40))
    expect(sanitizeUtmValue("utm_medium", "m".repeat(41))).toBeNull()
    expect(sanitizeUtmValue("utm_campaign", "c".repeat(100))).toBe("c".repeat(100))
    expect(sanitizeUtmValue("utm_campaign", "c".repeat(101))).toBeNull()
    expect(sanitizeUtmValue("utm_content", "x".repeat(100))).toBe("x".repeat(100))
    expect(sanitizeUtmValue("utm_content", "x".repeat(101))).toBeNull()
    expect(sanitizeUtmValue("utm_term", "t".repeat(60))).toBe("t".repeat(60))
    expect(sanitizeUtmValue("utm_term", "t".repeat(61))).toBeNull()
  })

  it.each([
    ["an email address", "owner@example.com"],
    ["a street address", "100 W Randolph St Apt 4B"],
    ["a name with spaces", "Jane Q Homeowner"],
    ["a dashed PIN", "16-01-216-001-0000"],
    ["a bare PIN", "16012160010000"],
    ["a phone number", "312-555-0142"],
    ["a URL", "https://evil.example/x"],
    ["query syntax", "a=b&c=d"],
    ["a fragment", "x#y"],
    ["percent-encoded text", "jane%40example.com"],
    ["a Stripe customer id", "cus_NffrFeUfNV2Hib"],
    ["a Stripe checkout session id", "cs_live_a1B2c3D4e5F6g7H8i9J0"],
    ["a record id", "clx1abc2def3ghi4jkl5mno6"],
    ["a leading separator", "_campaign"],
    ["an empty value", ""],
    ["a non-string value", 12],
  ])("refuses %s", (_label, value) => {
    expect(sanitizeUtmValue("utm_campaign", value)).toBeNull()
  })
})

describe("touch validation", () => {
  const campaignTouch = {
    source: "property_manager",
    medium: "email",
    campaign: "hoa_resident_resource_20260723",
    landing: "/hoa",
    at: NOW - DAY,
  }

  it("accepts a well-formed campaign touch", () => {
    expect(sanitizeTouch(campaignTouch, NOW)).toEqual({
      source: "property_manager",
      medium: "email",
      campaign: "hoa_resident_resource_20260723",
      landing: "/hoa",
      at: NOW - DAY,
    })
  })

  it("accepts a direct touch that carries only its landing and instant", () => {
    expect(sanitizeTouch({ landing: "/", at: NOW }, NOW)).toEqual({ landing: "/", at: NOW })
  })

  it("accepts a small forward clock skew and the exact edge of the 30-day window", () => {
    expect(sanitizeTouch({ at: NOW + MINUTE }, NOW)).toEqual({ at: NOW + MINUTE })
    expect(sanitizeTouch({ at: NOW - 30 * DAY }, NOW)).toEqual({ at: NOW - 30 * DAY })
  })

  it.each([
    ["an unrecognized key", { ...campaignTouch, email: "owner@example.com" }],
    ["a raw utm_ key", { ...campaignTouch, utm_source: "property_manager" }],
    ["a hostile value", { ...campaignTouch, source: "owner@example.com" }],
    ["a nested value", { ...campaignTouch, campaign: { name: "x" } }],
    ["a query-bearing landing", { ...campaignTouch, landing: "/check?pin=16012160010000" }],
    ["an unlisted landing", { ...campaignTouch, landing: "/clients/jane-doe" }],
    ["a missing instant", { source: "property_manager" }],
    ["a string instant", { ...campaignTouch, at: String(NOW) }],
    ["a fractional instant", { ...campaignTouch, at: NOW - 0.5 }],
    ["a future instant", { ...campaignTouch, at: NOW + 10 * MINUTE }],
    ["an instant outside the window", { ...campaignTouch, at: NOW - 30 * DAY - 1 }],
    ["an array", [campaignTouch]],
    ["null", null],
    ["a string", "utm_source=property_manager"],
  ])("rejects %s as a whole", (_label, raw) => {
    expect(sanitizeTouch(raw, NOW)).toBeNull()
  })
})

describe("server revalidation of submitted attribution", () => {
  const first = { source: "property_manager", medium: "email", campaign: "hoa_resident_resource_20260723", landing: "/hoa", at: NOW - 3 * DAY }
  const last = { source: "facebook", medium: "paid_social", campaign: "ot_2026_cicero_deadline", content: "v1_video", landing: "/appeal-deadline/[slug]", at: NOW - DAY }

  it("keeps a valid first touch and a valid last non-direct touch", () => {
    expect(revalidateCheckoutAttribution({ first, last }, NOW)).toEqual({
      first: { source: "property_manager", medium: "email", campaign: "hoa_resident_resource_20260723", landing: "/hoa", at: NOW - 3 * DAY },
      last: { source: "facebook", medium: "paid_social", campaign: "ot_2026_cicero_deadline", content: "v1_video", landing: "/appeal-deadline/[slug]", at: NOW - DAY },
    })
  })

  it("keeps a direct first touch but refuses a direct touch as the last non-direct touch", () => {
    expect(revalidateCheckoutAttribution({ first: { landing: "/", at: NOW - DAY }, last: { landing: "/check", at: NOW } }, NOW)).toEqual({
      first: { landing: "/", at: NOW - DAY },
      last: null,
    })
  })

  it("drops hostile touches without refusing the checkout", () => {
    expect(
      revalidateCheckoutAttribution(
        {
          first: { ...first, term: "16-01-216-001-0000" },
          last: { ...last, content: "100 W Randolph St Apt 4B" },
        },
        NOW,
      ),
    ).toEqual({ first: null, last: null })
  })

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "first=property_manager"],
    ["an array", [first]],
    ["an object with unknown top-level keys", { first, last, email: "owner@example.com" }],
  ])("treats %s as no attribution", (_label, raw) => {
    expect(revalidateCheckoutAttribution(raw, NOW)).toEqual({ first: null, last: null })
  })
})

describe("Stripe metadata projection", () => {
  // The shipped approval list is empty, so no campaign tuple is governed yet.
  // The governed (approved-slug) projection is covered by
  // touch-governance-approved.test.ts.
  it("projects no keys for a touch whose campaign tuple is not owner-approved", () => {
    expect(
      touchesToStripeMetadata({
        first: {
          source: "property_manager",
          medium: "email",
          campaign: "hoa_resident_resource_20260723",
          landing: "/hoa",
          at: Date.parse("2026-09-20T08:30:15.987Z"),
        },
        last: {
          source: "facebook",
          medium: "paid_social",
          campaign: "ot_2026_cicero_deadline",
          content: "v1_video",
          term: "appeal",
          landing: "/appeal-deadline/[slug]",
          at: Date.parse("2026-09-27T21:05:00.000Z"),
        },
      }),
    ).toEqual({})
  })

  it("refuses a canonically shaped tuple whose slug exists only for synthetic fixtures", () => {
    expect(
      touchesToStripeMetadata({
        first: null,
        last: {
          source: "reddit",
          medium: "paid_social",
          campaign: "ot_202610_acq_synthappeal",
          content: "img_a",
          landing: "/",
          at: Date.parse("2026-09-27T21:05:00.000Z"),
        },
      }),
    ).toEqual({})
  })

  it("never projects a person-chosen word, even when every other field is governed", () => {
    const metadata = touchesToStripeMetadata({
      first: { source: "jane_doe", medium: "whatever", campaign: "Elm_St_Smith", term: "springfield", at: NOW },
      last: { term: "springfield", landing: "/", at: NOW },
    })
    expect(metadata).toEqual({})
  })

  it("projects a direct first touch as landing and instant only", () => {
    expect(touchesToStripeMetadata({ first: { at: Date.parse("2026-09-20T08:30:15.000Z") }, last: null })).toEqual({
      firstTouchAt: "2026-09-20T08:30:15Z",
    })
    expect(
      touchesToStripeMetadata({ first: { landing: "/check", at: Date.parse("2026-09-20T08:30:15.000Z") }, last: null }),
    ).toEqual({ firstTouchLanding: "/check", firstTouchAt: "2026-09-20T08:30:15Z" })
  })

  it("contributes no keys when there is no attribution", () => {
    expect(touchesToStripeMetadata({ first: null, last: null })).toEqual({})
  })
})
