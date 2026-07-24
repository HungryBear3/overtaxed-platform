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

jest.mock("@/lib/free-check-appeal-window", () => {
  const getFreeCheckAppealWindowStatus = jest.fn(() => ({
    township: "Jefferson",
    status: "future_cycle",
    openDate: null,
    closeDate: null,
    filingUrl: "https://www.cookcountyassessoril.gov/online-appeals",
    note: "Official date pending",
  }))
  return { getFreeCheckAppealWindowStatus, __window: getFreeCheckAppealWindowStatus }
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
const windows = jest.requireMock("@/lib/free-check-appeal-window") as { __window: jest.Mock }
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

function request(body: Record<string, unknown>) {
  return new Request("https://www.overtaxed-il.com/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STRIPE_SECRET_KEY = "sk_test_gate"
  process.env.STRIPE_PRICE_T2_DIY_PRO = "price_t2"
  process.env.STRIPE_PRICE_T3_DFY = "price_t3"
  process.env.OT_CHECKOUT_GATE_SECRET = "test-gate-secret-at-least-32-characters"
  limits.__limit.mockReturnValue({ allowed: true })
  windows.__window.mockReturnValue({
    township: "Jefferson",
    status: "future_cycle",
    openDate: null,
    closeDate: null,
    filingUrl: "https://www.cookcountyassessoril.gov/online-appeals",
    note: "Official date pending",
  })
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

describe("POST /api/checkout/session filing-window safeguards", () => {
  it("rate-limits anonymous checkout attempts before resolving property or calling Stripe", async () => {
    limits.__limit.mockReturnValueOnce({ allowed: false })
    const res = await POST(request({ ...base, tier: "T3" }) as never)
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_RATE_LIMITED" })
    expect(cc.__search).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("blocks T3 when the server-resolved township is not officially open", async () => {
    const res = await POST(request({ ...base, tier: "T3" }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "T3_WINDOW_BLOCKED", window: { township: "Jefferson", status: "future_cycle" } })
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("does not let a held reassessment notice be repurposed into a different paid tier", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    db.__upsert.mockResolvedValueOnce({ id: "ord_notice_hold", status: "NOTICE_REVIEW_REQUIRED" })

    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("CHECKOUT_KEY_CONFLICT")
    expect(stripeCreate).not.toHaveBeenCalled()
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("does not turn an already-created Stripe checkout into a reassessment hold", async () => {
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_live_session",
      ...create,
      status: "CHECKOUT_CREATED",
      stripeSessionId: "cs_live",
    }))
    const res = await POST(request({
      ...base,
      tier: "T3",
      reassessmentNoticeDate: "2026-07-20",
      reassessmentNoticeAddress: base.address,
    }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("CHECKOUT_ALREADY_STARTED")
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("rejects notice-hold checkout-key reuse when the authoritative source identity drifts", async () => {
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_notice_source_drift",
      ...create,
      status: "NOTICE_REVIEW_REQUIRED",
      eligibilitySnapshot: { ...(create.eligibilitySnapshot as Record<string, unknown>), sourceUrl: "https://untrusted.example/drift" },
    }))
    const res = await POST(request({
      ...base,
      tier: "T3",
      reassessmentNoticeDate: "2026-07-20",
      reassessmentNoticeAddress: base.address,
    }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("rejects checkout-key reuse when any eligibility snapshot field drifts", async () => {
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_snapshot_drift",
      ...create,
      status: "NOTICE_REVIEW_REQUIRED",
      eligibilitySnapshot: { ...(create.eligibilitySnapshot as Record<string, unknown>), unexpected: "drift" },
    }))
    const res = await POST(request({
      ...base,
      tier: "T3",
      reassessmentNoticeDate: "2026-07-20",
      reassessmentNoticeAddress: base.address,
    }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("rejects notice-review key reuse when notice evidence changes", async () => {
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_notice_evidence_drift",
      ...create,
      status: "NOTICE_REVIEW_REQUIRED",
      reassessmentNoticeDate: new Date("2026-07-19T12:00:00Z"),
    }))
    const res = await POST(request({
      ...base,
      tier: "T3",
      reassessmentNoticeDate: "2026-07-20",
      reassessmentNoticeAddress: base.address,
    }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("rejects checkout-key reuse when the customer identity changes", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_name_drift",
      ...create,
      name: "Different Buyer",
      status: "CHECKOUT_PENDING",
    }))
    const res = await POST(request({ ...base, tier: "T3" }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("treats paid-recovery orders as terminal paid state", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    db.__upsert.mockResolvedValueOnce({ id: "ord_paid_recovery", status: "PAID_RECOVERY_REQUIRED" })
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("ORDER_ALREADY_PAID")
    expect(db.__updateMany).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("does not let a reassessment-notice replay rewrite an already-paid order", async () => {
    db.__upsert.mockResolvedValueOnce({ id: "ord_paid_notice", status: "PAID" })

    const res = await POST(request({
      ...base,
      tier: "T3",
      reassessmentNoticeDate: "2026-07-20",
      reassessmentNoticeAddress: base.address,
    }) as never)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ORDER_ALREADY_PAID" })
    expect(db.__updateMany).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("requires a server-issued, snapshot-bound acknowledgment challenge for T2 pending windows", async () => {
    const first = await POST(request({ ...base, tier: "T2" }) as never)
    expect(first.status).toBe(409)
    const challenge = await first.json()
    expect(challenge).toMatchObject({ code: "T2_ACKNOWLEDGMENT_REQUIRED", window: { township: "Jefferson", status: "future_cycle" } })
    expect(typeof challenge.acknowledgmentToken).toBe("string")
    expect(stripeCreate).not.toHaveBeenCalled()

    const second = await POST(request({ ...base, tier: "T2", analysisAcknowledged: true, acknowledgmentToken: challenge.acknowledgmentToken }) as never)
    expect(second.status).toBe(200)
    expect(stripeCreate).toHaveBeenCalledTimes(1)
  })

  it("rejects a forged acknowledgment token", async () => {
    const res = await POST(request({ ...base, tier: "T2", analysisAcknowledged: true, acknowledgmentToken: "forged.token" }) as never)
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
    jest.useFakeTimers().setSystemTime(new Date("2026-07-27T15:00:00Z"))
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    cc.__get.mockResolvedValueOnce({ success: true, data: { pin: "09000000000000", address: "1 TEST ST", city: "ELK GROVE VILLAGE", zipCode: "60007", township: "Elk Grove" } })
    cc.__search.mockResolvedValueOnce({ success: true, data: [{ pin: "09000000000000", property_address: "1 TEST ST", property_city: "ELK GROVE VILLAGE" }] })

    const res = await POST(request({ ...base, tier: "T3", address: "1 Test St, Elk Grove Village IL 60007" }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "T3_WINDOW_BLOCKED", window: { status: "unknown" } })
    expect(stripeCreate).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it("pre-creates a recoverable order and sends only internal references plus resolved facts to Stripe", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    cc.__get.mockResolvedValueOnce({ success: true, data: { pin: "09000000000000", address: "1 TEST ST", city: "ELK GROVE VILLAGE", zipCode: "60007", township: "Elk Grove" } })
    cc.__search.mockResolvedValueOnce({ success: true, data: [{ pin: "09000000000000", property_address: "1 TEST ST", property_city: "ELK GROVE VILLAGE" }] })

    const res = await POST(request({ ...base, tier: "T3", address: "1 Test St, Elk Grove Village IL 60007" }) as never)
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
    expect(sessionArgs.metadata).toMatchObject({ orderId: "ord_pre_1", tier: "T3", windowStatus: "open" })
    expect(sessionArgs.metadata).not.toHaveProperty("propertyPin")
    expect(sessionArgs.metadata).not.toHaveProperty("township")
    expect(sessionArgs.metadata).not.toHaveProperty("checkoutKey")
    expect(sessionArgs.metadata).not.toHaveProperty("customerName")
    expect(sessionArgs.metadata).not.toHaveProperty("customerAddress")
    expect(JSON.stringify(sessionArgs.metadata)).not.toContain(base.email)
  })

  it("refuses to downgrade or recreate a checkout for an already-paid order", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    db.__upsert.mockResolvedValueOnce({ id: "ord_paid_1", status: "PAID" })

    const res = await POST(request({ ...base, tier: "T3" }) as never)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ORDER_ALREADY_PAID" })
    expect(stripeCreate).not.toHaveBeenCalled()
    expect(db.__updateMany).not.toHaveBeenCalled()
  })

  it("does not return a hosted URL when full-contract provider finalization loses its CAS", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    db.__updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    const res = await POST(request({ ...base, tier: "T3" }) as never)
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
        township: "Elk Grove",
        windowStatus: "open",
        eligibilitySnapshot: { equals: expect.any(Object) },
        analysisAcknowledgedAt: null,
        reassessmentNoticeDate: null,
        reassessmentNoticeAddress: null,
        checkoutAmountCents: 9700,
        checkoutCurrency: "usd",
        status: "CHECKOUT_CREATING",
      }),
      data: { stripeSessionId: "cs_test_gate", status: "CHECKOUT_CREATED" },
    })
  })

  it("fails closed before order creation when the configured Stripe Price is not a fixed active amount", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    stripeRetrievePrice.mockResolvedValueOnce({ id: "price_t3", active: false, type: "one_time", unit_amount: 9700, currency: "usd" })

    const res = await POST(request({ ...base, tier: "T3" }) as never)

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_PRICE_UNAVAILABLE" })
    expect(db.__upsert).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("fails closed when Stripe creates no hosted checkout URL", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    stripeCreate.mockResolvedValueOnce({ id: "cs_without_url", url: null })

    const res = await POST(request({ ...base, tier: "T3" }) as never)
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe("CHECKOUT_PROVIDER_ERROR")
    expect(db.__updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "ord_pre_1", status: "CHECKOUT_CREATING" }),
      data: { status: "CHECKOUT_FAILED" },
    }))
  })

  it("marks the pre-payment record failed and returns a generic error when Stripe fails", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    stripeCreate.mockRejectedValueOnce(new Error("Stripe internals: metadata value exceeds 500 chars"))
    const res = await POST(request({ ...base, tier: "T2" }) as never)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: "Unable to start checkout. Please try again.", code: "CHECKOUT_PROVIDER_ERROR" })
    expect(db.__updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CHECKOUT_FAILED" }) }))
  })

  it("rejects checkout-key reuse across service contracts", async () => {
    windows.__window.mockReturnValueOnce({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
    db.__upsert.mockImplementationOnce(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "ord_conflict",
      ...create,
      tier: "T2",
    }))

    const res = await POST(request({ ...base, tier: "T3" }) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CHECKOUT_KEY_CONFLICT" })
    expect(db.__updateMany).not.toHaveBeenCalled()
    expect(stripeCreate).not.toHaveBeenCalled()
  })

  it("allows only one in-flight Stripe creator for the same checkout contract", async () => {
    windows.__window.mockReturnValue({ township: "Elk Grove", status: "open", openDate: "2026-06-22", closeDate: "2026-08-04", filingUrl: "https://official", note: "verified" })
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

    const first = POST(request({ ...base, tier: "T3" }) as never)
    await new Promise((resolve) => setImmediate(resolve))
    const second = await POST(request({ ...base, tier: "T3" }) as never)
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
