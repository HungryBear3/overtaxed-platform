/** @jest-environment node */

/**
 * Phase 1 confirmation-email delivery evidence — regression suite.
 *
 * Exercises the REAL webhook route (POST) and the REAL
 * lib/fulfillment-runtime/confirmation-evidence seam against an in-memory
 * Prisma double. Only the provider boundary (@/lib/email/send receipt fn) and
 * infrastructure (stripe client, db) are mocked, so the production webhook
 * settlement branch and evidence guards are what run.
 */

type Row = Record<string, unknown>

const dbState: {
  stripeEvents: Map<string, Row>
  otOrders: Map<string, Row>
} = {
  stripeEvents: new Map(),
  otOrders: new Map(),
}

const sendNewOrderAlertMock = jest.fn(async (_args?: unknown) => true)
const sendOrderConfirmationMock = jest.fn(async (_args?: unknown) => true)
const sendOrderConfirmationWithReceiptMock = jest.fn(
  async (_args?: unknown): Promise<Row> => ({ ok: true, providerMessageId: "re_msg_1" }),
)
const kickOffT2FulfillmentEvidenceMock = jest.fn(async (_order?: unknown) => ({ outcome: "DISABLED" }))
const fetchMock = jest.fn()
let forceEvidenceWriteFailure = false

;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

const EVIDENCE_FIELDS = [
  "confirmationEmailStatus",
  "confirmationEmailAttemptedAt",
  "confirmationEmailSentAt",
  "confirmationEmailMessageId",
  "confirmationEmailErrorClass",
]

jest.mock("@/lib/db", () => ({
  prisma: {
    stripeEvent: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (dbState.stripeEvents.has(String(data.id))) {
          const err = new Error("unique") as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
        dbState.stripeEvents.set(String(data.id), { ...data })
        return data
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = dbState.stripeEvents.get(where.id)
        dbState.stripeEvents.delete(where.id)
        return row ?? null
      }),
    },
    oTOrder: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; stripeSessionId?: string } }) => {
        if (where.id) {
          return Array.from(dbState.otOrders.values()).find((row) => row.id === where.id) ?? null
        }
        if (where.stripeSessionId) {
          return (
            Array.from(dbState.otOrders.values()).find((row) => row.stripeSessionId === where.stripeSessionId) ?? null
          )
        }
        return null
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const touchesEvidence = Object.keys(data).some((key) => EVIDENCE_FIELDS.includes(key))
        if (forceEvidenceWriteFailure && touchesEvidence) {
          throw new Error("evidence store unavailable")
        }
        const row = Array.from(dbState.otOrders.values()).find((candidate) => {
          return Object.entries(where).every(([key, value]) => {
            if (value === undefined) return true
            if (key === "eligibilitySnapshot" && value && typeof value === "object" && "equals" in value) {
              return JSON.stringify(candidate.eligibilitySnapshot ?? null) === JSON.stringify((value as Row).equals)
            }
            return (candidate[key] ?? null) === value
          })
        })
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: "ord_recovery", ...data }
        dbState.otOrders.set(String(data.stripeSessionId), row)
        return row
      }),
    },
  },
}))

jest.mock("@/lib/free-check-appeal-window", () => ({
  getFreeCheckAppealWindowStatus: jest.fn(() => ({
    township: "Elk Grove",
    status: "closed",
    openDate: "2026-06-22",
    closeDate: "2026-07-20",
    filingUrl: "https://official",
    note: "closed",
  })),
}))

jest.mock("@/lib/appeals/township-deadlines", () => ({
  ASSESSOR_CALENDAR_URL: "https://official",
  TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED: "2026-07-23",
}))

jest.mock("@/lib/packet/generate-and-deliver", () => ({
  generatePacketForInvoice: jest.fn(),
}))

jest.mock("@/lib/email/send", () => ({
  sendNewOrderAlert: (args: unknown) => sendNewOrderAlertMock(args),
  sendOrderConfirmation: (args: unknown) => sendOrderConfirmationMock(args),
  sendOrderConfirmationWithReceipt: (args: unknown) => sendOrderConfirmationWithReceiptMock(args),
}))

jest.mock("@/lib/fulfillment-runtime/kickoff", () => ({
  kickOffT2FulfillmentEvidence: (order: unknown) => kickOffT2FulfillmentEvidenceMock(order),
  t2FulfillmentEvidenceWritesEnabled: () => process.env.OT_T2_FULFILLMENT_EVIDENCE_ENABLED === "true",
}))

const listLineItemsMock = jest.fn()

jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: { constructEvent: jest.fn((body: string) => JSON.parse(body)) },
    checkout: { sessions: { listLineItems: (...args: unknown[]) => listLineItemsMock(...args) } },
    subscriptions: { retrieve: jest.fn(), list: jest.fn(async () => ({ data: [] })), update: jest.fn() },
    customers: { retrieve: jest.fn() },
  },
}))

import { POST } from "@/app/api/billing/webhook/route"

beforeEach(() => {
  jest.clearAllMocks()
  ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
  process.env.VERCEL_ENV = "production"
  ;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  dbState.stripeEvents.clear()
  dbState.otOrders.clear()
  forceEvidenceWriteFailure = false
  delete process.env.OT_T2_FULFILLMENT_EVIDENCE_ENABLED
  process.env.OT_CONFIRMATION_EVIDENCE_ENABLED = "true"
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123"
  process.env.GA4_API_SECRET = "ga4_secret"
  sendOrderConfirmationWithReceiptMock.mockResolvedValue({ ok: true, providerMessageId: "re_msg_1" })
  listLineItemsMock.mockResolvedValue({
    data: [
      {
        quantity: 1,
        amount_total: 9700,
        price: {
          id: "price_t3",
          unit_amount: 9700,
          currency: "usd",
          product: { id: "prod_t3" },
        },
      },
    ],
  })
  fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => "" })
})

afterEach(() => {
  delete process.env.OT_CONFIRMATION_EVIDENCE_ENABLED
})

function request(eventId: string, orderId: string, overrides: { amountTotal?: number } = {}) {
  return new Request("https://www.overtaxed-il.com/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body: JSON.stringify({
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_notice_paid",
          mode: "payment",
          payment_status: "paid",
          currency: "usd",
          amount_total: overrides.amountTotal ?? 9700,
          metadata: { orderId, tier: "T3", windowStatus: "closed" },
          customer_details: { email: "buyer@example.com", name: "Buyer Example" },
        },
      },
    }),
  }) as never
}

function seedOrder(overrides: Row = {}) {
  dbState.otOrders.set("cs_notice_paid", {
    id: "ord_notice",
    checkoutKey: "checkout-key",
    contractKey: "contract-key",
    attempt: 1,
    stripeSessionId: "cs_notice_paid",
    tier: "T3",
    email: "buyer@example.com",
    name: "Buyer Example",
    propertyAddress: "1 TEST ST",
    propertyPin: "09000000000000",
    township: "Elk Grove",
    windowStatus: "closed",
    windowOpenDate: new Date("2026-06-22T12:00:00.000Z"),
    windowCloseDate: new Date("2026-07-20T12:00:00.000Z"),
    windowSourceUpdated: "2026-07-23",
    windowVerifiedAt: new Date("2026-07-23T12:00:00.000Z"),
    eligibilitySnapshot: {
      pin: "09000000000000",
      township: "Elk Grove",
      status: "closed",
      openDate: "2026-06-22",
      closeDate: "2026-07-20",
      sourceUpdated: "2026-07-23",
      sourceUrl: "https://official",
      verifiedAt: "2026-07-23T12:00:00.000Z",
    },
    checkoutSessionExpiresAt: new Date("2026-12-25T12:00:00.000Z"),
    checkoutPriceId: "price_t3",
    checkoutProductId: "prod_t3",
    checkoutAmountCents: 9700,
    checkoutCurrency: "usd",
    status: "CHECKOUT_CREATED",
    noticeReviewStatus: "APPROVED",
    noticeReviewActionAt: new Date("2026-07-24T12:00:00.000Z"),
    noticeReviewActionBy: "admin_1",
    noticeEvidence: { type: "reassessment_notice", date: "2026-07-18", address: "1 TEST ST" },
    reassessmentNoticeDate: new Date("2026-07-18T12:00:00.000Z"),
    reassessmentNoticeAddress: "1 TEST ST",
    amountPaid: 0,
    // Evidence fields start in the "never attempted" state (all null), exactly
    // as the additive nullable migration leaves existing and new rows.
    confirmationEmailStatus: null,
    confirmationEmailAttemptedAt: null,
    confirmationEmailSentAt: null,
    confirmationEmailMessageId: null,
    confirmationEmailErrorClass: null,
    ...overrides,
  })
}

function order(): Row {
  const row = dbState.otOrders.get("cs_notice_paid")
  if (!row) throw new Error("order fixture missing")
  return row
}

describe("webhook confirmation-email delivery evidence (flag on)", () => {
  it("records attempt + success identity durably on the exact newly paid settlement path", async () => {
    seedOrder()

    const response = await POST(request("evt_conf_1", "ord_notice"))

    expect(response.status).toBe(200)
    expect(order().status).toBe("PAID")
    expect(sendOrderConfirmationWithReceiptMock).toHaveBeenCalledTimes(1)
    expect(order().confirmationEmailStatus).toBe("SENT")
    expect(order().confirmationEmailAttemptedAt).toBeInstanceOf(Date)
    expect(order().confirmationEmailSentAt).toBeInstanceOf(Date)
    expect(order().confirmationEmailMessageId).toBe("re_msg_1")
    expect(order().confirmationEmailErrorClass).toBeNull()
    // Legacy boolean sender is not used on the evidence path.
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
  })

  it("records a durable failed attempt without changing paid accounting", async () => {
    seedOrder()
    sendOrderConfirmationWithReceiptMock.mockResolvedValue({ ok: false, errorClass: "PROVIDER_ERROR" })

    const response = await POST(request("evt_conf_2", "ord_notice"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
    expect(order().status).toBe("PAID")
    expect(order().amountPaid).toBe(97)
    expect(order().settledAmountCents).toBe(9700)
    expect(order().confirmationEmailStatus).toBe("FAILED")
    expect(order().confirmationEmailAttemptedAt).toBeInstanceOf(Date)
    expect(order().confirmationEmailSentAt).toBeNull()
    expect(order().confirmationEmailMessageId).toBeNull()
    expect(order().confirmationEmailErrorClass).toBe("PROVIDER_ERROR")
    // Failure is best-effort telemetry: the StripeEvent claim stays in place so
    // Stripe does NOT retry (no duplicate customer notifications).
    expect(dbState.stripeEvents.has("evt_conf_2")).toBe(true)
  })

  it("webhook replay neither resends nor rewrites original paid/success evidence", async () => {
    seedOrder()
    await POST(request("evt_conf_3", "ord_notice"))
    expect(order().confirmationEmailStatus).toBe("SENT")
    const firstSentAt = order().confirmationEmailSentAt

    sendOrderConfirmationWithReceiptMock.mockResolvedValue({ ok: false, errorClass: "PROVIDER_ERROR" })
    const replay = await POST(request("evt_conf_3_replay", "ord_notice"))

    expect(replay.status).toBe(200)
    expect(sendOrderConfirmationWithReceiptMock).toHaveBeenCalledTimes(1)
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
    expect(order().confirmationEmailStatus).toBe("SENT")
    expect(order().confirmationEmailSentAt).toBe(firstSentAt)
    expect(order().confirmationEmailMessageId).toBe("re_msg_1")
  })

  it("a later failure can never overwrite a prior truthful success", async () => {
    seedOrder({
      status: "PAID",
      confirmationEmailStatus: "SENT",
      confirmationEmailAttemptedAt: new Date("2026-08-30T12:00:00.000Z"),
      confirmationEmailSentAt: new Date("2026-08-30T12:00:01.000Z"),
      confirmationEmailMessageId: "re_msg_original",
    })

    // Import the seam directly to prove the guard holds even if a caller
    // reaches it out of order.
    const { recordConfirmationEmailOutcome } = await import("@/lib/fulfillment-runtime/confirmation-evidence")
    await recordConfirmationEmailOutcome("ord_notice", { ok: false, errorClass: "PROVIDER_ERROR" })

    expect(order().confirmationEmailStatus).toBe("SENT")
    expect(order().confirmationEmailMessageId).toBe("re_msg_original")
    expect(order().confirmationEmailErrorClass).toBeNull()
  })

  it("recovery-required settlement sends no normal confirmation and writes no evidence", async () => {
    seedOrder()

    const response = await POST(request("evt_conf_4", "ord_notice", { amountTotal: 12345 }))

    expect(response.status).toBe(200)
    expect(order().status).toBe("PAID_RECOVERY_REQUIRED")
    expect(sendOrderConfirmationWithReceiptMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
    expect(order().confirmationEmailStatus).toBeNull()
    expect(order().confirmationEmailAttemptedAt).toBeNull()
  })

  it("evidence persistence failure is strictly best-effort: ack preserved, one send, no retry storm", async () => {
    seedOrder()
    forceEvidenceWriteFailure = true

    const response = await POST(request("evt_conf_5", "ord_notice"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
    expect(order().status).toBe("PAID")
    expect(sendOrderConfirmationWithReceiptMock).toHaveBeenCalledTimes(1)
    // Claim retained → Stripe will not redeliver → no duplicate notification.
    expect(dbState.stripeEvents.has("evt_conf_5")).toBe(true)
    // Evidence untouched (write failed) but payment truth intact.
    expect(order().confirmationEmailStatus).toBeNull()
  })
})

describe("webhook confirmation-email evidence flag off (default)", () => {
  it("preserves the exact legacy fire-and-forget behavior with no evidence writes", async () => {
    delete process.env.OT_CONFIRMATION_EVIDENCE_ENABLED
    seedOrder()

    const response = await POST(request("evt_conf_6", "ord_notice"))

    expect(response.status).toBe(200)
    expect(order().status).toBe("PAID")
    expect(sendOrderConfirmationMock).toHaveBeenCalledTimes(1)
    expect(sendOrderConfirmationWithReceiptMock).not.toHaveBeenCalled()
    expect(order().confirmationEmailStatus).toBeNull()
    expect(order().confirmationEmailAttemptedAt).toBeNull()
    expect(order().confirmationEmailSentAt).toBeNull()
  })
})
