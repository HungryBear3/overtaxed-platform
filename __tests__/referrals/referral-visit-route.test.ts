/** @jest-environment node */

/**
 * POST /api/referrals/visit is public. It may only count a visit against a
 * referral an admin already issued. It never creates a row, never echoes the
 * submitted value, and answers a well-formed unknown code exactly as it
 * answers a known one so it is not an existence oracle.
 */
type Row = { code: string; visits: number }
const rows = new Map<string, Row>()

const referral = {
  upsert: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(async ({ where, data }: { where: { code: string }; data: { visits: { increment: number } } }) => {
    const row = rows.get(where.code)
    if (!row) return { count: 0 }
    row.visits += data.visits.increment
    return { count: 1 }
  }),
}
jest.mock("@/lib/db", () => ({
  prisma: {
    get referral() {
      return referral
    },
  },
}))
jest.mock("@/lib/marketing/preview-gate", () => ({
  hostFromRequest: () => "www.overtaxed-il.com",
  isPreviewStubEnabled: () => false,
  marketingGateReason: () => "production",
  previewNoopResponseBody: () => ({ ok: true, mode: "preview_noop" }),
}))

import { POST } from "@/app/api/referrals/visit/route"

function post(body: unknown, raw = false) {
  return POST(
    new Request("https://www.overtaxed-il.com/api/referrals/visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? String(body) : JSON.stringify(body),
    }) as never,
  )
}

beforeEach(() => {
  rows.clear()
  rows.set("john", { code: "john", visits: 3 })
  jest.clearAllMocks()
})

afterEach(() => {
  expect(referral.upsert).not.toHaveBeenCalled()
  expect(referral.create).not.toHaveBeenCalled()
})

describe("/api/referrals/visit", () => {
  it("counts a visit for an existing canonical code", async () => {
    const res = await post({ code: "john" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(rows.get("john")?.visits).toBe(4)
  })

  it("normalizes case before matching", async () => {
    await post({ code: "JOHN" })
    expect(referral.updateMany).toHaveBeenCalledWith({
      where: { code: "john" },
      data: { visits: { increment: 1 } },
    })
    expect(rows.get("john")?.visits).toBe(4)
  })

  it("never creates an unknown well-formed code, and answers exactly as for a known one", async () => {
    const known = await post({ code: "john" })
    const unknown = await post({ code: "attacker-code" })
    expect(unknown.status).toBe(known.status)
    expect(await unknown.json()).toEqual({ ok: true })
    expect(rows.has("attacker-code")).toBe(false)
  })

  it.each([
    ["an email", { code: "owner@example.com" }],
    ["a name", { code: "John Smith" }],
    ["a URL", { code: "https://evil.example" }],
    ["a control character", { code: "john\u0000" }],
    ["a confusable", { code: "jоhn" }],
    ["an oversized value", { code: "a".repeat(10_000) }],
    ["a number", { code: 7 }],
    ["an array", { code: ["john"] }],
    ["no code", {}],
    ["null", null],
  ])("rejects %s without touching the database or echoing it", async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false })
    expect(referral.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a malformed JSON body as a client error", async () => {
    const res = await post("{not json", true)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false })
    expect(referral.updateMany).not.toHaveBeenCalled()
  })

  it("fails closed without leaking detail when the database throws", async () => {
    referral.updateMany.mockRejectedValueOnce(new Error("relation Referral: secret detail"))
    const res = await post({ code: "john" })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false })
  })
})
