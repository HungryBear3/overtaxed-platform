/**
 * @jest-environment node
 *
 * Route-level coverage for the PROPERTY_LOOKUP_UNAVAILABLE sentinel on the four
 * property surfaces that call `lookupUnavailableResponse`:
 *   GET  /api/properties/lookup
 *   GET  /api/properties/lookup-deadline
 *   POST /api/properties
 *   POST /api/properties/[id]/refresh
 *
 * Only `getPropertyByPIN` is replaced inside `@/lib/cook-county` (PIN helpers and
 * the sentinel constant stay real). Session, rate limiter, Prisma and Realie are
 * mocked; nothing touches the network or a database. The response helper and the
 * shared refresh module (`refreshPropertyFromCookCounty`) are REAL, so the refresh
 * route's outage path is exercised end to end against the mocked Prisma client.
 */
const prismaMock = {
  user: { findUnique: jest.fn() },
  property: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    upsert: jest.fn(),
  },
  assessmentHistory: {
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
}

// Lazy getter: jest.mock is hoisted above the `prismaMock` declaration.
jest.mock("@/lib/db", () => ({ __esModule: true, get prisma() { return prismaMock } }))
jest.mock("@/lib/auth/session", () => ({ getSession: jest.fn() }))
jest.mock("@/lib/rate-limit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  getClientIdentifier: jest.fn(() => "test-client"),
}))
jest.mock("@/lib/realie", () => ({ getFullPropertyByPin: jest.fn(async () => null) }))
jest.mock("@/lib/cook-county", () => ({
  ...jest.requireActual("@/lib/cook-county"),
  getPropertyByPIN: jest.fn(),
}))

import { NextRequest } from "next/server"
import { GET as lookupGET } from "@/app/api/properties/lookup/route"
import { GET as deadlineGET } from "@/app/api/properties/lookup-deadline/route"
import { POST as propertiesPOST } from "@/app/api/properties/route"
import { POST as refreshPOST } from "@/app/api/properties/[id]/refresh/route"
import { PROPERTY_LOOKUP_UNAVAILABLE } from "@/lib/cook-county"

const cookCounty = jest.requireMock("@/lib/cook-county") as { getPropertyByPIN: jest.Mock }
const session = jest.requireMock("@/lib/auth/session") as { getSession: jest.Mock }
const rate = jest.requireMock("@/lib/rate-limit") as { rateLimit: jest.Mock }
const realie = jest.requireMock("@/lib/realie") as { getFullPropertyByPin: jest.Mock }

const PIN = "16012160010000"
const PIN_DASHED = "16-01-216-001-0000"
const USER = { id: "user-1", email: "owner@example.test", subscriptionTier: "STARTER" }

/** Exact public body for an outage; must never carry the internal sentinel. */
const SAFE_503 = {
  error:
    "We could not reach the Cook County records service just now. Please try again in a few minutes — this is on our side, not your address.",
  code: "PROPERTY_LOOKUP_UNAVAILABLE",
  retryable: true,
}

const OUTAGE = { success: false, data: null, error: PROPERTY_LOOKUP_UNAVAILABLE, source: "Cook County Open Data" }
const NOT_FOUND = {
  success: false,
  data: null,
  error: `Property not found for PIN: ${PIN_DASHED}`,
  source: "Cook County Open Data",
}

const WRITE_MOCKS: Array<[string, jest.Mock]> = [
  ...Object.entries(prismaMock.property)
    .filter(([k]) => !["findFirst", "findUnique", "count"].includes(k))
    .map(([k, fn]) => [`property.${k}`, fn] as [string, jest.Mock]),
  ...Object.entries(prismaMock.assessmentHistory).map(([k, fn]) => [`assessmentHistory.${k}`, fn] as [string, jest.Mock]),
]

function expectNoWrites() {
  for (const [name, fn] of WRITE_MOCKS) {
    if (fn.mock.calls.length) throw new Error(`unexpected write: prisma.${name}`)
  }
}

function getReq(path: string) {
  return new NextRequest(new URL(path, "http://localhost"))
}
function postReq(path: string, body: unknown) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}
async function read(res: Response) {
  return { status: res.status, body: await res.json() }
}
function refreshCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, "error").mockImplementation(() => {})
  jest.spyOn(console, "warn").mockImplementation(() => {})
  session.getSession.mockResolvedValue({ user: USER })
  rate.rateLimit.mockReturnValue({ allowed: true })
  realie.getFullPropertyByPin.mockResolvedValue(null)
  prismaMock.user.findUnique.mockResolvedValue({ subscriptionTier: "STARTER", subscriptionQuantity: null })
  prismaMock.property.count.mockResolvedValue(0)
  prismaMock.property.findUnique.mockResolvedValue(null)
  prismaMock.property.findFirst.mockResolvedValue(null)
})
afterEach(() => jest.restoreAllMocks())

describe("GET /api/properties/lookup", () => {
  it("county outage sentinel → exact safe 503, no Realie enrichment", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await lookupGET(getReq(`/api/properties/lookup?pin=${PIN_DASHED}`)))
    expect(status).toBe(503)
    expect(body).toEqual(SAFE_503)
    expect(JSON.stringify(body)).not.toContain(PROPERTY_LOOKUP_UNAVAILABLE)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(PIN_DASHED)
    expect(realie.getFullPropertyByPin).not.toHaveBeenCalled()
  })

  it("actual not-found stays 404 with the county message", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue(NOT_FOUND)
    const { status, body } = await read(await lookupGET(getReq(`/api/properties/lookup?pin=${PIN}`)))
    expect(status).toBe(404)
    expect(body).toEqual({ error: NOT_FOUND.error, pin: PIN_DASHED })
  })

  it("rate limit 429 is returned before any lookup", async () => {
    rate.rateLimit.mockReturnValue({ allowed: false })
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await lookupGET(getReq(`/api/properties/lookup?pin=${PIN}`)))
    expect(status).toBe(429)
    expect(body).toEqual({ error: "Too many requests. Please try again later." })
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })
})

describe("GET /api/properties/lookup-deadline", () => {
  it("county outage sentinel → exact safe 503", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await deadlineGET(getReq(`/api/properties/lookup-deadline?pin=${PIN}`)))
    expect(status).toBe(503)
    expect(body).toEqual(SAFE_503)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(PIN)
  })

  it("actual not-found stays 404 with township null", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue(NOT_FOUND)
    const { status, body } = await read(await deadlineGET(getReq(`/api/properties/lookup-deadline?pin=${PIN}`)))
    expect(status).toBe(404)
    expect(body).toEqual({ error: NOT_FOUND.error, township: null })
  })

  it("no session → 401 before any lookup", async () => {
    session.getSession.mockResolvedValue(null)
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await deadlineGET(getReq(`/api/properties/lookup-deadline?pin=${PIN}`)))
    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })
})

describe("POST /api/properties", () => {
  const add = (body: unknown = { pin: PIN_DASHED }) => propertiesPOST(postReq("/api/properties", body))

  it("county outage sentinel → exact safe 503 and nothing is written", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await add())
    expect(status).toBe(503)
    expect(body).toEqual(SAFE_503)
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(PIN)
    expectNoWrites()
  })

  it("actual not-found stays 404 and nothing is written", async () => {
    cookCounty.getPropertyByPIN.mockResolvedValue(NOT_FOUND)
    const { status, body } = await read(await add())
    expect(status).toBe(404)
    expect(body).toEqual({ error: NOT_FOUND.error, pin: PIN_DASHED })
    expectNoWrites()
  })

  it("no session → 401 before any lookup", async () => {
    session.getSession.mockResolvedValue(null)
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await add())
    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
    expect(prismaMock.property.count).not.toHaveBeenCalled()
  })

  it("plan quota 403 is returned before the county is called", async () => {
    prismaMock.property.count.mockResolvedValue(2) // STARTER, no quantity → limit 2
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await add())
    expect(status).toBe(403)
    expect(body).toEqual({
      error: "Property limit reached (2 for your plan). Upgrade to add more properties.",
      limit: 2,
      currentCount: 2,
    })
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it("custom-pricing 403 is returned before the county is called", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ subscriptionTier: "PERFORMANCE", subscriptionQuantity: null })
    prismaMock.property.count.mockResolvedValue(20)
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await add())
    expect(status).toBe(403)
    expect(body.requiresCustom).toBe(true)
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it("duplicate 409 is returned before the county is called", async () => {
    prismaMock.property.findUnique.mockResolvedValue({ id: "prop-1", pin: PIN, address: "1 Existing St" })
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(await add())
    expect(status).toBe(409)
    expect(body).toEqual({
      error: "Property already exists in your account",
      property: { id: "prop-1", pin: PIN_DASHED, address: "1 Existing St" },
    })
    expect(prismaMock.property.findUnique).toHaveBeenCalledWith({
      where: { userId_pin: { userId: USER.id, pin: PIN } },
    })
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
    expectNoWrites()
  })
})

describe("POST /api/properties/[id]/refresh (real refreshPropertyFromCookCounty)", () => {
  const OWNED = { id: "prop-1", userId: USER.id, pin: PIN }

  it("county outage sentinel → exact safe 503 and nothing is written", async () => {
    prismaMock.property.findFirst.mockResolvedValue(OWNED)
    prismaMock.property.findUnique.mockResolvedValue(OWNED)
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(
      await refreshPOST(postReq("/api/properties/prop-1/refresh", {}), refreshCtx("prop-1"))
    )
    expect(status).toBe(503)
    expect(body).toEqual(SAFE_503)
    expect(prismaMock.property.findFirst).toHaveBeenCalledWith({ where: { id: "prop-1", userId: USER.id } })
    expect(cookCounty.getPropertyByPIN).toHaveBeenCalledWith(PIN)
    expectNoWrites()
  })

  it("actual county not-found stays 404 and nothing is written", async () => {
    prismaMock.property.findFirst.mockResolvedValue(OWNED)
    prismaMock.property.findUnique.mockResolvedValue(OWNED)
    cookCounty.getPropertyByPIN.mockResolvedValue(NOT_FOUND)
    const { status, body } = await read(
      await refreshPOST(postReq("/api/properties/prop-1/refresh", {}), refreshCtx("prop-1"))
    )
    expect(status).toBe(404)
    expect(body).toEqual({ error: NOT_FOUND.error })
    expectNoWrites()
  })

  it("not-owned property → 404 before any refresh or lookup", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null)
    cookCounty.getPropertyByPIN.mockResolvedValue(OUTAGE)
    const { status, body } = await read(
      await refreshPOST(postReq("/api/properties/prop-other/refresh", {}), refreshCtx("prop-other"))
    )
    expect(status).toBe(404)
    expect(body).toEqual({ error: "Property not found" })
    expect(prismaMock.property.findFirst).toHaveBeenCalledWith({ where: { id: "prop-other", userId: USER.id } })
    expect(prismaMock.property.findUnique).not.toHaveBeenCalled() // refresh module never entered
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it("no session → 401 before ownership check or lookup", async () => {
    session.getSession.mockResolvedValue(null)
    const { status, body } = await read(
      await refreshPOST(postReq("/api/properties/prop-1/refresh", {}), refreshCtx("prop-1"))
    )
    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(prismaMock.property.findFirst).not.toHaveBeenCalled()
    expect(cookCounty.getPropertyByPIN).not.toHaveBeenCalled()
  })
})
