/** @jest-environment node */

const getSessionMock = jest.fn()
const findUniqueMock = jest.fn()
const updateManyMock = jest.fn()

jest.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))

jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}))

jest.mock("@/lib/cook-county", () => ({
  getPropertyByPIN: jest.fn(async () => ({
    success: true,
    data: { pin: "09000000000000", address: "1 TEST ST", city: "ELK GROVE VILLAGE", zipCode: "60007", township: "Elk Grove" },
  })),
  normalizePIN: (value: string) => value.replace(/\D/g, ""),
  searchPropertiesByAddress: jest.fn(),
}))

jest.mock("@/lib/free-check-appeal-window", () => ({
  getFreeCheckAppealWindowStatus: jest.fn(() => ({
    township: "Elk Grove",
    status: "future_cycle",
    openDate: null,
    closeDate: null,
    filingUrl: "https://official",
    note: "notice path",
  })),
}))

jest.mock("@/lib/appeals/township-deadlines", () => ({
  ASSESSOR_CALENDAR_URL: "https://official",
  TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED: "2026-07-23",
}))

describe("admin OT notice review actions", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN", email: "admin@example.com" } })
    findUniqueMock.mockResolvedValue({
      id: "ord_notice",
      tier: "T3",
      status: "NOTICE_REVIEW_REQUIRED",
      contractKey: "contract_notice",
      attempt: 0,
      stripeSessionId: null,
      checkoutPriceId: "price_t3",
      checkoutProductId: "prod_t3",
      checkoutAmountCents: 6900,
      checkoutCurrency: "usd",
      propertyPin: "09000000000000",
      propertyAddress: "1 TEST ST",
      email: "buyer@example.com",
      reassessmentNoticeAddress: "1 TEST ST",
      reassessmentNoticeDate: new Date("2026-07-20T12:00:00Z"),
    })
    updateManyMock.mockResolvedValue({ count: 1 })
  })

  function request(action: string) {
    return new Request("https://www.overtaxed-il.com/api/admin/ot-orders/ord_notice/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    })
  }

  it("requires authenticated admin review actions", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { role: "USER" } })
    const { POST } = await import("@/app/api/admin/ot-orders/[orderId]/review/route")
    const res = await POST(request("approve") as never, { params: Promise.resolve({ orderId: "ord_notice" }) } as never)
    expect(res.status).toBe(401)
  })

  it("audits approve, reject, and revalidate without directly creating a charge", async () => {
    const { POST } = await import("@/app/api/admin/ot-orders/[orderId]/review/route")

    const approve = await POST(request("approve") as never, { params: Promise.resolve({ orderId: "ord_notice" }) } as never)
    expect(approve.status).toBe(200)
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "ord_notice",
        status: "NOTICE_REVIEW_REQUIRED",
        contractKey: "contract_notice",
        attempt: 0,
        stripeSessionId: null,
        checkoutPriceId: "price_t3",
        checkoutProductId: "prod_t3",
        checkoutAmountCents: 6900,
        checkoutCurrency: "usd",
      }),
      data: expect.objectContaining({
        noticeReviewStatus: "APPROVED",
        noticeReviewActionBy: "admin_1",
      }),
    }))

    const reject = await POST(request("reject") as never, { params: Promise.resolve({ orderId: "ord_notice" }) } as never)
    expect(reject.status).toBe(200)

    const revalidate = await POST(request("revalidate") as never, { params: Promise.resolve({ orderId: "ord_notice" }) } as never)
    expect(revalidate.status).toBe(200)
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        noticeReviewStatus: "REVALIDATED",
        township: "Elk Grove",
        windowStatus: "future_cycle",
      }),
    }))
  })

  it.each([
    "PAID",
    "PAID_RECOVERY_REQUIRED",
    "CANCELLED",
    "REFUNDED",
    "CHECKOUT_CREATED",
    "CHECKOUT_CREATING",
  ])("refuses to mutate provider-bound or terminal order status %s", async (status) => {
    findUniqueMock.mockResolvedValueOnce({
      id: "ord_terminal",
      tier: "T3",
      status,
      contractKey: "contract_terminal",
      attempt: 1,
      stripeSessionId: status === "CHECKOUT_PENDING" || status === "CHECKOUT_FAILED" ? null : "cs_terminal",
      checkoutPriceId: "price_t3",
      checkoutProductId: "prod_t3",
      checkoutAmountCents: 6900,
      checkoutCurrency: "usd",
      propertyPin: "09000000000000",
      township: "Elk Grove",
    })

    const { POST } = await import("@/app/api/admin/ot-orders/[orderId]/review/route")
    const res = await POST(request("approve") as never, { params: Promise.resolve({ orderId: "ord_terminal" }) } as never)

    expect(res.status).toBe(409)
    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it("allows pre-provider checkout failure revalidation only while the original immutable evidence still matches", async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: "ord_failed",
      tier: "T3",
      status: "CHECKOUT_FAILED",
      contractKey: "contract_failed",
      attempt: 2,
      stripeSessionId: null,
      checkoutPriceId: "price_t3",
      checkoutProductId: "prod_t3",
      checkoutAmountCents: 6900,
      checkoutCurrency: "usd",
      propertyPin: "09000000000000",
      township: "Elk Grove",
      reassessmentNoticeAddress: "1 TEST ST",
      reassessmentNoticeDate: new Date("2026-07-20T12:00:00Z"),
    })

    const { POST } = await import("@/app/api/admin/ot-orders/[orderId]/review/route")
    const res = await POST(request("revalidate") as never, { params: Promise.resolve({ orderId: "ord_failed" }) } as never)

    expect(res.status).toBe(200)
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "ord_failed",
        status: "CHECKOUT_FAILED",
        stripeSessionId: null,
        attempt: 2,
      }),
    }))
  })

  it("returns conflict when the admin review CAS loses a concurrent state change", async () => {
    updateManyMock.mockResolvedValueOnce({ count: 0 })

    const { POST } = await import("@/app/api/admin/ot-orders/[orderId]/review/route")
    const res = await POST(request("approve") as never, { params: Promise.resolve({ orderId: "ord_notice" }) } as never)

    expect(res.status).toBe(409)
  })
})
