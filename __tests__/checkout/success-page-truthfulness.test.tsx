import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: {
      findUnique: jest.fn(),
    },
  },
}))

const prismaMock = (jest.requireMock("@/lib/db") as { prisma: { oTOrder: { findUnique: jest.Mock } } }).prisma

describe("checkout success page truthfulness", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("does not trust query params alone to claim payment success", async () => {
    prismaMock.oTOrder.findUnique.mockResolvedValueOnce(null)
    const Page = (await import("@/app/checkout/success/page")).default
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ session_id: "cs_missing", tier: "T3" }),
    }))
    expect(html).not.toContain("Payment Successful")
    expect(html).toContain("We&#x27;re still verifying")
  })

  it("shows a recovery-safe state for paid recovery instead of claiming fulfillment", async () => {
    prismaMock.oTOrder.findUnique.mockResolvedValueOnce({
      stripeSessionId: "cs_recovery",
      tier: "T3",
      status: "PAID_RECOVERY_REQUIRED",
    })
    const Page = (await import("@/app/checkout/success/page")).default
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ session_id: "cs_recovery", tier: "T3" }),
    }))
    expect(html).toContain("We received your payment")
    expect(html).toContain("manual review")
    expect(html).not.toContain("get started on your appeal")
  })

  it("analysis-only paid success does not promise that an appeal will be filed", async () => {
    prismaMock.oTOrder.findUnique.mockResolvedValueOnce({
      stripeSessionId: "cs_t2_paid",
      tier: "T2",
      status: "PAID",
    })
    const Page = (await import("@/app/checkout/success/page")).default
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ session_id: "cs_t2_paid", tier: "T2" }),
    }))
    expect(html).toContain("analysis")
    expect(html).not.toContain("get started on your appeal")
    expect(html).not.toContain("appeal will be filed")
  })

  it("stale T1 paid success does not claim fulfillment", async () => {
    prismaMock.oTOrder.findUnique.mockResolvedValueOnce({
      stripeSessionId: "cs_t1_paid",
      tier: "T1",
      status: "PAID",
    })
    const Page = (await import("@/app/checkout/success/page")).default
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ session_id: "cs_t1_paid", tier: "T1" }),
    }))
    expect(html).toContain("manual review")
    expect(html).not.toContain("get started on your appeal")
  })
})
