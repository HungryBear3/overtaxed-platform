/** @jest-environment node */

/**
 * SURF-22 — `/api/township-alert`, driven.
 *
 * The named-surface registry previously offered
 * `__tests__/products/retired-surfaces.test.ts` as this row's proof, behind a
 * `/township/i` guard. Neither half was evidence: that suite contains no
 * reference to the route, and "township" appears 34 times in the route file, so
 * the guard could not fail. The row passed by existing.
 *
 * This suite is the replacement. It drives the real exported `POST` with the
 * provider modules mocked at the identifiers the route actually imports, and
 * asserts the four behaviours that make this surface safe to keep open while
 * the BOR product is held and no deadline feed is trusted:
 *
 *   1. the Board of Review waitlist sentinel is refused (BL-A7 — the held BOR
 *      product must not accept enrolment that induces a homeowner to wait);
 *   2. a township name off the canonical roster is refused;
 *   3. a refusal writes nothing and sends nothing;
 *   4. the confirmation states no date, no countdown and no schedule, and cites
 *      only the canonical host.
 *
 * Each is falsifiable against a real mutation of the route — see the mutation
 * ledger at the bottom, which names the edit that kills each case.
 */

const upsert = jest.fn(async () => ({ id: "ta_1" }))
const sendEmail = jest.fn(async () => ({ success: true }))

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  prisma: { townshipAlert: { upsert: (...a: unknown[]) => upsert(...(a as [])), update: jest.fn() } },
}))

jest.mock("@/lib/email/send", () => ({
  __esModule: true,
  sendEmail: (...a: unknown[]) => sendEmail(...(a as [])),
}))

jest.mock("@/lib/marketing/preview-gate", () => ({
  __esModule: true,
  hostFromRequest: () => "www.overtaxed-il.com",
  isPreviewStubEnabled: () => false,
  marketingGateReason: () => "test",
  previewNoopResponseBody: () => ({ ok: true, mode: "preview_noop" }),
}))

import { POST } from "@/app/api/township-alert/route"
import { TOWNSHIPS } from "@/lib/townships"

function post(body: Record<string, unknown>) {
  return POST(
    new Request("https://www.overtaxed-il.com/api/township-alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  )
}

const ROSTER_NAME = TOWNSHIPS[0].name

beforeEach(() => {
  jest.clearAllMocks()
})

describe("the held Board of Review product cannot be joined here", () => {
  it("refuses the Board of Review waitlist sentinel", async () => {
    const res = await post({ email: "homeowner@example.com", township: "Board of Review Waitlist" })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("valid township") })
  })

  it("writes nothing and sends nothing when it refuses", async () => {
    await post({ email: "homeowner@example.com", township: "Board of Review Waitlist" })

    expect(upsert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("refuses every phrasing of the held waitlist, not one literal", async () => {
    for (const name of ["Board of Review", "BOR Waitlist", "Board of Review waitlist", "bor"]) {
      const res = await post({ email: "homeowner@example.com", township: name })
      expect({ name, status: res.status }).toEqual({ name, status: 400 })
    }
    expect(upsert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe("subscription is keyed to the canonical roster", () => {
  it("refuses a township the county does not use", async () => {
    // The display grouping that used to be accepted. A subscription keyed to a
    // name with no filing window cannot be matched to one later.
    const res = await post({ email: "homeowner@example.com", township: "Chicago (City)" })

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("accepts a real roster township and records exactly one subscription", async () => {
    const res = await post({ email: "homeowner@example.com", township: ROSTER_NAME })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email_township: { email: "homeowner@example.com", township: ROSTER_NAME } },
      }),
    )
  })

  it("refuses a malformed email before touching the database", async () => {
    const res = await post({ email: "not-an-email", township: ROSTER_NAME })

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe("the confirmation promises no deadline", () => {
  const DATE_CLAIM =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}\b/
  const ISO_DATE = /\b(19|20)\d{2}-\d{2}-\d{2}\b/
  const COUNTDOWN = /\b\d+\s*(days?|business days?)\s*(left|remaining|until|before|to file)/i
  const SCHEDULE = /when the window opens|before it closes|we'?ll (email|tell|remind) you|we will (email|tell|remind) you/i

  async function confirmation(): Promise<{ text: string; html: string; subject: string }> {
    await post({ email: "homeowner@example.com", township: ROSTER_NAME })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [args] = sendEmail.mock.calls[0] as unknown as [{ text: string; html: string; subject: string }]
    return args
  }

  it("states no date and runs no countdown", async () => {
    const { text, html, subject } = await confirmation()
    for (const [where, body] of [["text", text], ["html", html], ["subject", subject]] as const) {
      expect({ where, date: DATE_CLAIM.test(body) }).toEqual({ where, date: false })
      expect({ where, iso: ISO_DATE.test(body) }).toEqual({ where, iso: false })
      expect({ where, countdown: COUNTDOWN.test(body) }).toEqual({ where, countdown: false })
    }
  })

  it("promises no delivery schedule it cannot keep", async () => {
    // The retired `cron/township-alerts` sends nothing at all. Copy that says
    // otherwise gives a homeowner a reason to stop watching their own deadline.
    const { text, html } = await confirmation()
    expect({ where: "text", schedule: SCHEDULE.test(text) }).toEqual({ where: "text", schedule: false })
    expect({ where: "html", schedule: SCHEDULE.test(html) }).toEqual({ where: "html", schedule: false })
  })

  it("sends the reader to the county, on the canonical host only", async () => {
    const { text, html } = await confirmation()
    for (const [where, body] of [["text", text], ["html", html]] as const) {
      expect({ where, canonical: body.includes("cookcountyassessoril.gov") }).toEqual({ where, canonical: true })
      expect({ where, wrongHost: /cookcountyassessor\.com/i.test(body) }).toEqual({ where, wrongHost: false })
    }
  })

  it("tells the reader not to wait for us", async () => {
    const { text } = await confirmation()
    expect(text).toMatch(/should not wait for one from us/i)
  })
})

/**
 * Mutation ledger — the edit to `app/api/township-alert/route.ts` that kills
 * each group above. Recorded so a future reader can re-run the falsification
 * rather than trust this comment.
 *
 * | Mutation | Case that fails |
 * |---|---|
 * | add `"Board of Review Waitlist"` to `NON_TOWNSHIP_BUCKETS` | refuses the Board of Review waitlist sentinel |
 * | drop `ROSTER_TOWNSHIP_NAMES.has(township)` from the guard | refuses a township the county does not use |
 * | move the `upsert` above the validation block | writes nothing and sends nothing when it refuses |
 * | restore "we'll email you when the window opens" to the confirmation | promises no delivery schedule it cannot keep |
 * | change the calendar link to `cookcountyassessor.com` | sends the reader to the county, on the canonical host only |
 */
export {}
