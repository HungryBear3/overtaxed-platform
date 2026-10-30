/** @jest-environment node */

import { NextRequest } from "next/server"

type OrderRow = Record<string, any>

const state: {
  orders: Map<string, OrderRow>
  stripeSessions: Map<string, Record<string, any>>
} = {
  orders: new Map(),
  stripeSessions: new Map(),
}

let createCount = 0
let nowMs = Date.now()

function matchesWhere(row: OrderRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (key === "status") {
      if (typeof value === "string") return row.status === value
      if (value && typeof value === "object" && "in" in value) {
        return Array.isArray((value as { in?: unknown[] }).in) && (value as { in: unknown[] }).in.includes(row.status)
      }
      return false
    }
    if (key === "attempt") return row.attempt === value
    if (key === "updatedAt") {
      if (!(value instanceof Date) || !(row.updatedAt instanceof Date)) return false
      return row.updatedAt.getTime() === value.getTime()
    }
    if (key === "eligibilitySnapshot" && value && typeof value === "object" && "equals" in value) {
      return JSON.stringify(row.eligibilitySnapshot ?? null) === JSON.stringify((value as { equals: unknown }).equals)
    }
    const rowValue = row[key]
    // `{ not: null }` — the claim predicate binds `analysisAcknowledgedAt` this
    // way on T2, which the T3-era helper never saw and compared as a plain
    // object, so every claim lost its CAS.
    if (value && typeof value === "object" && "not" in value) {
      const excluded = (value as { not: unknown }).not
      return excluded === null ? rowValue != null : rowValue !== excluded
    }
    if (value === null) return rowValue == null
    if (rowValue instanceof Date && value instanceof Date) return rowValue.getTime() === value.getTime()
    return rowValue === value
  })
}

jest.mock("stripe", () => {
  const create = jest.fn(async (_params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
    const id = `cs_contract_${++createCount}`
    const url = `https://checkout.stripe.test/${id}`
    state.stripeSessions.set(id, {
      id,
      url,
      status: "open",
      expires_at: Math.floor((nowMs + 60 * 60 * 1000) / 1000),
      idempotencyKey: options?.idempotencyKey ?? null,
    })
    return { id, url }
  })
  const retrievePrice = jest.fn(async (id: string) => ({
    id,
    active: true,
    type: "one_time",
    unit_amount: id === "price_t2" ? 6900 : 9700,
    currency: "usd",
    product: id === "price_t2" ? "prod_t2" : "prod_t3",
  }))
  const retrieveSession = jest.fn(async (id: string) => state.stripeSessions.get(id) ?? null)
  const listPromotionCodes = jest.fn(async (_params: Record<string, unknown>) => ({ data: [] as unknown[] }))
  const Stripe = jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create, retrieve: retrieveSession } },
    prices: { retrieve: retrievePrice },
    promotionCodes: { list: listPromotionCodes },
  }))
  return {
    __esModule: true,
    default: Stripe,
    __create: create,
    __retrievePrice: retrievePrice,
    __retrieveSession: retrieveSession,
    __listPromotionCodes: listPromotionCodes,
  }
})

jest.mock("@/lib/marketing/preview-gate", () => ({
  hostFromRequest: jest.fn(() => "www.overtaxed-il.com"),
  isPreviewStubEnabled: jest.fn(() => false),
  marketingGateReason: jest.fn(() => "test"),
  previewNoopResponseBody: jest.fn(() => ({ mode: "preview_noop" })),
}))

jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  getClientIdentifier: jest.fn(() => "client-test"),
}))

jest.mock("@/lib/cook-county", () => ({
  searchPropertiesByAddress: jest.fn(async () => ({
    success: true,
    data: [{ pin: "09000000000000", property_address: "1 TEST ST", property_city: "ELK GROVE VILLAGE", township_name: "Elk Grove" }],
  })),
  getPropertyByPIN: jest.fn(async () => ({
    success: true,
    data: { pin: "09000000000000", address: "1 TEST ST", city: "ELK GROVE VILLAGE", zipCode: "60007", township: "Elk Grove" },
  })),
  normalizePIN: (value: string) => value.replace(/\D/g, ""),
}))

/**
 * The canonical snapshot the route evaluates.
 *
 * These two mocks replace a stub of `@/lib/appeals/township-deadlines` that
 * exported only `ASSESSOR_CALENDAR_URL` and the removed
 * `TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED`. That module is now an adapter over
 * the canonical state and the route calls `projectTownshipDeadline` through it,
 * so the stub left the route calling `undefined`. Mocking the snapshot data
 * instead runs the real evaluator against a fixture.
 */
const mockSnapshot: {
  schemaVersion: number
  synthetic: boolean
  sources: Record<string, unknown>
  townships: Record<string, unknown>
} = { schemaVersion: 1, synthetic: true, sources: {}, townships: {} }

jest.mock("@/data/deadlines/cook-county.json", () => mockSnapshot)
jest.mock("@/lib/deadlines/commerce-deadline-authority", () => ({
  projectCommerceDeadline: jest.fn(async ({ township, at }: { township: unknown; at: Date }) => {
    const { evaluateOfficialDeadlineState, projectDeadline } = jest.requireActual("@/lib/deadlines/official-source-state")
    return projectDeadline(evaluateOfficialDeadlineState({ snapshot: mockSnapshot, township, stage: "assessor", evaluatedAt: at.toISOString() }), at.toISOString())
  }),
}))

/**
 * The signed eligibility policy.
 *
 * `SIGNED_ELIGIBILITY_POLICIES` is empty — OD-2 and OD-3 are unsigned — so paid
 * eligibility is closed in every configuration that ships. These reuse and
 * idempotency mechanics still have to hold the day a policy is signed, which is
 * the worst moment to discover they do not, so one is signed here for the
 * duration of the suite. `session-window-gates` proves the unsigned default
 * refuses on its own.
 */
const mockPolicy: { version: string | null } = { version: "test-policy-2026-08-19" }

jest.mock("@/lib/checkout/ot-contract", () => {
  const actual = jest.requireActual("@/lib/checkout/ot-contract")
  return {
    ...actual,
    signedPolicyVersion: () => mockPolicy.version,
    resolveEligibilityPolicy: () =>
      mockPolicy.version === null
        ? { signed: false, version: null, reason: "eligibility_policy_unsigned" }
        : {
            signed: true,
            version: mockPolicy.version,
            ownerDecisions: ["OD-2", "OD-3"],
            signedAt: "2026-08-19",
            evidenceThreshold: { minRelativeAssessmentGap: 0.15, minComparables: 3 },
          },
  }
})

jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; contractKey?: string } }) => {
        if (where.id) {
          return Array.from(state.orders.values()).find((row) => row.id === where.id) ?? null
        }
        if (where.contractKey) {
          return state.orders.get(where.contractKey) ?? null
        }
        return null
      }),
      upsert: jest.fn(async ({ where, create }: { where: { contractKey: string }; create: OrderRow }) => {
        const existing = state.orders.get(where.contractKey)
        if (existing) return { ...existing }
        const row = {
          id: `ord_${state.orders.size + 1}`,
          attempt: 0,
          status: "CHECKOUT_PENDING",
          ...create,
          updatedAt: new Date(nowMs),
          createdAt: new Date(nowMs),
        }
        state.orders.set(where.contractKey, row)
        return { ...row }
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = Array.from(state.orders.values()).find((candidate) => matchesWhere(candidate, where))
        if (!row) return { count: 0 }
        const { attempt, ...rest } = data
        Object.assign(row, rest)
        if (attempt && typeof attempt === "object" && "increment" in attempt) {
          row.attempt = Number(row.attempt ?? 0) + Number((attempt as { increment: number }).increment)
        }
        row.updatedAt = new Date(nowMs)
        state.orders.set(String(row.contractKey), row)
        return { count: 1 }
      }),
    },
  },
}))

process.env.STRIPE_SECRET_KEY = "sk_test_contract"
process.env.STRIPE_PRICE_T2_DIY_PRO = "price_t2"
process.env.STRIPE_PRICE_T3_DFY = "price_t3"
process.env.OT_CHECKOUT_GATE_SECRET = "test-gate-secret-at-least-32-characters"

const stripeModule = jest.requireMock("stripe") as {
  __create: jest.Mock
  __listPromotionCodes: jest.Mock
  __retrieveSession: jest.Mock
}
const { POST } = require("@/app/api/checkout/session/route") as typeof import("@/app/api/checkout/session/route")

/**
 * These reuse/idempotency mechanics were written against T3 only because T3 was
 * the tier in front of them at the time. T3 / $97 DFY is now a held product and
 * refuses at 410 before any order row is touched, which would make every
 * assertion below vacuous. The mechanics themselves still have to hold for the
 * one tier that can reach a provider, so they are exercised against T2. The
 * hold on T3 is asserted separately at the bottom of this file.
 */
function request(checkoutKey: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("https://www.overtaxed-il.com/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tier: "T2",
      email: "Buyer@example.com",
      name: " Buyer Name ",
      address: "1 Test St, Elk Grove Village IL 60007",
      checkoutKey,
      ...extra,
    }),
  })
}

/** A YYYY-MM-DD county calendar day, `days` from now. */
function countyDay(days: number, from: Date = new Date()): string {
  const at = new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)
}

/** Put a verified, currently-open Elk Grove window in the snapshot. */
function armWindow(closesInDays = 20) {
  const now = new Date()
  const url = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
  const source = {
    authority: "cook_county_assessor",
    sourceUrl: url,
    retrievedAt: new Date(now.getTime() - 5000).toISOString(),
    sourceUpdatedAt: null,
    contentSha256: "f".repeat(64),
    httpStatus: 200,
    finalUrl: url,
    parseStatus: "ok",
    parserVersion: "1.0.0",
  }
  mockSnapshot.synthetic = false
  mockSnapshot.sources = { assessor: source, bor: source }
  mockSnapshot.townships = {
    "elk-grove": {
      townshipName: "Elk Grove",
      stages: {
        assessor: {
          noticeDate: null,
          openDate: countyDay(-10, now),
          lastFileDate: countyDay(closesInDays, now),
        },
      },
    },
  }
}

/**
 * T2 requires the CC-10 acknowledgment on every checkout, and the token is
 * minted server-side against the snapshot that cleared the eligibility gate.
 * Each call here therefore takes the challenge first and presents it back —
 * the challenge writes no order and calls no provider.
 */
async function postT2(checkoutKey: string, extra: Record<string, unknown> = {}) {
  const challenge = await POST(request(checkoutKey, extra))
  const body = await challenge.json()
  if (body?.code !== "T2_ACKNOWLEDGMENT_REQUIRED") return challenge
  return POST(
    request(checkoutKey, {
      analysisAcknowledged: true,
      acknowledgmentToken: body.acknowledgmentToken,
      ...extra,
    }),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  state.orders.clear()
  state.stripeSessions.clear()
  createCount = 0
  nowMs = Date.now()
  jest.useRealTimers()
  mockPolicy.version = "test-policy-2026-08-19"
  armWindow()
})

describe("POST /api/checkout/session server-authoritative OT contract reuse", () => {
  it("treats two browser nonces for the same normalized OT contract as one order and one payable session", async () => {
    const first = await postT2("11111111-1111-4111-8111-111111111111")
    const second = await postT2("22222222-2222-4222-8222-222222222222")

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    expect(state.orders.size).toBe(1)
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
  })

  it("reuses the exact hosted URL for an already-bound open Stripe Checkout Session", async () => {
    const first = await postT2("11111111-1111-4111-8111-111111111111")
    const url = (await first.json()).url

    const second = await postT2("33333333-3333-4333-8333-333333333333")
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ url })
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
  })

  it("reclaims a stale CHECKOUT_CREATING lease with the same attempt idempotency key instead of creating a new payable session", async () => {
    const key = "11111111-1111-4111-8111-111111111111"
    const first = await postT2(key)
    expect(first.status).toBe(200)

    const [contractKey, order] = Array.from(state.orders.entries())[0]
    order.status = "CHECKOUT_CREATING"
    order.stripeSessionId = null
    order.updatedAt = new Date(nowMs - 20 * 60 * 1000)
    state.orders.set(contractKey, order)

    const second = await postT2("44444444-4444-4444-8444-444444444444")
    expect(second.status).toBe(200)
    expect(stripeModule.__create).toHaveBeenCalledTimes(2)
    expect(stripeModule.__create.mock.calls[0][1]).toEqual(stripeModule.__create.mock.calls[1][1])
  })

  it("only increments the attempt after the prior bound session is confirmed expired", async () => {
    const first = await postT2("11111111-1111-4111-8111-111111111111")
    expect(first.status).toBe(200)
    const [contractKey, order] = Array.from(state.orders.entries())[0]
    state.stripeSessions.set(String(order.stripeSessionId), {
      id: order.stripeSessionId,
      url: "https://checkout.stripe.test/expired",
      status: "expired",
      expires_at: Math.floor((nowMs - 60_000) / 1000),
    })

    const second = await postT2("55555555-5555-4555-8555-555555555555")
    expect(second.status).toBe(200)
    expect(state.orders.get(contractKey)?.attempt).toBe(1)
    expect(stripeModule.__create.mock.calls[1][1]).toEqual({ idempotencyKey: expect.stringMatching(/:1$/) })
  })

  it("allows only one provider creation when two workers race from the same pending row", async () => {
    const first = await postT2("11111111-1111-4111-8111-111111111111")
    expect(first.status).toBe(200)
    stripeModule.__create.mockClear()

    const [contractKey, seedOrder] = Array.from(state.orders.entries())[0]
    seedOrder.status = "CHECKOUT_PENDING"
    seedOrder.stripeSessionId = null
    state.orders.set(contractKey, seedOrder)

    const db = jest.requireMock("@/lib/db") as {
      prisma: { oTOrder: { updateMany: jest.Mock } }
    }
    const realUpdateMany = db.prisma.oTOrder.updateMany.getMockImplementation() as (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>
    let claimCalls = 0
    let releaseClaims!: () => void
    const claimBarrier = new Promise<void>((resolve) => { releaseClaims = resolve })
    db.prisma.oTOrder.updateMany.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (args.data.status === "CHECKOUT_CREATING") {
        claimCalls += 1
        if (claimCalls <= 2) {
          if (claimCalls === 2) releaseClaims()
          await claimBarrier
        }
      }
      return realUpdateMany(args)
    })

    const [left, right] = await Promise.all([
      postT2("22222222-2222-4222-8222-222222222222"),
      postT2("33333333-3333-4333-8333-333333333333"),
    ])

    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    const payloads = await Promise.all([left.json(), right.json()])
    const urls = payloads.filter((body) => typeof body?.url === "string").map((body) => body.url)
    expect(new Set(urls).size).toBe(1)
    expect(urls.length).toBeGreaterThanOrEqual(1)
  })

  it("allows only one provider creation when two workers race to reclaim the same stale creating row", async () => {
    const first = await postT2("11111111-1111-4111-8111-111111111111")
    expect(first.status).toBe(200)
    stripeModule.__create.mockClear()

    const [contractKey, order] = Array.from(state.orders.entries())[0]
    const staleUpdatedAt = new Date(nowMs - 20 * 60 * 1000)
    order.status = "CHECKOUT_CREATING"
    order.stripeSessionId = null
    order.updatedAt = staleUpdatedAt
    state.orders.set(contractKey, order)

    const db = jest.requireMock("@/lib/db") as {
      prisma: { oTOrder: { updateMany: jest.Mock } }
    }
    const realUpdateMany = db.prisma.oTOrder.updateMany.getMockImplementation() as (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>
    let claimCalls = 0
    let releaseClaims!: () => void
    const claimBarrier = new Promise<void>((resolve) => { releaseClaims = resolve })
    db.prisma.oTOrder.updateMany.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (args.data.status === "CHECKOUT_CREATING") {
        claimCalls += 1
        if (claimCalls <= 2) {
          if (claimCalls === 2) releaseClaims()
          await claimBarrier
        }
      }
      return realUpdateMany(args)
    })

    const [left, right] = await Promise.all([
      postT2("44444444-4444-4444-8444-444444444444"),
      postT2("55555555-5555-4555-8555-555555555555"),
    ])

    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    const payloads = await Promise.all([left.json(), right.json()])
    const urls = payloads.filter((body) => typeof body?.url === "string").map((body) => body.url)
    expect(new Set(urls).size).toBe(1)
    expect(urls.length).toBeGreaterThanOrEqual(1)
  })

  it("creates no order at all when the filing window is too close to sell into", async () => {
    // This case used to prove that the Stripe session-expiry clamp
    // (STRIPE_MIN_CHECKOUT_SECONDS, 30 minutes) refused without stranding a
    // pre-created order in CHECKOUT_CREATING.
    //
    // The approved three-business-day product cutoff now refuses the same
    // request earlier and for the better reason: a window closing today has no
    // business days left, so there is no packet to sell regardless of how long
    // a provider session could live. Because that cutoff runs before any order
    // row is written, the original invariant is not merely preserved but
    // strengthened — there is no order to strand.
    //
    // The provider clamp remains in the route as defence in depth. Behind a
    // three-business-day floor it is no longer reachable on this path, since a
    // close date that far out always leaves far more than thirty minutes.
    jest.useFakeTimers().setSystemTime(new Date("2026-07-23T23:45:30.000Z"))
    nowMs = Date.now()
    armWindow(0)

    // Called directly rather than through `postT2`: the refusal lands before
    // the acknowledgment gate, and that helper consumes the body it inspects.
    const res = await POST(request("66666666-6666-4666-8666-666666666666"))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: "CHECKOUT_WINDOW_CLOSING_TOO_SOON",
      minimumBusinessDays: 3,
    })
    expect(stripeModule.__create).not.toHaveBeenCalled()
    expect(state.orders.size).toBe(0)
  })

  it("does not create or reuse any order row for the held T3 tier", async () => {
    const res = await POST(new NextRequest("https://www.overtaxed-il.com/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "T3",
        email: "Buyer@example.com",
        name: " Buyer Name ",
        address: "1 Test St, Elk Grove Village IL 60007",
        checkoutKey: "77777777-7777-4777-8777-777777777777",
      }),
    }))

    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ code: "PRODUCT_HELD", product: "T3_DFY" })
    // The reuse machinery is upstream of the provider but downstream of the
    // hold: a held tier must not even acquire a contract key, or a later
    // release would find half-formed rows waiting to be reused.
    expect(state.orders.size).toBe(0)
    expect(stripeModule.__create).not.toHaveBeenCalled()
  })
})

describe("POST /api/checkout/session scoped full-discount promotion codes", () => {
  const fullPromo = (coupon: Record<string, unknown> = {}, promo: Record<string, unknown> = {}) => ({
    id: "promo_full",
    code: "FREEREPORT",
    active: true,
    promotion: { type: "coupon", coupon: { id: "coupon_full", valid: true, percent_off: 100, amount_off: null, currency: null, applies_to: { products: ["prod_t2"] }, ...coupon } },
    ...promo,
  })
  beforeEach(() => {
    process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS = "promo_full"
  })
  afterAll(() => {
    delete process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS
  })

  it("keeps the ordinary paid session unchanged when no code is entered", async () => {
    const res = await postT2("11111111-1111-4111-8111-111111111111")
    expect(res.status).toBe(200)
    const params = stripeModule.__create.mock.calls[0][0]
    expect(params).not.toHaveProperty("discounts")
    expect(params).not.toHaveProperty("allow_promotion_codes")
    expect(params.line_items).toEqual([{ price: "price_t2", quantity: 1 }])
    expect(stripeModule.__listPromotionCodes).not.toHaveBeenCalled()
    // Explicit "none" binding: never a `promo_…` id, so zero-total settlement still fails closed.
    expect(Array.from(state.orders.values())[0].checkoutDiscountPromotionCodeId).toBe("none")
  })

  it("applies an allowlisted product-scoped full discount server-side and persists it on the durable order", async () => {
    stripeModule.__listPromotionCodes.mockResolvedValue({ data: [fullPromo()] })
    const res = await postT2("11111111-1111-4111-8111-111111111111", { promotionCode: "FREEREPORT" })
    expect(res.status).toBe(200)
    expect(stripeModule.__listPromotionCodes).toHaveBeenCalledWith(expect.objectContaining({ code: "FREEREPORT", active: true }))
    const params = stripeModule.__create.mock.calls[0][0]
    expect(params.discounts).toEqual([{ promotion_code: "promo_full" }])
    expect(params.line_items).toEqual([{ price: "price_t2", quantity: 1 }])
    const order = Array.from(state.orders.values())[0]
    expect(order.checkoutAmountCents).toBe(6900)
    expect(order.checkoutDiscountPromotionCodeId).toBe("promo_full")
    expect(order.status).toBe("CHECKOUT_CREATED")
  })

  it.each([
    ["not allowlisted", fullPromo({}, { id: "promo_other" })],
    ["partial discount", fullPromo({ percent_off: 50 })],
    ["scoped to a different product", fullPromo({ applies_to: { products: ["prod_t3"] } })],
  ])("refuses a code that is %s before any provider session or order claim", async (_n, promo) => {
    stripeModule.__listPromotionCodes.mockResolvedValue({ data: [promo] })
    const res = await postT2("11111111-1111-4111-8111-111111111111", { promotionCode: "FREEREPORT" })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_PROMOTION_CODE" })
    expect(stripeModule.__create).not.toHaveBeenCalled()
  })
})

describe("POST /api/checkout/session promotion binding on reuse and retry", () => {
  const promoWith = (id: string, code: string) => ({
    id,
    code,
    active: true,
    promotion: { type: "coupon", coupon: { id: `coupon_${id}`, valid: true, percent_off: 100, amount_off: null, currency: null, applies_to: { products: ["prod_t2"] } } },
  })
  const KEY_A = "11111111-1111-4111-8111-111111111111"
  const KEY_B = "22222222-2222-4222-8222-222222222222"
  beforeEach(() => {
    process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS = "promo_full,promo_other"
    stripeModule.__listPromotionCodes.mockImplementation(async (params: { code?: string }) => ({
      data: params.code === "FREEREPORT" ? [promoWith("promo_full", "FREEREPORT")]
        : params.code === "OTHERFREE" ? [promoWith("promo_other", "OTHERFREE")]
        : [],
    }))
  })
  afterAll(() => {
    delete process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS
    stripeModule.__listPromotionCodes.mockReset()
  })

  const onlyOrder = () => {
    expect(state.orders.size).toBe(1)
    return Array.from(state.orders.values())[0]
  }
  const onlyOrderStatus = () => Array.from(state.orders.values())[0]?.status

  it.each([
    ["paid/no coupon then coupon", {}, { promotionCode: "FREEREPORT" }],
    ["coupon then no coupon", { promotionCode: "FREEREPORT" }, {}],
    ["coupon then a different allowlisted code", { promotionCode: "FREEREPORT" }, { promotionCode: "OTHERFREE" }],
  ])("refuses %s against the open session without a second order or provider session", async (_n, firstTerms, secondTerms) => {
    const first = await postT2(KEY_A, firstTerms)
    expect(first.status).toBe(200)
    const { url } = await first.json()
    const before = { ...onlyOrder() }

    const second = await postT2(KEY_B, secondTerms)
    expect(second.status).toBe(409)
    const body = await second.json()
    expect(body).toMatchObject({ code: "CHECKOUT_PROMOTION_CONFLICT" })
    expect(JSON.stringify(body)).not.toContain(url)
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    const after = onlyOrder()
    expect(after.stripeSessionId).toBe(before.stripeSessionId)
    expect(after.attempt).toBe(before.attempt)
    expect(after.checkoutDiscountPromotionCodeId ?? null).toBe(before.checkoutDiscountPromotionCodeId ?? null)
  })

  it.each([
    ["no coupon", {}],
    ["the same coupon", { promotionCode: "FREEREPORT" }],
  ])("reuses the same order, session and URL for a same-terms retry with %s", async (_n, terms) => {
    const first = await postT2(KEY_A, terms)
    const second = await postT2(KEY_B, terms)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(await first.json())
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    onlyOrder()
  })

  it.each([
    ["no coupon", {}, "none"],
    ["a coupon", { promotionCode: "FREEREPORT" }, "promo_full"],
  ])("durably binds %s on the order BEFORE the provider create call", async (_n, terms, binding) => {
    const seen: Array<{ status: unknown; binding: unknown }> = []
    stripeModule.__create.mockImplementationOnce(async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
      const row = Array.from(state.orders.values())[0]
      seen.push({ status: row?.status, binding: row?.checkoutDiscountPromotionCodeId ?? null })
      const id = `cs_contract_${++createCount}`
      const url = `https://checkout.stripe.test/${id}`
      state.stripeSessions.set(id, { id, url, status: "open", idempotencyKey: options?.idempotencyKey ?? null, params })
      return { id, url }
    })
    const res = await postT2(KEY_A, terms)
    expect(res.status).toBe(200)
    expect(seen).toEqual([{ status: "CHECKOUT_CREATING", binding }])
    expect(onlyOrder().checkoutDiscountPromotionCodeId).toBe(binding)
  })

  it("after an ambiguous provider-create failure, retries same terms under the same idempotency key and refuses changed terms", async () => {
    stripeModule.__create.mockImplementationOnce(async () => {
      throw new Error("socket hang up after request was sent")
    })
    const first = await postT2(KEY_A, { promotionCode: "FREEREPORT" })
    expect(first.status).toBe(502)
    const failed = onlyOrder()
    expect(failed.status).toBe("CHECKOUT_FAILED")
    expect(failed.checkoutDiscountPromotionCodeId).toBe("promo_full")
    const firstKey = stripeModule.__create.mock.calls[0][1]

    for (const changed of [{}, { promotionCode: "OTHERFREE" }]) {
      const refused = await postT2(KEY_B, changed)
      expect(refused.status).toBe(409)
      expect(await refused.json()).toMatchObject({ code: "CHECKOUT_PROMOTION_CONFLICT" })
    }
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    expect(onlyOrder().status).toBe("CHECKOUT_FAILED")

    const retry = await postT2(KEY_B, { promotionCode: "FREEREPORT" })
    expect(retry.status).toBe(200)
    expect(stripeModule.__create).toHaveBeenCalledTimes(2)
    expect(stripeModule.__create.mock.calls[1][1]).toEqual(firstKey)
    expect(stripeModule.__create.mock.calls[1][0].discounts).toEqual([{ promotion_code: "promo_full" }])
    expect(onlyOrder()).toMatchObject({ status: "CHECKOUT_CREATED", checkoutDiscountPromotionCodeId: "promo_full", attempt: 0 })
  })

  it("refuses changed terms on a stale CHECKOUT_CREATING lease without reclaiming it", async () => {
    stripeModule.__create.mockImplementationOnce(async () => new Promise(() => {}) as never)
    void postT2(KEY_A, { promotionCode: "FREEREPORT" })
    for (let i = 0; i < 100 && onlyOrderStatus() !== "CHECKOUT_CREATING"; i++) await new Promise((r) => setTimeout(r, 5))
    const row = onlyOrder()
    expect(row.status).toBe("CHECKOUT_CREATING")
    row.updatedAt = new Date(Date.now() - 20 * 60 * 1000)

    const refused = await postT2(KEY_B, {})
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: "CHECKOUT_PROMOTION_CONFLICT" })
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    expect(onlyOrder()).toMatchObject({ status: "CHECKOUT_CREATING", checkoutDiscountPromotionCodeId: "promo_full" })
  })

  it("refuses changed terms after the bound session expired, without advancing the attempt", async () => {
    await postT2(KEY_A, {})
    const order = onlyOrder()
    state.stripeSessions.set(String(order.stripeSessionId), { id: order.stripeSessionId, url: "https://checkout.stripe.test/expired", status: "expired" })

    const refused = await postT2(KEY_B, { promotionCode: "FREEREPORT" })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: "CHECKOUT_PROMOTION_CONFLICT" })
    expect(onlyOrder()).toMatchObject({ attempt: 0, status: "CHECKOUT_CREATED" })
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
  })

  it("treats a legacy CHECKOUT_CREATED row with a null binding as explicit none", async () => {
    await postT2(KEY_A, {})
    const order = onlyOrder()
    order.checkoutDiscountPromotionCodeId = null

    const refused = await postT2(KEY_B, { promotionCode: "FREEREPORT" })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: "CHECKOUT_PROMOTION_CONFLICT" })
    const reused = await postT2(KEY_B, {})
    expect(reused.status).toBe(200)
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["legacy FAILED", { status: "CHECKOUT_FAILED", stripeSessionId: null }],
    ["legacy stale CREATING", { status: "CHECKOUT_CREATING", stripeSessionId: null, updatedAt: new Date(Date.now() - 20 * 60 * 1000) }],
    ["questionable PENDING holding a session", { status: "CHECKOUT_PENDING" }],
  ])("refuses a %s row with a null binding for any terms before any Stripe call, leaving it unchanged", async (_n, legacy) => {
    await postT2(KEY_A, {})
    const order = onlyOrder()
    Object.assign(order, legacy, { checkoutDiscountPromotionCodeId: null })
    const before = { ...order }
    stripeModule.__create.mockClear()
    stripeModule.__retrieveSession.mockClear()

    for (const terms of [{}, { promotionCode: "FREEREPORT" }]) {
      const refused = await postT2(KEY_B, terms)
      expect(refused.status).toBe(409)
      expect(await refused.json()).toMatchObject({ code: "CHECKOUT_PROMOTION_CONFLICT" })
    }
    expect(stripeModule.__create).not.toHaveBeenCalled()
    expect(stripeModule.__retrieveSession).not.toHaveBeenCalled()
    expect(state.orders.size).toBe(1)
    expect(onlyOrder()).toEqual(before)
  })

  it("binds a never-attempted unbound PENDING row to the first claimant's terms before the provider call", async () => {
    await postT2(KEY_A, {})
    const order = onlyOrder()
    Object.assign(order, { status: "CHECKOUT_PENDING", stripeSessionId: null, checkoutDiscountPromotionCodeId: null })

    const res = await postT2(KEY_B, { promotionCode: "FREEREPORT" })
    expect(res.status).toBe(200)
    expect(onlyOrder().checkoutDiscountPromotionCodeId).toBe("promo_full")
    const refused = await postT2(KEY_A, {})
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: "CHECKOUT_PROMOTION_CONFLICT" })
    expect(stripeModule.__create).toHaveBeenCalledTimes(2)
  })

  it("a racing claim loser with different terms never receives the winner's session URL", async () => {
    const first = await postT2(KEY_A, {})
    expect(first.status).toBe(200)
    const order = onlyOrder()
    Object.assign(order, { status: "CHECKOUT_PENDING", stripeSessionId: null, checkoutDiscountPromotionCodeId: null })
    stripeModule.__create.mockClear()

    const db = jest.requireMock("@/lib/db") as { prisma: { oTOrder: { updateMany: jest.Mock } } }
    const realUpdateMany = db.prisma.oTOrder.updateMany.getMockImplementation() as (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>
    let claimCalls = 0
    let releaseClaims!: () => void
    const claimBarrier = new Promise<void>((resolve) => { releaseClaims = resolve })
    db.prisma.oTOrder.updateMany.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (args.data.status === "CHECKOUT_CREATING") {
        claimCalls += 1
        if (claimCalls <= 2) {
          if (claimCalls === 2) releaseClaims()
          await claimBarrier
        }
      }
      return realUpdateMany(args)
    })
    try {
      const [left, right] = await Promise.all([
        postT2(KEY_A, { promotionCode: "FREEREPORT" }),
        postT2(KEY_B, {}),
      ])
      expect(stripeModule.__create).toHaveBeenCalledTimes(1)
      const bodies = await Promise.all([left.json(), right.json()])
      expect(bodies.filter((b) => typeof b?.url === "string")).toHaveLength(1)
      expect(bodies.filter((b) => b?.code === "CHECKOUT_PROMOTION_CONFLICT")).toHaveLength(1)
    } finally {
      db.prisma.oTOrder.updateMany.mockImplementation(realUpdateMany)
    }
  })
})
