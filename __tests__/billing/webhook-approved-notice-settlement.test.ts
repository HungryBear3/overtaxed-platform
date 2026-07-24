/** @jest-environment node */

type Row = Record<string, unknown>

const dbState: {
  stripeEvents: Map<string, Row>
  otOrders: Map<string, Row>
  recoveries: Map<string, Row>
} = {
  stripeEvents: new Map(),
  otOrders: new Map(),
  recoveries: new Map(),
}

const sendNewOrderAlertMock = jest.fn(async (_args?: unknown) => true)
const sendOrderConfirmationMock = jest.fn(async (_args?: unknown) => true)
const sendPaidOrderRecoveryAlertMock = jest.fn(async (_args?: unknown) => true)
const sendPaymentRecoveryAcknowledgmentMock = jest.fn(async (_args?: unknown) => true)
const sendBillingPaymentRecoveryAlertMock = jest.fn(async (_args?: unknown) => true)
let forceOtOrderUpdateMiss = false

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
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => dbState.stripeEvents.get(where.id) ?? null),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = dbState.stripeEvents.get(where.id)
        dbState.stripeEvents.delete(where.id)
        return row ?? null
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = dbState.stripeEvents.get(String(where.id))
        if (!row) return { count: 0 }
        if (where.claimToken !== undefined && row.claimToken !== where.claimToken) return { count: 0 }
        dbState.stripeEvents.set(String(where.id), { ...row, ...data })
        return { count: 1 }
      }),
      deleteMany: jest.fn(async ({ where }: { where: { id: string; claimToken: string } }) => {
        const row = dbState.stripeEvents.get(where.id)
        if (!row || row.claimToken !== where.claimToken) return { count: 0 }
        dbState.stripeEvents.delete(where.id)
        return { count: 1 }
      }),
    },
    stripePaymentRecovery: {
      upsert: jest.fn(async ({ where, create }: { where: { providerObjectId: string }; create: Row }) => {
        const row = dbState.recoveries.get(where.providerObjectId) ?? { id: `recovery_${dbState.recoveries.size + 1}`, ...create }
        dbState.recoveries.set(where.providerObjectId, row)
        return row
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    oTOrder: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; stripeSessionId?: string } }) => {
        if (where.id) {
          return Array.from(dbState.otOrders.values()).find((row) => row.id === where.id) ?? null
        }
        if (where.stripeSessionId) {
          return Array.from(dbState.otOrders.values()).find((row) => row.stripeSessionId === where.stripeSessionId) ?? null
        }
        return null
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        if (forceOtOrderUpdateMiss) return { count: 0 }
        const row = Array.from(dbState.otOrders.values()).find((candidate) => {
          return Object.entries(where).every(([key, value]) => {
            if (value === undefined) return true
            if (key === "status" && value && typeof value === "object" && "notIn" in value) {
              return !((value as Row).notIn as unknown[]).includes(candidate.status)
            }
            if (key === "eligibilitySnapshot" && value && typeof value === "object" && "equals" in value) {
              return JSON.stringify(candidate.eligibilitySnapshot ?? null) === JSON.stringify((value as Row).equals)
            }
            return candidate[key] === value
          })
        })
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (Array.from(dbState.otOrders.values()).some((row) => row.stripeSessionId === data.stripeSessionId)) {
          const err = new Error("unique") as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
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
  sendPaidOrderRecoveryAlert: (args: unknown) => sendPaidOrderRecoveryAlertMock(args),
  sendPaymentRecoveryAcknowledgment: (args: unknown) => sendPaymentRecoveryAcknowledgmentMock(args),
  sendBillingPaymentRecoveryAlert: (args: unknown) => sendBillingPaymentRecoveryAlertMock(args),
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
  dbState.stripeEvents.clear()
  dbState.otOrders.clear()
  dbState.recoveries.clear()
  forceOtOrderUpdateMiss = false
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  listLineItemsMock.mockResolvedValue({
    data: [{
      quantity: 1,
      amount_total: 9700,
      price: {
        id: "price_t3",
        unit_amount: 9700,
        currency: "usd",
        product: { id: "prod_t3" },
      },
    }],
  })
})

function request(
  eventId: string,
  orderId: string,
  overrides: { tier?: string; amountTotal?: number; paymentStatus?: string } = {},
) {
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
          payment_status: overrides.paymentStatus ?? "paid",
          currency: "usd",
          amount_total: overrides.amountTotal ?? 9700,
          metadata: { orderId, tier: overrides.tier ?? "T3", windowStatus: "closed" },
          customer_details: {
            email: "buyer@example.com",
            name: "Buyer Example",
          },
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
    checkoutSessionExpiresAt: new Date("2026-07-25T12:00:00.000Z"),
    checkoutPriceId: "price_t3",
    checkoutProductId: "prod_t3",
    checkoutAmountCents: 9700,
    checkoutCurrency: "usd",
    status: "CHECKOUT_CREATED",
    noticeReviewStatus: "APPROVED",
    noticeReviewActionAt: new Date("2026-07-24T12:00:00.000Z"),
    noticeReviewActionBy: "admin_1",
    noticeEvidence: {
      type: "reassessment_notice",
      date: "2026-07-18",
      address: "1 TEST ST",
    },
    reassessmentNoticeDate: new Date("2026-07-18T12:00:00.000Z"),
    reassessmentNoticeAddress: "1 TEST ST",
    ...overrides,
  })
}

describe("billing webhook approved notice settlement", () => {
  it("settles an exact approved notice order without current-window revalidation", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-24T15:00:00.000Z"))
    seedOrder()

    const response = await POST(request("evt_notice_paid", "ord_notice"))

    expect(response.status).toBe(200)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({ status: "PAID", settledAmountCents: 9700, settledCurrency: "usd" })
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
    expect(sendOrderConfirmationMock).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  it("sends the order to recovery when durable approval evidence is missing or tampered", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-24T15:00:00.000Z"))
    seedOrder({ noticeReviewStatus: null, noticeReviewActionAt: null })

    const response = await POST(request("evt_notice_tampered", "ord_notice"))

    expect(response.status).toBe(200)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({ status: "PAID_RECOVERY_REQUIRED" })
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it("still revalidates ordinary T3 settlements against the current window", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-24T15:00:00.000Z"))
    seedOrder({
      noticeReviewStatus: null,
      noticeReviewActionAt: null,
      noticeReviewActionBy: null,
      noticeEvidence: null,
      reassessmentNoticeDate: null,
      reassessmentNoticeAddress: null,
    })

    const response = await POST(request("evt_t3_closed", "ord_notice"))

    expect(response.status).toBe(200)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({ status: "PAID_RECOVERY_REQUIRED" })
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it("requires exact durable acknowledgment evidence before settling T2", async () => {
    seedOrder({
      tier: "T2",
      analysisAcknowledgedAt: new Date("2026-07-24T12:00:00.000Z"),
      acknowledgmentVersion: "analysis_ack_v1",
      acknowledgmentEvidence: { acknowledged: true, version: "analysis_ack_v1" },
      noticeReviewStatus: null,
      noticeReviewActionAt: null,
      noticeReviewActionBy: null,
      noticeEvidence: null,
      reassessmentNoticeDate: null,
      reassessmentNoticeAddress: null,
    })

    const response = await POST(request("evt_t2_paid", "ord_notice", { tier: "T2" }))
    expect(response.status).toBe(200)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({ status: "PAID" })
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
  })

  it("holds a paid T2 checkout when acknowledgment evidence is missing", async () => {
    seedOrder({
      tier: "T2",
      analysisAcknowledgedAt: null,
      acknowledgmentVersion: null,
      acknowledgmentEvidence: null,
      noticeEvidence: null,
    })

    const response = await POST(request("evt_t2_missing_ack", "ord_notice", { tier: "T2" }))
    expect(response.status).toBe(200)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({ status: "PAID_RECOVERY_REQUIRED" })
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
  })

  it("holds settled money when amount differs from the durable contract", async () => {
    seedOrder()
    const response = await POST(request("evt_amount_mismatch", "ord_notice", { amountTotal: 9800 }))
    expect(response.status).toBe(200)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({
      status: "PAID_RECOVERY_REQUIRED",
      settledAmountCents: 9800,
    })
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
  })

  it("does not resurrect a cancelled order when money settles late", async () => {
    seedOrder({ status: "CANCELLED" })
    const response = await POST(request("evt_cancelled_paid", "ord_notice"))
    expect(response.status).toBe(200)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({
      status: "CANCELLED",
      settledAmountCents: 9700,
    })
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
  })

  it("durably records the incoming paid session when it differs from the bound session", async () => {
    seedOrder({ stripeSessionId: "cs_original" })
    const response = await POST(request("evt_binding_mismatch", "ord_notice"))

    expect(response.status).toBe(200)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({
      stripeSessionId: "cs_original",
      status: "PAID_RECOVERY_REQUIRED",
      recoveryStripeSessionId: "cs_notice_paid",
      recoveryStripeEventId: "evt_binding_mismatch",
      recoveryReason: "DURABLE_CONTRACT_MISMATCH",
    })
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
  })

  it("returns 500 and releases the event claim when recovery CAS loses", async () => {
    seedOrder({ stripeSessionId: "cs_original" })
    forceOtOrderUpdateMiss = true
    const response = await POST(request("evt_recovery_cas_miss", "ord_notice"))

    expect(response.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_recovery_cas_miss")).toBe(false)
    expect(dbState.otOrders.get("cs_notice_paid")).toMatchObject({
      stripeSessionId: "cs_original",
      status: "CHECKOUT_CREATED",
    })
  })
})

export {}
