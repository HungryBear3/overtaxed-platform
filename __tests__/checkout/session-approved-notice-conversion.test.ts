/** @jest-environment node */

/**
 * T3 / $97 DFY is a held product.
 *
 * This suite previously asserted the opposite contract: that an approved
 * reassessment-notice hold could be *converted* into a payable T3 contract and
 * that exactly one Stripe Checkout Session was created from it. Those
 * assertions encoded selling a held product, so they are replaced rather than
 * repaired.
 *
 * What is asserted now is the conversion path specifically, because it is the
 * one route into T3 that does not begin from a cold request: the order row
 * already exists, an operator has already approved the notice, and the caller
 * is only asking for the payment link. That is exactly the shape a hold has to
 * survive. The refusal must land before the provider client is constructed and
 * before the pre-existing hold is mutated, so an approved hold left over from
 * before the hold-date cannot be drained by replaying the request.
 */

type OrderRow = Record<string, unknown>

const state: { order: OrderRow | null } = { order: null }

const stripeConstructorMock = jest.fn()
const stripeCreateMock = jest.fn()
const stripeSessionRetrieveMock = jest.fn()
const stripeRetrieveMock = jest.fn()

const orderFindUniqueMock = jest.fn()
const orderUpsertMock = jest.fn()
const orderUpdateManyMock = jest.fn()

process.env.STRIPE_SECRET_KEY = "sk_test_gate"
process.env.STRIPE_PRICE_T3_DFY = "price_t3"
process.env.OT_CHECKOUT_GATE_SECRET = "test-gate-secret-at-least-32-characters"

jest.mock("stripe", () => {
  const Stripe = jest.fn().mockImplementation((...args: unknown[]) => {
    stripeConstructorMock(...args)
    return {
      checkout: {
        sessions: {
          create: (...a: unknown[]) => stripeCreateMock(...a),
          retrieve: (...a: unknown[]) => stripeSessionRetrieveMock(...a),
        },
      },
      prices: { retrieve: (...a: unknown[]) => stripeRetrieveMock(...a) },
    }
  })
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

const searchPropertiesByAddressMock = jest.fn()
const getPropertyByPINMock = jest.fn()

jest.mock("@/lib/cook-county", () => ({
  searchPropertiesByAddress: (...args: unknown[]) => searchPropertiesByAddressMock(...args),
  getPropertyByPIN: (...args: unknown[]) => getPropertyByPINMock(...args),
  normalizePIN: (value: string) => value.replace(/\D/g, ""),
}))

jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: {
      findUnique: (...args: unknown[]) => orderFindUniqueMock(...args),
      upsert: (...args: unknown[]) => orderUpsertMock(...args),
      updateMany: (...args: unknown[]) => orderUpdateManyMock(...args),
    },
  },
}))

const { POST } = require("@/app/api/checkout/session/route") as typeof import("@/app/api/checkout/session/route")

beforeEach(() => {
  jest.clearAllMocks()
  state.order = null
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

/** The pre-hold artifact: an operator-approved notice awaiting a payment link. */
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
    noticeReviewStatus: "APPROVED",
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
  orderFindUniqueMock.mockImplementation(async () => (state.order ? { ...state.order } : null))
}

function expectNoProviderOrRecordSideEffects() {
  expect(stripeConstructorMock).not.toHaveBeenCalled()
  expect(stripeCreateMock).not.toHaveBeenCalled()
  expect(stripeSessionRetrieveMock).not.toHaveBeenCalled()
  expect(stripeRetrieveMock).not.toHaveBeenCalled()
  expect(orderUpsertMock).not.toHaveBeenCalled()
  expect(orderUpdateManyMock).not.toHaveBeenCalled()
  expect(searchPropertiesByAddressMock).not.toHaveBeenCalled()
  expect(getPropertyByPINMock).not.toHaveBeenCalled()
}

describe("POST /api/checkout/session — T3 approved-notice conversion is held", () => {
  it("refuses to convert an approved notice hold into a payable T3 contract", async () => {
    seedApprovedHold()

    const response = await POST(request())

    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({
      code: "PRODUCT_HELD",
      product: "T3_DFY",
    })
    expectNoProviderOrRecordSideEffects()
  })

  it("leaves the pre-existing approved hold byte-identical", async () => {
    seedApprovedHold()
    const before = JSON.stringify(state.order)

    await POST(request())

    expect(JSON.stringify(state.order)).toBe(before)
    expect(state.order).toMatchObject({
      contractKey: "placeholder_contract",
      checkoutAmountCents: 0,
      stripeSessionId: null,
      status: "CHECKOUT_PENDING",
    })
  })

  it("does not become reachable by replaying the request", async () => {
    seedApprovedHold()

    const first = await POST(request())
    const second = await POST(request())

    expect(first.status).toBe(410)
    expect(second.status).toBe(410)
    expectNoProviderOrRecordSideEffects()
  })

  it("refuses on a cold request with no approved hold at all", async () => {
    orderFindUniqueMock.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ product: "T3_DFY" })
    expectNoProviderOrRecordSideEffects()
  })

  it("refuses before reading the order record, so the hold does not depend on review state", async () => {
    // A REJECTED notice previously produced 422 NOTICE_REVIEW_REQUIRED. The
    // hold must not be expressed through review state: it has to refuse the
    // product regardless of what the record says, and without reading it.
    seedApprovedHold({ noticeReviewStatus: "REJECTED", status: "NOTICE_REVIEW_REQUIRED" })

    const response = await POST(request())

    expect(response.status).toBe(410)
    expect(orderFindUniqueMock).not.toHaveBeenCalled()
    expectNoProviderOrRecordSideEffects()
  })

  it("names the boundary that refused, so the refusal is attributable in logs", async () => {
    seedApprovedHold()

    const body = await (await POST(request())).json()

    expect(body.error).toContain("api/checkout/session")
    expect(body.error).toContain("T3_DFY")
  })
})

export {}
