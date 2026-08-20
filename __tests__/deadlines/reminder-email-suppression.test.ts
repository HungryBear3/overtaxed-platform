/** @jest-environment node */

/**
 * Reminder-email suppression — freshness test-map row 13.
 *
 * "All reminder/open-notification/template paths produce zero sends/CTAs/dates
 * on failure." This file was specified in the frozen implementation map and had
 * never been written, and the defect it was specified to catch was live:
 * `/api/cron/deadline-reminders` read `appeal.filingDeadline` — a value a
 * customer typed into a form, or that the app derived as "notice date + 30
 * days" — formatted it as a filing date, subtracted today from it to make a
 * countdown, and mailed both to a named homeowner. Daily, on a Vercel cron,
 * from a product that publishes no deadline anywhere on its own site. Its auth
 * guard was `if (expectedKey && ...)`, so an unset CRON_SECRET made the whole
 * thing an unauthenticated public GET.
 *
 * The proofs here run against the real modules. `@/lib/email/send` is *not*
 * mocked: the genuine `sendEmail` executes, so the only thing standing between
 * a refusal path and a provider call is the code under test. What is mocked is
 * the `resend` SDK itself, at the package boundary, so any construction or send
 * is observable — and, in the strictest case, fatal.
 */

const resendSend = jest.fn(async (_payload: unknown) => ({ data: { id: "msg_test" }, error: null }))
const resendConstructor = jest.fn(function ResendMock(this: Record<string, unknown>) {
  this.emails = { send: resendSend }
})
jest.mock("resend", () => ({ __esModule: true, Resend: resendConstructor }))

const prismaMock = {
  appeal: { findMany: jest.fn(async () => [] as unknown[]) },
}
jest.mock("@/lib/db", () => ({ __esModule: true, prisma: prismaMock }))

const describeTownshipCalendar = jest.fn()
jest.mock("@/lib/appeals/township-deadlines", () => ({
  __esModule: true,
  describeTownshipCalendar,
  ASSESSOR_CALENDAR_URL: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
}))

import { NextRequest } from "next/server"

import {
  decideDeadlineReminder,
  DEADLINE_REMINDER_DAYS,
  type DeadlineReminderRefusal,
} from "@/lib/followups/schedule"
import { deadlineReminderTemplate } from "@/lib/email/templates"
import {
  evaluateOfficialDeadlineState,
  projectDeadline,
  type DeadlineProjection,
  type OfficialDeadlineSnapshot,
} from "@/lib/deadlines/official-source-state"
import type { TownshipResolution } from "@/lib/deadlines/township-resolution"

const CALENDAR_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
const CRON_SECRET = "cron-secret-for-tests"

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const RESOLUTION: TownshipResolution = {
  inputKind: "pin",
  normalizedPin: "13243140450000",
  normalizedAddress: null,
  townshipKey: "jefferson",
  townshipName: "Jefferson",
  resolutionSource: "official_property_record",
  resolvedAt: "2026-08-19T17:00:00.000Z",
}

function snapshot(over: Record<string, unknown> = {}, at = "2026-08-19T16:59:55.000Z"): OfficialDeadlineSnapshot {
  const source = {
    authority: "cook_county_assessor" as const,
    sourceUrl: CALENDAR_URL,
    retrievedAt: at,
    sourceUpdatedAt: null,
    contentSha256: "a".repeat(64),
    httpStatus: 200,
    finalUrl: CALENDAR_URL,
    parseStatus: "ok" as const,
    parserVersion: "1.0.0",
    ...(over.source as Record<string, unknown>),
  }
  return {
    schemaVersion: 1,
    synthetic: Boolean(over.synthetic),
    sources: { assessor: source, bor: source },
    townships: {
      jefferson: {
        townshipName: "Jefferson",
        stages: {
          assessor: {
            noticeDate: null,
            openDate: (over.openDate as string) ?? "2026-08-05",
            lastFileDate: (over.lastFileDate as string) ?? "2026-08-26",
          },
        },
      },
    },
  } as OfficialDeadlineSnapshot
}

/** A real projection, produced by the real evaluator. */
function project(
  snap: OfficialDeadlineSnapshot,
  now: string,
  township: TownshipResolution | null = RESOLUTION,
): DeadlineProjection {
  return projectDeadline(
    evaluateOfficialDeadlineState({ snapshot: snap, township, stage: "assessor", evaluatedAt: now }),
    now,
  )
}

/* ── The decision, against real projections ───────────────────────────────── */

describe("decideDeadlineReminder refuses every unverified state", () => {
  // Seven days before the close date in the fixture, so the schedule rule is
  // satisfied in every case and the *only* thing under test is the state.
  const NOW = "2026-08-19T17:00:00.000Z"
  const PERSISTED = new Date("2026-08-26T00:00:00.000Z")

  const cases: Array<[string, DeadlineProjection, DeadlineReminderRefusal]> = [
    ["FX-02 stale source", project(snapshot({ source: { retrievedAt: "2026-08-18T16:00:00.000Z" } }), NOW), "state_unavailable"],
    ["FX-04 future retrieval", project(snapshot({ source: { retrievedAt: "2026-08-20T16:00:00.000Z" } }), NOW), "state_unavailable"],
    ["FX-05 malformed hash", project(snapshot({ source: { contentSha256: "not-a-sha" } }), NOW), "state_unavailable"],
    ["FX-06 parse failure", project(snapshot({ source: { parseStatus: "parse_error" } }), NOW), "state_unavailable"],
    ["FX-07 schema failure", project(snapshot({ source: { parseStatus: "schema_error" } }), NOW), "state_unavailable"],
    ["FX-08 unresolved township", project(snapshot(), NOW, null), "state_unavailable"],
    ["FX-10 synthetic source", project(snapshot({ synthetic: true }), NOW), "state_unavailable"],
    [
      "FX-03 verified but closed",
      project(snapshot({ openDate: "2026-06-01", lastFileDate: "2026-07-01" }), NOW),
      "window_not_open",
    ],
  ]

  it.each(cases)("%s produces no reminder", (_label, projection, reason) => {
    const decision = decideDeadlineReminder({ projection, persistedDeadline: PERSISTED })
    expect(decision).toEqual({ send: false, reason })
  })

  it("a missing projection produces no reminder", () => {
    expect(decideDeadlineReminder({ projection: null, persistedDeadline: PERSISTED })).toEqual({
      send: false,
      reason: "state_unavailable",
    })
  })

  it("a township known only by name is not an eligibility claim", () => {
    // The identity a page or a persisted column can supply, rather than one an
    // official property record established. Dates may be shown from it; a
    // reminder addressed to one homeowner may not be sent from it.
    const informational = projectDeadline(
      evaluateOfficialDeadlineState({
        snapshot: snapshot(),
        township: { townshipKey: "jefferson", townshipName: "Jefferson", eligible: false } as never,
        stage: "assessor",
        evaluatedAt: NOW,
      }),
      NOW,
    )
    const decision = decideDeadlineReminder({ projection: informational, persistedDeadline: PERSISTED })
    expect(decision.send).toBe(false)
    if (!decision.send) {
      expect(["identity_not_official", "state_unavailable"]).toContain(decision.reason)
    }
  })
})

describe("decideDeadlineReminder gates the schedule and the persisted date", () => {
  const NOW = "2026-08-19T17:00:00.000Z"

  function verified(lastFileDate: string): DeadlineProjection {
    const p = project(snapshot({ openDate: "2026-08-05", lastFileDate }), NOW)
    expect(p.available).toBe(true)
    return p
  }

  it("sends only on the scheduled countdowns", () => {
    // 2026-08-19 → close on the 26th is 7 days, the 22nd is 3, the 20th is 1.
    for (const [lastFileDate, days] of [
      ["2026-08-26", 7],
      ["2026-08-22", 3],
      ["2026-08-20", 1],
    ] as const) {
      const decision = decideDeadlineReminder({
        projection: verified(lastFileDate),
        persistedDeadline: new Date(`${lastFileDate}T00:00:00.000Z`),
      })
      expect({ lastFileDate, send: decision.send }).toEqual({ lastFileDate, send: true })
      if (decision.send) expect(decision.daysRemaining).toBe(days)
      expect(DEADLINE_REMINDER_DAYS).toContain(days)
    }
  })

  it("says nothing on an unscheduled day", () => {
    // Five days out is a real, verified, open window — and still not a send.
    const decision = decideDeadlineReminder({
      projection: verified("2026-08-24"),
      persistedDeadline: new Date("2026-08-24T00:00:00.000Z"),
    })
    expect(decision).toEqual({ send: false, reason: "outside_reminder_schedule" })
  })

  it("refuses when the persisted column disagrees with the county", () => {
    // The whole defect in one case: the customer's record says the 31st, the
    // county says the 26th. The old code mailed the 31st.
    const decision = decideDeadlineReminder({
      projection: verified("2026-08-26"),
      persistedDeadline: new Date("2026-08-31T00:00:00.000Z"),
    })
    expect(decision).toEqual({ send: false, reason: "persisted_deadline_mismatch" })
  })

  it("refuses when there is no persisted deadline at all", () => {
    expect(
      decideDeadlineReminder({ projection: verified("2026-08-26"), persistedDeadline: null }),
    ).toEqual({ send: false, reason: "persisted_deadline_missing" })
  })

  it("returns only projection-derived values", () => {
    const projection = verified("2026-08-26")
    const decision = decideDeadlineReminder({
      projection,
      persistedDeadline: new Date("2026-08-26T00:00:00.000Z"),
    })
    expect(decision.send).toBe(true)
    if (!decision.send || !projection.available) return
    expect(decision.lastFileDate).toBe(projection.lastFileDate)
    expect(decision.daysRemaining).toBe(projection.daysRemaining)
    expect(decision.officialSourceUrl).toBe(projection.officialSourceUrl)
    expect(decision.retrievedAt).toBe(projection.retrievedAt)
  })
})

/* ── The template ─────────────────────────────────────────────────────────── */

describe("deadlineReminderTemplate carries provenance with every date", () => {
  const rendered = deadlineReminderTemplate({
    userName: "Sam",
    propertyAddress: "123 Main St, Chicago, IL",
    pin: "13-24-314-045-0000",
    township: "Jefferson",
    taxYear: 2026,
    lastFileDate: "2026-08-26",
    daysRemaining: 7,
    officialSourceUrl: CALENDAR_URL,
    retrievedAt: "2026-08-19T16:59:55.000Z",
    appealLink: "https://www.overtaxed-il.com/appeals/apl_1",
  })
  const body = `${rendered.subject}\n${rendered.text}\n${rendered.html}`

  it("renders CC-08 provenance in both parts", () => {
    // BL-F4: CC-08 wherever any date appears. A reminder is the one surface a
    // reader cannot refresh to check.
    for (const part of [rendered.text, rendered.html]) {
      expect(part).toContain("Deadline shown as published by the Cook County Assessor and retrieved 2026-08-19T16:59:55.000Z")
      expect(part).toContain("Confirm your filing deadline with the county before you file.")
    }
  })

  it("renders the canonical date, not a locale reinterpretation of it", () => {
    expect(body).toContain("August 26, 2026")
    expect(body).not.toContain("August 25, 2026")
    expect(body).not.toContain("August 27, 2026")
  })

  it("cites only the canonical .gov host", () => {
    expect(body).toContain("cookcountyassessoril.gov")
    expect(body).not.toContain("cookcountyassessor.com")
  })

  it("makes no savings, merits, or guarantee claim", () => {
    for (const banned of [
      /estimated savings/i,
      /potential savings/i,
      /overpay/i,
      /over-assessed/i,
      /guarantee/i,
      /no lawyer/i,
      /no attorney/i,
      /we file/i,
      /on your behalf/i,
    ]) {
      expect(body).not.toMatch(banned)
    }
  })
})

/* ── The real route boundary ──────────────────────────────────────────────── */

describe("/api/cron/deadline-reminders at the real boundary", () => {
  const ROUTE_URL = "http://localhost/api/cron/deadline-reminders"

  function get(headers: Record<string, string> = {}) {
    return new NextRequest(ROUTE_URL, { method: "GET", headers })
  }

  async function runRoute(req: NextRequest) {
    const { GET } = await import("@/app/api/cron/deadline-reminders/route")
    const res = await GET(req)
    return { res, json: await res.json() }
  }

  const appealRow = {
    id: "apl_1",
    taxYear: 2026,
    filingDeadline: new Date("2026-08-26T00:00:00.000Z"),
    user: { email: "homeowner@example.com", name: "Sam" },
    property: {
      pin: "13243140450000",
      address: "123 Main St",
      city: "Chicago",
      state: "IL",
      township: "Jefferson",
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    // A key is present so nothing is skipped for the trivial reason. If a
    // refusal path leaked, `resendSend` would fire.
    process.env.RESEND_API_KEY = "re_test_should_never_be_used"
    process.env.CRON_SECRET = CRON_SECRET
    process.env.NEXT_PUBLIC_APP_URL = "https://www.overtaxed-il.com"
    prismaMock.appeal.findMany.mockResolvedValue([appealRow])
    describeTownshipCalendar.mockReturnValue(
      project(snapshot({ synthetic: true }), "2026-08-19T17:00:00.000Z"),
    )
  })

  it("fails closed when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET
    const { res, json } = await runRoute(get())
    expect(res.status).toBe(401)
    expect(json).toEqual({ error: "Unauthorized" })
    // Nothing was read and nothing was sent — the refusal precedes both.
    expect(prismaMock.appeal.findMany).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
  })

  it("fails closed on a wrong bearer token", async () => {
    const { res } = await runRoute(get({ authorization: "Bearer wrong" }))
    expect(res.status).toBe(401)
    expect(prismaMock.appeal.findMany).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
  })

  it("sends nothing against the committed synthetic snapshot", async () => {
    const { json } = await runRoute(get({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(json.emailsSent).toBe(0)
    expect(json.candidatesConsidered).toBe(1)
    expect(resendSend).not.toHaveBeenCalled()
  })

  it.each([
    ["stale", { source: { retrievedAt: "2026-08-18T16:00:00.000Z" } }],
    ["future-stamped", { source: { retrievedAt: "2026-08-20T16:00:00.000Z" } }],
    ["hash-mismatched", { source: { contentSha256: "not-a-sha" } }],
    ["parse-failed", { source: { parseStatus: "parse_error" } }],
    ["schema-failed", { source: { parseStatus: "schema_error" } }],
    ["closed", { openDate: "2026-06-01", lastFileDate: "2026-07-01" }],
  ])("sends nothing and constructs no provider call for %s state", async (_label, over) => {
    describeTownshipCalendar.mockReturnValue(project(snapshot(over), "2026-08-19T17:00:00.000Z"))
    const { json } = await runRoute(get({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(json.emailsSent).toBe(0)
    expect(resendSend).not.toHaveBeenCalled()
  })

  it("sends nothing when the township cannot be resolved", async () => {
    describeTownshipCalendar.mockReturnValue(
      project(snapshot(), "2026-08-19T17:00:00.000Z", null),
    )
    const { json } = await runRoute(get({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(json.emailsSent).toBe(0)
    expect(resendSend).not.toHaveBeenCalled()
  })

  it("sends nothing when the persisted deadline disagrees with the county", async () => {
    // The county says the 26th; the customer's row says the 31st. The one date
    // that must never reach a mailbox is the one only we believe.
    prismaMock.appeal.findMany.mockResolvedValue([
      { ...appealRow, filingDeadline: new Date("2026-08-31T00:00:00.000Z") },
    ])
    describeTownshipCalendar.mockReturnValue(
      project(snapshot({ lastFileDate: "2026-08-26" }), "2026-08-19T17:00:00.000Z"),
    )
    const { json } = await runRoute(get({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(json.emailsSent).toBe(0)
    expect(json.suppressed.persisted_deadline_mismatch).toBe(1)
    expect(resendSend).not.toHaveBeenCalled()
  })

  it("sends the canonical date, and only the canonical date, when the state verifies", async () => {
    describeTownshipCalendar.mockReturnValue(
      project(snapshot({ lastFileDate: "2026-08-26" }), "2026-08-19T17:00:00.000Z"),
    )
    const { json } = await runRoute(get({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(json.emailsSent).toBe(1)
    expect(resendSend).toHaveBeenCalledTimes(1)

    const payload = resendSend.mock.calls[0][0] as unknown as {
      to: string
      subject: string
      text: string
      html: string
    }
    const body = `${payload.subject}\n${payload.text}\n${payload.html}`
    expect(payload.to).toBe("homeowner@example.com")
    expect(body).toContain("August 26, 2026")
    expect(body).toContain("7 days remaining")
    expect(body).toContain("Deadline shown as published by the Cook County Assessor and retrieved")
    expect(body).not.toContain("cookcountyassessor.com")
  })
})
