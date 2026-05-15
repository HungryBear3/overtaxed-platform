/**
 * @jest-environment node
 *
 * DIY Pro $69 checkout route — verify the Invoice fulfillment record is created
 * up front so the Stripe webhook has a stable idempotency anchor.
 */

// jest.mock factories must not reference unhoisted locals. Declare helpers
// inside the factory, then grab refs after `import` via jest.requireMock.
jest.mock("@/lib/stripe/client", () => {
  const createFn = jest.fn(async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/x" }))
  return {
    stripe: { checkout: { sessions: { create: createFn } } },
    PRICE_IDS: { COMPS_ONLY: "price_test" },
    __createFn: createFn,
  }
})

jest.mock("@/lib/db", () => {
  const createFn = jest.fn(async (args: { data: Record<string, unknown> }) => ({
    id: "inv_generated",
    ...args.data,
  }))
  const updateFn = jest.fn(async () => ({}))
  // Ownership lookups: configurable per test via mockResolvedValueOnce.
  const propertyFindFirst = jest.fn(async () => ({ id: "prop_owned" }))
  const appealFindFirst = jest.fn(async () => ({ id: "appeal_owned", propertyId: "prop_owned" }))
  return {
    prisma: {
      invoice: { create: createFn, update: updateFn },
      property: { findFirst: propertyFindFirst },
      appeal: { findFirst: appealFindFirst },
    },
    __createFn: createFn,
    __updateFn: updateFn,
    __propertyFindFirst: propertyFindFirst,
    __appealFindFirst: appealFindFirst,
  }
})

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(async () => ({ sub: "user_alice", email: "alice@example.com" })),
}))

const stripeMockRef = jest.requireMock("@/lib/stripe/client") as { __createFn: jest.Mock }
const dbMockRef = jest.requireMock("@/lib/db") as {
  __createFn: jest.Mock
  __updateFn: jest.Mock
  __propertyFindFirst: jest.Mock
  __appealFindFirst: jest.Mock
}
const createInvoiceMock = dbMockRef.__createFn
const updateInvoiceMock = dbMockRef.__updateFn
const propertyFindFirstMock = dbMockRef.__propertyFindFirst
const appealFindFirstMock = dbMockRef.__appealFindFirst
const stripeCreateMock = stripeMockRef.__createFn

import { POST } from "@/app/api/billing/checkout-diy/route"

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com"
})

describe("POST /api/billing/checkout-diy", () => {
  it("creates an Invoice with packetStatus=NOT_STARTED before creating the Stripe session", async () => {
    const req = new Request("https://app.example.com/api/billing/checkout-diy", { method: "POST" })
    const res = await POST(req as unknown as import("next/server").NextRequest)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.invoiceId).toBe("inv_generated")
    expect(createInvoiceMock).toHaveBeenCalledTimes(1)
    const created = createInvoiceMock.mock.calls[0]?.[0]?.data
    expect(created?.invoiceType).toBe("COMPS_ONLY")
    expect(created?.status).toBe("PENDING")
    expect(created?.packetStatus).toBe("NOT_STARTED")
  })

  it("passes invoiceId in Stripe metadata (the webhook's idempotency key)", async () => {
    const req = new Request("https://app.example.com/api/billing/checkout-diy", { method: "POST" })
    await POST(req as unknown as import("next/server").NextRequest)

    const sessionArgs = stripeCreateMock.mock.calls[0]?.[0] as {
      metadata?: Record<string, string>
      success_url?: string
    }
    expect(sessionArgs?.metadata?.invoiceId).toBe("inv_generated")
    expect(sessionArgs?.metadata?.plan).toBe("COMPS_ONLY")
    expect(sessionArgs?.success_url).toContain("/account/packets/inv_generated")
  })

  it("stores the Stripe session id as packetStripeSessionId after creation", async () => {
    const req = new Request("https://app.example.com/api/billing/checkout-diy", { method: "POST" })
    await POST(req as unknown as import("next/server").NextRequest)

    expect(updateInvoiceMock).toHaveBeenCalled()
    const updateArgs = updateInvoiceMock.mock.calls.find(
      (c) => (c[0] as { data?: { packetStripeSessionId?: string } }).data?.packetStripeSessionId === "cs_test_123",
    )
    expect(updateArgs).toBeTruthy()
  })

  it("rejects a foreign propertyId with 403 and creates no invoice", async () => {
    propertyFindFirstMock.mockResolvedValueOnce(null)
    const req = new Request(
      "https://app.example.com/api/billing/checkout-diy?propertyId=prop_someone_else",
      { method: "POST" },
    )
    const res = await POST(req as unknown as import("next/server").NextRequest)
    expect(res.status).toBe(403)
    expect(createInvoiceMock).not.toHaveBeenCalled()
    expect(stripeCreateMock).not.toHaveBeenCalled()
  })

  it("rejects a foreign appealId with 403 and creates no invoice", async () => {
    appealFindFirstMock.mockResolvedValueOnce(null)
    const req = new Request(
      "https://app.example.com/api/billing/checkout-diy?appealId=appeal_someone_else",
      { method: "POST" },
    )
    const res = await POST(req as unknown as import("next/server").NextRequest)
    expect(res.status).toBe(403)
    expect(createInvoiceMock).not.toHaveBeenCalled()
    expect(stripeCreateMock).not.toHaveBeenCalled()
  })

  it("rejects appeal/property mismatch with 400 and creates no invoice", async () => {
    propertyFindFirstMock.mockResolvedValueOnce({ id: "prop_owned" })
    appealFindFirstMock.mockResolvedValueOnce({ id: "appeal_owned", propertyId: "prop_other" })
    const req = new Request(
      "https://app.example.com/api/billing/checkout-diy?propertyId=prop_owned&appealId=appeal_owned",
      { method: "POST" },
    )
    const res = await POST(req as unknown as import("next/server").NextRequest)
    expect(res.status).toBe(400)
    expect(createInvoiceMock).not.toHaveBeenCalled()
    expect(stripeCreateMock).not.toHaveBeenCalled()
  })

  it("accepts an owned property + appeal that match", async () => {
    propertyFindFirstMock.mockResolvedValueOnce({ id: "prop_owned" })
    appealFindFirstMock.mockResolvedValueOnce({ id: "appeal_owned", propertyId: "prop_owned" })
    const req = new Request(
      "https://app.example.com/api/billing/checkout-diy?propertyId=prop_owned&appealId=appeal_owned",
      { method: "POST" },
    )
    const res = await POST(req as unknown as import("next/server").NextRequest)
    expect(res.status).toBe(200)
    expect(createInvoiceMock).toHaveBeenCalledTimes(1)
  })

  it("rejects unauthenticated requests", async () => {
    const { getToken } = jest.requireMock("next-auth/jwt") as { getToken: jest.Mock }
    getToken.mockResolvedValueOnce(null)
    const req = new Request("https://app.example.com/api/billing/checkout-diy", { method: "POST" })
    const res = await POST(req as unknown as import("next/server").NextRequest)
    expect(res.status).toBe(401)
    expect(createInvoiceMock).not.toHaveBeenCalled()
  })
})
