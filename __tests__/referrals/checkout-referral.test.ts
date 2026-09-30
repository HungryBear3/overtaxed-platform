/** @jest-environment node */

/**
 * The `ot_ref` cookie is client-controlled. Subscription checkout may forward a
 * referral code into Stripe metadata only when the cookie normalizes to a
 * canonical code that an admin already issued; anything else is dropped. The
 * lookup is read-only and never blocks the checkout.
 */
const createMock = jest.fn()
jest.mock("@/lib/auth/session", () => ({
  getSession: jest.fn(async () => ({ user: { id: "user_1", email: "owner@example.com" } })),
}))

const referral = {
  upsert: jest.fn(),
  create: jest.fn(),
  findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
    where.code === "john" ? { code: "john" } : null,
  ),
}
jest.mock("@/lib/db", () => ({
  prisma: {
    get referral() {
      return referral
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: "user_1",
        email: "owner@example.com",
        subscriptionTier: null,
        subscriptionStatus: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionQuantity: 0,
      })),
      update: jest.fn(),
    },
    property: { count: jest.fn(async () => 1) },
  },
}))

jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    checkout: { sessions: { create: (...args: unknown[]) => createMock(...args) } },
    customers: { retrieve: jest.fn() },
    subscriptions: { retrieve: jest.fn() },
  },
  PRICE_IDS: {
    STARTER: "price_starter",
    GROWTH_PER_PROPERTY: "price_growth",
    PORTFOLIO_PER_PROPERTY: "price_portfolio",
  },
}))

import { POST } from "@/app/api/billing/checkout/route"

async function checkoutWithCookie(cookie: string | undefined) {
  const request = new Request("https://www.overtaxed-il.com/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: "STARTER", propertyCount: 1 }),
  })
  Object.defineProperty(request, "cookies", {
    value: { get: jest.fn((name: string) => (name === "ot_ref" && cookie !== undefined ? { name, value: cookie } : undefined)) },
  })
  const response = await POST(request as never)
  expect(response.status).toBe(200)
  expect(createMock).toHaveBeenCalledTimes(1)
  return (createMock.mock.calls[0][0] as { metadata: Record<string, string> }).metadata
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = "https://www.overtaxed-il.com"
  createMock.mockResolvedValue({ url: "https://checkout.stripe.test/session" })
})

afterEach(() => {
  expect(referral.upsert).not.toHaveBeenCalled()
  expect(referral.create).not.toHaveBeenCalled()
})

describe("subscription checkout referral metadata", () => {
  it("forwards the canonical code of an existing referral", async () => {
    const metadata = await checkoutWithCookie("JOHN")
    expect(referral.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "john" } }))
    expect(metadata.referralCode).toBe("john")
  })

  it("drops a forged well-formed code no admin issued", async () => {
    const metadata = await checkoutWithCookie("attacker-code")
    expect(metadata.referralCode).toBe("")
  })

  it.each([
    ["an email", "owner@example.com"],
    ["a name", "John Smith"],
    ["a URL", "https://evil.example"],
    ["a confusable", "jоhn"],
    ["an oversized value", "a".repeat(4000)],
  ])("drops %s without a database lookup", async (_label, cookie) => {
    const metadata = await checkoutWithCookie(cookie)
    expect(metadata.referralCode).toBe("")
    expect(referral.findUnique).not.toHaveBeenCalled()
  })

  it("sends no referral when there is no cookie", async () => {
    const metadata = await checkoutWithCookie(undefined)
    expect(metadata.referralCode).toBe("")
    expect(referral.findUnique).not.toHaveBeenCalled()
  })

  it("still creates the checkout when the referral lookup fails", async () => {
    referral.findUnique.mockRejectedValueOnce(new Error("db down"))
    const metadata = await checkoutWithCookie("john")
    expect(metadata.referralCode).toBe("")
  })
})
