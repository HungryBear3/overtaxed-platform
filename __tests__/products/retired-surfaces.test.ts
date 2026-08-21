/** @jest-environment node */

/**
 * Withdrawn HTTP surfaces.
 *
 * Each route must fail closed *before* it constructs a provider, parses an
 * unbounded body, or touches the database — while preserving the authoritative
 * auth check that already guarded it, so a withdrawn admin/cron endpoint does
 * not become an unauthenticated information surface.
 */

const stripeConstructor = jest.fn(() => {
  throw new Error("STRIPE_CONSTRUCTED")
})
jest.mock("stripe", () => ({ __esModule: true, default: stripeConstructor }))

const resendConstructor = jest.fn(() => {
  throw new Error("RESEND_CONSTRUCTED")
})
jest.mock("resend", () => ({ __esModule: true, Resend: resendConstructor }))

const sendEmail = jest.fn(async () => ({ ok: true }))
jest.mock("@/lib/email/send", () => ({ __esModule: true, sendEmail }))

const prismaMock = {
  contingencyLead: { create: jest.fn() },
  user: { findMany: jest.fn(), findUnique: jest.fn() },
  invoice: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  dripSubscriber: { findMany: jest.fn(), update: jest.fn() },
  appeal: { findFirst: jest.fn(), findMany: jest.fn() },
}
jest.mock("@/lib/db", () => ({ __esModule: true, prisma: prismaMock }))
jest.mock("@/lib/db/prisma", () => ({ __esModule: true, prisma: prismaMock }))

const getSession = jest.fn()
jest.mock("@/lib/auth/session", () => ({ __esModule: true, getSession }))

jest.mock("@/lib/marketing/preview-gate", () => ({
  __esModule: true,
  hostFromRequest: jest.fn(() => "www.overtaxed-il.com"),
  isPreviewStubEnabled: jest.fn(() => false),
  marketingGateReason: jest.fn(() => "test"),
  previewNoopResponseBody: jest.fn(() => ({ mode: "preview_noop" })),
}))

const { NextRequest } = require("next/server") as typeof import("next/server")

function post(url: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  })
}

function noProviderOrDbSideEffects() {
  expect(stripeConstructor).not.toHaveBeenCalled()
  expect(resendConstructor).not.toHaveBeenCalled()
  expect(sendEmail).not.toHaveBeenCalled()
  expect(prismaMock.contingencyLead.create).not.toHaveBeenCalled()
  expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  expect(prismaMock.invoice.update).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.resetModules()
  process.env.STRIPE_SECRET_KEY = "sk_test_never_used"
  process.env.OT_RESEND_API_KEY = "re_test_never_used"
})

describe("POST /api/contingency-intake", () => {
  it("is withdrawn and writes no lead and sends no email", async () => {
    const { POST } = await import("@/app/api/contingency-intake/route")
    const res = await POST(
      post("https://www.overtaxed-il.com/api/contingency-intake", {
        fullName: "A", email: "a@example.com", phone: "1", propertyPin: "1", propertyAddress: "x",
      }),
    )

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({ code: "PRODUCT_HELD" })
    noProviderOrDbSideEffects()
  })
})

describe("POST /api/admin/create-performance-invoice", () => {
  it("still rejects unauthenticated callers before revealing the withdrawal", async () => {
    getSession.mockResolvedValue(null)
    delete process.env.ADMIN_SECRET

    const { POST } = await import("@/app/api/admin/create-performance-invoice/route")
    const res = await POST(post("https://x/api/admin/create-performance-invoice", { userId: "u1" }))

    expect(res.status).toBe(401)
    noProviderOrDbSideEffects()
  })

  it("is withdrawn for authorised admins and creates no invoice", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } })

    const { POST } = await import("@/app/api/admin/create-performance-invoice/route")
    const res = await POST(post("https://x/api/admin/create-performance-invoice", { userId: "u1" }))

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({ code: "PRODUCT_HELD" })
    noProviderOrDbSideEffects()
  })
})

describe("GET /api/cron/performance-invoices", () => {
  it("still rejects an unauthorised cron caller", async () => {
    process.env.CRON_SECRET = "cron_secret"

    const { GET } = await import("@/app/api/cron/performance-invoices/route")
    const res = await GET(new NextRequest("https://x/api/cron/performance-invoices"))

    expect(res.status).toBe(401)
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
    noProviderOrDbSideEffects()
  })

  it("is withdrawn for an authorised cron caller and enumerates no users", async () => {
    process.env.CRON_SECRET = "cron_secret"

    const { GET } = await import("@/app/api/cron/performance-invoices/route")
    const res = await GET(
      new NextRequest("https://x/api/cron/performance-invoices", {
        headers: { authorization: "Bearer cron_secret" },
      }),
    )

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({ code: "PRODUCT_HELD", invoicesCreated: 0 })
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
    noProviderOrDbSideEffects()
  })
})

describe("POST /api/billing/pay-invoice", () => {
  it("still rejects unauthenticated callers", async () => {
    getSession.mockResolvedValue(null)

    const { POST } = await import("@/app/api/billing/pay-invoice/route")
    const res = await POST(post("https://x/api/billing/pay-invoice", { invoiceId: "i1" }))

    expect(res.status).toBe(401)
    noProviderOrDbSideEffects()
  })

  it("is withdrawn for signed-in customers without constructing Stripe", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", email: "a@example.com" } })

    const { POST } = await import("@/app/api/billing/pay-invoice/route")
    const res = await POST(post("https://x/api/billing/pay-invoice", { invoiceId: "i1" }))

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({ code: "PRODUCT_HELD" })
    expect(prismaMock.invoice.findFirst).not.toHaveBeenCalled()
    noProviderOrDbSideEffects()
  })
})

describe("POST /api/drip/send", () => {
  it("is withdrawn and sends nothing", async () => {
    const { POST } = await import("@/app/api/drip/send/route")
    const res = await POST(post("https://x/api/drip/send", { step: 2 }))

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({ code: "PRODUCT_HELD", sent: 0 })
    expect(prismaMock.dripSubscriber.findMany).not.toHaveBeenCalled()
    noProviderOrDbSideEffects()
  })
})

/**
 * Signed-in plan labels.
 *
 * These pages are behind auth, which is why they were missed: they are not in
 * the public path list, but the person reading them is a customer, and a label
 * that still states "22% of first-year savings, if granted" tells that customer
 * they hold a live percentage arrangement contingent on a county decision
 * (BL-B3 and BL-A5) for a product that no longer exists.
 *
 * Asserted against source rather than rendered output because each page is an
 * async server component that reads the session and the database on render;
 * the rendered corpus covers them under their authenticated states.
 */
describe("authenticated plan labels", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")
  // Comments are stripped before scanning. The question these tests ask is
  // what a signed-in customer reads, and a comment recording *why* a term was
  // removed is not that — without this, documenting the removal would fail the
  // assertion that the removal happened.
  const read = (p: string) =>
    readFileSync(join(process.cwd(), p), "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")

  const OFFER_TERMS = [/22%/, /first-year savings/i, /if granted/i]

  for (const page of ["app/dashboard/page.tsx", "app/account/page.tsx"]) {
    it(`${page} states the contingency plan is withdrawn instead of restating its terms`, () => {
      const src = read(page)
      for (const term of OFFER_TERMS) expect(src).not.toMatch(term)
      expect(src).toMatch(/PERFORMANCE"\s*&&\s*"Contingency \(no longer offered\)"/)
    })
  }

  it("app/admin/page.tsx does not label the operator console with the held fee percentage", () => {
    const src = read("app/admin/page.tsx")
    for (const term of OFFER_TERMS) expect(src).not.toMatch(term)
    expect(src).toMatch(/Contingency fee review \(withdrawn\)/)
  })
})

export {}
