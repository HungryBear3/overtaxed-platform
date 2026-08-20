/** @jest-environment node */

type Row = Record<string, unknown>

const fetchMock = jest.fn()
type SubscriptionListResult = {
  data: Array<{ items: { data: Array<{ quantity: number }> } }>
}
const listMock = jest.fn(async (_args?: { status?: string }): Promise<SubscriptionListResult> => ({ data: [] }))
const retrieveMock = jest.fn()
const updateMock = jest.fn()

const dbState: {
  stripeEvents: Map<string, Row>
  users: Map<string, Row>
  invoices: Map<string, Row>
} = {
  stripeEvents: new Map(),
  users: new Map(),
  invoices: new Map(),
}

;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

jest.mock("@/lib/packet/generate-and-deliver", () => ({
  generatePacketForInvoice: jest.fn(),
}))

jest.mock("@/lib/email/send", () => ({
  sendNewOrderAlert: jest.fn(async () => true),
  sendOrderConfirmation: jest.fn(async () => true),
}))

jest.mock("@/lib/fulfillment-runtime/kickoff", () => ({
  kickOffT2FulfillmentEvidence: jest.fn(async () => ({ outcome: "DISABLED" })),
  t2FulfillmentEvidenceWritesEnabled: () => false,
}))

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
    user: {
      findUnique: jest.fn(async ({ where, select }: { where: { id?: string; email?: string }; select?: Row }) => {
        const row = where.id
          ? dbState.users.get(where.id) ?? null
          : Array.from(dbState.users.values()).find((user) => user.email === where.email) ?? null
        if (!row || !select) return row
        return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
      }),
      findFirst: jest.fn(async ({ where }: { where: { stripeSubscriptionId?: string } }) => {
        return Array.from(dbState.users.values()).find((user) => user.stripeSubscriptionId === where.stripeSubscriptionId) ?? null
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const current = dbState.users.get(where.id)
        if (!current) throw new Error(`missing user ${where.id}`)
        const next = { ...current, ...data }
        dbState.users.set(where.id, next)
        return next
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { email: string }; data: Row }) => {
        let count = 0
        for (const [id, row] of dbState.users.entries()) {
          if (row.email === where.email) {
            dbState.users.set(id, { ...row, ...data })
            count += 1
          }
        }
        return { count }
      }),
    },
    invoice: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const current = dbState.invoices.get(where.id)
        if (!current) throw new Error(`missing invoice ${where.id}`)
        const next = { ...current, ...data }
        dbState.invoices.set(where.id, next)
        return next
      }),
    },
    oTOrder: {
      findUnique: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(),
    },
    referral: {
      upsert: jest.fn(),
    },
  },
}))

jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: { constructEvent: jest.fn((body: string) => JSON.parse(body)) },
    checkout: { sessions: { listLineItems: jest.fn() } },
    subscriptions: {
      retrieve: (...args: unknown[]) => retrieveMock(...args),
      list: (args?: { status?: string }) => listMock(args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    customers: {
      retrieve: jest.fn(async (customerId: string) => ({
        id: customerId,
        email: "owner@example.com",
      })),
    },
  },
}))

import { POST } from "@/app/api/billing/webhook/route"

function request(object: Record<string, unknown>) {
  return new Request("https://www.overtaxed-il.com/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body: JSON.stringify({
      id: object.eventId ?? "evt_default",
      type: "checkout.session.completed",
      data: {
        object: {
          id: object.sessionId ?? "cs_test_purchase",
          mode: object.mode ?? "subscription",
          amount_total: object.amountTotal ?? 14900,
          currency: object.currency ?? "usd",
          payment_status: object.paymentStatus ?? "paid",
          customer: object.customer ?? "cus_123",
          subscription: object.subscription ?? "sub_123",
          metadata: object.metadata ?? {},
        },
      },
    }),
  }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(global as typeof globalThis & { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  dbState.stripeEvents.clear()
  dbState.users.clear()
  dbState.invoices.clear()
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123"
  process.env.GA4_API_SECRET = "ga4_secret"
  dbState.users.set("user_1", {
    id: "user_1",
    email: "owner@example.com",
    subscriptionTier: "STARTER",
    subscriptionStatus: "INACTIVE",
    subscriptionQuantity: 1,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    referralCode: null,
  })
  dbState.invoices.set("inv_1", {
    id: "inv_1",
    status: "PENDING",
    paidAt: null,
    paymentMethod: null,
    invoiceType: "PERFORMANCE_FEE",
    amount: 264,
    invoiceNumber: "INV-001",
    userId: "user_1",
  })
  retrieveMock.mockResolvedValue({
    items: { data: [{ id: "si_123", quantity: 3 }] },
  })
  listMock.mockImplementation(async (args?: { status?: string }) => (
    args?.status === "active"
      ? { data: [{ items: { data: [{ quantity: 3 }] } }] }
      : { data: [] }
  ))
  fetchMock.mockResolvedValue({
    ok: true,
    status: 204,
    text: async () => "",
  })
})

describe("legacy billing webhook branches do not emit GA purchases", () => {
  it("does not emit a purchase from the subscription branch after durable subscription update", async () => {
    const response = await POST(request({
      eventId: "evt_subscription_paid",
      sessionId: "cs_subscription_paid",
      mode: "subscription",
      amountTotal: 14900,
      metadata: {
        userId: "user_1",
        plan: "GROWTH",
        propertyCount: "3",
        gaClientId: "1234567890.1234567890",
        gaSessionId: "1724102400",
        gaSessionNumber: "4",
      },
    }))

    expect(response.status).toBe(200)
    expect(dbState.users.get("user_1")).toMatchObject({
      subscriptionTier: "GROWTH",
      subscriptionStatus: "ACTIVE",
      subscriptionQuantity: 3,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbState.stripeEvents.has("evt_subscription_paid")).toBe(true)
  })

  it("does not emit purchases from add-slots, including unpaid sessions", async () => {
    const paid = await POST(request({
      eventId: "evt_slots_paid",
      sessionId: "cs_slots_paid",
      mode: "payment",
      amountTotal: 19800,
      metadata: {
        userId: "user_1",
        plan: "GROWTH",
        addSlots: "true",
        subscriptionId: "sub_123",
        newQuantity: "5",
        propertyCount: "5",
        gaClientId: "1234567890.1234567890",
        gaSessionId: "1724102400",
        gaSessionNumber: "4",
      },
    }))

    expect(paid.status).toBe(200)
    expect(dbState.users.get("user_1")).toMatchObject({
      subscriptionQuantity: 5,
    })
    expect(fetchMock).not.toHaveBeenCalled()

    const unpaid = await POST(request({
      eventId: "evt_slots_unpaid",
      sessionId: "cs_slots_unpaid",
      mode: "payment",
      paymentStatus: "unpaid",
      amountTotal: 19800,
      metadata: {
        userId: "user_1",
        plan: "GROWTH",
        addSlots: "true",
        subscriptionId: "sub_123",
        newQuantity: "7",
        propertyCount: "7",
        gaClientId: "1234567890.1234567890",
      },
    }))

    expect(unpaid.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not emit a purchase from the pay-invoice branch after invoice settlement", async () => {
    const response = await POST(request({
      eventId: "evt_invoice_paid",
      sessionId: "cs_invoice_paid",
      mode: "payment",
      amountTotal: 26400,
      metadata: {
        invoiceId: "inv_1",
        userId: "user_1",
        invoiceNumber: "INV-001",
        gaClientId: "1234567890.1234567890",
        gaSessionId: "1724102400",
        gaSessionNumber: "4",
      },
    }))

    expect(response.status).toBe(200)
    expect(dbState.invoices.get("inv_1")).toMatchObject({
      status: "PAID",
      paymentMethod: "credit_card",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
