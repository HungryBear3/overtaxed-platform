/** @jest-environment node */

/**
 * The Meta Conversions API posture: DEFERRED, with no send path.
 *
 * CAPI matching needs user_data. Checkout metadata carries no durable
 * marketing consent and no consented, bounded fbp/fbc, and the purchase
 * contract forbids every customer identifier a match would need. So there is
 * no server event to build, and nothing — no input, no environment variable —
 * can produce one. The posture must also agree with the rest of Phase B: no
 * Meta purchase anywhere, and no experiment readout that needs Meta evidence.
 */
import { META_CAPI_POSTURE, buildMetaServerPurchaseEvent } from "@/lib/analytics/meta-capi"
import { buildMetaBrowserEvent } from "@/lib/analytics/meta-pixel-policy"
import { validateServerPurchasePayload } from "@/lib/analytics/funnel-contract"
import { PRIMARY_OUTCOMES, PRIMARY_OUTCOME_EVIDENCE } from "@/lib/analytics/experiment-registry"
import { buildDecisionExportMappingContract } from "@/lib/analytics/decision-export"

const META_ENV = {
  META_CAPI_ENABLED: "true",
  OT_META_CAPI_ENABLED: "1",
  META_CAPI_ACCESS_TOKEN: "EAAB-synthetic-token",
  META_ACCESS_TOKEN: "EAAB-synthetic-token",
  FACEBOOK_ACCESS_TOKEN: "EAAB-synthetic-token",
  META_PIXEL_ID: "1234567890123456",
  META_DATASET_ID: "1234567890123456",
  META_TEST_EVENT_CODE: "TEST123",
  NEXT_PUBLIC_META_PIXEL_ID: "1234567890123456",
  NEXT_PUBLIC_META_CAPI_ENABLED: "true",
}

const SETTLED_PURCHASE = {
  transactionId: "cs_live_a1B2c3D4e5F6g7H8",
  amountCents: 6900,
  currency: "usd",
  tier: "T2",
  email: "buyer@example.com",
  fbp: "fb.1.1724102400000.1234567890",
  fbc: "fb.1.1724102400000.IwAR0abcDEF",
  marketingConsent: true,
  clientIpAddress: "203.0.113.7",
  clientUserAgent: "Mozilla/5.0",
}

describe("the deferred posture", () => {
  it("is DEFERRED with no server event and names why", () => {
    expect(META_CAPI_POSTURE.status).toBe("DEFERRED")
    expect(META_CAPI_POSTURE.server_event).toBeNull()
    expect(META_CAPI_POSTURE.reasons).toEqual(
      expect.arrayContaining([
        "NO_DURABLE_MARKETING_CONSENT_IN_SIGNED_CHECKOUT_METADATA",
        "NO_CONSENTED_BOUNDED_FBP_FBC_IN_SIGNED_CHECKOUT_METADATA",
        "MATCHING_REQUIRES_USER_DATA_THE_PURCHASE_CONTRACT_FORBIDS",
      ]),
    )
  })

  it.each([
    ["a fully populated settled purchase", SETTLED_PURCHASE],
    ["nothing", undefined],
    ["garbage", "cs_live_a1B2c3D4e5F6g7H8"],
  ])("builds no server event from %s", (_label, input) => {
    expect(buildMetaServerPurchaseEvent(input)).toEqual({
      status: "DEFERRED",
      event: null,
      reasons: META_CAPI_POSTURE.reasons,
    })
  })
})

describe("nothing can activate it", () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it("stays deferred with every conceivable Meta setting present, even on a fresh module load", () => {
    process.env = { ...originalEnv, ...META_ENV }
    let fresh!: typeof import("@/lib/analytics/meta-capi")
    jest.isolateModules(() => {
      fresh = require("@/lib/analytics/meta-capi")
    })

    expect(fresh.META_CAPI_POSTURE.status).toBe("DEFERRED")
    expect(fresh.buildMetaServerPurchaseEvent(SETTLED_PURCHASE).event).toBeNull()
  })

  it("reads no environment variable and makes no request", () => {
    const readKeys: string[] = []
    process.env = new Proxy({ ...originalEnv, ...META_ENV }, {
      get(target, key) {
        if (typeof key === "string") readKeys.push(key)
        return Reflect.get(target, key)
      },
    })
    const fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    buildMetaServerPurchaseEvent(SETTLED_PURCHASE)
    void META_CAPI_POSTURE.status

    expect(readKeys).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("the posture agrees with the event contracts and experiment readiness", () => {
  it("leaves no Meta purchase anywhere: no browser Purchase, and a purchase payload cannot carry matching data", () => {
    expect(buildMetaBrowserEvent("Purchase", { value: 69, currency: "USD" })).toBeNull()

    const withMatching = {
      client_id: "1234567890.1724102400",
      user_data: { em: ["hashed"], fbp: SETTLED_PURCHASE.fbp, fbc: SETTLED_PURCHASE.fbc },
      events: [],
    }
    const result = validateServerPurchasePayload(withMatching)
    expect(result.ok ? [] : result.violations).toContain("UNKNOWN_FIELD:user_data")
  })

  it("no experiment primary outcome reads Meta evidence, so deferral cannot block readiness", () => {
    const exportedDocuments = Object.keys(buildDecisionExportMappingContract().documents)

    for (const outcome of PRIMARY_OUTCOMES) {
      const evidence = PRIMARY_OUTCOME_EVIDENCE[outcome]
      expect(evidence.length).toBeGreaterThan(0)
      for (const evidenceClass of evidence) {
        expect(exportedDocuments).toContain(evidenceClass)
        expect(evidenceClass).not.toMatch(/meta|facebook|capi/i)
      }
    }
  })
})
