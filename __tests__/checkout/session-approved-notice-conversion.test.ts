/** @jest-environment node */

type OrderRow = Record<string, unknown>

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

const state: {
  order: OrderRow | null
  forceTransformLoss: boolean
} = {
  order: null,
  forceTransformLoss: false,
}

const stripeCreateMock = jest.fn()
const stripeSessionRetrieveMock = jest.fn()
const stripeRetrieveMock = jest.fn()

process.env.STRIPE_SECRET_KEY = "sk_test_gate"
process.env.STRIPE_PRICE_T3_DFY = "price_t3"
process.env.OT_CHECKOUT_GATE_SECRET = "test-gate-secret-at-least-32-characters"

jest.mock("stripe", () => {
  const Stripe = jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => stripeCreateMock(...args),
        retrieve: (...args: unknown[]) => stripeSessionRetrieveMock(...args),
      },
    },
    prices: {
      retrieve: (...args: unknown[]) => stripeRetrieveMock(...args),
    },
  }))
  return { __esModule: true, default: Stripe }
})

jest.mock("@/lib/marketing/preview-gate", () => ({
  hostFromRequest: jest.fn(() => "www.overtaxed-il.com"),
  isPreviewStubEnabled: jest.fn(() => false),
  marketingGateReason: jest.fn(() => "test"),
  previewNoopResponseBody: jest.fn(() => ({ mode: "preview_noop" })),
}))

jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  getClientIdentifier: jest.fn(() => "test-client"),
}))

jest.mock("@/lib/cook-county", () => ({
  searchPropertiesByAddress: jest.fn(async () => ({
    success: true,
    data: [{ pin: "09000000000000", property_address: "1 TEST ST", property_city: "ELK GROVE VILLAGE", township_name: "Elk Grove" }],
  })),
  getPropertyByPIN: jest.fn(async () => ({
    success: true,
    data: {
      pin: "09000000000000",
      address: "1 TEST ST",
      city: "ELK GROVE VILLAGE",
      zipCode: "60007",
      township: "Elk Grove",
    },
  })),
  normalizePIN: (value: string) => value.replace(/\D/g, ""),
}))

jest.mock("@/lib/free-check-appeal-window", () => ({
  getFreeCheckAppealWindowStatus: jest.fn(() => ({
    township: "Elk Grove",
    status: "closed",
    openDate: "2026-06-22",
    closeDate: "2026-07-20",
    filingUrl: "https://official",
    note: "closed window",
  })),
}))

jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; contractKey?: string; checkoutKey?: string } }) => {
        if (!state.order) return null
        if (where.id) return state.order.id === where.id ? { ...state.order } : null
        if (where.contractKey) return state.order.contractKey === where.contractKey ? { ...state.order } : null
        if (where.checkoutKey) return state.order.checkoutKey === where.checkoutKey ? { ...state.order } : null
        return null
      }),
      upsert: jest.fn(async ({ create }: { create: OrderRow }) => {
        if (state.order) return { ...state.order }
        state.order = { id: "ord_notice", attempt: 0, stripeSessionId: null, ...create }
        return { ...state.order }
      }),
      updateMany: jest.fn(async ({ where, data }: { where: OrderRow; data: OrderRow }) => {
        if (!state.order) return { count: 0 }
        const order = state.order
        const matches = Object.entries(where).every(([key, value]) => {
          if (value === undefined) return true
          if (key === "eligibilitySnapshot" && value && typeof value === "object" && "equals" in value) {
            return canonical(order.eligibilitySnapshot ?? null) === canonical((value as OrderRow).equals)
          }
          if (value === null) return order[key] == null
          if (order[key] instanceof Date && value instanceof Date) return (order[key] as Date).getTime() === value.getTime()
          return order[key] === value
        })
        if (!matches) return { count: 0 }
        if (state.forceTransformLoss && data.contractKey) return { count: 0 }
        state.order = { ...order, ...data, updatedAt: new Date() }
        return { count: 1 }
      }),
    },
  },
}))

const { POST } = require("@/app/api/checkout/session/route") as typeof import("@/app/api/checkout/session/route")

beforeEach(() => {
  jest.clearAllMocks()
  state.order = null
  state.forceTransformLoss = false
  stripeRetrieveMock.mockResolvedValue({
    id: "price_t3",
    active: true,
    type: "one_time",
    unit_amount: 9700,
    currency: "usd",
    product: "prod_t3",
  })
  stripeCreateMock.mockResolvedValue({
    id: "cs_notice_paid",
    url: "https://checkout.stripe.test/approved-notice",
  })
  stripeSessionRetrieveMock.mockResolvedValue({
    id: "cs_notice_paid",
    status: "open",
    url: "https://checkout.stripe.test/approved-notice",
  })
})

function request(checkoutKey = "57dc81a6-1329-4a85-9210-0d6f574ea65d") {
  return new Request("https://www.overtaxed-il.com/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tier: "T3",
      email: "buyer@example.com",
      name: "Buyer Name",
      address: "1 Test St, Elk Grove Village IL 60007",
      checkoutKey,
      reassessmentNoticeDate: "2026-07-18",
      reassessmentNoticeAddress: "1 TEST ST",
    }),
  }) as never
}

function seedApprovedHold(overrides: OrderRow = {}) {
  state.order = {
    id: "ord_notice",
    checkoutKey: "57dc81a6-1329-4a85-9210-0d6f574ea65d",
    contractKey: "placeholder_contract",
    tier: "T3",
    email: "buyer@example.com",
    name: "Buyer Name",
    propertyAddress: "1 TEST ST",
    propertyPin: "09000000000000",
    township: "Elk Grove",
    windowStatus: "closed",
    windowOpenDate: new Date("2026-06-22T12:00:00.000Z"),
    windowCloseDate: new Date("2026-07-20T12:00:00.000Z"),
    windowSourceUpdated: "2026-07-23",
    windowVerifiedAt: new Date("2026-07-23T12:00:00.000Z"),
    eligibilitySnapshot: {
      township: "Elk Grove",
      status: "closed",
      openDate: "2026-06-22",
      closeDate: "2026-07-20",
      sourceUpdated: "2026-07-23",
      sourceUrl: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      verifiedAt: "2026-07-23T12:00:00.000Z",
      pin: "09000000000000",
    },
    reassessmentNoticeDate: new Date("2026-07-18T12:00:00.000Z"),
    reassessmentNoticeAddress: "1 TEST ST",
    noticeEvidence: {
      type: "reassessment_notice",
      date: "2026-07-18",
      address: "1 TEST ST",
    },
    noticeReviewStatus: "APPROVED",
    noticeReviewActionAt: new Date("2026-07-24T12:00:00.000Z"),
    noticeReviewActionBy: "admin_1",
    checkoutPriceId: "price_t3_placeholder",
    checkoutProductId: "notice_review_pending",
    checkoutAmountCents: 0,
    checkoutCurrency: "usd",
    stripeSessionId: null,
    attempt: 0,
    status: "CHECKOUT_PENDING",
    ...overrides,
  }
}

describe("POST /api/checkout/session approved notice conversion", () => {
  it("converts the same approved notice hold into the payable contract and creates one Stripe session", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-24T15:00:00.000Z"))
    seedApprovedHold()

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ url: "https://checkout.stripe.test/approved-notice" })
    expect(state.order).toMatchObject({
      id: "ord_notice",
      checkoutKey: "57dc81a6-1329-4a85-9210-0d6f574ea65d",
      status: "CHECKOUT_CREATED",
      stripeSessionId: "cs_notice_paid",
      checkoutPriceId: "price_t3",
      checkoutProductId: "prod_t3",
      checkoutAmountCents: 9700,
      checkoutCurrency: "usd",
      noticeReviewStatus: "APPROVED",
      noticeReviewActionBy: "admin_1",
      noticeEvidence: {
        type: "reassessment_notice",
        date: "2026-07-18",
        address: "1 TEST ST",
      },
    })
    expect(state.order?.contractKey).not.toBe("placeholder_contract")
    expect(stripeCreateMock).toHaveBeenCalledTimes(1)
    const [sessionArgs] = stripeCreateMock.mock.calls[0]
    expect(sessionArgs.metadata).toMatchObject({ orderId: "ord_notice", tier: "T3" })
    expect(sessionArgs.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30 * 60)
    jest.useRealTimers()
  })

  it("returns the exact existing open session after an approved-notice response is lost", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-24T15:00:00.000Z"))
    try {
      seedApprovedHold()

      const first = await POST(request())
      expect(first.status).toBe(200)
      expect(stripeCreateMock).toHaveBeenCalledTimes(1)

      const retry = await POST(request())

      expect(retry.status).toBe(200)
      expect(await retry.json()).toEqual({ url: "https://checkout.stripe.test/approved-notice" })
      expect(stripeSessionRetrieveMock).toHaveBeenCalledWith("cs_notice_paid")
      expect(stripeCreateMock).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it("blocks retries when the notice is not durably approved", async () => {
    seedApprovedHold({ noticeReviewStatus: "REJECTED", status: "NOTICE_REVIEW_REQUIRED" })

    const response = await POST(request())

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: "NOTICE_REVIEW_REQUIRED" })
    expect(stripeCreateMock).not.toHaveBeenCalled()
  })

  it("fails closed if the approved-hold conversion CAS loses", async () => {
    seedApprovedHold()
    state.forceTransformLoss = true

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(stripeCreateMock).not.toHaveBeenCalled()
  })

  it("allows only one provider session when approved retries race", async () => {
    seedApprovedHold()
    let releaseStripe!: () => void
    stripeCreateMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseStripe = () => resolve({
        id: "cs_notice_paid",
        url: "https://checkout.stripe.test/approved-notice",
      })
    }))

    const first = POST(request())
    await new Promise((resolve) => setImmediate(resolve))
    const second = await POST(request())
    releaseStripe()

    expect(second.status).toBe(409)
    expect(stripeCreateMock).toHaveBeenCalledTimes(1)
    expect((await first).status).toBe(200)
  })
})

export {}
