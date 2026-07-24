import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/auth/session", () => ({
  getSession: jest.fn(),
}))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}))

jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: { findMany: jest.fn() },
  },
}))

const authMock = jest.requireMock("@/lib/auth/session") as { getSession: jest.Mock }
const prismaMock = (jest.requireMock("@/lib/db") as {
  prisma: {
    oTOrder: { findMany: jest.Mock }
  }
}).prisma

describe("admin orders page recovery visibility", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("requires an authenticated admin and shows recovery evidence fields", async () => {
    authMock.getSession.mockResolvedValueOnce({ user: { role: "ADMIN" } })
    prismaMock.oTOrder.findMany.mockResolvedValueOnce([{
      id: "ord_1",
      createdAt: new Date("2026-07-24T15:00:00Z"),
      name: "Buyer",
      email: "buyer@example.com",
      tier: "T3",
      propertyAddress: "1 TEST ST",
      propertyPin: "09000000000000",
      amountPaid: 97,
      status: "PAID_RECOVERY_REQUIRED",
      township: "Elk Grove",
      windowStatus: "open",
      analysisAcknowledgedAt: null,
      reassessmentNoticeAddress: "1 TEST ST",
      recoveryReason: "Late eligibility drift",
    }])

    const Page = (await import("@/app/admin/orders/page")).default
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain("Elk Grove")
    expect(html).toContain("PAID_RECOVERY_REQUIRED")
    expect(html).toContain("Late eligibility drift")
    expect(html).not.toContain("checkout.session")
  })

  it("shows bounded notice review controls for an unbound review order", async () => {
    authMock.getSession.mockResolvedValueOnce({ user: { role: "ADMIN" } })
    prismaMock.oTOrder.findMany.mockResolvedValueOnce([{
      id: "ord_notice",
      createdAt: new Date("2026-07-24T15:00:00Z"),
      name: "Buyer",
      email: "buyer@example.com",
      tier: "T3",
      propertyAddress: "1 TEST ST",
      propertyPin: "09000000000000",
      amountPaid: 0,
      status: "NOTICE_REVIEW_REQUIRED",
      stripeSessionId: null,
      township: "Elk Grove",
      windowStatus: "future_cycle",
      analysisAcknowledgedAt: null,
      reassessmentNoticeAddress: "1 TEST ST",
      recoveryReason: null,
    }])

    const Page = (await import("@/app/admin/orders/page")).default
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain("Approve notice")
    expect(html).toContain("Reject notice")
    expect(html).toContain("Revalidate")
  })
})
