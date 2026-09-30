/**
 * @jest-environment node
 *
 * Stripe metadata `referralCode` came from a client cookie, so the webhook
 * treats it as untrusted. It may only add conversion evidence to a referral an
 * admin already issued — never create one — and a referral problem must never
 * fail the settlement it rides on. Replay of the same session must not count
 * twice.
 */
type Row = Record<string, unknown>
const users = new Map<string, Row>()
const referrals = new Map<string, { code: string; conversions: number; revenue: number }>()
const stripeEvents = new Map<string, Row>()

type Increment = { increment: number }
const referral = {
  upsert: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(
    async ({ where, data }: { where: { code: string }; data: { conversions: Increment; revenue: Increment } }) => {
      const row = referrals.get(where.code)
      if (!row) return { count: 0 }
      row.conversions += data.conversions.increment
      row.revenue += data.revenue.increment
      return { count: 1 }
    },
  ),
}

jest.mock("@/lib/db", () => ({
  prisma: {
    get referral() {
      return referral
    },
    stripeEvent: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => stripeEvents.get(where.id) ?? null),
      create: jest.fn(async ({ data }: { data: { id: string } }) => {
        if (stripeEvents.has(data.id)) {
          throw Object.assign(new Error("unique constraint"), { code: "P2002" })
        }
        stripeEvents.set(data.id, data)
        return data
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        stripeEvents.delete(where.id)
        return null
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const user = users.get(where.id)
        if (!user) throw new Error("user not found")
        Object.assign(user, data)
        return user
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
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

jest.mock("@/lib/packet/generate-and-deliver", () => ({
  generatePacketForInvoice: jest.fn(async () => ({ ok: true })),
}))

import { POST } from "@/app/api/billing/webhook/route"

function completed(eventId: string, referralCode: unknown, amountTotal = 9900) {
  const body = JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${eventId}`,
        mode: "subscription",
        amount_total: amountTotal,
        metadata: { userId: "user_1", plan: "STARTER", propertyCount: "1", referralCode },
      },
    },
  })
  return POST(
    new Request("https://www.overtaxed-il.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=fake" },
      body,
    }) as never,
  )
}

beforeEach(() => {
  users.clear()
  referrals.clear()
  stripeEvents.clear()
  jest.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  users.set("user_1", { id: "user_1", referralCode: null, subscriptionTier: null })
  referrals.set("john", { code: "john", conversions: 0, revenue: 0 })
})

afterEach(() => {
  expect(referral.upsert).not.toHaveBeenCalled()
  expect(referral.create).not.toHaveBeenCalled()
})

function expectSettled() {
  // The subscription itself is still recorded: referral handling is nonfatal.
  expect(users.get("user_1")?.subscriptionTier).toBe("STARTER")
  expect(stripeEvents.size).toBeGreaterThan(0)
}

describe("webhook referral conversion evidence", () => {
  it("credits an existing canonical referral once", async () => {
    const res = await completed("evt_1", "john")
    expect(res.status).toBe(200)
    expect(referrals.get("john")).toEqual({ code: "john", conversions: 1, revenue: 99 })
    expect(users.get("user_1")?.referralCode).toBe("john")
    expectSettled()
  })

  it("normalizes metadata case before matching", async () => {
    await completed("evt_1", "JOHN")
    expect(referrals.get("john")?.conversions).toBe(1)
    expect(users.get("user_1")?.referralCode).toBe("john")
  })

  it("does not count a replayed event twice", async () => {
    await completed("evt_1", "john")
    await completed("evt_1", "john")
    expect(referrals.get("john")?.conversions).toBe(1)
  })

  it("does not count a second delivery for an already credited user twice", async () => {
    await completed("evt_1", "john")
    await completed("evt_2", "JOHN")
    expect(referrals.get("john")?.conversions).toBe(1)
  })

  it("never creates a referral from forged well-formed metadata", async () => {
    const res = await completed("evt_1", "attacker-code")
    expect(res.status).toBe(200)
    expect(referrals.has("attacker-code")).toBe(false)
    expect(users.get("user_1")?.referralCode).toBeNull()
    expectSettled()
  })

  it.each([
    ["an email", "owner@example.com"],
    ["a name", "John Smith"],
    ["a URL", "https://evil.example"],
    ["a confusable", "jоhn"],
    ["a control character", "john\u0000"],
    ["an oversized value", "a".repeat(500)],
  ])("ignores %s in metadata without touching referrals", async (_label, code) => {
    const res = await completed("evt_1", code)
    expect(res.status).toBe(200)
    expect(referral.updateMany).not.toHaveBeenCalled()
    expect(users.get("user_1")?.referralCode).toBeNull()
    expectSettled()
  })

  it("keeps settlement when referral bookkeeping throws", async () => {
    referral.updateMany.mockRejectedValueOnce(new Error("db down"))
    const res = await completed("evt_1", "john")
    expect(res.status).toBe(200)
    expectSettled()
  })
})
