/** @jest-environment node */

jest.mock("stripe", () => {
  const create = jest.fn(async () => ({ id: "cs_test_gate", url: "https://checkout.stripe.test/gate" }))
  const retrievePrice = jest.fn(async (id: string) => ({
    id,
    active: true,
    type: "one_time",
    unit_amount: id === "price_t2" ? 6900 : 9700,
    currency: "usd",
  }))
  const Stripe = jest.fn().mockImplementation(() => ({ checkout: { sessions: { create } }, prices: { retrieve: retrievePrice } }))
  return { __esModule: true, default: Stripe, __create: create, __retrievePrice: retrievePrice }
})

jest.mock("@/lib/marketing/preview-gate", () => ({
  hostFromRequest: jest.fn(() => "www.overtaxed-il.com"),
  isPreviewStubEnabled: jest.fn(() => false),
  marketingGateReason: jest.fn(() => "test"),
  previewNoopResponseBody: jest.fn(() => ({ mode: "preview_noop" })),
}))

jest.mock("@/lib/rate-limit", () => {
  const rateLimit = jest.fn(() => ({ allowed: true }))
  return { rateLimit, getClientIdentifier: jest.fn(() => "test-client"), __limit: rateLimit }
})

jest.mock("@/lib/cook-county", () => {
  const searchPropertiesByAddress = jest.fn(async () => ({
    success: true,
    data: [{ pin: "13243140450000", property_address: "2834 W HENDERSON ST", property_city: "CHICAGO", township_name: "Jefferson" }],
  }))
  const getPropertyByPIN = jest.fn(async () => ({
    success: true,
    data: {
      pin: "13243140450000",
      address: "2834 W HENDERSON ST",
      city: "CHICAGO",
      zipCode: "60618",
      township: "Jefferson",
    },
  }))
  return { searchPropertiesByAddress, getPropertyByPIN, normalizePIN: (v: string) => v.replace(/\D/g, ""), __search: searchPropertiesByAddress, __get: getPropertyByPIN }
})

/**
 * The canonical snapshot the route evaluates against.
 *
 * The route no longer calls `getFreeCheckAppealWindowStatus`; it projects the
 * committed snapshot through `projectTownshipDeadline`, so mocking the free
 * check module influenced nothing and every case fell through to
 * `CHECKOUT_ELIGIBILITY_CLOSED`. This object IS the snapshot module, mutated
 * per-test by `armWindow` / `armPending` below.
 */
const mockSnapshot: {
  schemaVersion: number
  synthetic: boolean
  sources: Record<string, unknown>
  townships: Record<string, unknown>
} = { schemaVersion: 1, synthetic: true, sources: {}, townships: {} }

jest.mock("@/data/deadlines/cook-county.json", () => mockSnapshot)

/**
 * The signed eligibility policy in force.
 *
 * `SIGNED_ELIGIBILITY_POLICIES` is deliberately empty — OD-2 and OD-3 are
 * unsigned — so no configuration opens paid eligibility today. Every safeguard
 * downstream of that gate (contract keys, CAS, idempotency, Price validation)
 * would therefore be unproven the day a policy IS signed, which is the worst
 * possible time to discover a regression. These tests sign one for the duration
 * of a case, and the committed-default suite below proves the unsigned state
 * closes checkout on its own.
 */
const mockPolicy: { version: string | null } = { version: null }

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

jest.mock("@/lib/db", () => {
  const upsert = jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: "ord_pre_1", ...create }))
  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "ord_pre_1", ...data }))
  const updateMany = jest.fn(async () => ({ count: 1 }))
  return { prisma: { oTOrder: { upsert, update, updateMany } }, __upsert: upsert, __update: update, __updateMany: updateMany }
})

const stripeCreate = (jest.requireMock("stripe") as { __create: jest.Mock }).__create
const stripeRetrievePrice = (jest.requireMock("stripe") as { __retrievePrice: jest.Mock }).__retrievePrice
const cc = jest.requireMock("@/lib/cook-county") as { __search: jest.Mock; __get: jest.Mock }
const db = jest.requireMock("@/lib/db") as { __upsert: jest.Mock; __update: jest.Mock; __updateMany: jest.Mock }
const limits = jest.requireMock("@/lib/rate-limit") as { __limit: jest.Mock }

process.env.STRIPE_SECRET_KEY = "sk_test_gate"
process.env.STRIPE_PRICE_T2_DIY_PRO = "price_t2"
process.env.STRIPE_PRICE_T3_DFY = "price_t3"
process.env.OT_CHECKOUT_GATE_SECRET = "test-gate-secret-at-least-32-characters"

const { POST } = require("@/app/api/checkout/session/route") as typeof import("@/app/api/checkout/session/route")

const base = {
  email: "buyer@example.com",
  name: "Buyer Name",
  address: "2834 W Henderson St, Chicago IL 60618",
  checkoutKey: "57dc81a6-1329-4a85-9210-0d6f574ea65d",
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

const FIXTURE_CALENDAR_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"

/**
 * Put a verified, currently-open Assessor window in the snapshot.
 *
 * Dates are relative to the run instant rather than pinned literals: the
 * canonical state requires a same-day retrieval inside 14 days of a close, and
 * a fixture with hard-coded 2026 dates would go stale the way the map this
 * branch removes did.
 */
function armWindow(
  townships: Array<{ key: string; name: string }>,
  opts: { openInDays?: number; closesInDays?: number; retrievedAt?: string } = {},
) {
  const now = new Date()
  const source = {
    authority: "cook_county_assessor",
    sourceUrl: FIXTURE_CALENDAR_URL,
    retrievedAt: opts.retrievedAt ?? new Date(now.getTime() - 5000).toISOString(),
    sourceUpdatedAt: null,
    contentSha256: "e".repeat(64),
    httpStatus: 200,
    finalUrl: FIXTURE_CALENDAR_URL,
    parseStatus: "ok",
    parserVersion: "1.0.0",
  }
  mockSnapshot.synthetic = false
  mockSnapshot.sources = { assessor: source, bor: source }
  mockSnapshot.townships = Object.fromEntries(
    townships.map(({ key, name }) => [
      key,
      {
        townshipName: name,
        stages: {
          assessor: {
            noticeDate: null,
            openDate: countyDay(opts.openInDays ?? -10, now),
            lastFileDate: countyDay(opts.closesInDays ?? 20, now),
          },
        },
      },
    ]),
  )
}

/** Restore the committed default: a synthetic snapshot that verifies nothing. */
function armPending() {
  mockSnapshot.synthetic = true
  mockSnapshot.sources = {}
  mockSnapshot.townships = {}
}

/** The open Jefferson window plus a signed policy — the only state that pays. */
function armOpenCheckout(name = "Jefferson", key = "jefferson") {
  armWindow([{ key, name }])
  mockPolicy.version = "test-policy-2026-08-19"
}

function request(body: Record<string, unknown>) {
  return new Request("https://www.overtaxed-il.com/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  // `clearAllMocks` clears recorded calls but leaves queued `*Once`
  // implementations in place, so an unconsumed one-shot from a case that
  // returned early leaks into the next case. Every mock below is reset and
  // re-established explicitly.
  jest.clearAllMocks()
  for (const mock of [
    db.__upsert,
    db.__update,
    db.__updateMany,
    stripeCreate,
    stripeRetrievePrice,
    cc.__search,
    cc.__get,
    limits.__limit,
  ]) {
    mock.mockReset()
  }
  process.env.STRIPE_SECRET_KEY = "sk_test_gate"
  process.env.STRIPE_PRICE_T2_DIY_PRO = "price_t2"
  process.env.STRIPE_PRICE_T3_DFY = "price_t3"
  process.env.OT_CHECKOUT_GATE_SECRET = "test-gate-secret-at-least-32-characters"
  limits.__limit.mockReturnValue({ allowed: true })
  mockPolicy.version = null
  armPending()
  cc.__search.mockResolvedValue({ success: true, data: [{ pin: "13243140450000", property_address: "2834 W HENDERSON ST", property_city: "CHICAGO" }] })
  cc.__get.mockResolvedValue({ success: true, data: { pin: "13243140450000", address: "2834 W HENDERSON ST", city: "CHICAGO", zipCode: "60618", township: "Jefferson" } })
  db.__upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: "ord_pre_1", ...create }))
  db.__update.mockResolvedValue({ id: "ord_pre_1" })
  db.__updateMany.mockResolvedValue({ count: 1 })
  stripeCreate.mockResolvedValue({ id: "cs_test_gate", url: "https://checkout.stripe.test/gate" })
  stripeRetrievePrice.mockImplementation(async (id: string) => ({
    id,
    active: true,
    type: "one_time",
    unit_amount: id === "price_t2" ? 6900 : 9700,
    currency: "usd",
  }))
})

/** Mint the server-issued acknowledgment challenge, then present it. */
async function t2Challenge(extra: Record<string, unknown> = {}) {
  const res = await POST(request({ ...base, tier: "T2", ...extra }) as never)
  const body = await res.json()
  return { res, body, token: body.acknowledgmentToken as string | undefined }
}

async function postT2(extra: Record<string, unknown> = {}) {
  const { token } = await t2Challenge(extra)
  return POST(
    request({
      ...base,
      tier: "T2",
      analysisAcknowledged: true,
      acknowledgmentToken: token,
      ...extra,
    }) as never,
  )
}

/** Point the county lookup at a second township, so the fixture is not the only one. */
function resolveTo(township: string, pin = "09000000000000", address = "1 TEST ST") {
  cc.__get.mockResolvedValue({
    success: true,
    data: { pin, address, city: "ELK GROVE VILLAGE", zipCode: "60007", township },
  })
  cc.__search.mockResolvedValue({
    success: true,
    data: [{ pin, property_address: address, property_city: "ELK GROVE VILLAGE" }],
  })
}

describe("the committed default", () => {
  // Nothing is armed here: the snapshot is the synthetic fixture and no
  // eligibility policy is signed. This is the state that ships.

  it("closes checkout before writing an order or touching the provider", async () => {
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: "CHECKOUT_ELIGIBILITY_CLOSED",
      window: { township: "Jefferson", status: "unknown", pendingReason: "synthetic_source" },
    })
    expect(db.__upsert).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
    expect(stripeRetrievePrice).not.toHaveBeenCalled()
  })

  it("stays closed with a verified open window while the policy is unsigned", async () => {
    // Both conditions are required. A verified window is a fact about the
    // county; a signed policy is the owner's decision about who may be sold a
    // packet, and OD-2/OD-3 are unsigned.
    armWindow([{ key: "jefferson", name: "Jefferson" }])
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("CHECKOUT_ELIGIBILITY_CLOSED")
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("stays closed with a signed policy while the window is unverified", async () => {
    mockPolicy.version = "test-policy-2026-08-19"
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("CHECKOUT_ELIGIBILITY_CLOSED")
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("refuses a closed window with copy that says the window is closed", async () => {
    armWindow([{ key: "jefferson", name: "Jefferson" }], { openInDays: -40, closesInDays: -1 })
    mockPolicy.version = "test-policy-2026-08-19"
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("CHECKOUT_ELIGIBILITY_CLOSED")
    expect(body.error).toMatch(/window for your township is closed/i)
    expect(body.error).toMatch(/you have not been charged/i)
    expect(stripeCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/checkout/session filing-window safeguards", () => {
  it("rate-limits anonymous checkout attempts before resolving property or calling Stripe", async () => {
    limits.__limit.mockReturnValueOnce({ allowed: false })
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_RATE_LIMITED" })
    expect(cc.__search).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("refuses T3 as a held product before evaluating any window", async () => {
    // Was "blocks T3 when the server-resolved township is not officially open",
    // expecting 409 T3_WINDOW_BLOCKED. T3_DFY is now in the held-product
    // registry, so the tier fails closed with 410 ahead of property resolution,
    // the eligibility gate, and the provider — a hold that only refuses after a
    // window check is a hold that depends on the calendar.
    armOpenCheckout()
    const res = await POST(request({ ...base, tier: "T3" }) as never)
    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ code: "PRODUCT_HELD" })
    expect(cc.__search).not.toHaveBeenCalled()
    expect(db.__upsert).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("refuses T3 even when a reassessment notice is presented", async () => {
    // The notice-review path was T3's way past a non-open window. It is behind
    // the hold now, so a notice cannot reopen the tier.
    armOpenCheckout()
    const res = await POST(request({
      ...base,
      tier: "T3",
      reassessmentNoticeDate: "2026-07-20",
      reassessmentNoticeAddress: base.address,
    }) as never)
    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ code: "PRODUCT_HELD" })
    expect(db.__upsert).not.toHaveBeenCalled()
    expect(db.__updateMany).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("requires a server-issued, snapshot-bound acknowledgment challenge on every T2 checkout", async () => {
    // Was scoped to "T2 pending windows". The acknowledgment used to run only
    // when the window was NOT open, which made it the buyer's own permission to
    // be sold a packet for a window we could not verify. The eligibility gate
    // refuses those outright now, so the acknowledgment does only its own job —
    // CC-10 — and is required on every T2 checkout.
    armOpenCheckout()
    const { res: first, body: challenge, token } = await t2Challenge()
    expect(first.status).toBe(409)
    expect(challenge).toMatchObject({
      code: "T2_ACKNOWLEDGMENT_REQUIRED",
      window: { township: "Jefferson", status: "open" },
    })
    expect(typeof token).toBe("string")
    expect(stripeCreate).not.toHaveBeenCalled()

    const second = await POST(request({
      ...base,
      tier: "T2",
      analysisAcknowledged: true,
      acknowledgmentToken: token,
    }) as never)
    expect(second.status).toBe(200)
    expect(stripeCreate).toHaveBeenCalledTimes(1)
  })

  it("rejects a forged acknowledgment token", async () => {
    armOpenCheckout()
    const res = await POST(request({
      ...base,
      tier: "T2",
      analysisAcknowledged: true,
      acknowledgmentToken: "forged.token",
    }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "T2_ACKNOWLEDGMENT_REQUIRED" })
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("rejects an acknowledgment token minted against a different snapshot", async () => {
    // The token is bound to the snapshot that cleared the gate, so it cannot be
    // carried from one window to another — which is what would let a buyer keep
    // a challenge and replay it after the county changed something.
    armOpenCheckout()
    const { token } = await t2Challenge()
    armWindow([{ key: "jefferson", name: "Jefferson" }], { closesInDays: 25 })
    const res = await POST(request({
      ...base,
      tier: "T2",
      analysisAcknowledged: true,
      acknowledgmentToken: token,
    }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "T2_ACKNOWLEDGMENT_REQUIRED" })
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("does not silently choose the first ambiguous address match", async () => {
    cc.__search.mockResolvedValueOnce({ success: true, data: [
      { pin: "13243140450000", property_address: "2834 W HENDERSON ST", property_city: "CHICAGO" },
      { pin: "13243140460000", property_address: "2834 W HENDERSON ST 2", property_city: "CHICAGO" },
    ] })
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ADDRESS_AMBIGUOUS" })
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("fails closed when an open-window source is older than the configured freshness TTL", async () => {
    // Inside 14 days of a close the source must have been read today. A
    // prior-day retrieval is refused with the reason, not silently served.
    armWindow([{ key: "jefferson", name: "Jefferson" }], {
      closesInDays: 5,
      retrievedAt: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(),
    })
    mockPolicy.version = "test-policy-2026-08-19"
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: "CHECKOUT_ELIGIBILITY_CLOSED",
      window: { status: "unknown", pendingReason: "source_stale" },
    })
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("does not let a held reassessment notice be repurposed into a paid checkout", async () => {
    resolveTo("Elk Grove")
    armWindow([{ key: "elk-grove", name: "Elk Grove" }])
    mockPolicy.version = "test-policy-2026-08-19"
    db.__upsert.mockResolvedValueOnce({ id: "ord_notice_hold", status: "NOTICE_REVIEW_REQUIRED" })

    const res = await postT2()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("CHECKOUT_KEY_CONFLICT")
    expect(stripeCreate).not.toHaveBeenCalled()
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("rejects checkout-key reuse when the authoritative source identity drifts", async () => {
    armOpenCheckout()
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_source_drift",
      ...create,
      eligibilitySnapshot: { ...(create.eligibilitySnapshot as Record<string, unknown>), sourceUrl: "https://untrusted.example/drift" },
    }))
    const res = await postT2()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("rejects checkout-key reuse when any eligibility snapshot field drifts", async () => {
    armOpenCheckout()
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_snapshot_drift",
      ...create,
      eligibilitySnapshot: { ...(create.eligibilitySnapshot as Record<string, unknown>), unexpected: "drift" },
    }))
    const res = await postT2()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("rejects key reuse when notice evidence appears on a tier that carries none", async () => {
    // T2 binds `reassessmentNoticeDate: null` into its contract. A stored order
    // carrying notice evidence is a different service request, not this one.
    armOpenCheckout()
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_notice_evidence_drift",
      ...create,
      reassessmentNoticeDate: new Date("2026-07-19T12:00:00Z"),
    }))
    const res = await postT2()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("rejects checkout-key reuse when the customer identity changes", async () => {
    armOpenCheckout()
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_name_drift",
      ...create,
      name: "Different Buyer",
      status: "CHECKOUT_PENDING",
    }))
    const res = await postT2()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("rejects checkout-key reuse across service contracts", async () => {
    armOpenCheckout()
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_conflict",
      ...create,
      tier: "T3",
    }))
    const res = await postT2()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(db.__updateMany).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("treats paid-recovery orders as terminal paid state", async () => {
    armOpenCheckout()
    db.__upsert.mockResolvedValueOnce({ id: "ord_paid_recovery", status: "PAID_RECOVERY_REQUIRED" })
    const res = await postT2()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("ORDER_ALREADY_PAID")
    expect(db.__updateMany).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("refuses to downgrade or recreate a checkout for an already-paid order", async () => {
    armOpenCheckout()
    db.__upsert.mockResolvedValueOnce({ id: "ord_paid_1", status: "PAID" })
    const res = await postT2()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ORDER_ALREADY_PAID" })
    expect(stripeCreate).not.toHaveBeenCalled()
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("pre-creates a recoverable order and sends only internal references plus resolved facts to Stripe", async () => {
    resolveTo("Elk Grove")
    armWindow([{ key: "elk-grove", name: "Elk Grove" }])
    mockPolicy.version = "test-policy-2026-08-19"

    const res = await postT2()
    expect(res.status).toBe(200)
    expect(db.__upsert).toHaveBeenCalledTimes(1)
    expect(db.__upsert.mock.invocationCallOrder[0]).toBeLessThan(stripeCreate.mock.invocationCallOrder[0])
    expect(db.__updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        township: "Elk Grove",
        windowStatus: "open",
        eligibilitySnapshot: { equals: expect.objectContaining({ sourceUrl: expect.any(String) }) },
      }),
      data: expect.objectContaining({ status: "CHECKOUT_CREATING" }),
    }))

    const [sessionArgs, requestOptions] = stripeCreate.mock.calls[0]
    expect(requestOptions).toEqual({ idempotencyKey: expect.stringMatching(/^ot:[a-f0-9]{64}:0$/) })
    expect(sessionArgs.metadata).toMatchObject({ orderId: "ord_pre_1", tier: "T2", windowStatus: "open" })
    expect(sessionArgs.metadata).not.toHaveProperty("propertyPin")
    expect(sessionArgs.metadata).not.toHaveProperty("township")
    expect(sessionArgs.metadata).not.toHaveProperty("checkoutKey")
    expect(sessionArgs.metadata).not.toHaveProperty("customerName")
    expect(sessionArgs.metadata).not.toHaveProperty("customerAddress")
    expect(JSON.stringify(sessionArgs.metadata)).not.toContain(base.email)
  })

  it("binds the retrieval instant that authorized the sale onto the order", async () => {
    // The order carries the retrieval behind the window it was sold against, so
    // a later dispute can be answered with what we had read and when — not with
    // a timestamp minted at write time.
    armOpenCheckout()
    const res = await postT2()
    expect(res.status).toBe(200)
    const created = db.__upsert.mock.calls[0][0].create
    expect(created.windowSourceUpdated).toEqual(expect.any(String))
    expect(created.windowVerifiedAt).toBeInstanceOf(Date)
    expect(created.windowSourceUpdated).toBe(
      (mockSnapshot.sources as { assessor: { retrievedAt: string } }).assessor.retrievedAt,
    )
  })

  it("does not return a hosted URL when provider finalization loses its CAS", async () => {
    armOpenCheckout()
    db.__updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    const res = await postT2()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_STATE_UNRESOLVED" })
    expect(stripeCreate).toHaveBeenCalledTimes(1)
    expect(db.__updateMany.mock.calls[1][0]).toMatchObject({
      where: expect.objectContaining({
        id: "ord_pre_1",
        contractKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        email: "buyer@example.com",
        name: "Buyer Name",
        propertyAddress: "2834 W HENDERSON ST",
        township: "Jefferson",
        windowStatus: "open",
        eligibilitySnapshot: { equals: expect.any(Object) },
        reassessmentNoticeDate: null,
        reassessmentNoticeAddress: null,
        checkoutAmountCents: 6900,
        checkoutCurrency: "usd",
        status: "CHECKOUT_CREATING",
      }),
      data: { stripeSessionId: "cs_test_gate", status: "CHECKOUT_CREATED" },
    })
  })

  it("fails closed before order creation when the configured Stripe Price is not a fixed active amount", async () => {
    armOpenCheckout()
    stripeRetrievePrice.mockResolvedValueOnce({ id: "price_t2", active: false, type: "one_time", unit_amount: 6900, currency: "usd" })

    const res = await postT2()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_PRICE_UNAVAILABLE" })
    expect(db.__upsert).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("fails closed when Stripe creates no hosted checkout URL", async () => {
    armOpenCheckout()
    stripeCreate.mockResolvedValueOnce({ id: "cs_without_url", url: null })

    const res = await postT2()
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe("CHECKOUT_PROVIDER_ERROR")
    expect(db.__updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "ord_pre_1", status: "CHECKOUT_CREATING" }),
      data: { status: "CHECKOUT_FAILED" },
    }))
  })

  it("marks the pre-payment record failed and returns a generic error when Stripe fails", async () => {
    armOpenCheckout()
    stripeCreate.mockRejectedValueOnce(new Error("Stripe internals: metadata value exceeds 500 chars"))
    const res = await postT2()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: "Unable to start checkout. Please try again.", code: "CHECKOUT_PROVIDER_ERROR" })
    expect(db.__updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CHECKOUT_FAILED" }) }))
  })

  it("allows only one in-flight Stripe creator for the same checkout contract", async () => {
    armOpenCheckout()
    const { token } = await t2Challenge()
    let releaseStripe!: (value: { id: string; url: string }) => void
    stripeCreate.mockImplementationOnce(() => new Promise((resolve) => { releaseStripe = resolve }))
    let claimed = false
    db.__updateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (data.status === "CHECKOUT_CREATING") {
        if (claimed) return { count: 0 }
        claimed = true
      }
      return { count: 1 }
    })

    const acknowledged = { ...base, tier: "T2", analysisAcknowledged: true, acknowledgmentToken: token }
    const first = POST(request(acknowledged) as never)
    await new Promise((resolve) => setImmediate(resolve))
    const second = await POST(request(acknowledged) as never)
    expect(second.status).toBe(409)
    expect(stripeCreate).toHaveBeenCalledTimes(1)

    releaseStripe({ id: "cs_single_flight", url: "https://checkout.stripe.test/single" })
    expect((await first).status).toBe(200)
  })

  it("rejects oversized PII before calling Stripe", async () => {
    const res = await POST(request({ ...base, tier: "T2", address: "A".repeat(501) }) as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_CHECKOUT_INPUT" })
    expect(stripeCreate).not.toHaveBeenCalled()
  })
})
