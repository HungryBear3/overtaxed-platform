/**
 * @jest-environment node
 *
 * The HTTP boundary for provider callbacks.
 *
 * Two things it must get right: a probing caller learns nothing from the status
 * code about WHY it was refused, and a provider that sends something we do not
 * model is not told to retry forever.
 */
const ingestMock = jest.fn()
jest.mock("@/lib/fulfillment-runtime/t2-resend-events", () => ({
  ingestT2ResendCallback: (...args: unknown[]) => ingestMock(...args),
  MAX_SIGNATURE_AGE_MS: 300_000,
}))

import { MAX_CALLBACK_BODY_BYTES } from "@/lib/fulfillment/provider-callbacks"
import { GET, POST } from "@/app/api/ot/webhooks/resend/route"

const PRIOR = process.env.OT_T2_DELIVERY_CALLBACK_ENABLED

function request(body = "{}", headers: Record<string, string> = {}) {
  return new Request("https://www.overtaxed-il.com/api/ot/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": "msg_1", "svix-timestamp": "1", "svix-signature": "v1,x", ...headers },
    body,
  }) as unknown as import("next/server").NextRequest
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, "warn").mockImplementation(() => {})
  jest.spyOn(console, "info").mockImplementation(() => {})
  jest.spyOn(console, "error").mockImplementation(() => {})
  process.env.OT_T2_DELIVERY_CALLBACK_ENABLED = "true"
  ingestMock.mockResolvedValue({ ok: true, result: { outcome: "APPLIED" } })
})
afterEach(() => { jest.restoreAllMocks() })
afterAll(() => {
  if (PRIOR === undefined) delete process.env.OT_T2_DELIVERY_CALLBACK_ENABLED
  else process.env.OT_T2_DELIVERY_CALLBACK_ENABLED = PRIOR
})

describe("the route does not exist while the flag is not exactly true", () => {
  it.each([undefined, "", "false", "TRUE", "1", "true "])("flag %j 404s", async (flag) => {
    if (flag === undefined) delete process.env.OT_T2_DELIVERY_CALLBACK_ENABLED
    else process.env.OT_T2_DELIVERY_CALLBACK_ENABLED = flag
    const response = await POST(request())
    expect(response.status).toBe(404)
    expect(ingestMock).not.toHaveBeenCalled()
  })
})

describe("the body is bounded before it is read", () => {
  it("refuses a declared length over the ceiling without reading it", async () => {
    const response = await POST(
      request("{}", { "content-length": String(MAX_CALLBACK_BODY_BYTES + 1) }),
    )
    expect(response.status).toBe(413)
    expect(ingestMock).not.toHaveBeenCalled()
  })
})

describe("only signature headers reach the verifier", () => {
  it("passes exactly the allowlisted headers and the raw body", async () => {
    await POST(request('{"type":"email.sent"}', { "x-forwarded-for": "1.2.3.4", cookie: "a=b" }))
    const [input] = ingestMock.mock.calls[0] as [{ rawBody: string; headers: Record<string, unknown> }]
    expect(input.rawBody).toBe('{"type":"email.sent"}')
    expect(Object.keys(input.headers).sort()).toEqual([
      "svix-id", "svix-signature", "svix-timestamp",
      "webhook-id", "webhook-signature", "webhook-timestamp",
    ])
    expect(JSON.stringify(input.headers)).not.toContain("1.2.3.4")
    expect(JSON.stringify(input.headers)).not.toContain("a=b")
  })
})

describe("refusals are coarse on the wire and precise in the log", () => {
  it.each([
    ["INVALID_SIGNATURE", 401],
    ["INVALID_PROVIDER_EVENT_ID", 401],
    ["SECRET_NOT_CONFIGURED", 503],
    ["BODY_TOO_LARGE", 413],
    ["INVALID_JSON", 400],
    ["MISSING_MESSAGE_ID", 400],
    ["INVALID_TIMESTAMP", 400],
    ["IMPLAUSIBLE_TIMESTAMP", 400],
    ["FLAG_DISABLED", 400],
  ])("maps %s to %i", async (code, status) => {
    ingestMock.mockResolvedValue({ ok: false, code })
    const response = await POST(request())
    expect(response.status).toBe(status)
    // The body never distinguishes one refusal from another.
    await expect(response.json()).resolves.toEqual({ ok: false })
  })

  it.each(["IGNORED_EVENT_TYPE", "UNSUPPORTED_EVENT_TYPE"])(
    "accepts %s so the provider does not retry forever",
    async (code) => {
      ingestMock.mockResolvedValue({ ok: false, code })
      const response = await POST(request())
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true, received: true })
    },
  )

  it("answers 500 on a throw, so the provider's retry can succeed later", async () => {
    ingestMock.mockRejectedValue(new Error("synthetic connection detail"))
    const response = await POST(request())
    expect(response.status).toBe(500)
    // Nothing from the thrown value is logged.
    expect(console.error).toHaveBeenCalledWith("[ot-t2-callback] outcome=THREW")
  })
})

describe("responses carry no identifier and are never cached", () => {
  it.each(["APPLIED", "UNMATCHED", "DUPLICATE"])("returns a bare receipt for %s", async (outcome) => {
    ingestMock.mockResolvedValue({ ok: true, result: { outcome, fulfillmentId: "ful_secret", attemptNumber: 1 } })
    const response = await POST(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ ok: true, received: true })
    expect(JSON.stringify(body)).not.toContain("ful_secret")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("x-robots-tag")).toContain("noindex")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })
})

describe("a signed callback is a POST", () => {
  it("refuses GET", async () => {
    const response = await GET()
    expect(response.status).toBe(405)
  })
})
