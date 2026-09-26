/** @jest-environment node */
/**
 * T-11: runtime behaviour of the three Slice 1 operator routes.
 *
 * These drive the real route handlers: auth, same-origin, strict JSON, the
 * default-off flag gate, response headers, and the guarantee that no raw
 * database record and no PII ever reaches a response body.
 */
import fs from "node:fs"
import path from "node:path"

const getSession = jest.fn()
jest.mock("@/lib/auth/session", () => ({ __esModule: true, getSession }))

const listNeutralOperatorQueue = jest.fn()
jest.mock("@/lib/fulfillment-runtime/neutral-operator-queue", () => ({
  __esModule: true,
  listNeutralOperatorQueue,
}))

const classifyNeutralOrder = jest.fn()
jest.mock("@/lib/fulfillment-runtime/neutral-order-classification-store", () => ({
  __esModule: true,
  classifyNeutralOrder,
}))

const readNeutralOperatorArtifact = jest.fn()
jest.mock("@/lib/fulfillment-runtime/neutral-operator-read-store", () => ({
  __esModule: true,
  readNeutralOperatorArtifact,
}))

const { NextRequest } = require("next/server") as typeof import("next/server")

const ORIGIN = "https://admin.example.com"
const SHA = "a".repeat(64)

const params = (orderId: string) => ({ params: Promise.resolve({ orderId }) })

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
  })
}

function get(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "GET", headers: { origin: ORIGIN, ...headers } })
}

const admin = () => getSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } })

const FLAGS = [
  "OT_NEUTRAL_OPERATOR_QUEUE_ENABLED",
  "OT_NEUTRAL_OPERATOR_READ_ENABLED",
  "OT_NEUTRAL_MANUAL_DELIVERY_ENABLED",
] as const

describe("Slice 1 operator routes", () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    for (const flag of FLAGS) {
      saved[flag] = process.env[flag]
      delete process.env[flag]
    }
  })

  afterEach(() => {
    for (const flag of FLAGS)
      if (saved[flag] === undefined) delete process.env[flag]
      else process.env[flag] = saved[flag]
  })

  // --------------------------------------------------------------- queue GET

  describe("GET /api/admin/neutral-reports/queue", () => {
    const route = () => require("@/app/api/admin/neutral-reports/queue/route")

    it("refuses an anonymous or non-admin caller before reading anything", async () => {
      for (const session of [null, { user: { id: "u1", role: "USER" } }, { user: { role: "ADMIN" } }]) {
        getSession.mockResolvedValue(session)
        const response = await route().GET(get(`${ORIGIN}/api/admin/neutral-reports/queue`))
        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({ ok: false, code: "UNAUTHORIZED" })
      }
      expect(listNeutralOperatorQueue).not.toHaveBeenCalled()
    })

    it("returns 404 NOT_AVAILABLE while the flag is absent", async () => {
      admin()
      const response = await route().GET(get(`${ORIGIN}/api/admin/neutral-reports/queue`))
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ ok: false, code: "NOT_AVAILABLE" })
      expect(listNeutralOperatorQueue).not.toHaveBeenCalled()
    })

    it("serves the bounded item list with private, non-indexable headers", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED = "true"
      listNeutralOperatorQueue.mockResolvedValue({
        ok: true,
        items: [{ orderId: "ord_1", state: "AWAITING_QA" }],
      })
      const response = await route().GET(get(`${ORIGIN}/api/admin/neutral-reports/queue`))
      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toContain("no-store")
      expect(response.headers.get("cache-control")).toContain("private")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
      expect(response.headers.get("x-robots-tag")).toContain("noindex")
      expect(await response.json()).toEqual({
        ok: true,
        items: [{ orderId: "ord_1", state: "AWAITING_QA" }],
      })
    })

    it("uses strict === true flag semantics", async () => {
      admin()
      for (const value of ["1", "TRUE", "true ", "yes", ""]) {
        process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED = value
        const response = await route().GET(get(`${ORIGIN}/api/admin/neutral-reports/queue`))
        expect(response.status).toBe(404)
      }
      expect(listNeutralOperatorQueue).not.toHaveBeenCalled()
    })
  })

  // ----------------------------------------------------- classification POST

  describe("POST /api/admin/neutral-reports/[orderId]/classification", () => {
    const route = () => require("@/app/api/admin/neutral-reports/[orderId]/classification/route")
    const url = `${ORIGIN}/api/admin/neutral-reports/ord_1/classification`

    it("refuses a non-admin, a cross-origin post, and a non-JSON content type", async () => {
      getSession.mockResolvedValue(null)
      expect(
        (await route().POST(post(url, { action: "CLASSIFY", class: "CUSTOMER" }), params("ord_1"))).status,
      ).toBe(401)

      admin()
      process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED = "true"
      expect(
        (
          await route().POST(
            post(url, { action: "CLASSIFY", class: "CUSTOMER" }, { origin: "https://evil.example" }),
            params("ord_1"),
          )
        ).status,
      ).toBe(403)
      expect(
        (
          await route().POST(
            post(url, { action: "CLASSIFY", class: "CUSTOMER" }, { "content-type": "text/plain" }),
            params("ord_1"),
          )
        ).status,
      ).toBe(400)
      expect(classifyNeutralOrder).not.toHaveBeenCalled()
    })

    it("returns 404 while the flag is absent", async () => {
      admin()
      const response = await route().POST(
        post(url, { action: "CLASSIFY", class: "CUSTOMER" }),
        params("ord_1"),
      )
      expect(response.status).toBe(404)
      expect(classifyNeutralOrder).not.toHaveBeenCalled()
    })

    it("parses a strict body: unknown keys, unknown classes, and free text are refused", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED = "true"
      for (const body of [
        { action: "CLASSIFY", class: "CUSTOMER", extra: 1 },
        { action: "CLASSIFY", class: "PARTNER" },
        { action: "CLASSIFY" },
        { action: "RECLASSIFY", class: "CUSTOMER" },
        { action: "CLASSIFY", class: "CUSTOMER", noteCode: "anything at all" },
        {},
      ]) {
        const response = await route().POST(post(url, body), params("ord_1"))
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ ok: false, code: "INVALID_BODY" })
      }
      expect(classifyNeutralOrder).not.toHaveBeenCalled()
    })

    it("derives the actor key from the authenticated admin and never from the body", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED = "true"
      classifyNeutralOrder.mockResolvedValue({ ok: true, class: "OWNER_TEST", created: true })
      await route().POST(
        post(url, { action: "CLASSIFY", class: "OWNER_TEST", noteCode: "REHEARSAL" }),
        params("ord_1"),
      )
      expect(classifyNeutralOrder).toHaveBeenCalledWith({
        orderId: "ord_1",
        actorKey: "admin:u1",
        class: "OWNER_TEST",
        noteCode: "REHEARSAL",
      })
    })

    it("reports a refusal as 409 with a closed code and no record", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED = "true"
      classifyNeutralOrder.mockResolvedValue({ ok: false, blocker: "CLASS_CONFLICT" })
      const response = await route().POST(
        post(url, { action: "CLASSIFY", class: "CUSTOMER" }),
        params("ord_1"),
      )
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ ok: false, blocker: "CLASS_CONFLICT" })
    })

    it("refuses a malformed order id", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED = "true"
      const response = await route().POST(
        post(url, { action: "CLASSIFY", class: "CUSTOMER" }),
        params("ord 1/../x"),
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, code: "INVALID_ORDER_ID" })
    })
  })

  // ---------------------------------------------------------- artifact POST

  describe("POST /api/admin/neutral-reports/[orderId]/artifact", () => {
    const route = () => require("@/app/api/admin/neutral-reports/[orderId]/artifact/route")
    const url = `${ORIGIN}/api/admin/neutral-reports/ord_1/artifact`
    const body = { action: "READ", artifactKind: "INTERNAL_PDF", expectedSha256: SHA }

    it("refuses a non-admin and a cross-origin post before reading bytes", async () => {
      getSession.mockResolvedValue(null)
      expect((await route().POST(post(url, body), params("ord_1"))).status).toBe(401)
      admin()
      process.env.OT_NEUTRAL_OPERATOR_READ_ENABLED = "true"
      expect(
        (await route().POST(post(url, body, { origin: "https://evil.example" }), params("ord_1"))).status,
      ).toBe(403)
      expect(readNeutralOperatorArtifact).not.toHaveBeenCalled()
    })

    it("returns 404 while the read flag is absent", async () => {
      admin()
      const response = await route().POST(post(url, body), params("ord_1"))
      expect(response.status).toBe(404)
      expect(readNeutralOperatorArtifact).not.toHaveBeenCalled()
    })

    it("requires an exact expected digest and a known artifact kind", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_READ_ENABLED = "true"
      for (const bad of [
        { action: "READ", artifactKind: "INTERNAL_PDF", expectedSha256: "short" },
        { action: "READ", artifactKind: "INTERNAL_PDF", expectedSha256: SHA.toUpperCase() },
        { action: "READ", artifactKind: "SOURCE_HTML", expectedSha256: SHA },
        { action: "READ", artifactKind: "INTERNAL_PDF" },
        { action: "READ", artifactKind: "INTERNAL_PDF", expectedSha256: SHA, extra: true },
        { action: "DOWNLOAD", artifactKind: "INTERNAL_PDF", expectedSha256: SHA },
      ]) {
        const response = await route().POST(post(url, bad), params("ord_1"))
        expect(response.status).toBe(400)
      }
      expect(readNeutralOperatorArtifact).not.toHaveBeenCalled()
    })

    it("serves verified bytes with private, non-indexable, non-sniffable headers", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_READ_ENABLED = "true"
      readNeutralOperatorArtifact.mockResolvedValue({
        ok: true,
        bytes: Buffer.from("%PDF-1.7 synthetic"),
        sha256: SHA,
        byteSize: 18,
        artifactKind: "INTERNAL_PDF",
        purpose: "QA_REVIEW",
        mediaType: "application/pdf",
      })
      const response = await route().POST(post(url, body), params("ord_1"))
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("application/pdf")
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
      expect(response.headers.get("x-robots-tag")).toContain("noindex")
      expect(response.headers.get("content-disposition")).toContain("attachment")
      expect(response.headers.get("x-ot-artifact-sha256")).toBe(SHA)
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-1.7 synthetic")
      expect(readNeutralOperatorArtifact).toHaveBeenCalledWith({
        orderId: "ord_1",
        actorKey: "admin:u1",
        artifactKind: "INTERNAL_PDF",
        expectedSha256: SHA,
      })
    })

    it("never leaks a locator, a public URL, or a raw record on refusal", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_READ_ENABLED = "true"
      for (const blocker of [
        "QA_NOT_OPEN_FOR_ACTOR",
        "ARTIFACT_DIGEST_MISMATCH",
        "STORAGE_READ_FAILED",
        "PAYMENT_NOT_AUTHORITATIVE",
      ]) {
        readNeutralOperatorArtifact.mockResolvedValue({ ok: false, blocker })
        const response = await route().POST(post(url, body), params("ord_1"))
        expect(response.status).toBe(409)
        const text = await response.text()
        expect(JSON.parse(text)).toEqual({ ok: false, blocker })
        expect(text).not.toMatch(/https?:|blob\.vercel|ot-neutral-reports\/|@/)
      }
    })

    it("maps an unexpected store exception to a bare 500", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_READ_ENABLED = "true"
      readNeutralOperatorArtifact.mockRejectedValue(
        new Error("blob ot-neutral-reports/sha256/deadbeef.json unreachable"),
      )
      const response = await route().POST(post(url, body), params("ord_1"))
      expect(response.status).toBe(500)
      const text = await response.text()
      expect(JSON.parse(text)).toEqual({ ok: false, code: "INTERNAL_ERROR" })
      expect(text).not.toContain("ot-neutral-reports")
    })

    it("refuses a malformed JSON body without echoing it", async () => {
      admin()
      process.env.OT_NEUTRAL_OPERATOR_READ_ENABLED = "true"
      const request = new NextRequest(url, {
        method: "POST",
        body: "{not json",
        headers: { "content-type": "application/json", origin: ORIGIN },
      })
      const response = await route().POST(request, params("ord_1"))
      expect(response.status).toBe(400)
      expect(await response.text()).not.toContain("not json")
    })
  })
})

describe("Slice 1 operator route source shape", () => {
  /** Source with runs of whitespace collapsed, so formatting is not asserted. */
  const read = (file: string) =>
    fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/[ \t]+/g, " ")
  const ROUTES = [
    "app/api/admin/neutral-reports/queue/route.ts",
    "app/api/admin/neutral-reports/[orderId]/classification/route.ts",
    "app/api/admin/neutral-reports/[orderId]/artifact/route.ts",
  ]

  it.each(ROUTES)("%s uses strict schemas and the admin-derived actor key", (file) => {
    const src = read(file)
    expect(src).toContain('user?.role !== "ADMIN"')
    if (file.endsWith("queue/route.ts")) expect(src).not.toContain("export async function POST")
    else {
      expect(src).toContain(".strict()")
      expect(src).toContain("actorKey: `admin:${user.id}`")
      expect(src).toContain('request.headers.get("origin")')
      expect(src).toContain("content-type")
    }
  })

  it.each(ROUTES)("%s gates on its own strict flag and exposes no enabling path", (file) => {
    const src = read(file)
    // Strict equality against the exact string, in the refusal direction: the
    // route serves only when the flag is exactly "true". `!==` and `===` are the
    // same semantics here; what matters is that neither is a truthiness test.
    expect(src).toMatch(/process\.env\.OT_NEUTRAL_\w+ !== "true"/)
    expect(src).not.toMatch(/if \(\s*process\.env\.OT_NEUTRAL_\w+\s*\)/)
    expect(src).not.toMatch(/process\.env\[[^\]]+\]\s*=[^=]/)
    expect(src).toContain('"NOT_AVAILABLE"')
  })

  it.each(ROUTES)("%s calls no send, provider, capability, or promotion path", (file) => {
    const src = read(file)
    expect(src).not.toMatch(
      /sendEmail|Resend|resend\.emails|stripe|Stripe|issueT2PacketCapability|neutral-customer-promotion|ot_delivery_attempt|OTDeliveryAttempt/,
    )
  })
})
