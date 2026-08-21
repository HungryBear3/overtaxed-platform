/** @jest-environment node */

/**
 * Staff-assisted filing authorization.
 *
 * This is the sharpest BL-A surface left on the branch. The appeal detail page
 * headed a panel "Authorize filing on your behalf" (BL-A4), told the customer
 * it would "authorize OverTaxed IL to file your appeal with Cook County"
 * (BL-A1, BL-A3), and captured a drawn signature on the county's official
 * Attorney/Representative form.
 *
 * CC-11 states the opposite: under the Board's own rules only a licensed
 * attorney or the taxpayer personally may practise there, and OverTaxed IL does
 * not file, sign, or represent anyone. Staff-assisted filing is the held
 * Done-For-You product (T3_DFY) by another name, so the hold is enforced at the
 * two routes that create an authorization.
 *
 * The download route is deliberately NOT withdrawn here. It returns a document
 * a customer already signed; cutting off access to their own record is a data
 * disposition decision, not an implementation one. That residue is named in the
 * handoff.
 */

const put = jest.fn()
const del = jest.fn()
jest.mock("@vercel/blob", () => ({ __esModule: true, put, del }))

const fillOfficialCookCountyAuthForm = jest.fn()
jest.mock("@/lib/document-generation/fill-official-auth-form", () => ({
  __esModule: true,
  fillOfficialCookCountyAuthForm,
}))

const prismaMock = {
  appeal: { findFirst: jest.fn(), update: jest.fn() },
  filingAuthorization: { upsert: jest.fn(), update: jest.fn(), create: jest.fn() },
}
jest.mock("@/lib/db", () => ({ __esModule: true, prisma: prismaMock }))

const getSession = jest.fn()
jest.mock("@/lib/auth/session", () => ({ __esModule: true, getSession }))

const { NextRequest } = require("next/server") as typeof import("next/server")

const params = Promise.resolve({ id: "appeal_1" })

function noAuthorizationSideEffects() {
  expect(prismaMock.appeal.findFirst).not.toHaveBeenCalled()
  expect(prismaMock.filingAuthorization.upsert).not.toHaveBeenCalled()
  expect(prismaMock.filingAuthorization.create).not.toHaveBeenCalled()
  expect(fillOfficialCookCountyAuthForm).not.toHaveBeenCalled()
  expect(put).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.resetModules()
})

describe("POST /api/appeals/[id]/authorization", () => {
  it("still rejects unauthenticated callers first", async () => {
    getSession.mockResolvedValue(null)

    const { POST } = await import("@/app/api/appeals/[id]/authorization/route")
    const res = await POST(
      new NextRequest("https://x/api/appeals/appeal_1/authorization", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      { params },
    )

    expect(res.status).toBe(401)
    noAuthorizationSideEffects()
  })

  it("is withdrawn for the signed-in owner and captures no signature", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } })

    const { POST } = await import("@/app/api/appeals/[id]/authorization/route")
    const res = await POST(
      new NextRequest("https://x/api/appeals/appeal_1/authorization", {
        method: "POST",
        body: JSON.stringify({
          ownerName: "Owner",
          ownerEmail: "owner@example.com",
          ownerAddress: "1 Main St",
          ownerCity: "Chicago",
          ownerZip: "60601",
          signatureImageData: "data:image/png;base64,AAAA",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params },
    )

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({
      code: "PRODUCT_HELD",
      product: "T3_DFY",
    })
    noAuthorizationSideEffects()
  })
})

describe("POST /api/appeals/[id]/authorization/upload", () => {
  it("still rejects unauthenticated callers first", async () => {
    getSession.mockResolvedValue(null)

    const { POST } = await import("@/app/api/appeals/[id]/authorization/upload/route")
    const res = await POST(
      new NextRequest("https://x/api/appeals/appeal_1/authorization/upload", { method: "POST" }),
      { params },
    )

    expect(res.status).toBe(401)
    noAuthorizationSideEffects()
  })

  it("is withdrawn for the signed-in owner and stores no signed form", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } })

    const { POST } = await import("@/app/api/appeals/[id]/authorization/upload/route")
    const res = await POST(
      new NextRequest("https://x/api/appeals/appeal_1/authorization/upload", { method: "POST" }),
      { params },
    )

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({
      code: "PRODUCT_HELD",
      product: "T3_DFY",
    })
    noAuthorizationSideEffects()
  })
})

describe("the appeal detail page", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")

  const src = () =>
    readFileSync(join(process.cwd(), "app/appeals/[id]/page.tsx"), "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")

  it("offers no filing-authorization panel", () => {
    const page = src()
    expect(page).not.toMatch(/FilingAuthorizationForm/)
    expect(page).not.toMatch(/Authorize filing on your behalf/i)
    expect(page).not.toMatch(/authorize OverTaxed IL to file/i)
    expect(page).not.toMatch(/staff will file it with Cook County/i)
  })

  it("answers its Board of Review label with CC-11", () => {
    const page = src()
    expect(page).toMatch(/Board of Review/)
    expect(page).toMatch(
      /import\s*\{[^}]*\bCC_11\b[^}]*\}\s*from\s*"@\/lib\/copy\/canonical"/,
    )
    expect(page).toContain("{CC_11}")
  })
})

export {}
