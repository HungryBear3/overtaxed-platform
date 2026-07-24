/**
 * @jest-environment node
 *
 * Webhook retry-integrity hardening:
 *   - any failure of the REQUIRED writes in the invoiceId branch must release
 *     the StripeEvent claim and return 500
 *   - duplicate concurrent deliveries still short-circuit safely (P2002 path)
 *   - releaseEventClaim is idempotent (no double-release behavior)
 *   - happy path still 200s and keeps the claim in place
 */

type Row = Record<string, unknown>
const dbState: {
  invoices: Map<string, Row>
  users: Map<string, Row>
  stripeEvents: Map<string, Row>
  otOrders: Map<string, Row>
} = { invoices: new Map(), users: new Map(), stripeEvents: new Map(), otOrders: new Map() }

// Toggleable failure injection — set per test before invoking the route.
const failures: { invoiceUpdate?: Error; userUpdate?: Error; otOrderUpsert?: Error } = {}

jest.mock("@/lib/db", () => ({
  prisma: {
    stripeEvent: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        dbState.stripeEvents.get(where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: { id: string; type: string } }) => {
        if (dbState.stripeEvents.has(data.id)) {
          const err = new Error("unique constraint") as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
        dbState.stripeEvents.set(data.id, data)
        return data
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        dbState.stripeEvents.delete(where.id)
        return null
      }),
    },
    invoice: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        if (failures.invoiceUpdate) throw failures.invoiceUpdate
        const inv = dbState.invoices.get(where.id)
        if (!inv) {
          const err = new Error("not found") as Error & { code?: string }
          err.code = "P2025"
          throw err
        }
        Object.assign(inv, data)
        return inv
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        dbState.users.get(where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        if (failures.userUpdate) throw failures.userUpdate
        const u = dbState.users.get(where.id)
        if (!u) throw new Error("user not found")
        Object.assign(u, data)
        return u
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    referral: { upsert: jest.fn(async () => ({})) },
    oTOrder: {
      upsert: jest.fn(async ({ where, update, create }: { where: { stripeSessionId: string }; update: Row; create: Row }) => {
        if (failures.otOrderUpsert) throw failures.otOrderUpsert
        const existing = dbState.otOrders.get(where.stripeSessionId)
        const row = existing ? { ...existing, ...update } : create
        dbState.otOrders.set(where.stripeSessionId, row)
        return row
      }),
    },
  },
}))

jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: { constructEvent: jest.fn((body: string) => JSON.parse(body)) },
    subscriptions: { retrieve: jest.fn(), list: jest.fn(async () => ({ data: [] })), update: jest.fn() },
    customers: { retrieve: jest.fn() },
  },
}))

const generatePacketMock = jest.fn(async (_invoiceId?: string) => ({ ok: true, status: "DELIVERED", pdfUrl: "x" }))
jest.mock("@/lib/packet/generate-and-deliver", () => ({
  generatePacketForInvoice: (invoiceId: string) => generatePacketMock(invoiceId),
}))

const sendNewOrderAlertMock = jest.fn(async (_args?: unknown) => true)
const sendOrderConfirmationMock = jest.fn(async (_args?: unknown) => true)
jest.mock("@/lib/email/send", () => ({
  sendNewOrderAlert: (args: unknown) => sendNewOrderAlertMock(args),
  sendOrderConfirmation: (args: unknown) => sendOrderConfirmationMock(args),
}))

import { POST } from "@/app/api/billing/webhook/route"

beforeEach(() => {
  dbState.invoices.clear()
  dbState.users.clear()
  dbState.stripeEvents.clear()
  dbState.otOrders.clear()
  failures.invoiceUpdate = undefined
  failures.userUpdate = undefined
  failures.otOrderUpsert = undefined
  generatePacketMock.mockClear()
  sendNewOrderAlertMock.mockClear()
  sendOrderConfirmationMock.mockClear()
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
})

function makeRequest(eventId: string, invoiceId: string) {
  const body = JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "payment",
        metadata: { invoiceId },
        customer: "cus_xyz",
      },
    },
  })
  return new Request("http://test/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body,
  }) as unknown as import("next/server").NextRequest
}

function makeTierRequest(eventId: string, sessionId = "cs_test_ot_order") {
  const body = JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        mode: "payment",
        payment_status: "paid",
        currency: "usd",
        amount_total: 6900,
        metadata: {
          tier: "T2",
          propertyPin: "12-34-567-890-0000",
          customerAddress: "123 Test Ave, Chicago IL",
        },
        customer_details: {
          email: "buyer@example.com",
          name: "Buyer Example",
        },
      },
    },
  })
  return new Request("http://test/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body,
  }) as unknown as import("next/server").NextRequest
}

function seedUserAndInvoice(tier: string | null, invoiceId = "inv_retry_test") {
  dbState.users.set("user_1", {
    id: "user_1",
    subscriptionTier: tier,
    stripeCustomerId: null,
  })
  dbState.invoices.set(invoiceId, {
    id: invoiceId,
    userId: "user_1",
    invoiceType: "COMPS_ONLY",
    status: "PENDING",
  })
}

// ── Required-write failure → 500 + claim released ───────────────────────────

describe("invoiceId branch retry integrity", () => {
  it("returns 500 and releases the StripeEvent claim when invoice.update fails", async () => {
    seedUserAndInvoice(null)
    failures.invoiceUpdate = new Error("DB connection lost")
    const res = await POST(makeRequest("evt_inv_fail", "inv_retry_test"))
    expect(res.status).toBe(500)
    // Claim was released so Stripe will retry.
    expect(dbState.stripeEvents.has("evt_inv_fail")).toBe(false)
    // Packet generation was NOT triggered.
    expect(generatePacketMock).not.toHaveBeenCalled()
  })

  it("returns 500 and releases the claim when user.update fails (COMPS_ONLY tier patch)", async () => {
    seedUserAndInvoice(null)
    failures.userUpdate = new Error("DB connection lost")
    const res = await POST(makeRequest("evt_user_fail", "inv_retry_test"))
    expect(res.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_user_fail")).toBe(false)
    expect(generatePacketMock).not.toHaveBeenCalled()
  })

  it("returns 500 and releases the claim when stripeCustomerId backfill fails on a stronger plan", async () => {
    seedUserAndInvoice("STARTER") // hasStrongerPlan=true; backfill path runs
    failures.userUpdate = new Error("DB connection lost")
    const res = await POST(makeRequest("evt_starter_fail", "inv_retry_test"))
    expect(res.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_starter_fail")).toBe(false)
    expect(generatePacketMock).not.toHaveBeenCalled()
  })

  it("happy path: 200 + claim retained + packet trigger fires", async () => {
    seedUserAndInvoice(null)
    const res = await POST(makeRequest("evt_ok", "inv_retry_test"))
    expect(res.status).toBe(200)
    expect(dbState.stripeEvents.has("evt_ok")).toBe(true)
    expect(generatePacketMock).toHaveBeenCalledTimes(1)
  })

  it("happy path with stronger plan: tier preserved, no packet downgrade, claim retained", async () => {
    seedUserAndInvoice("STARTER")
    const res = await POST(makeRequest("evt_starter_ok", "inv_retry_test"))
    expect(res.status).toBe(200)
    expect(dbState.users.get("user_1")?.subscriptionTier).toBe("STARTER")
    expect(dbState.stripeEvents.has("evt_starter_ok")).toBe(true)
    expect(generatePacketMock).toHaveBeenCalledTimes(1)
  })
})

describe("Duplicate / concurrent webhook delivery", () => {
  it("second delivery of the same event short-circuits with 200 and does not re-run business writes", async () => {
    seedUserAndInvoice(null)
    const r1 = await POST(makeRequest("evt_dup", "inv_retry_test"))
    expect(r1.status).toBe(200)
    expect(generatePacketMock).toHaveBeenCalledTimes(1)

    // Second delivery: P2002 on the create → the route returns received:true without
    // running any business writes again.
    const r2 = await POST(makeRequest("evt_dup", "inv_retry_test"))
    expect(r2.status).toBe(200)
    expect(generatePacketMock).toHaveBeenCalledTimes(1) // still only once
  })

  it("after a failed delivery (claim released), a retried delivery can succeed without double-release", async () => {
    seedUserAndInvoice(null)
    failures.invoiceUpdate = new Error("transient DB error")
    const r1 = await POST(makeRequest("evt_retry", "inv_retry_test"))
    expect(r1.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_retry")).toBe(false)

    // Retry: failure cleared, business writes succeed, claim is reinstated.
    failures.invoiceUpdate = undefined
    const r2 = await POST(makeRequest("evt_retry", "inv_retry_test"))
    expect(r2.status).toBe(200)
    expect(dbState.stripeEvents.has("evt_retry")).toBe(true)
    expect(generatePacketMock).toHaveBeenCalledTimes(1)
  })
})

describe("anonymous OT tier orders", () => {
  it("holds a legacy paid session without a durable orderId and suppresses fulfillment", async () => {
    const res = await POST(makeTierRequest("evt_tier_ok", "cs_test_order_1"))
    expect(res.status).toBe(200)
    expect(dbState.stripeEvents.has("evt_tier_ok")).toBe(true)
    expect(dbState.otOrders.get("cs_test_order_1")).toMatchObject({
      stripeSessionId: "cs_test_order_1",
      tier: "T2",
      email: "buyer@example.com",
      name: "Buyer Example",
      amountPaid: 69,
      status: "PAID_RECOVERY_REQUIRED",
      recoveryReason: "MISSING_PRECREATED_ORDER_ID",
    })
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
  })

  it("returns 500 and releases the StripeEvent claim when recovery persistence fails", async () => {
    failures.otOrderUpsert = new Error("DB connection lost")
    const res = await POST(makeTierRequest("evt_tier_fail", "cs_test_order_fail"))
    expect(res.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_tier_fail")).toBe(false)
    expect(sendNewOrderAlertMock).not.toHaveBeenCalled()
    expect(sendOrderConfirmationMock).not.toHaveBeenCalled()
  })
})

describe("releaseEventClaim is idempotent (no double-release misbehavior)",  () => {
  it("two failures back-to-back on the same event do not throw", async () => {
    seedUserAndInvoice(null)
    failures.invoiceUpdate = new Error("DB down")
    const r1 = await POST(makeRequest("evt_x", "inv_retry_test"))
    expect(r1.status).toBe(500)
    // Re-deliver the same event — same failure — must still cleanly 500.
    const r2 = await POST(makeRequest("evt_x", "inv_retry_test"))
    expect(r2.status).toBe(500)
    expect(dbState.stripeEvents.has("evt_x")).toBe(false)
  })
})
