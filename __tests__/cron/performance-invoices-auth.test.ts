/** @jest-environment node */

/**
 * `/api/cron/performance-invoices` — authorization fails closed.
 *
 * This was the last cron route on the `if (expectedKey && ...)` pattern: with
 * `CRON_SECRET` unset or empty it skipped the check entirely and answered an
 * anonymous GET. Its reachable response was already the inert held-product
 * refusal, so nothing leaked — but the route sits on a held-product path, it
 * was disclosed as closed while it was not, and a fail-open guard left in the
 * tree is a pattern the next route copies.
 *
 * Every provider here is a **throwing** mock. The assertion is not "the mock
 * recorded no calls" but "touching a provider at all would have thrown", so a
 * refusal that constructs a client before returning cannot pass quietly.
 */

const explode = (what: string) => () => {
  throw new Error(`PROVIDER TOUCHED: ${what}`)
}

jest.mock("stripe", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(explode("Stripe constructor")),
}))

jest.mock("resend", () => ({
  __esModule: true,
  Resend: jest.fn().mockImplementation(explode("Resend constructor")),
}))

jest.mock("@/lib/db", () => ({
  __esModule: true,
  get prisma() {
    return new Proxy(
      {},
      {
        get: (_t, model: string) =>
          new Proxy({}, { get: (_m, op: string) => explode(`prisma.${model}.${op}`) }),
      },
    )
  },
}))

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  get prisma() {
    return new Proxy(
      {},
      {
        get: (_t, model: string) =>
          new Proxy({}, { get: (_m, op: string) => explode(`prisma.${model}.${op}`) }),
      },
    )
  },
}))

jest.mock("@/lib/email", () => ({
  __esModule: true,
  sendEmail: explode("lib/email sendEmail"),
}))

jest.mock("@/lib/email/send", () => ({
  __esModule: true,
  sendEmail: explode("lib/email/send sendEmail"),
}))

import { GET } from "@/app/api/cron/performance-invoices/route"

const netAttempt = jest.fn(explode("global fetch"))
const originalFetch = globalThis.fetch

function get(headers: Record<string, string> = {}) {
  return GET(
    new Request("https://www.overtaxed-il.com/api/cron/performance-invoices", { headers }) as never,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(globalThis as unknown as { fetch: unknown }).fetch = netAttempt
})

afterEach(() => {
  ;(globalThis as unknown as { fetch: unknown }).fetch = originalFetch
  delete process.env.CRON_SECRET
})

describe("refuses before any provider, read, write, or network attempt", () => {
  const REFUSED: Array<[string, () => void, Record<string, string>]> = [
    ["CRON_SECRET missing", () => delete process.env.CRON_SECRET, {}],
    ["CRON_SECRET missing, bearer presented", () => delete process.env.CRON_SECRET, { authorization: "Bearer anything" }],
    ["CRON_SECRET empty", () => { process.env.CRON_SECRET = "" }, { authorization: "Bearer " }],
    ["CRON_SECRET empty, no header", () => { process.env.CRON_SECRET = "" }, {}],
    ["wrong bearer", () => { process.env.CRON_SECRET = "correct-horse-battery-staple" }, { authorization: "Bearer wrong" }],
    ["no bearer at all", () => { process.env.CRON_SECRET = "correct-horse-battery-staple" }, {}],
    ["bare secret without the Bearer scheme", () => { process.env.CRON_SECRET = "correct-horse-battery-staple" }, { authorization: "correct-horse-battery-staple" }],
    ["lowercase scheme", () => { process.env.CRON_SECRET = "correct-horse-battery-staple" }, { authorization: "bearer correct-horse-battery-staple" }],
  ]

  it.each(REFUSED)("%s → 401", async (_label, arrange, headers) => {
    arrange()
    const res = await get(headers)

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
    expect(netAttempt).not.toHaveBeenCalled()
  })

  it("an unconfigured deployment is not a public endpoint", async () => {
    // The exact regression: this returned the held-product body, status 410, to
    // an anonymous caller whenever CRON_SECRET was absent.
    delete process.env.CRON_SECRET
    const res = await get()

    expect(res.status).not.toBe(410)
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain("PERFORMANCE_INVOICE")
  })
})

describe("an authorized caller still receives only the withdrawal", () => {
  it("returns the held-product refusal with no enumeration", async () => {
    process.env.CRON_SECRET = "correct-horse-battery-staple"
    const res = await get({ authorization: "Bearer correct-horse-battery-staple" })

    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body).toMatchObject({
      code: "PRODUCT_HELD",
      product: "PERFORMANCE_INVOICE",
      performanceUsersChecked: 0,
      invoicesCreated: 0,
      invoiceIds: [],
    })
    expect(netAttempt).not.toHaveBeenCalled()
  })

  it("names the boundary that refused", async () => {
    process.env.CRON_SECRET = "correct-horse-battery-staple"
    const body = await (await get({ authorization: "Bearer correct-horse-battery-staple" })).json()

    expect(body.error).toContain("api/cron/performance-invoices")
    expect(body.error).toContain("PERFORMANCE_INVOICE")
  })
})
