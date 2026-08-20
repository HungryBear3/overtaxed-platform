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
const kickOffT2FulfillmentEvidenceMock = jest.fn(async (_order?: unknown) => ({ outcome: "DISABLED" }))
const fetchMock = jest.fn()
let forceOtOrderUpdateMiss = false
let forceStripeEventDeleteFailure = false

;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

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
        if (forceStripeEventDeleteFailure) throw new Error("claim release unavailable")
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

jest.mock("@/lib/fulfillment-runtime/kickoff", () => ({
  kickOffT2FulfillmentEvidence: (order: unknown) => kickOffT2FulfillmentEvidenceMock(order),
  t2FulfillmentEvidenceWritesEnabled: () =>
    process.env.OT_T2_FULFILLMENT_EVIDENCE_ENABLED === "true",
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
  dbState.recoveries.clear()
  forceOtOrderUpdateMiss = false
  forceStripeEventDeleteFailure = false
  delete process.env.OT_T2_FULFILLMENT_EVIDENCE_ENABLED
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123"
  process.env.GA4_API_SECRET = "ga4_secret"
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
  fetchMock.mockResolvedValue({
    ok: true,
    status: 204,
    text: async () => "",
  })
})

afterEach(() => {
  jest.useRealTimers()
})

function request(
  eventId: string,
  orderId: string,
  overrides: {
    tier?: string
    amountTotal?: number
    paymentStatus?: string
    metadata?: Record<string, string>
  } = {},
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
          metadata: {
            orderId,
            tier: overrides.tier ?? "T3",
            windowStatus: "closed",
            gaClientId: "1234567890.1234567890",
            gaSessionId: "1724102400",
            gaSessionNumber: "3",
            ...overrides.metadata,
          },
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
    checkoutSessionExpiresAt: new Date("2026-12-25T12:00:00.000Z"),
    checkoutPriceId: "price_t3",
    checkoutProductId: "prod_t3",
    checkoutAmountCents: 9700,
    checkoutCurrency: "usd",
    gaClientId: "1234567890.1234567890",
    gaSessionId: "1724102400",
    gaSessionNumber: "3",
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
  it("emits one deterministic trusted purchase payload after verified paid settlement", async () => {
    seedOrder()

    const response = await POST(request("evt_paid_1", "ord_notice"))

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("/mp/collect?measurement_id=G-TEST123&api_secret=ga4_secret")
    const payload = JSON.parse(String(init.body))
    expect(payload).toEqual({
      client_id: "1234567890.1234567890",
      events: [{
        name: "purchase",
        params: {
          currency: "usd",
          value: 97,
          transaction_id: "cs_notice_paid",
          item_name: "T3",
          item_category: "ot_checkout",
          item_variant: "T3",
          price: 97,
          quantity: 1,
          ga_session_id: 1724102400,
          ga_session_number: 3,
          items: [{
            item_name: "T3",
            item_category: "ot_checkout",
            item_variant: "T3",
            price: 97,
            quantity: 1,
          }],
        },
      }],
    })
    expect(JSON.stringify(payload)).not.toContain("buyer@example.com")
    expect(JSON.stringify(payload)).not.toContain("Buyer Example")
    expect(JSON.stringify(payload)).not.toContain("1 TEST ST")
    expect(JSON.stringify(payload)).not.toContain("09000000000000")
  })

  it("uses verified checkout session metadata as the attribution source when the durable order has no GA identifiers", async () => {
    seedOrder({
      gaClientId: null,
      gaSessionId: null,
      gaSessionNumber: null,
    })

    const response = await POST(new Request("https://www.overtaxed-il.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=fake" },
      body: JSON.stringify({
        id: "evt_paid_metadata_ids",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_notice_paid",
            mode: "payment",
            payment_status: "paid",
            currency: "usd",
            amount_total: 9700,
            metadata: {
              orderId: "ord_notice",
              tier: "T3",
              windowStatus: "closed",
              gaClientId: "9876543210.1724102400",
              gaSessionId: "1724102400",
              gaSessionNumber: "7",
            },
            customer_details: {
              email: "buyer@example.com",
              name: "Buyer Example",
            },
          },
        },
      }),
    }) as never)

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      client_id: "9876543210.1724102400",
      events: [{
        name: "purchase",
        params: {
          currency: "usd",
          value: 97,
          transaction_id: "cs_notice_paid",
          item_name: "T3",
          item_category: "ot_checkout",
          item_variant: "T3",
          price: 97,
          quantity: 1,
          ga_session_id: 1724102400,
          ga_session_number: 7,
          items: [{
            item_name: "T3",
            item_category: "ot_checkout",
            item_variant: "T3",
            price: 97,
            quantity: 1,
          }],
        },
      }],
    })
  })

  it("uses the same transaction id on webhook replay", async () => {
    seedOrder({ status: "PAID" })

    const response = await POST(request("evt_paid_2", "ord_notice"))

    expect(response.status).toBe(200)
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(payload.events[0].params.transaction_id).toBe("cs_notice_paid")
  })

  it("fails safe and redacts secrets when Measurement Protocol delivery fails", async () => {
    seedOrder()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "upstream failure",
    })

    const response = await POST(request("evt_paid_3", "ord_notice"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
  })

  it("continues T2 fulfillment and returns 2xx when GA times out", async () => {
    jest.useFakeTimers()
    seedOrder({
      tier: "T2",
      checkoutPriceId: "price_t2",
      checkoutProductId: "prod_t2",
      analysisAcknowledgedAt: new Date("2026-07-24T12:00:00.000Z"),
      acknowledgmentVersion: "analysis_ack_v1",
      acknowledgmentEvidence: {
        acknowledged: true,
        version: "analysis_ack_v1",
      },
    })
    listLineItemsMock.mockResolvedValueOnce({
      data: [{
        quantity: 1,
        amount_total: 9700,
        price: {
          id: "price_t2",
          unit_amount: 9700,
          currency: "usd",
          product: { id: "prod_t2" },
        },
      }],
    })
    fetchMock.mockImplementationOnce((_input?: unknown, init?: RequestInit) => new Promise((_, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      signal?.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("timeout ga4_secret buyer@example.com"), { name: "AbortError" })),
        { once: true },
      )
    }))

    let response: Response | undefined
    const responsePromise = POST(request("evt_paid_timeout", "ord_notice", { tier: "T2" })).then((value) => {
      response = value
      return value
    })

    await jest.advanceTimersByTimeAsync(2000)
    await Promise.resolve()

    expect(response?.status).toBe(200)
    expect(kickOffT2FulfillmentEvidenceMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "ord_notice",
      tier: "T2",
      status: "PAID",
    }))
    await expect(responsePromise).resolves.toBeDefined()
    jest.useRealTimers()
  })

  it("emits no purchase for unpaid or recovery settlement paths", async () => {
    seedOrder({ checkoutAmountCents: 9700 })

    const unpaidResponse = await POST(request("evt_unpaid", "ord_notice", { paymentStatus: "unpaid" }))
    expect(unpaidResponse.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockClear()
    const mismatchResponse = await POST(request("evt_mismatch", "ord_notice", { amountTotal: 9800 }))
    expect(mismatchResponse.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
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
    expect(kickOffT2FulfillmentEvidenceMock).toHaveBeenCalledTimes(1)
    expect(kickOffT2FulfillmentEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ord_notice", tier: "T2", status: "PAID" }),
    )
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
  })

  it("reaches evidence persistence on a paid retry before the already-paid early return", async () => {
    seedOrder({
      tier: "T2",
      status: "PAID",
      settledAmountCents: 9700,
      settledCurrency: "usd",
      amountPaid: 97,
      analysisAcknowledgedAt: new Date("2026-07-24T12:00:00.000Z"),
      acknowledgmentVersion: "analysis_ack_v1",
      acknowledgmentEvidence: { acknowledged: true, version: "analysis_ack_v1" },
      noticeReviewStatus: null,
      noticeReviewActionAt: null,
      noticeReviewActionBy: null,
      noticeEvidence: null,
    })

    const response = await POST(request("evt_t2_paid_retry", "ord_notice", { tier: "T2" }))

    expect(response.status).toBe(200)
    expect(kickOffT2FulfillmentEvidenceMock).toHaveBeenCalledTimes(1)
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
  })

  it("retries evidence persistence without losing or duplicating paid-order emails", async () => {
    seedOrder({
      tier: "T2",
      analysisAcknowledgedAt: new Date("2026-07-24T12:00:00.000Z"),
      acknowledgmentVersion: "analysis_ack_v1",
      acknowledgmentEvidence: { acknowledged: true, version: "analysis_ack_v1" },
      noticeReviewStatus: null,
      noticeReviewActionAt: null,
      noticeReviewActionBy: null,
      noticeEvidence: null,
    })
    kickOffT2FulfillmentEvidenceMock.mockRejectedValueOnce(new Error("evidence persistence unavailable"))

    const first = await POST(request("evt_t2_evidence_failure", "ord_notice", { tier: "T2" }))

    expect(first.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_t2_evidence_failure")).toBe(false)
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
    expect(sendOrderConfirmationMock).toHaveBeenCalledTimes(1)

    const retry = await POST(request("evt_t2_evidence_failure", "ord_notice", { tier: "T2" }))

    expect(retry.status).toBe(200)
    expect(dbState.stripeEvents.has("evt_t2_evidence_failure")).toBe(true)
    expect(kickOffT2FulfillmentEvidenceMock).toHaveBeenCalledTimes(2)
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
    expect(sendOrderConfirmationMock).toHaveBeenCalledTimes(1)
  })

  it("retries enabled T2 evidence when a failed claim release leaves the event row", async () => {
    process.env.OT_T2_FULFILLMENT_EVIDENCE_ENABLED = "true"
    seedOrder({
      tier: "T2",
      analysisAcknowledgedAt: new Date("2026-07-24T12:00:00.000Z"),
      acknowledgmentVersion: "analysis_ack_v1",
      acknowledgmentEvidence: { acknowledged: true, version: "analysis_ack_v1" },
      noticeReviewStatus: null,
      noticeReviewActionAt: null,
      noticeReviewActionBy: null,
      noticeEvidence: null,
    })
    kickOffT2FulfillmentEvidenceMock.mockRejectedValueOnce(new Error("evidence persistence unavailable"))
    forceStripeEventDeleteFailure = true

    const first = await POST(request("evt_t2_stale_claim", "ord_notice", { tier: "T2" }))

    expect(first.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_t2_stale_claim")).toBe(true)
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
    expect(sendOrderConfirmationMock).toHaveBeenCalledTimes(1)

    forceStripeEventDeleteFailure = false
    const retry = await POST(request("evt_t2_stale_claim", "ord_notice", { tier: "T2" }))

    expect(retry.status).toBe(200)
    expect(kickOffT2FulfillmentEvidenceMock).toHaveBeenCalledTimes(2)
    expect(sendNewOrderAlertMock).toHaveBeenCalledTimes(1)
    expect(sendOrderConfirmationMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { flag: undefined, tier: "T2" },
    { flag: "true", tier: "T3" },
  ])("keeps ordinary duplicate skipping for flag=$flag tier=$tier", async ({ flag, tier }) => {
    if (flag) process.env.OT_T2_FULFILLMENT_EVIDENCE_ENABLED = flag
    seedOrder({ tier, status: "PAID" })
    dbState.stripeEvents.set("evt_ordinary_duplicate", {
      id: "evt_ordinary_duplicate",
      type: "checkout.session.completed",
    })

    const response = await POST(request("evt_ordinary_duplicate", "ord_notice", { tier }))

    expect(response.status).toBe(200)
    expect(kickOffT2FulfillmentEvidenceMock).not.toHaveBeenCalled()
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
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
