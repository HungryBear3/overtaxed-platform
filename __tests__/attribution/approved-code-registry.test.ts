/** @jest-environment node */

/**
 * The privacy boundary itself: what the approved-code registry accepts and,
 * far more importantly, what it refuses.
 *
 * The refusals here are the point of the feature. If any of them start passing,
 * a raw UTM value, an email, a PIN, an address or a URL has a path into a
 * durable row and into Stripe metadata.
 */

import {
  type AttributionRegistry,
  resolveAttributionCodes,
  shippedAttributionRegistry,
} from "@/lib/attribution/registry"

/** Test-local approval set. Injected, never merged into the shipped registry. */
const SYNTHETIC_REGISTRY: AttributionRegistry = {
  version: "synthetic_test_registry_v1",
  campaigns: [
    { campaignCode: "synthetic_campaign_a", creativeCodes: ["synthetic_creative_1", "synthetic_creative_2"] },
    { campaignCode: "synthetic_campaign_b", creativeCodes: [] },
  ],
}

describe("shipped acquisition code registry", () => {
  it("ships EMPTY, so no tagged live traffic is accepted", () => {
    expect(shippedAttributionRegistry().campaigns).toEqual([])
  })

  it("accepts no campaign code at all while the shipped registry is empty", () => {
    expect(
      resolveAttributionCodes({ campaignCode: "synthetic_campaign_a" }, shippedAttributionRegistry()),
    ).toEqual({ ok: false, reason: "unknown_campaign_code" })
  })

  it("is frozen, so an importing module cannot push an approval into it at runtime", () => {
    const registry = shippedAttributionRegistry()
    expect(Object.isFrozen(registry)).toBe(true)
    expect(() => {
      ;(registry.campaigns as unknown as Array<unknown>).push({ campaignCode: "smuggled", creativeCodes: [] })
    }).toThrow()
    expect(shippedAttributionRegistry().campaigns).toEqual([])
  })
})

describe("resolveAttributionCodes refuses unapproved and PII-shaped input", () => {
  it("treats an absent code as organic rather than an error", () => {
    expect(resolveAttributionCodes({}, SYNTHETIC_REGISTRY)).toEqual({ ok: true, attribution: null })
  })

  /**
   * The single most important assertion in this file. An unknown code must be
   * an ERROR, not a silent downgrade to organic: a downgrade would let a
   * tampered code mint a durable organic first touch that then permanently
   * blocks the order's real attribution.
   */
  it("rejects an unknown campaign code instead of downgrading it to organic", () => {
    const result = resolveAttributionCodes({ campaignCode: "not_approved_anywhere" }, SYNTHETIC_REGISTRY)
    expect(result).toEqual({ ok: false, reason: "unknown_campaign_code" })
  })

  it("rejects a creative that is not approved under its campaign", () => {
    expect(
      resolveAttributionCodes(
        { campaignCode: "synthetic_campaign_a", creativeCode: "synthetic_creative_9" },
        SYNTHETIC_REGISTRY,
      ),
    ).toEqual({ ok: false, reason: "unknown_creative_code" })
  })

  it("rejects a creative approved under a DIFFERENT campaign", () => {
    expect(
      resolveAttributionCodes(
        { campaignCode: "synthetic_campaign_b", creativeCode: "synthetic_creative_1" },
        SYNTHETIC_REGISTRY,
      ),
    ).toEqual({ ok: false, reason: "unknown_creative_code" })
  })

  it("rejects a creative submitted without its campaign", () => {
    expect(
      resolveAttributionCodes({ creativeCode: "synthetic_creative_1" }, SYNTHETIC_REGISTRY),
    ).toEqual({ ok: false, reason: "creative_without_campaign" })
  })

  it.each([
    ["an email address", "buyer@example.com"],
    ["a landing URL", "https://www.overtaxed-il.com/check?utm_source=x"],
    ["a bare host", "www.overtaxed-il.com"],
    ["a street address", "1 Test St, Elk Grove Village IL 60007"],
    ["a raw utm_source label", "property_manager | email"],
    ["a referrer", "https://l.facebook.com/"],
    ["a person's name", "Buyer Name"],
    ["a query fragment", "utm_campaign=hoa_resident_resource_20260723&utm_medium=email"],
    ["an uppercase label", "Property_Manager"],
    ["a path", "/hoa"],
    ["whitespace padding", " synthetic_campaign_a "],
  ])("rejects %s as a malformed code", (_label, value) => {
    expect(resolveAttributionCodes({ campaignCode: value }, SYNTHETIC_REGISTRY)).toEqual({
      ok: false,
      reason: "malformed_code",
    })
  })

  /**
   * A 14-digit Cook County PIN is shape-legal under the code pattern. It is
   * refused anyway, which is the reason shape is a floor and registry
   * membership is the actual acceptance rule.
   */
  it("rejects a property PIN, which passes the shape floor but is not approved", () => {
    expect(resolveAttributionCodes({ campaignCode: "09000000000000" }, SYNTHETIC_REGISTRY)).toEqual({
      ok: false,
      reason: "unknown_campaign_code",
    })
  })

  it("rejects an over-long code before it can carry a payload", () => {
    expect(resolveAttributionCodes({ campaignCode: "a".repeat(41) }, SYNTHETIC_REGISTRY)).toEqual({
      ok: false,
      reason: "malformed_code",
    })
  })

  it("accepts an approved pair from an injected synthetic registry", () => {
    expect(
      resolveAttributionCodes(
        { campaignCode: "synthetic_campaign_a", creativeCode: "synthetic_creative_2" },
        SYNTHETIC_REGISTRY,
      ),
    ).toEqual({ ok: true, attribution: { campaignCode: "synthetic_campaign_a", creativeCode: "synthetic_creative_2" } })
  })

  it("accepts an approved campaign with no creative", () => {
    expect(resolveAttributionCodes({ campaignCode: "synthetic_campaign_b" }, SYNTHETIC_REGISTRY)).toEqual({
      ok: true,
      attribution: { campaignCode: "synthetic_campaign_b", creativeCode: null },
    })
  })

  it("does not leak the injected synthetic registry into the shipped one", () => {
    expect(shippedAttributionRegistry().campaigns).toEqual([])
  })
})
