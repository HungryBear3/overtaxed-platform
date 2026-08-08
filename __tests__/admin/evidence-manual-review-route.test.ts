/** @jest-environment node */

const getSessionMock = jest.fn()
const consoleFlagMock = jest.fn()
const controlFlagMock = jest.fn()
const storeMock = jest.fn()

jest.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))
jest.mock("@/lib/fulfillment/flag", () => ({
  t2EvidenceConsoleEnabled: (...args: unknown[]) => consoleFlagMock(...args),
  t2ManualReviewControlEnabled: (...args: unknown[]) => controlFlagMock(...args),
}))
jest.mock("@/lib/fulfillment-runtime/manual-review-store", () => ({
  enterManualReview: (...args: unknown[]) => storeMock(...args),
}))

import { POST } from "@/app/api/admin/evidence/[orderId]/manual-review/route"

const body = {
  action: "ENTER_MANUAL_REVIEW",
  expectedStatus: "ARTIFACT_PENDING",
  expectedStatusRevision: 2,
}

function request(
  value: unknown = body,
  headers: Record<string, string> = {},
  raw = false,
) {
  return new Request("https://admin.example/api/admin/evidence/ord_1/manual-review", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://admin.example",
      ...headers,
    },
    body: raw ? String(value) : JSON.stringify(value),
  }) as unknown as import("next/server").NextRequest
}

const context = (orderId = "ord_1") => ({ params: Promise.resolve({ orderId }) })

beforeEach(() => {
  jest.clearAllMocks()
  getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } })
  consoleFlagMock.mockReturnValue(true)
  controlFlagMock.mockReturnValue(true)
  storeMock.mockResolvedValue({
    ok: true,
    outcome: "ENTERED_MANUAL_REVIEW",
    status: "MANUAL_REVIEW",
    statusRevision: 3,
  })
})

describe("manual-review admin route boundary", () => {
  it.each([
    null,
    { user: { id: "user_1", role: "USER" } },
    { user: { role: "ADMIN" } },
    { user: { id: "", role: "ADMIN" } },
    { user: { id: "x".repeat(129), role: "ADMIN" } },
  ])("rejects invalid admin session before flags/body/store", async (session) => {
    getSessionMock.mockResolvedValue(session)
    const response = await POST(request("not-json", {}, true), context())
    expect(response.status).toBe(401)
    expect(consoleFlagMock).not.toHaveBeenCalled()
    expect(controlFlagMock).not.toHaveBeenCalled()
    expect(storeMock).not.toHaveBeenCalled()
  })

  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])("requires both independent flags and performs zero DB/store calls", async (consoleOn, controlOn) => {
    consoleFlagMock.mockReturnValue(consoleOn)
    controlFlagMock.mockReturnValue(controlOn)
    const response = await POST(request("not-json", {}, true), context())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: "MANUAL_REVIEW_CONTROL_DISABLED",
    })
    expect(storeMock).not.toHaveBeenCalled()
  })

  it.each([
    ["malformed JSON", "{", true],
    ["null", null, false],
    ["array", [], false],
    ["missing field", { action: "ENTER_MANUAL_REVIEW" }, false],
    ["extra field", { ...body, actorUserId: "attacker" }, false],
    ["string revision", { ...body, expectedStatusRevision: "2" }, false],
    ["fractional revision", { ...body, expectedStatusRevision: 1.5 }, false],
    ["negative revision", { ...body, expectedStatusRevision: -1 }, false],
    ["overflow revision", { ...body, expectedStatusRevision: 2_147_483_647 }, false],
    ["normalized action", { ...body, action: " ENTER_MANUAL_REVIEW" }, false],
  ])("rejects %s before store access", async (_label, value, raw) => {
    const response = await POST(request(value, {}, Boolean(raw)), context())
    expect(response.status).toBe(400)
    expect(storeMock).not.toHaveBeenCalled()
  })

  it("requires application/json before parsing", async () => {
    const response = await POST(
      request(body, { "content-type": "text/plain" }),
      context(),
    )
    expect(response.status).toBe(400)
    expect(storeMock).not.toHaveBeenCalled()
  })

  it.each([
    "https://evil.example",
    "not a URL",
    "https://admin.example/path",
    "https://admin.example?x=1",
    "https://admin.example#fragment",
    "https://user:pass@admin.example",
    "",
  ])(
    "rejects cross-origin or non-serialized origin %s",
    async (origin) => {
      const response = await POST(request(body, { origin }), context())
      expect(response.status).toBe(403)
      expect(storeMock).not.toHaveBeenCalled()
    },
  )

  it.each([" https://admin.example", "https://admin.example "])(
    "rejects unnormalized whitespace origin %s at the route boundary",
    async (origin) => {
      const base = request(body)
      const hostile = {
        url: base.url,
        headers: {
          get: (name: string) => name.toLowerCase() === "origin" ? origin : base.headers.get(name),
        },
        json: () => base.json(),
      } as unknown as import("next/server").NextRequest
      const response = await POST(hostile, context())
      expect(response.status).toBe(403)
      expect(storeMock).not.toHaveBeenCalled()
    },
  )

  it.each(["", "bad id", "../escape", "x".repeat(129)])(
    "rejects malformed order path %p",
    async (orderId) => {
      const response = await POST(request(), context(orderId))
      expect(response.status).toBe(400)
      expect(storeMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["ORDER_NOT_FOUND", 404],
    ["NO_FULFILLMENT_SUMMARY", 404],
    ["ORDER_NOT_T2", 409],
    ["ORDER_NOT_PAID", 409],
    ["STALE_STATE", 409],
    ["INELIGIBLE_SOURCE_STATUS", 409],
    ["LEASE_PRESENT", 409],
    ["DOWNSTREAM_EVIDENCE_PRESENT", 409],
  ])("maps store refusal %s to %i", async (code, status) => {
    storeMock.mockResolvedValue({ ok: false, code })
    const response = await POST(request(), context())
    expect(response.status).toBe(status)
  })

  it("returns bounded success and supplies actor from session only", async () => {
    const response = await POST(request(), context())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      outcome: "ENTERED_MANUAL_REVIEW",
      status: "MANUAL_REVIEW",
      statusRevision: 3,
    })
    expect(storeMock).toHaveBeenCalledWith({
      orderId: "ord_1",
      actorUserId: "admin_1",
      expectedStatus: "ARTIFACT_PENDING",
      expectedStatusRevision: 2,
    })
  })

  it("returns a bounded 500 on unexpected store failure", async () => {
    storeMock.mockRejectedValue(new Error("secret database details"))
    const response = await POST(request(), context())
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain("secret database")
  })

  it("does not import any downstream side-effect module", () => {
    const source = require("fs").readFileSync(
      require("path").join(
        process.cwd(),
        "app/api/admin/evidence/[orderId]/manual-review/route.ts",
      ),
      "utf8",
    ).toLowerCase()
    for (const forbidden of [
      "kickoff",
      "retry",
      "generation",
      "delivery",
      "email",
      "stripe",
      "refund",
      "webhook",
      "provider",
      "packet",
    ]) expect(source).not.toContain(forbidden)
  })
})
