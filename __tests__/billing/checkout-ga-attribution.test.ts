/** @jest-environment node */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const createMock = jest.fn()
jest.mock("@/lib/auth/session", () => ({
  getSession: jest.fn(async () => ({ user: { id: "user_1", email: "owner@example.com" } })),
}))

jest.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async () => ({
        id: "user_1",
        email: "owner@example.com",
        subscriptionTier: "STARTER",
        subscriptionStatus: "ACTIVE",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionQuantity: 2,
      })),
      update: jest.fn(),
    },
    property: {
      count: jest.fn(async () => 2),
    },
    invoice: {
      findFirst: jest.fn(async () => ({
        id: "inv_1",
        amount: 264,
        invoiceNumber: "INV-001",
        user: { stripeCustomerId: null, email: "owner@example.com" },
      })),
    },
  },
}))

jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    checkout: { sessions: { create: (...args: unknown[]) => createMock(...args) } },
    customers: { retrieve: jest.fn() },
  },
  PRICE_IDS: {
    STARTER: "price_starter",
    GROWTH_PER_PROPERTY: "price_growth",
    PORTFOLIO_PER_PROPERTY: "price_portfolio",
  },
}))

describe("legacy billing checkout creators do not claim GA purchase support", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = "https://www.overtaxed-il.com"
    createMock.mockResolvedValue({ url: "https://checkout.stripe.test/session" })
  })

  it("does not bind GA identifiers on subscription checkout metadata", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route")
    const request = new Request("https://www.overtaxed-il.com/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan: "STARTER",
        propertyCount: 2,
        gaClientId: "1234567890.1234567890",
        gaSessionId: "1724102400",
        gaSessionNumber: "4",
      }),
    })
    Object.defineProperty(request, "cookies", {
      value: { get: jest.fn(() => undefined) },
    })
    const response = await POST(request as never)

    expect(response.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.not.objectContaining({
        gaClientId: expect.anything(),
        gaSessionId: expect.anything(),
        gaSessionNumber: expect.anything(),
      }),
    }))
  })

  it("does not bind GA identifiers on contingency invoice checkout metadata", async () => {
    const { POST } = await import("@/app/api/billing/pay-invoice/route")
    const response = await POST(new Request("https://www.overtaxed-il.com/api/billing/pay-invoice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceId: "inv_1",
        gaClientId: "1234567890.1234567890",
        gaSessionId: "1724102400",
        gaSessionNumber: "4",
      }),
    }) as never)

    expect(response.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        invoiceId: "inv_1",
      }),
    }))
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.not.objectContaining({
        gaClientId: expect.anything(),
        gaSessionId: expect.anything(),
        gaSessionNumber: expect.anything(),
      }),
    }))
  })

  it("leaves no invoice-page GA metadata plumbing in source", () => {
    const repoRoot = resolve(__dirname, "../..")
    const pendingInvoicesSource = readFileSync(resolve(repoRoot, "components/account/PendingInvoicesSection.tsx"), "utf8")

    expect(pendingInvoicesSource).not.toContain("getAnonymousGaIdentifiersForRequest")
    expect(pendingInvoicesSource).not.toContain("gaClientId")
    expect(pendingInvoicesSource).toContain("body: JSON.stringify({ invoiceId })")
  })
})
