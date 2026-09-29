/** @jest-environment node */

/**
 * Continuity of the authoritative purchase across the attribution change.
 *
 * Checkout now stamps bounded first/last touches beside the GA identifiers in
 * Stripe metadata. The purchase itself must stay exactly what it was: emitted
 * only by the signed webhook after exact settlement and the durable PAID
 * transition, carrying the checkout's GA identifiers (revalidated again here),
 * a deterministic transaction id, and nothing from the touch metadata. Stripe,
 * the database and the GA transport are mocked; nothing leaves the process.
 */

type Row = Record<string, unknown>

jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: jest.fn() }))

jest.mock("@/lib/checkout/ot-reversal", () => ({
  ...jest.requireActual("@/lib/checkout/ot-reversal"),
  bindPayment: jest.fn(async () => {}),
}))

const dbState: { stripeEvents: Map<string, Row>; otOrders: Map<string, Row> } = {
  stripeEvents: new Map(),
  otOrders: new Map(),
}
/** When set, the idempotency table accepts Stripe event claims but cannot record anything else. */
let claimStoreDownExceptStripeEvents = false

const fetchMock = jest.fn()
;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

jest.mock("@/lib/db", () => ({
  prisma: {
    $transaction: jest.fn(async (work: (tx: unknown) => unknown) => work({})),
    stripeEvent: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (claimStoreDownExceptStripeEvents && !String(data.id).startsWith("evt_")) {
          throw Object.assign(new Error("Can't reach database server"), { code: "P1001" })
        }
        if (dbState.stripeEvents.has(String(data.id))) {
          throw Object.assign(new Error("unique"), { code: "P2002" })
        }
        dbState.stripeEvents.set(String(data.id), { ...data })
        return data
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        dbState.stripeEvents.delete(where.id)
        return null
      }),
    },
    oTOrder: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; stripeSessionId?: string } }) => {
        const rows = Array.from(dbState.otOrders.values())
        if (where.id) return rows.find((row) => row.id === where.id) ?? null
        if (where.stripeSessionId) return rows.find((row) => row.stripeSessionId === where.stripeSessionId) ?? null
        return null
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = Array.from(dbState.otOrders.values()).find((candidate) =>
          Object.entries(where).every(([key, value]) => {
            if (value === undefined) return true
            if (key === "eligibilitySnapshot" && value && typeof value === "object" && "equals" in value) {
              return JSON.stringify(candidate.eligibilitySnapshot ?? null) === JSON.stringify((value as Row).equals)
            }
            if (candidate[key] instanceof Date && value instanceof Date) {
              return (candidate[key] as Date).getTime() === value.getTime()
            }
            return candidate[key] === value
          }),
        )
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: "ord_recovery", ...data }
        dbState.otOrders.set("ord_recovery", row)
        return row
      }),
    },
  },
}))

const sendNewOrderAlertMock = jest.fn(async (_args?: unknown) => true)
const sendOrderConfirmationMock = jest.fn(async (_args?: unknown) => true)
jest.mock("@/lib/email/send", () => ({
  sendNewOrderAlert: (args: unknown) => sendNewOrderAlertMock(args),
  sendOrderConfirmation: (args: unknown) => sendOrderConfirmationMock(args),
}))

jest.mock("@/lib/packet/generate-and-deliver", () => ({ generatePacketForInvoice: jest.fn() }))

const kickOffMock = jest.fn(async (_order?: unknown) => ({ outcome: "DISABLED" }))
let evidenceWritesEnabled = false
jest.mock("@/lib/fulfillment-runtime/kickoff", () => ({
  kickOffT2FulfillmentEvidence: (order: unknown) => kickOffMock(order),
  t2FulfillmentEvidenceWritesEnabled: () => evidenceWritesEnabled,
}))

const listLineItemsMock = jest.fn()
jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: { constructEvent: jest.fn((body: string) => JSON.parse(body)) },
    checkout: { sessions: { listLineItems: (...args: unknown[]) => listLineItemsMock(...args) } },
  },
}))

import { POST } from "@/app/api/billing/webhook/route"
import { validateServerPurchasePayload } from "@/lib/analytics/funnel-contract"

const SESSION_ID = "cs_test_t2_settled"

/** Stripe metadata exactly as the checkout route stamps it for a T2 order. */
function checkoutMetadata(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    orderId: "ord_t2",
    tier: "T2",
    windowStatus: "open",
    windowRetrievedAt: "2026-09-28T11:00:00.000Z",
    gaClientId: "1234567890.1724102400",
    gaSessionId: "1724102400",
    gaSessionNumber: "4",
    firstTouchSource: "property_manager",
    firstTouchMedium: "email",
    firstTouchCampaign: "hoa_resident_resource_20260723",
    firstTouchLanding: "/hoa",
    firstTouchAt: "2026-09-25T09:00:00Z",
    lastTouchSource: "facebook",
    lastTouchMedium: "paid_social",
    lastTouchCampaign: "ot_2026_cicero_deadline",
    lastTouchContent: "v1_video",
    lastTouchLanding: "/appeal-deadline/[slug]",
    lastTouchAt: "2026-09-27T21:05:00Z",
    ...overrides,
  }
}

function webhook(eventId: string, options: { metadata?: Record<string, string>; paymentStatus?: string; amountTotal?: number } = {}) {
  return new Request("https://www.overtaxed-il.com/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body: JSON.stringify({
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: SESSION_ID,
          mode: "payment",
          payment_intent: "pi_test_t2",
          payment_status: options.paymentStatus ?? "paid",
          currency: "usd",
          amount_total: options.amountTotal ?? 6900,
          metadata: options.metadata ?? checkoutMetadata(),
          customer_details: { email: "buyer@example.com", name: "Buyer Example" },
        },
      },
    }),
  }) as never
}

function seedT2Order(overrides: Row = {}) {
  dbState.otOrders.set("ord_t2", {
    id: "ord_t2",
    checkoutKey: "57dc81a6-1329-4a85-9210-0d6f574ea65d",
    contractKey: "contract-key-t2",
    attempt: 0,
    stripeSessionId: SESSION_ID,
    tier: "T2",
    email: "buyer@example.com",
    name: "Buyer Example",
    propertyAddress: "2834 W HENDERSON ST",
    propertyPin: "13243140450000",
    township: "Jefferson",
    windowStatus: "open",
    windowOpenDate: new Date("2026-09-18T12:00:00.000Z"),
    windowCloseDate: new Date("2026-10-18T12:00:00.000Z"),
    windowSourceUpdated: "2026-09-28T11:00:00.000Z",
    eligibilitySnapshot: { pin: "13243140450000", township: "Jefferson", status: "open" },
    analysisAcknowledgedAt: new Date("2026-09-28T11:30:00.000Z"),
    acknowledgmentVersion: "analysis_ack_v1",
    acknowledgmentEvidence: { acknowledged: true, version: "analysis_ack_v1" },
    reassessmentNoticeDate: null,
    reassessmentNoticeAddress: null,
    checkoutPriceId: "price_t2",
    checkoutProductId: "prod_t2",
    checkoutAmountCents: 6900,
    checkoutCurrency: "usd",
    status: "CHECKOUT_CREATED",
    ...overrides,
  })
}

function purchasePayloads(): Array<Record<string, any>> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/mp/collect"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
  process.env.VERCEL_ENV = "production"
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123"
  process.env.GA4_API_SECRET = "ga4_secret"
  delete process.env.OT_NEUTRAL_REPORT_PRODUCTION_ENABLED
  ;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  dbState.stripeEvents.clear()
  dbState.otOrders.clear()
  evidenceWritesEnabled = false
  claimStoreDownExceptStripeEvents = false
  listLineItemsMock.mockResolvedValue({
    data: [{
      quantity: 1,
      amount_total: 6900,
      price: { id: "price_t2", unit_amount: 6900, currency: "usd", product: { id: "prod_t2" } },
    }],
  })
  fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => "" })
})

describe("authoritative purchase continuity", () => {
  it("turns one exact settlement into one server purchase carrying the checkout's GA identifiers and nothing from the touch metadata", async () => {
    seedT2Order()

    const res = await POST(webhook("evt_t2_paid"))

    expect(res.status).toBe(200)
    expect(dbState.otOrders.get("ord_t2")).toMatchObject({ status: "PAID", settledAmountCents: 6900 })
    const payloads = purchasePayloads()
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({
      client_id: "1234567890.1724102400",
      events: [{
        name: "purchase",
        params: {
          transaction_id: SESSION_ID,
          value: 69,
          ga_session_id: 1724102400,
          ga_session_number: 4,
          item_variant: "T2",
        },
      }],
    })
    const serialized = JSON.stringify(payloads)
    for (const forbidden of [
      "Touch",
      "property_manager",
      "hoa_resident_resource_20260723",
      "/hoa",
      "facebook",
      "ot_2026_cicero_deadline",
      "v1_video",
      "buyer@example.com",
      "Buyer Example",
      "HENDERSON",
      "13243140450000",
      "pi_test_t2",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(kickOffMock).toHaveBeenCalledWith(expect.objectContaining({ id: "ord_t2", status: "PAID" }))
  })

  it("emits a purchase the decision-grade funnel contract accepts, with an ISO 4217 currency code", async () => {
    seedT2Order()

    await POST(webhook("evt_t2_contract"))

    const payloads = purchasePayloads()
    expect(payloads).toHaveLength(1)
    expect(validateServerPurchasePayload(payloads[0])).toEqual({ ok: true })
    expect(payloads[0].events[0].params.currency).toBe("USD")
  })

  it("acknowledges a redelivery of the same Stripe event without a second purchase", async () => {
    seedT2Order()

    const first = await POST(webhook("evt_t2_redelivered"))
    const second = await POST(webhook("evt_t2_redelivered"))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(purchasePayloads()).toHaveLength(1)
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
  })

  it("contacts no Meta endpoint even with every Meta setting present, and a replay still sends one purchase", async () => {
    const metaSettings = {
      META_CAPI_ENABLED: "true",
      META_CAPI_ACCESS_TOKEN: "EAAB-synthetic-token",
      META_PIXEL_ID: "1234567890123456",
      NEXT_PUBLIC_META_PIXEL_ID: "1234567890123456",
    }
    Object.assign(process.env, metaSettings)
    try {
      seedT2Order()

      await POST(webhook("evt_t2_meta_env"))
      await POST(webhook("evt_t2_meta_env"))
    } finally {
      for (const key of Object.keys(metaSettings)) delete process.env[key]
    }

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.filter((url) => url.includes("/mp/collect"))).toHaveLength(1)
    expect(urls.filter((url) => /facebook|graph\.|meta/i.test(url))).toEqual([])
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
  })

  it("sends no second purchase when a different event arrives for an already-paid order", async () => {
    seedT2Order()

    await POST(webhook("evt_t2_first"))
    const second = await POST(webhook("evt_t2_second"))

    expect(second.status).toBe(200)
    expect(purchasePayloads()).toHaveLength(1)
    // The durable transition and its notifications happened once.
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["an unpaid session", { paymentStatus: "unpaid" }],
    ["an amount that differs from the durable order", { amountTotal: 7900 }],
  ])("sends no purchase for %s", async (_label, options) => {
    seedT2Order()

    const res = await POST(webhook("evt_t2_not_settled", options))

    expect(res.status).toBe(200)
    expect(purchasePayloads()).toHaveLength(0)
  })
})

/**
 * At most one purchase transport per settled Checkout Session. The winner of a
 * durable claim keyed by the transaction id sends; every later path — a
 * redelivery that re-enters to retry T2 evidence, a retry after evidence
 * failed, another event for the same session — finds the claim and sends
 * nothing. A failed or ambiguous send is not retried: GA may miss a purchase,
 * but never counts one twice. Settlement never depends on any of it.
 */
describe("one purchase transport per settled checkout", () => {
  it("sends one purchase when the same paid T2 event is redelivered to retry evidence", async () => {
    evidenceWritesEnabled = true
    seedT2Order()

    const first = await POST(webhook("evt_t2_evidence_redelivery"))
    const second = await POST(webhook("evt_t2_evidence_redelivery"))

    expect([first.status, second.status]).toEqual([200, 200])
    expect(kickOffMock).toHaveBeenCalledTimes(2)
    expect(purchasePayloads()).toHaveLength(1)
  })

  it("sends one purchase when evidence persistence fails after it and Stripe retries", async () => {
    evidenceWritesEnabled = true
    seedT2Order()
    kickOffMock.mockRejectedValueOnce(new Error("evidence persistence unavailable"))

    const failed = await POST(webhook("evt_t2_evidence_failure"))
    const retried = await POST(webhook("evt_t2_evidence_failure"))

    expect(failed.status).toBe(500)
    expect(retried.status).toBe(200)
    expect(kickOffMock).toHaveBeenCalledTimes(2)
    expect(purchasePayloads()).toHaveLength(1)
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
  })

  it("does not attempt a second transport after the first one failed", async () => {
    seedT2Order()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" })

    const first = await POST(webhook("evt_t2_provider_failure"))
    const second = await POST(webhook("evt_t2_provider_failure_other_event"))

    expect([first.status, second.status]).toEqual([200, 200])
    expect(purchasePayloads()).toHaveLength(1)
  })

  it("sends nothing, and still settles, when the claim cannot be recorded", async () => {
    claimStoreDownExceptStripeEvents = true
    seedT2Order()

    const res = await POST(webhook("evt_t2_claim_store_down"))

    expect(res.status).toBe(200)
    expect(dbState.otOrders.get("ord_t2")).toMatchObject({ status: "PAID", settledAmountCents: 6900 })
    expect(purchasePayloads()).toHaveLength(0)
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
    expect(kickOffMock).toHaveBeenCalledTimes(1)
  })
})

describe("GA identifiers are revalidated again at the webhook", () => {
  it("sends no purchase when the stamped client id is not an exact GA client id", async () => {
    seedT2Order()

    const res = await POST(webhook("evt_t2_bad_client", { metadata: checkoutMetadata({ gaClientId: "1.2" }) }))

    expect(res.status).toBe(200)
    expect(dbState.otOrders.get("ord_t2")).toMatchObject({ status: "PAID" })
    expect(purchasePayloads()).toHaveLength(0)
  })

  it("omits a session id or session number that is not exactly bounded rather than repairing it", async () => {
    seedT2Order()

    await POST(
      webhook("evt_t2_bad_session", {
        metadata: checkoutMetadata({ gaSessionId: "0724102400", gaSessionNumber: "1000000" }),
      }),
    )

    const payloads = purchasePayloads()
    expect(payloads).toHaveLength(1)
    expect(payloads[0].client_id).toBe("1234567890.1724102400")
    expect(payloads[0].events[0].params).not.toHaveProperty("ga_session_id")
    expect(payloads[0].events[0].params).not.toHaveProperty("ga_session_number")
  })
})
