/** @jest-environment node */
// Phase-one reproduction for DESIGN.md rev 2 (root of this scratch directory):
// a neutral reservation denial/throw writes NO order state.
//
// ACTUAL app/api/checkout/session/route.ts POST on the neutral, non-transfer
// branch. MOCKED route evidence, not PostgreSQL: the in-memory `updateMany`
// below models Prisma CAS semantics (a predicate matches only an unchanged row;
// `@updatedAt` moves on every write). Assertions are about behaviour, never a
// marker representation.
//
// RED-TODAY tests reproduce D1 (same-order retry permanently 409), D2 (stale
// failure clobbers a resolved row) or D3 (legacy reason never cleared, which
// blocks artifact binding). GREEN-TODAY tests guard properties that already
// hold and must keep holding.

import { NextRequest } from "next/server"

type OrderRow = Record<string, any>

const LEGACY_REASON = "NEUTRAL_RESERVATION_FAILED"

const state: { orders: Map<string, OrderRow>; stripeSessions: Map<string, Record<string, any>> } = {
  orders: new Map(),
  stripeSessions: new Map(),
}
let createCount = 0
let mockClock = Date.now()
/** Strictly increasing write instants, so every unsupplied `updatedAt` moves. */
const nextStamp = () => new Date(++mockClock)

function matchesWhere(row: OrderRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    const rowValue = row[key]
    if (key === "eligibilitySnapshot" && value && typeof value === "object" && "equals" in value) {
      return JSON.stringify(rowValue ?? null) === JSON.stringify((value as { equals: unknown }).equals)
    }
    if (value && typeof value === "object" && "not" in value) {
      const excluded = (value as { not: unknown }).not
      return excluded === null ? rowValue != null : rowValue !== excluded
    }
    if (value === null) return rowValue == null
    if (value instanceof Date) return rowValue instanceof Date && rowValue.getTime() === value.getTime()
    return rowValue === value
  })
}

jest.mock("stripe", () => {
  const create = jest.fn(async (_params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
    const id = `cs_neutral_${++createCount}`
    const url = `https://checkout.stripe.test/${id}`
    state.stripeSessions.set(id, { id, url, status: "open", idempotencyKey: options?.idempotencyKey ?? null })
    return { id, url, status: "open" }
  })
  const retrievePrice = jest.fn(async (id: string) => ({ id, active: true, type: "one_time", unit_amount: 6900, currency: "usd", product: "prod_t2" }))
  const retrieveSession = jest.fn(async (id: string) => state.stripeSessions.get(id) ?? null)
  const listPromotionCodes = jest.fn(async (_params: Record<string, unknown>) => ({ data: [] as unknown[] }))
  const Stripe = jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create, retrieve: retrieveSession } },
    prices: { retrieve: retrievePrice },
    promotionCodes: { list: listPromotionCodes },
  }))
  return { __esModule: true, default: Stripe, __create: create, __retrievePrice: retrievePrice, __retrieveSession: retrieveSession, __listPromotionCodes: listPromotionCodes }
})

jest.mock("@/lib/marketing/preview-gate", () => ({
  hostFromRequest: jest.fn(() => "www.overtaxed-il.com"),
  isPreviewStubEnabled: jest.fn(() => false),
  marketingGateReason: jest.fn(() => "test"),
  previewNoopResponseBody: jest.fn(() => ({ mode: "preview_noop" })),
}))
jest.mock("@/lib/rate-limit", () => ({ rateLimit: jest.fn(() => ({ allowed: true })), getClientIdentifier: jest.fn(() => "client-test") }))
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

const mockSnapshot: { schemaVersion: number; synthetic: boolean; sources: Record<string, unknown>; townships: Record<string, unknown> } =
  { schemaVersion: 1, synthetic: true, sources: {}, townships: {} }
jest.mock("@/data/deadlines/cook-county.json", () => mockSnapshot)
jest.mock("@/lib/deadlines/commerce-deadline-authority", () => ({
  projectCommerceDeadline: jest.fn(async ({ township, at }: { township: unknown; at: Date }) => {
    const { evaluateOfficialDeadlineState, projectDeadline } = jest.requireActual("@/lib/deadlines/official-source-state")
    return projectDeadline(evaluateOfficialDeadlineState({ snapshot: mockSnapshot, township, stage: "assessor", evaluatedAt: at.toISOString() }), at.toISOString())
  }),
}))

// Strict policy unsigned (as shipped), so only the neutral authority can admit.
jest.mock("@/lib/checkout/ot-contract", () => ({ ...jest.requireActual("@/lib/checkout/ot-contract"), signedPolicyVersion: () => null }))
// The property-shape gate is unit-tested elsewhere; here it admits.
jest.mock("@/lib/commerce/neutral-checkout-gate", () => ({
  ...jest.requireActual("@/lib/commerce/neutral-checkout-gate"),
  evaluateNeutralCheckout: () => ({ allowed: true, policyVersion: "ot-neutral-records-report/2026-09-15", pin: "09000000000000" }),
}))
jest.mock("@/lib/commerce/snapshot-checkout-transfer", () => ({
  productionSnapshotTransferAuthority: () => ({ readClaim: () => ({ status: "ABSENT" }) }),
}))

const mockNeutral = {
  reserve: jest.fn(async (_input: { orderId: string }): Promise<Record<string, unknown>> => ({ ok: true, created: true })),
  unbound: jest.fn(async (_orderId: string) => ({ ok: true })),
  intend: jest.fn(async (_input: Record<string, unknown>) => "neutral_attempt_1"),
  observe: jest.fn(async () => true),
  markUnknown: jest.fn(async () => true),
}
jest.mock("@/lib/commerce/neutral-checkout-runtime", () => {
  const at = new Date(Date.now() - 60_000).toISOString()
  return {
    loadNeutralCheckoutOfficialProperty: async () => ({
      property: { pin: "09000000000000" },
      dataEvidenceSha256: "a".repeat(64),
      sourceContentSha256: "b".repeat(64),
      officialRetrievedAt: at,
      officialOldestRetrievedAt: at,
    }),
    loadNeutralCheckoutFromTransfer: async () => null,
    neutralDeadlineEvidence: () => ({ sha256: "c".repeat(64), identitySha256: "d".repeat(64), retrievedAt: at }),
    neutralAdmissionSha256: () => "e".repeat(64),
    neutralCheckoutUnboundOrRefuse: (orderId: string) => mockNeutral.unbound(orderId),
    reserveNeutralCheckout: (input: { orderId: string }) => mockNeutral.reserve(input),
    prepareNeutralCheckoutAdmission: async () => ({ ok: true }),
    intendNeutralCheckout: (input: Record<string, unknown>) => mockNeutral.intend(input),
    observeNeutralCheckout: () => mockNeutral.observe(),
    markNeutralCheckoutUnknown: () => mockNeutral.markUnknown(),
  }
})

jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; contractKey?: string; checkoutKey?: string } }) => {
        const row = Array.from(state.orders.values()).find((candidate) =>
          (where.id && candidate.id === where.id) ||
          (where.contractKey && candidate.contractKey === where.contractKey) ||
          (where.checkoutKey && candidate.checkoutKey === where.checkoutKey))
        return row ? { ...row } : null
      }),
      upsert: jest.fn(async ({ where, create }: { where: { contractKey: string }; create: OrderRow }) => {
        const existing = state.orders.get(where.contractKey)
        if (existing) return { ...existing }
        const stamp = nextStamp()
        const row = { id: `ord_${state.orders.size + 1}`, attempt: 0, status: "CHECKOUT_PENDING", ...create, updatedAt: stamp, createdAt: stamp }
        state.orders.set(where.contractKey, row)
        return { ...row }
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = Array.from(state.orders.values()).find((candidate) => matchesWhere(candidate, where))
        if (!row) return { count: 0 }
        const { attempt, updatedAt, ...rest } = data
        Object.assign(row, rest)
        if (attempt && typeof attempt === "object" && "increment" in attempt) {
          row.attempt = Number(row.attempt ?? 0) + Number((attempt as { increment: number }).increment)
        }
        row.updatedAt = updatedAt instanceof Date ? updatedAt : nextStamp()
        return { count: 1 }
      }),
    },
  },
}))

process.env.STRIPE_SECRET_KEY = "sk_test_neutral_retry"
process.env.STRIPE_PRICE_T2_DIY_PRO = "price_t2"
process.env.STRIPE_PRICE_T3_DFY = "price_t3"
process.env.OT_CHECKOUT_GATE_SECRET = "test-gate-secret-at-least-32-characters"
process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = "true"

const stripeModule = jest.requireMock("stripe") as { __create: jest.Mock; __retrievePrice: jest.Mock; __retrieveSession: jest.Mock; __listPromotionCodes: jest.Mock }
const db = jest.requireMock("@/lib/db") as { prisma: { oTOrder: { updateMany: jest.Mock } } }
const realUpdateMany = db.prisma.oTOrder.updateMany.getMockImplementation() as (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>
const { POST } = require("@/app/api/checkout/session/route") as typeof import("@/app/api/checkout/session/route")

const KEY_A = "11111111-1111-4111-8111-111111111111"
const KEY_B = "22222222-2222-4222-8222-222222222222"
const PROMO = { promotionCode: "FREEREPORT" }
const OK = { ok: true, created: true }
const DENIED = { ok: false, blocker: "NEUTRAL_RESERVATION_CONFLICT" }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function request(checkoutKey: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("https://www.overtaxed-il.com/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "T2", email: "Buyer@example.com", name: " Buyer Name ", address: "1 Test St, Elk Grove Village IL 60007", checkoutKey, ...extra }),
  })
}

async function postT2(checkoutKey: string, extra: Record<string, unknown> = {}) {
  const challenge = await POST(request(checkoutKey, extra))
  const body = await challenge.json()
  if (body?.code !== "T2_ACKNOWLEDGMENT_REQUIRED") return { status: challenge.status, json: body }
  const res = await POST(request(checkoutKey, { analysisAcknowledged: true, acknowledgmentToken: body.acknowledgmentToken, ...extra }))
  return { status: res.status, json: await res.json() }
}

function countyDay(days: number, from: Date = new Date()): string {
  const at = new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
}

function armWindow(closesInDays = 20) {
  const now = new Date()
  const url = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
  const source = { authority: "cook_county_assessor", sourceUrl: url, retrievedAt: new Date(now.getTime() - 5000).toISOString(), sourceUpdatedAt: null, contentSha256: "f".repeat(64), httpStatus: 200, finalUrl: url, parseStatus: "ok", parserVersion: "1.0.0" }
  mockSnapshot.synthetic = false
  mockSnapshot.sources = { assessor: source, bor: source }
  mockSnapshot.townships = { "elk-grove": { townshipName: "Elk Grove", stages: { assessor: { noticeDate: null, openDate: countyDay(-10, now), lastFileDate: countyDay(closesInDays, now) } } } }
}

const promoWith = (id: string, code: string) => ({
  id,
  code,
  active: true,
  promotion: { type: "coupon", coupon: { id: `coupon_${id}`, valid: true, percent_off: 100, amount_off: null, currency: null, applies_to: { products: ["prod_t2"] } } },
})

function onlyOrder(): OrderRow {
  expect(state.orders.size).toBe(1)
  return Array.from(state.orders.values())[0]
}
const peekStatus = () => Array.from(state.orders.values())[0]?.status
const n = (v: unknown) => v ?? null
const keyFor = (row: OrderRow, attempt: number) => `ot:${row.contractKey}:${attempt}`
const sessionCalls = () => stripeModule.__create.mock.calls.length + stripeModule.__retrieveSession.mock.calls.length
const orderWrites = () => db.prisma.oTOrder.updateMany.mock.calls.length
const clearCallLog = () => {
  stripeModule.__create.mockClear()
  stripeModule.__retrieveSession.mockClear()
  mockNeutral.reserve.mockClear()
  db.prisma.oTOrder.updateMany.mockClear()
}

/** Creates the deterministic order through the route; its first reservation is denied. */
async function seedWithDeniedReservation() {
  mockNeutral.reserve.mockResolvedValueOnce(DENIED)
  const seeded = await postT2(KEY_A)
  expect(seeded).toMatchObject({ status: 503, json: { code: "NEUTRAL_RESERVATION_UNAVAILABLE" } })
  return onlyOrder()
}

beforeEach(() => {
  jest.clearAllMocks()
  db.prisma.oTOrder.updateMany.mockImplementation(realUpdateMany)
  mockNeutral.reserve.mockImplementation(async () => OK)
  state.orders.clear()
  state.stripeSessions.clear()
  createCount = 0
  mockClock = Date.now()
  armWindow()
  process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS = "promo_full,promo_other"
  stripeModule.__listPromotionCodes.mockImplementation(async (params: { code?: string }) => ({
    data: params.code === "FREEREPORT" ? [promoWith("promo_full", "FREEREPORT")] : params.code === "OTHERFREE" ? [promoWith("promo_other", "OTHERFREE")] : [],
  }))
})
afterAll(() => {
  delete process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS
  delete process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED
})

describe("neutral reservation failure writes no order state; the SAME deterministic order stays fresh", () => {
  it.each([
    ["denied", () => mockNeutral.reserve.mockResolvedValueOnce(DENIED)],
    ["throwing", () => mockNeutral.reserve.mockRejectedValueOnce(new Error("reservation COMMIT outcome unknown"))],
  ])("T1 (RED-TODAY) %s reservation: 503, zero order writes, zero session calls; a same-terms retry re-runs admission and succeeds on the same order", async (_n, arrange) => {
    arrange()
    const first = await postT2(KEY_A)
    expect(first).toMatchObject({ status: 503, json: { code: "NEUTRAL_RESERVATION_UNAVAILABLE" } })
    expect(sessionCalls()).toBe(0)
    expect(orderWrites()).toBe(0)
    const fresh = { ...onlyOrder() }
    expect(fresh.status).toBe("CHECKOUT_PENDING")
    expect(n(fresh.recoveryReason)).toBeNull()
    expect(n(fresh.checkoutDiscountPromotionCodeId)).toBeNull()
    expect(n(fresh.stripeSessionId)).toBeNull()

    const retry = await postT2(KEY_A)
    expect(retry.status).toBe(200)
    expect(typeof retry.json.url).toBe("string")
    expect(mockNeutral.reserve).toHaveBeenCalledTimes(2)
    const after = onlyOrder()
    expect(after).toMatchObject({ id: fresh.id, contractKey: fresh.contractKey, status: "CHECKOUT_CREATED", attempt: 0, checkoutDiscountPromotionCodeId: "none" })
    // Fulfilment (artifact-binding.ts:297) requires a null recoveryReason.
    expect(n(after.recoveryReason)).toBeNull()
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    expect(stripeModule.__create.mock.calls[0][1]).toEqual({ idempotencyKey: keyFor(fresh, 0) })
    expect(stripeModule.__create.mock.calls[0][0]).not.toHaveProperty("discounts")
  })

  it("T1c (RED-TODAY) repeated denials and throws leave the same fresh order; the first admitted retry succeeds", async () => {
    mockNeutral.reserve
      .mockResolvedValueOnce(DENIED)
      .mockRejectedValueOnce(new Error("unknown"))
      .mockResolvedValueOnce({ ok: false, blocker: "NEUTRAL_ADMISSION_STALE" })
    for (let i = 0; i < 3; i++) expect(await postT2(i === 1 ? KEY_B : KEY_A)).toMatchObject({ status: 503, json: { code: "NEUTRAL_RESERVATION_UNAVAILABLE" } })
    expect(orderWrites()).toBe(0)
    const fresh = { ...onlyOrder() }
    expect(fresh.status).toBe("CHECKOUT_PENDING")
    expect(await postT2(KEY_B)).toMatchObject({ status: 200 })
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    expect(stripeModule.__create.mock.calls[0][1]).toEqual({ idempotencyKey: keyFor(fresh, 0) })
    expect(onlyOrder()).toMatchObject({ id: fresh.id, status: "CHECKOUT_CREATED" })
  })

  it("T2 (RED-TODAY) a failure committed no terms: the retry may bind the full-discount promo, after which changed terms are refused", async () => {
    const fresh = { ...(await seedWithDeniedReservation()) }
    const retry = await postT2(KEY_A, PROMO)
    expect(retry.status).toBe(200)
    expect(stripeModule.__create.mock.calls[0][0].discounts).toEqual([{ promotion_code: "promo_full" }])
    expect(stripeModule.__create.mock.calls[0][1]).toEqual({ idempotencyKey: keyFor(fresh, 0) })
    expect(onlyOrder()).toMatchObject({ id: fresh.id, status: "CHECKOUT_CREATED", checkoutDiscountPromotionCodeId: "promo_full" })

    for (const changed of [{}, { promotionCode: "OTHERFREE" }]) {
      const refused = await postT2(KEY_B, changed)
      expect(refused).toMatchObject({ status: 409, json: { code: "CHECKOUT_PROMOTION_CONFLICT" } })
      expect(JSON.stringify(refused.json)).not.toContain("checkout.stripe.test")
    }
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
  })

  it("T3 (GREEN-TODAY) an evidence-conflict denial writes no order state at all", async () => {
    mockNeutral.reserve.mockResolvedValueOnce({ ok: false, blocker: "NEUTRAL_EVIDENCE_CONFLICT" })
    const res = await postT2(KEY_A)
    expect(res).toMatchObject({ status: 409, json: { code: "NEUTRAL_EVIDENCE_CONFLICT" } })
    const row = onlyOrder()
    expect(row.status).toBe("CHECKOUT_PENDING")
    expect(n(row.recoveryReason)).toBeNull()
    expect(orderWrites()).toBe(0)
    expect(sessionCalls()).toBe(0)
  })
})

describe("unknown legacy history and stranded rows stay blocked before any session call or reservation", () => {
  it.each<[string, Record<string, unknown>]>([
    ["FAILED, reason null", { status: "CHECKOUT_FAILED", recoveryReason: null }],
    ["FAILED, stranded legacy NEUTRAL_RESERVATION_FAILED (not auto-upgraded)", { status: "CHECKOUT_FAILED", recoveryReason: LEGACY_REASON }],
    ["FAILED, legacy reason at a later attempt", { status: "CHECKOUT_FAILED", recoveryReason: LEGACY_REASON, attempt: 1 }],
    ["FAILED, a marker-looking reason (rejected rev-1 format is not honoured)", { status: "CHECKOUT_FAILED", recoveryReason: `${LEGACY_REASON}_PRE_SESSION:0:2026-10-25T00:00:00.000Z` }],
    ["stale CREATING with the legacy reason", { status: "CHECKOUT_CREATING", recoveryReason: LEGACY_REASON, updatedAt: new Date(Date.now() - 20 * 60 * 1000) }],
    ["PENDING holding a session, legacy reason", { status: "CHECKOUT_PENDING", stripeSessionId: "cs_ghost_from_old_code", recoveryReason: LEGACY_REASON }],
  ])("T4 (GREEN-TODAY) null binding, %s: refused for any terms, row unchanged", async (_n, legacy) => {
    const row = await seedWithDeniedReservation()
    Object.assign(row, { stripeSessionId: null, checkoutSessionExpiresAt: null, checkoutDiscountPromotionCodeId: null, updatedAt: nextStamp() }, legacy)
    const before = { ...row }
    clearCallLog()

    for (const terms of [{}, PROMO]) {
      const refused = await postT2(KEY_B, terms)
      expect(refused).toMatchObject({ status: 409, json: { code: "CHECKOUT_PROMOTION_CONFLICT" } })
    }
    expect(sessionCalls()).toBe(0)
    expect(mockNeutral.reserve).not.toHaveBeenCalled()
    expect(orderWrites()).toBe(0)
    expect(onlyOrder()).toEqual(before)
  })
})

describe("resolved binding is authoritative; only the exact legacy reason is cleared, at a same-term claim", () => {
  /** A bound row as after an expired session was advanced and a later reservation failed (today's writer). */
  async function boundFailedRow(reason: string) {
    expect((await postT2(KEY_A, {})).status).toBe(200)
    const row = onlyOrder()
    Object.assign(row, { status: "CHECKOUT_FAILED", attempt: 1, stripeSessionId: null, checkoutSessionExpiresAt: null, recoveryReason: reason, updatedAt: nextStamp() })
    expect(row.checkoutDiscountPromotionCodeId).toBe("none")
    clearCallLog()
    return row
  }

  it("T6 (RED-TODAY) legacy reason on a bound row: changed terms refused unchanged; the same-term claim creates once and clears it", async () => {
    const row = await boundFailedRow(LEGACY_REASON)
    const refused = await postT2(KEY_B, PROMO)
    expect(refused).toMatchObject({ status: 409, json: { code: "CHECKOUT_PROMOTION_CONFLICT" } })
    expect(sessionCalls()).toBe(0)
    expect(onlyOrder().recoveryReason).toBe(LEGACY_REASON)

    const retry = await postT2(KEY_A, {})
    expect(retry.status).toBe(200)
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    expect(stripeModule.__create.mock.calls[0][1]).toEqual({ idempotencyKey: keyFor(row, 1) })
    const after = onlyOrder()
    expect(after).toMatchObject({ status: "CHECKOUT_CREATED", attempt: 1, checkoutDiscountPromotionCodeId: "none" })
    expect(n(after.recoveryReason)).toBeNull()
  })

  it("T6b (GREEN-TODAY) any other reason value is never cleared by a claim", async () => {
    await boundFailedRow("SOME_OPERATOR_RECOVERY_REASON")
    expect((await postT2(KEY_A, {})).status).toBe(200)
    expect(onlyOrder().recoveryReason).toBe("SOME_OPERATOR_RECOVERY_REASON")
  })

  it("T6c (GREEN-TODAY) a reason-fenced claim loses if the reason changed after it was read", async () => {
    await boundFailedRow(LEGACY_REASON)
    db.prisma.oTOrder.updateMany.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (args.data.status === "CHECKOUT_CREATING") onlyOrder().recoveryReason = "SOME_OPERATOR_RECOVERY_REASON"
      return realUpdateMany(args)
    })
    const res = await postT2(KEY_A, {})
    // Either the claim was fenced on the reason (lost: no session) or it did not touch the reason; never both a clear and a different reason.
    expect(onlyOrder().recoveryReason).toBe("SOME_OPERATOR_RECOVERY_REASON")
    if (res.status !== 200) expect(stripeModule.__create).not.toHaveBeenCalled()
  })
})

describe("races between reservation failures and session claims (mocked CAS)", () => {
  it("T7 (GREEN-TODAY) a late reservation failure cannot disturb the row a concurrent request claimed and finalized", async () => {
    let calls = 0
    let arrived!: () => void
    const bothRead = new Promise<void>((resolve) => { arrived = resolve })
    mockNeutral.reserve.mockImplementation(async () => {
      calls += 1
      if (calls === 1) { await bothRead; return OK }
      arrived()
      for (let i = 0; i < 400 && peekStatus() !== "CHECKOUT_CREATED"; i++) await sleep(5)
      return DENIED
    })
    const results = await Promise.all([postT2(KEY_A), postT2(KEY_B)])
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.status).sort()).toEqual([200, 503])
    const row = onlyOrder()
    expect(row).toMatchObject({ status: "CHECKOUT_CREATED", checkoutDiscountPromotionCodeId: "none" })
    expect(n(row.recoveryReason)).toBeNull()
  })

  it("T8 (RED-TODAY) a failure that completes first leaves the row untouched, so the concurrent claimant that read it still succeeds", async () => {
    let calls = 0
    let arrived!: () => void
    const bothRead = new Promise<void>((resolve) => { arrived = resolve })
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let releaseSecond!: () => void
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve })
    mockNeutral.reserve.mockImplementation(async () => {
      calls += 1
      if (calls === 1) { await firstGate; return DENIED }
      arrived()
      await secondGate
      return OK
    })
    const x = postT2(KEY_A)
    const y = postT2(KEY_B)
    await bothRead
    releaseFirst()
    const firstDone = await Promise.race([x, y])
    expect(firstDone).toMatchObject({ status: 503, json: { code: "NEUTRAL_RESERVATION_UNAVAILABLE" } })
    releaseSecond()
    const results = await Promise.all([x, y])
    expect(results.map((r) => r.status).sort()).toEqual([200, 503])
    expect(stripeModule.__create).toHaveBeenCalledTimes(1)
    const row = onlyOrder()
    expect(stripeModule.__create.mock.calls[0][1]).toEqual({ idempotencyKey: keyFor(row, 0) })
    expect(row).toMatchObject({ status: "CHECKOUT_CREATED", checkoutDiscountPromotionCodeId: "none" })
    expect(n(row.recoveryReason)).toBeNull()
  })

  it("T9 (RED-TODAY) a stale failure from a request that read attempt 0 cannot overwrite a row since resolved and advanced", async () => {
    expect((await postT2(KEY_A, {})).status).toBe(200)
    const row = onlyOrder()
    // Never-attempted unbound PENDING, as session-contract-reuse.test.ts:734 seeds it.
    Object.assign(row, { status: "CHECKOUT_PENDING", stripeSessionId: null, checkoutSessionExpiresAt: null, checkoutDiscountPromotionCodeId: null, updatedAt: nextStamp() })
    clearCallLog()

    mockNeutral.reserve.mockImplementationOnce(async () => {
      // Meanwhile, elsewhere: claim -> create -> finalize -> session expired -> advanced.
      Object.assign(row, { status: "CHECKOUT_PENDING", attempt: 1, stripeSessionId: null, checkoutSessionExpiresAt: null, checkoutDiscountPromotionCodeId: "none", updatedAt: nextStamp() })
      return DENIED
    })
    const stale = await postT2(KEY_B, {})
    expect(stale).toMatchObject({ status: 503, json: { code: "NEUTRAL_RESERVATION_UNAVAILABLE" } })
    expect(onlyOrder()).toMatchObject({ status: "CHECKOUT_PENDING", attempt: 1, checkoutDiscountPromotionCodeId: "none" })
    expect(n(onlyOrder().recoveryReason)).toBeNull()
    expect(orderWrites()).toBe(0)

    const retry = await postT2(KEY_A, {})
    expect(retry.status).toBe(200)
    expect(stripeModule.__create.mock.calls[0][1]).toEqual({ idempotencyKey: keyFor(row, 1) })
    expect(n(onlyOrder().recoveryReason)).toBeNull()
  })

  it("T10 (RED-TODAY) after a failure, two retries with different terms race: exactly one claim, one create, the loser never gets the URL", async () => {
    await seedWithDeniedReservation()
    clearCallLog()
    let claimCalls = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const fallback = setTimeout(() => release(), 1000)
    db.prisma.oTOrder.updateMany.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (args.data.status === "CHECKOUT_CREATING") {
        claimCalls += 1
        if (claimCalls === 2) release()
        if (claimCalls <= 2) await barrier
      }
      return realUpdateMany(args)
    })
    try {
      const results = await Promise.all([postT2(KEY_A, PROMO), postT2(KEY_B, {})])
      expect(stripeModule.__create).toHaveBeenCalledTimes(1)
      const winners = results.filter((r) => r.status === 200)
      expect(winners).toHaveLength(1)
      const loser = results.find((r) => r.status !== 200)!
      expect(loser.status).toBe(409)
      expect(["CHECKOUT_PROMOTION_CONFLICT", "CHECKOUT_ALREADY_STARTED"]).toContain(loser.json.code)
      expect(JSON.stringify(loser.json)).not.toContain(winners[0].json.url)
      const row = onlyOrder()
      expect(row.status).toBe("CHECKOUT_CREATED")
      expect(["promo_full", "none"]).toContain(row.checkoutDiscountPromotionCodeId)
      expect(n(row.recoveryReason)).toBeNull()
    } finally {
      clearTimeout(fallback)
    }
  })
})
