/** @jest-environment node */

/**
 * G1 companion (test-first): the settlement webhook must not acknowledge a
 * neutral $69 T2 settlement (paid OR legitimate zero-total) whose production
 * enqueue was REFUSED. A refusal must leave the event retryable exactly like a
 * thrown enqueue: claim released when this delivery owns it, non-2xx response,
 * settlement and notifications not repeated on the retry.
 *
 * The REAL route and the REAL enqueueAndScheduleNeutralReportProduction run;
 * only the durable generation store's `ensure` is a seam (its native SQL
 * authority is covered by __tests__/checkout/g1-zero-total-authority-native.test.ts).
 * Database, Stripe, settlement binders, email and kickoff are in-process
 * stand-ins following __tests__/billing/webhook-zero-total-settlement.test.ts.
 * Nothing leaves the process.
 */

type Row = Record<string, unknown>

const mockAfter = jest.fn((_callback: () => Promise<void>) => {})
jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: (cb: () => Promise<void>) => mockAfter(cb) }))

const mockEnsure = jest.fn(async (_orderId: string): Promise<{ workId: string } | null> => ({ workId: "neutral_work_1" }))
jest.mock("@/lib/fulfillment-runtime/neutral-generation-store", () => ({
  prismaNeutralGenerationStore: { ensure: (orderId: string) => mockEnsure(orderId) },
}))

const mockBindPayment = jest.fn(async (..._a: unknown[]) => {})
const mockBindZeroTotal = jest.fn(async (..._a: unknown[]) => {})
jest.mock("@/lib/checkout/ot-reversal", () => ({
  ...jest.requireActual("@/lib/checkout/ot-reversal"),
  bindPayment: (...a: unknown[]) => mockBindPayment(...a),
  bindZeroTotalSettlement: (...a: unknown[]) => mockBindZeroTotal(...a),
}))

const mockDb: { stripeEvents: Map<string, Row>; otOrders: Map<string, Row> } = { stripeEvents: new Map(), otOrders: new Map() }
jest.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (work: (tx: unknown) => unknown) => work({ tx: true }),
    $executeRaw: async () => 1,
    stripeEvent: {
      create: async ({ data }: { data: Row }) => {
        if (mockDb.stripeEvents.has(String(data.id))) throw Object.assign(new Error("unique"), { code: "P2002" })
        mockDb.stripeEvents.set(String(data.id), { ...data })
        return data
      },
      delete: async ({ where }: { where: { id: string } }) => { mockDb.stripeEvents.delete(where.id); return null },
    },
    gaPurchaseClaim: { create: async () => ({}) },
    oTOrder: {
      findUnique: async ({ where }: { where: { id?: string; stripeSessionId?: string } }) => {
        const rows = Array.from(mockDb.otOrders.values())
        const row = where.id ? rows.find(r => r.id === where.id) : rows.find(r => r.stripeSessionId === where.stripeSessionId)
        return row ? { ...row } : null
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = Array.from(mockDb.otOrders.values()).find(candidate =>
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
      },
      create: async ({ data }: { data: Row }) => { const row = { id: "ord_recovery", ...data }; mockDb.otOrders.set("ord_recovery", row); return row },
    },
  },
}))

const mockEmail = { alert: jest.fn(async (_a?: unknown) => true), confirmation: jest.fn(async (_a?: unknown) => true) }
jest.mock("@/lib/email/send", () => ({
  sendNewOrderAlert: (a: unknown) => mockEmail.alert(a),
  sendOrderConfirmation: (a: unknown) => mockEmail.confirmation(a),
}))
jest.mock("@/lib/packet/generate-and-deliver", () => ({ generatePacketForInvoice: jest.fn() }))
const mockKickOff = jest.fn(async (_o?: unknown) => ({ outcome: "DISABLED" }))
jest.mock("@/lib/fulfillment-runtime/kickoff", () => ({
  kickOffT2FulfillmentEvidence: (o: unknown) => mockKickOff(o),
  t2FulfillmentEvidenceWritesEnabled: () => false,
}))
jest.mock("@/lib/fulfillment-runtime/t2-artifact-scheduling", () => ({ scheduleT2ArtifactOrchestration: jest.fn() }))

const mockListLineItems = jest.fn()
const mockRetrievePromotion = jest.fn()
jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: {
      constructEvent: (body: string, sig: string) => {
        if (sig !== "t=1,v1=fake") throw new Error("bad signature")
        return JSON.parse(body)
      },
    },
    checkout: { sessions: { listLineItems: (...a: unknown[]) => mockListLineItems(...a) } },
    promotionCodes: { retrieve: (...a: unknown[]) => mockRetrievePromotion(...a) },
  },
}))

import { POST } from "@/app/api/billing/webhook/route"

const ORDER_ID = "ord_neutral"
const SESSION_ID = "cs_test_neutral_enqueue"
const PROMO = "promo_full_report"
const POLICY = "ot-neutral-records-report/2026-09-15"

function seedOrder(overrides: Row = {}) {
  mockDb.otOrders.set(ORDER_ID, {
    id: ORDER_ID,
    checkoutKey: "6f0f0b8e-5d55-4c39-9a6f-1d1f3c6a9b11",
    contractKey: "contract-key-neutral",
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
    eligibilitySnapshot: { policyVersion: POLICY, pin: "13243140450000", township: "Jefferson", status: "open" },
    analysisAcknowledgedAt: new Date("2026-09-28T11:30:00.000Z"),
    acknowledgmentVersion: "analysis_ack_v1",
    acknowledgmentEvidence: { acknowledged: true, version: "analysis_ack_v1" },
    reassessmentNoticeDate: null,
    reassessmentNoticeAddress: null,
    checkoutPriceId: "price_t2",
    checkoutProductId: "prod_t2",
    checkoutAmountCents: 6900,
    checkoutCurrency: "usd",
    checkoutDiscountPromotionCodeId: "none",
    status: "CHECKOUT_CREATED",
    ...overrides,
  })
}

const base = {
  id: SESSION_ID, object: "checkout.session", mode: "payment", status: "complete", currency: "usd", amount_subtotal: 6900,
  metadata: { orderId: ORDER_ID, tier: "T2", windowStatus: "open" },
  customer_details: { email: "buyer@example.com", name: "Buyer Example" },
}
const paidSession = (): Row => ({ ...base, payment_status: "paid", payment_intent: "pi_neutral", amount_total: 6900, total_details: { amount_discount: 0 } })
const zeroSession = (): Row => ({ ...base, payment_status: "no_payment_required", payment_intent: null, amount_total: 0, total_details: { amount_discount: 6900, amount_shipping: 0, amount_tax: 0 } })
const paidLines = () => ({ data: [{ quantity: 1, amount_subtotal: 6900, amount_discount: 0, amount_total: 6900, currency: "usd", price: { id: "price_t2", unit_amount: 6900, currency: "usd", product: { id: "prod_t2" } }, discounts: [] }] })
const zeroLines = (promotionCode = PROMO) => ({ data: [{ quantity: 1, amount_subtotal: 6900, amount_discount: 6900, amount_total: 0, currency: "usd",
  price: { id: "price_t2", unit_amount: 6900, currency: "usd", product: { id: "prod_t2" } },
  discounts: [{ amount: 6900, discount: { id: "di_1", checkout_session: SESSION_ID, promotion_code: promotionCode, source: { coupon: "coupon_full", type: "coupon" } } }] }] })
const promotion = () => ({ id: PROMO, object: "promotion_code", active: false, code: "FREEREPORT",
  promotion: { type: "coupon", coupon: { id: "coupon_full", object: "coupon", valid: false, percent_off: 100, amount_off: null, currency: null, applies_to: { products: ["prod_t2"] } } } })

function webhook(eventId: string, object: Row) {
  return new Request("https://www.overtaxed-il.com/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body: JSON.stringify({ id: eventId, type: "checkout.session.completed", data: { object } }),
  }) as never
}
const order = () => mockDb.otOrders.get(ORDER_ID) as Row
const notifications = () => ({ alerts: mockEmail.alert.mock.calls.length, confirmations: mockEmail.confirmation.mock.calls.length })

type Kind = "paid" | "zero"
const settings: Record<Kind, { seed: Row; session: () => Row; lines: () => unknown; settled: Row; binder: () => jest.Mock }> = {
  paid: { seed: {}, session: paidSession, lines: paidLines, settled: { status: "PAID", settledAmountCents: 6900, amountPaid: 69 }, binder: () => mockBindPayment },
  zero: { seed: { checkoutDiscountPromotionCodeId: PROMO }, session: zeroSession, lines: () => zeroLines(), settled: { status: "PAID", settledAmountCents: 0, amountPaid: 0 }, binder: () => mockBindZeroTotal },
}
const arrange = (kind: Kind) => { seedOrder(settings[kind].seed); mockListLineItems.mockResolvedValue(settings[kind].lines()) }
const deliver = (kind: Kind, eventId: string) => POST(webhook(eventId, settings[kind].session()))

beforeEach(() => {
  jest.clearAllMocks()
  mockEnsure.mockImplementation(async () => ({ workId: "neutral_work_1" }))
  mockDb.stripeEvents.clear()
  mockDb.otOrders.clear()
  ;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = (async () => { throw new Error("NETWORK_FORBIDDEN_IN_TEST") }) as unknown as typeof fetch
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic"
  process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS = PROMO
  process.env.OT_NEUTRAL_REPORT_PRODUCTION_ENABLED = "true"
  delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  delete process.env.GA4_API_SECRET
  mockRetrievePromotion.mockResolvedValue(promotion())
})

describe.each(["paid", "zero"] as const)("neutral $69 T2 settlement (%s): production enqueue outcome", (kind) => {
  it("first-transition REFUSED is not acknowledged: non-2xx, claim released, settlement kept, notified once; the retry reaches enqueue again and is acknowledged once SCHEDULED", async () => {
    arrange(kind)
    mockEnsure.mockResolvedValueOnce(null)
    const refused = await deliver(kind, "evt_first")
    expect(refused.status).toBe(500)
    expect(mockDb.stripeEvents.has("evt_first")).toBe(false)
    expect(order()).toMatchObject(settings[kind].settled)
    expect(settings[kind].binder()).toHaveBeenCalledTimes(1)
    expect(notifications()).toEqual({ alerts: 1, confirmations: 1 })
    expect(mockAfter).not.toHaveBeenCalled()
    expect(mockKickOff).not.toHaveBeenCalled()

    const retry = await deliver(kind, "evt_first")
    expect(retry.status).toBe(200)
    expect(mockEnsure).toHaveBeenCalledTimes(2)
    expect(mockEnsure).toHaveBeenNthCalledWith(2, ORDER_ID)
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockDb.stripeEvents.has("evt_first")).toBe(true)
    expect(order()).toMatchObject(settings[kind].settled)
    expect(notifications()).toEqual({ alerts: 1, confirmations: 1 })
  })

  it("already-PAID retry under a NEW event id that is REFUSED is not acknowledged and releases only its own claim; no re-notification", async () => {
    arrange(kind)
    expect((await deliver(kind, "evt_ok")).status).toBe(200)
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    mockEnsure.mockResolvedValueOnce(null)
    const refused = await deliver(kind, "evt_new")
    expect(refused.status).toBe(500)
    expect(mockEnsure).toHaveBeenCalledTimes(2)
    expect(mockDb.stripeEvents.has("evt_new")).toBe(false)
    expect(mockDb.stripeEvents.has("evt_ok")).toBe(true)
    expect(order()).toMatchObject(settings[kind].settled)
    expect(notifications()).toEqual({ alerts: 1, confirmations: 1 })
  })

  it("duplicate-event retry path (claim already held) that is REFUSED is not acknowledged; the held claim is untouched and a later duplicate converges", async () => {
    arrange(kind)
    expect((await deliver(kind, "evt_dup")).status).toBe(200)
    mockEnsure.mockResolvedValueOnce(null)
    const refused = await deliver(kind, "evt_dup")
    expect(refused.status).toBe(500)
    expect(mockDb.stripeEvents.has("evt_dup")).toBe(true)
    const again = await deliver(kind, "evt_dup")
    expect(again.status).toBe(200)
    expect(mockEnsure).toHaveBeenCalledTimes(3)
    expect(mockAfter).toHaveBeenCalledTimes(2)
    expect(notifications()).toEqual({ alerts: 1, confirmations: 1 })
  })

  it("SCHEDULED is acknowledged once with one durable enqueue (unchanged)", async () => {
    arrange(kind)
    const res = await deliver(kind, "evt_sched")
    expect(res.status).toBe(200)
    expect(mockEnsure).toHaveBeenCalledWith(ORDER_ID)
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockKickOff).toHaveBeenCalledTimes(1)
    expect(mockDb.stripeEvents.has("evt_sched")).toBe(true)
  })

  it("production disabled keeps the existing deliberate behavior: acknowledged, no enqueue attempt (unchanged)", async () => {
    delete process.env.OT_NEUTRAL_REPORT_PRODUCTION_ENABLED
    arrange(kind)
    const res = await deliver(kind, "evt_disabled")
    expect(res.status).toBe(200)
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
    expect(mockKickOff).toHaveBeenCalledTimes(1)
    expect(order()).toMatchObject(settings[kind].settled)
  })

  it("a thrown enqueue still releases the claim with 500 (unchanged)", async () => {
    arrange(kind)
    mockEnsure.mockRejectedValueOnce(new Error("db down"))
    const res = await deliver(kind, "evt_threw")
    expect(res.status).toBe(500)
    expect(mockDb.stripeEvents.has("evt_threw")).toBe(false)
  })
})

describe("recovery holds never reach production enqueue (unchanged)", () => {
  it("zero-total with a foreign promotion on the provider discount is held, acknowledged as recovery, no enqueue", async () => {
    seedOrder({ checkoutDiscountPromotionCodeId: PROMO })
    mockListLineItems.mockResolvedValue(zeroLines("promo_attacker"))
    const res = await POST(webhook("evt_hold", zeroSession()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, recovery: true })
    expect(order().status).toBe("PAID_RECOVERY_REQUIRED")
    expect(mockBindZeroTotal).not.toHaveBeenCalled()
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(notifications()).toEqual({ alerts: 0, confirmations: 0 })
  })
})
