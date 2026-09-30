/** @jest-environment node */

/**
 * POST /api/admin/referrals is the only path that may create a referral. It
 * keeps its ADMIN gate and applies the same canonical validator every public
 * ingress uses, so it cannot issue a code the public paths would reject.
 */
let role: string | undefined = "ADMIN"
jest.mock("@/lib/auth/session", () => ({
  getSession: jest.fn(async () => (role ? { user: { id: "u1", role } } : null)),
}))

const referral = {
  create: jest.fn(async ({ data }: { data: { code: string; name?: unknown } }) => ({ id: "r1", ...data })),
  findMany: jest.fn(async () => []),
}
jest.mock("@/lib/db", () => ({
  prisma: {
    get referral() {
      return referral
    },
  },
}))

import { POST } from "@/app/api/admin/referrals/route"

function post(body: unknown) {
  return POST(
    new Request("https://www.overtaxed-il.com/api/admin/referrals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  )
}

beforeEach(() => {
  role = "ADMIN"
  jest.clearAllMocks()
})

describe("/api/admin/referrals POST", () => {
  it("keeps the admin gate", async () => {
    role = "USER"
    expect((await post({ code: "jane" })).status).toBe(401)
    role = undefined
    expect((await post({ code: "jane" })).status).toBe(401)
    expect(referral.create).not.toHaveBeenCalled()
  })

  it("creates the canonical form of a valid code", async () => {
    const res = await post({ code: "Jane-Doe", name: "Jane Doe" })
    expect(res.status).toBe(200)
    expect(referral.create).toHaveBeenCalledWith({ data: { code: "jane-doe", name: "Jane Doe" } })
  })

  it.each([
    ["surrounding whitespace", " john "],
    ["a name", "John Smith"],
    ["an email", "owner@example.com"],
    ["a URL", "https://evil.example"],
    ["a confusable", "jоhn"],
    ["a control character", "john\u0000"],
    ["an oversized value", "a".repeat(500)],
    ["a number", 5],
    ["nothing", undefined],
  ])("refuses %s", async (_label, code) => {
    const res = await post({ code, name: "x" })
    expect(res.status).toBe(400)
    expect(referral.create).not.toHaveBeenCalled()
  })

  it("reports a duplicate as a conflict", async () => {
    referral.create.mockRejectedValueOnce(new Error("Unique constraint failed on the fields: (`code`)"))
    expect((await post({ code: "john" })).status).toBe(409)
  })
})
