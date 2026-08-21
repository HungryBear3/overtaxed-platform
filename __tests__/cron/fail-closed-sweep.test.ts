/** @jest-environment node */

/**
 * Every cron route refuses an unconfigured deployment.
 *
 * Three separate review rounds each found the same defect on a different route:
 * `if (secret && header !== ...)` skips authorization entirely when the secret
 * is absent, so an unset `CRON_SECRET` turns a scheduled job into a public GET.
 * Each was corrected individually, and the next round found another one — the
 * enumeration was even disclosed as two routes when it was three.
 *
 * Fixing them one at a time is what produced that sequence. This sweep is the
 * standing rule instead: it discovers the cron routes from the filesystem
 * rather than from a list, drives each real handler with no secret set, and
 * requires 401. A new cron route added with the fail-open shape fails here on
 * the day it lands, and a route cannot be omitted from the check by being left
 * out of an enumeration.
 *
 * Providers are throwing mocks, so "refused" also means "refused before
 * touching anything".
 */
import { readdirSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const explode = (what: string) => () => {
  throw new Error(`PROVIDER TOUCHED: ${what}`)
}

const throwingPrisma = () =>
  new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy({}, { get: (_m, op: string) => explode(`prisma.${model}.${op}`) }),
    },
  )

jest.mock("stripe", () => ({ __esModule: true, default: jest.fn().mockImplementation(explode("Stripe")) }))
jest.mock("resend", () => ({ __esModule: true, Resend: jest.fn().mockImplementation(explode("Resend")) }))
jest.mock("@/lib/db", () => ({ __esModule: true, get prisma() { return throwingPrisma() } }))
jest.mock("@/lib/db/prisma", () => ({ __esModule: true, get prisma() { return throwingPrisma() } }))
jest.mock("@/lib/email", () => {
  const actual = jest.requireActual("@/lib/email")
  return { ...actual, sendEmail: explode("lib/email sendEmail") }
})
jest.mock("@/lib/email/send", () => {
  const actual = jest.requireActual("@/lib/email/send")
  return { ...actual, sendEmail: explode("lib/email/send sendEmail") }
})

const ROOT = resolve(__dirname, "../..")
const CRON_DIR = join(ROOT, "app/api/cron")

/** Cron routes, discovered — not enumerated. */
const CRON_ROUTES = readdirSync(CRON_DIR)
  .filter((name) => existsSync(join(CRON_DIR, name, "route.ts")))
  .sort()

const netAttempt = jest.fn(explode("global fetch"))
const originalFetch = globalThis.fetch

beforeEach(() => {
  jest.clearAllMocks()
  ;(globalThis as unknown as { fetch: unknown }).fetch = netAttempt
})

afterEach(() => {
  ;(globalThis as unknown as { fetch: unknown }).fetch = originalFetch
  delete process.env.CRON_SECRET
})

describe("cron authorization fails closed across the fleet", () => {
  it("discovers every cron route from the filesystem", () => {
    // If this list shrinks, the sweep stopped covering something.
    expect(CRON_ROUTES).toEqual([
      "assessment-checks",
      "deadline-reminders",
      "free-check-followups",
      "invoice-collections",
      "performance-invoices",
      "township-alerts",
      "township-open-notifications",
    ])
  })

  it.each(CRON_ROUTES)("%s refuses when CRON_SECRET is unset", async (name) => {
    delete process.env.CRON_SECRET
    const mod = (await import(`@/app/api/cron/${name}/route`)) as Record<string, unknown>
    const handler = (mod.GET ?? mod.POST) as (r: unknown) => Promise<Response>

    const res = await handler(
      new Request(`https://www.overtaxed-il.com/api/cron/${name}`) as never,
    )

    expect({ name, status: res.status }).toEqual({ name, status: 401 })
    expect(netAttempt).not.toHaveBeenCalled()
  })

  it.each(CRON_ROUTES)("%s refuses when CRON_SECRET is empty", async (name) => {
    process.env.CRON_SECRET = ""
    const mod = (await import(`@/app/api/cron/${name}/route`)) as Record<string, unknown>
    const handler = (mod.GET ?? mod.POST) as (r: unknown) => Promise<Response>

    const res = await handler(
      new Request(`https://www.overtaxed-il.com/api/cron/${name}`, {
        headers: { authorization: "Bearer " },
      }) as never,
    )

    expect({ name, status: res.status }).toEqual({ name, status: 401 })
    expect(netAttempt).not.toHaveBeenCalled()
  })

  it.each(CRON_ROUTES)("%s refuses a wrong bearer", async (name) => {
    process.env.CRON_SECRET = "correct-horse-battery-staple"
    const mod = (await import(`@/app/api/cron/${name}/route`)) as Record<string, unknown>
    const handler = (mod.GET ?? mod.POST) as (r: unknown) => Promise<Response>

    const res = await handler(
      new Request(`https://www.overtaxed-il.com/api/cron/${name}`, {
        headers: { authorization: "Bearer wrong" },
      }) as never,
    )

    expect({ name, status: res.status }).toEqual({ name, status: 401 })
    expect(netAttempt).not.toHaveBeenCalled()
  })

  it("leaves no fail-open guard in the tree", () => {
    // The behavioural cases above are the proof; this names the shape, so a
    // reviewer grepping for the pattern finds the rule that bans it.
    const sources = CRON_ROUTES.map((name) => ({
      name,
      src: require("node:fs").readFileSync(join(CRON_DIR, name, "route.ts"), "utf8") as string,
    }))
    for (const { name, src } of sources) {
      const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
      const failOpen = /if\s*\(\s*(\w+)\s*&&\s*[^)]*authorization|if\s*\(\s*(\w+)\s*&&\s*\w*[Aa]uthHeader/.test(code)
      expect({ name, failOpen }).toEqual({ name, failOpen: false })
    }
  })
})
