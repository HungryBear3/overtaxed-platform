/** @jest-environment node */

/**
 * Legitimate 100%-discount (zero-total) OT checkout settlement through the real
 * signed webhook handler. Stripe, the database and GA are mocked; nothing
 * leaves the process and no fixture here is a real payment.
 *
 * A zero-total session becomes PAID only with complete `no_payment_required`,
 * total exactly 0, no PaymentIntent, and discount evidence binding the
 * server-allowlisted promotion code persisted on the durable order to the exact
 * product/price/currency/subtotal. Everything else fails closed.
 */

type Row = Record<string, unknown>

jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: jest.fn() }))

const bindPaymentMock = jest.fn(async (..._a: unknown[]) => {})
const bindZeroTotalMock = jest.fn(async (..._a: unknown[]) => {})
jest.mock("@/lib/checkout/ot-reversal", () => ({
  ...jest.requireActual("@/lib/checkout/ot-reversal"),
  bindPayment: (...a: unknown[]) => bindPaymentMock(...a),
  bindZeroTotalSettlement: (...a: unknown[]) => bindZeroTotalMock(...a),
}))

const dbState: { stripeEvents: Map<string, Row>; otOrders: Map<string, Row> } = {
  stripeEvents: new Map(),
  otOrders: new Map(),
}
const fetchMock = jest.fn(async () => ({ ok: true, status: 204 }))
;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

jest.mock("@/lib/db", () => ({
  prisma: {
    $transaction: jest.fn(async (work: (tx: unknown) => unknown) => work({ tx: true })),
    $executeRaw: jest.fn(async () => 1),
    stripeEvent: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (dbState.stripeEvents.has(String(data.id))) throw Object.assign(new Error("unique"), { code: "P2002" })
        dbState.stripeEvents.set(String(data.id), { ...data })
        return data
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        dbState.stripeEvents.delete(where.id)
        return null
      }),
    },
    gaPurchaseClaim: { create: jest.fn(async () => ({})) },
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
            if (candidate[key] instanceof Date && value instanceof Date) return (candidate[key] as Date).getTime() === value.getTime()
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

const sendNewOrderAlertMock = jest.fn(async (_a?: unknown) => true)
const sendOrderConfirmationMock = jest.fn(async (_a?: unknown) => true)
jest.mock("@/lib/email/send", () => ({
  sendNewOrderAlert: (a: unknown) => sendNewOrderAlertMock(a),
  sendOrderConfirmation: (a: unknown) => sendOrderConfirmationMock(a),
}))
jest.mock("@/lib/packet/generate-and-deliver", () => ({ generatePacketForInvoice: jest.fn() }))
const kickOffMock = jest.fn(async (_o?: unknown) => ({ outcome: "DISABLED" }))
jest.mock("@/lib/fulfillment-runtime/kickoff", () => ({
  kickOffT2FulfillmentEvidence: (o: unknown) => kickOffMock(o),
  t2FulfillmentEvidenceWritesEnabled: () => false,
}))
jest.mock("@/lib/fulfillment-runtime/t2-artifact-scheduling", () => ({ scheduleT2ArtifactOrchestration: jest.fn() }))

const listLineItemsMock = jest.fn()
const retrievePromotionMock = jest.fn()
jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: {
      constructEvent: jest.fn((body: string, sig: string) => {
        if (sig !== "t=1,v1=fake") throw new Error("bad signature")
        return JSON.parse(body)
      }),
    },
    checkout: { sessions: { listLineItems: (...a: unknown[]) => listLineItemsMock(...a) } },
    promotionCodes: { retrieve: (...a: unknown[]) => retrievePromotionMock(...a) },
  },
}))

import { POST } from "@/app/api/billing/webhook/route"

const SESSION_ID = "cs_test_t2_zero_total"
const PROMO = "promo_full_report"

function session(overrides: Row = {}): Row {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_intent: null,
    payment_status: "no_payment_required",
    currency: "usd",
    amount_subtotal: 6900,
    amount_total: 0,
    total_details: { amount_discount: 6900, amount_shipping: 0, amount_tax: 0 },
    metadata: { orderId: "ord_t2", tier: "T2", windowStatus: "open" },
    customer_details: { email: "buyer@example.com", name: "Buyer Example" },
    ...overrides,
  }
}

function webhook(eventId: string, object: Row, sig = "t=1,v1=fake") {
  return new Request("https://www.overtaxed-il.com/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": sig },
    body: JSON.stringify({ id: eventId, type: "checkout.session.completed", data: { object } }),
  }) as never
}

function seedOrder(overrides: Row = {}) {
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
    checkoutDiscountPromotionCodeId: PROMO,
    status: "CHECKOUT_CREATED",
    ...overrides,
  })
}

function lineItem(overrides: Row = {}, discountOverrides: Row = {}) {
  return {
    data: [
      {
        quantity: 1,
        amount_subtotal: 6900,
        amount_discount: 6900,
        amount_total: 0,
        currency: "usd",
        price: { id: "price_t2", unit_amount: 6900, currency: "usd", product: { id: "prod_t2" } },
        discounts: [
          {
            amount: 6900,
            discount: { id: "di_1", checkout_session: SESSION_ID, promotion_code: PROMO, source: { coupon: "coupon_full", type: "coupon" }, ...discountOverrides },
          },
        ],
        ...overrides,
      },
    ],
  }
}

function promotion(couponOverrides: Row = {}) {
  return {
    id: PROMO,
    object: "promotion_code",
    active: false,
    code: "FREEREPORT",
    promotion: {
      type: "coupon",
      coupon: { id: "coupon_full", object: "coupon", valid: false, percent_off: 100, amount_off: null, currency: null, applies_to: { products: ["prod_t2"] }, ...couponOverrides },
    },
  }
}

const order = () => dbState.otOrders.get("ord_t2") as Row

beforeEach(() => {
  jest.clearAllMocks()
  dbState.stripeEvents.clear()
  dbState.otOrders.clear()
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic"
  process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS = PROMO
  delete process.env.OT_NEUTRAL_REPORT_PRODUCTION_ENABLED
  listLineItemsMock.mockResolvedValue(lineItem())
  retrievePromotionMock.mockResolvedValue(promotion())
  seedOrder()
})

describe("zero-total full-discount settlement", () => {
  it("settles a complete no_payment_required session with exact discount evidence as truthful zero-total PAID", async () => {
    const res = await POST(webhook("evt_zero_ok", session()))
    expect(res.status).toBe(200)
    expect(order().status).toBe("PAID")
    expect(order().settledAmountCents).toBe(0)
    expect(order().settledCurrency).toBe("usd")
    expect(order().amountPaid).toBe(0)
    expect(bindPaymentMock).not.toHaveBeenCalled()
    expect(bindZeroTotalMock).toHaveBeenCalledTimes(1)
    expect(bindZeroTotalMock).toHaveBeenCalledWith({ tx: true }, {
      orderId: "ord_t2",
      sessionId: SESSION_ID,
      eventId: "evt_zero_ok",
      promotionCodeId: PROMO,
      couponId: "coupon_full",
      subtotalCents: 6900,
      discountCents: 6900,
      currency: "usd",
    })
    expect(listLineItemsMock).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ expand: expect.arrayContaining(["data.discounts"]) }))
    expect(retrievePromotionMock).toHaveBeenCalledWith(PROMO, { expand: ["promotion.coupon"] })
    expect(kickOffMock).toHaveBeenCalledWith(expect.objectContaining({ id: "ord_t2", status: "PAID" }))
  })

  it("accepts an amount_off coupon equal to the exact price in the exact currency", async () => {
    retrievePromotionMock.mockResolvedValue(promotion({ percent_off: null, amount_off: 6900, currency: "usd" }))
    expect((await POST(webhook("evt_zero_amount_off", session()))).status).toBe(200)
    expect(order().status).toBe("PAID")
  })

  it("keeps the ordinary paid flow unchanged: PaymentIntent binding, full settled amount", async () => {
    seedOrder({ checkoutDiscountPromotionCodeId: null })
    listLineItemsMock.mockResolvedValue(lineItem({ amount_discount: 0, amount_total: 6900, discounts: [] }))
    const res = await POST(webhook("evt_paid", session({ payment_status: "paid", payment_intent: "pi_real", amount_total: 6900, total_details: { amount_discount: 0 } })))
    expect(res.status).toBe(200)
    expect(order().status).toBe("PAID")
    expect(order().settledAmountCents).toBe(6900)
    expect(bindPaymentMock).toHaveBeenCalledWith({ tx: true }, "ord_t2", SESSION_ID, "pi_real")
    expect(bindZeroTotalMock).not.toHaveBeenCalled()
    expect(retrievePromotionMock).not.toHaveBeenCalled()
  })

  it("still ignores an unpaid session with no settlement write", async () => {
    const res = await POST(webhook("evt_unpaid", session({ payment_status: "unpaid" })))
    expect(res.status).toBe(200)
    expect(order().status).toBe("CHECKOUT_CREATED")
    expect(bindZeroTotalMock).not.toHaveBeenCalled()
    expect(listLineItemsMock).not.toHaveBeenCalled()
  })

  it("rejects an unsigned zero-total event before any write", async () => {
    expect((await POST(webhook("evt_unsigned", session(), "bad"))).status).toBe(400)
    expect(dbState.stripeEvents.size).toBe(0)
    expect(order().status).toBe("CHECKOUT_CREATED")
  })

  const holds: Array<[string, () => void, Row]> = [
    ["session not complete", () => {}, { status: "open" }],
    ["nonzero total", () => {}, { amount_total: 100 }],
    ["unexpected PaymentIntent", () => {}, { payment_intent: "pi_unexpected" }],
    ["subtotal differs from durable price", () => {}, { amount_subtotal: 5000, total_details: { amount_discount: 5000 } }],
    ["session discount total differs", () => {}, { total_details: { amount_discount: 6800 } }],
    ["currency mismatch", () => {}, { currency: "eur" }],
    ["order mismatch (other order id)", () => seedOrder({ stripeSessionId: "cs_test_other" }), {}],
    ["durable order has no discount evidence", () => seedOrder({ checkoutDiscountPromotionCodeId: null }), {}],
    ["promotion code no longer allowlisted", () => { process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS = "promo_other" }, {}],
    ["line item lacks discount evidence", () => listLineItemsMock.mockResolvedValue(lineItem({ discounts: [] })), {}],
    ["line item promotion code differs", () => listLineItemsMock.mockResolvedValue(lineItem({}, { promotion_code: "promo_attacker" })), {}],
    ["line item discount bound to another session", () => listLineItemsMock.mockResolvedValue(lineItem({}, { checkout_session: "cs_test_other" })), {}],
    ["line item product mismatch", () => listLineItemsMock.mockResolvedValue(lineItem({ price: { id: "price_t2", unit_amount: 6900, currency: "usd", product: { id: "prod_other" } } })), {}],
    ["line item price mismatch", () => listLineItemsMock.mockResolvedValue(lineItem({ price: { id: "price_other", unit_amount: 6900, currency: "usd", product: { id: "prod_t2" } } })), {}],
    ["partial line discount", () => listLineItemsMock.mockResolvedValue(lineItem({ amount_discount: 3450, amount_total: 3450 })), {}],
    ["partial coupon", () => retrievePromotionMock.mockResolvedValue(promotion({ percent_off: 50 })), {}],
    ["coupon not scoped to product", () => retrievePromotionMock.mockResolvedValue(promotion({ applies_to: undefined })), {}],
    ["coupon scoped to another product", () => retrievePromotionMock.mockResolvedValue(promotion({ applies_to: { products: ["prod_other"] } })), {}],
    ["amount_off in wrong currency", () => retrievePromotionMock.mockResolvedValue(promotion({ percent_off: null, amount_off: 6900, currency: "eur" })), {}],
  ]
  it.each(holds)("fails closed (no entitlement, no zero-total binding) when %s", async (_name, arrange, overrides) => {
    arrange()
    const res = await POST(webhook("evt_zero_bad", session(overrides)))
    expect([200, 500]).toContain(res.status)
    const ord = dbState.otOrders.get("ord_t2") as Row
    expect(ord.status).not.toBe("PAID")
    expect(bindZeroTotalMock).not.toHaveBeenCalled()
    expect(bindPaymentMock).not.toHaveBeenCalled()
    expect(kickOffMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
  })

  it("a duplicate event is skipped and does not re-bind or re-notify", async () => {
    expect((await POST(webhook("evt_dup", session()))).status).toBe(200)
    expect((await POST(webhook("evt_dup", session()))).status).toBe(200)
    expect(bindZeroTotalMock).toHaveBeenCalledTimes(1)
    expect(sendOrderConfirmationMock).toHaveBeenCalledTimes(1)
  })

  it("a replayed session under a new event id reuses the immutable binding and does not re-notify", async () => {
    expect((await POST(webhook("evt_first", session()))).status).toBe(200)
    expect((await POST(webhook("evt_replay", session()))).status).toBe(200)
    expect(order().status).toBe("PAID")
    expect(sendOrderConfirmationMock).toHaveBeenCalledTimes(1)
  })

  it("a cross-order replay (session metadata naming another order) is held, never PAID", async () => {
    dbState.otOrders.set("ord_victim", { ...order(), id: "ord_victim", stripeSessionId: "cs_test_victim", status: "CHECKOUT_CREATED" })
    await POST(webhook("evt_cross", session({ metadata: { orderId: "ord_victim", tier: "T2" } })))
    expect((dbState.otOrders.get("ord_victim") as Row).status).not.toBe("PAID")
    expect(bindZeroTotalMock).not.toHaveBeenCalled()
  })

  it("persistence failure of the zero-total binding releases the event claim (retryable) and grants nothing", async () => {
    bindZeroTotalMock.mockRejectedValueOnce(new Error("db down"))
    const res = await POST(webhook("evt_persist_fail", session()))
    expect(res.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_persist_fail")).toBe(false)
    expect(order().status).toBe("CHECKOUT_CREATED")
    expect(kickOffMock).not.toHaveBeenCalled()
    const retry = await POST(webhook("evt_persist_fail", session()))
    expect(retry.status).toBe(200)
    expect(order().status).toBe("PAID")
  })

  it("promotion lookup failure is retryable, not a silent hold or grant", async () => {
    retrievePromotionMock.mockRejectedValueOnce(new Error("stripe unavailable"))
    const res = await POST(webhook("evt_lookup_fail", session()))
    expect(res.status).toBe(500)
    expect(order().status).toBe("CHECKOUT_CREATED")
    expect(dbState.stripeEvents.has("evt_lookup_fail")).toBe(false)
  })
})
