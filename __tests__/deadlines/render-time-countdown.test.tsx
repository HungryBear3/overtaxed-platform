/** @jest-environment node */

/**
 * Render-time projection: the one thing consumers are allowed to read.
 *
 * `evaluateOfficialDeadlineState` answers a question about a moment. Rendering
 * happens at a later moment — after a cache, after a prerender, after a page sat
 * open in a tab overnight — and the gap between the two is where every stale
 * countdown on this branch came from. A page that stored `daysRemaining: 3` at
 * build time still says three days on the day the window shuts.
 *
 * So the projection re-derives status and countdown from the render clock, and
 * it degrades: a state that was verified can project as unavailable, never the
 * reverse. The countdown must fall over the county's midnight, not UTC's, and
 * the same-day rule is re-applied at render time rather than trusted from
 * evaluation. Everything a consumer is permitted to draw — dates, status,
 * countdown, CTA, reminder, checkout, JSON-LD — is a boolean on this object, so
 * "suppress all of it together" is one decision made in one place.
 */

import {
  evaluateOfficialDeadlineState,
  projectDeadline,
  daysRemainingAtRenderTime,
  PENDING_NOTICE,
  PENDING_STATUS_LABEL,
  SERVING_AGE_CEILING_MS,
  type OfficialDeadlineSnapshot,
  type OfficialDeadlineState,
  type SourceProvenance,
} from "@/lib/deadlines/official-source-state"
import {
  informationalTownship,
  type TownshipResolution,
} from "@/lib/deadlines/township-resolution"

const resolution: TownshipResolution = {
  inputKind: "pin",
  normalizedPin: "10361040340000",
  normalizedAddress: null,
  townshipKey: "rogers-park",
  townshipName: "Rogers Park",
  resolutionSource: "official_property_record",
  resolvedAt: "2026-06-25T17:00:00.000Z",
}

function provenance(over: Partial<SourceProvenance> = {}): SourceProvenance {
  return {
    authority: "cook_county_assessor",
    sourceUrl: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
    retrievedAt: "2026-06-25T13:00:00.000Z",
    sourceUpdatedAt: "2026-06-01T00:00:00.000Z",
    contentSha256: "a".repeat(64),
    httpStatus: 200,
    finalUrl: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
    parseStatus: "ok",
    parserVersion: "1.0.0",
    ...over,
  }
}

function snapshot(over: Partial<OfficialDeadlineSnapshot> = {}): OfficialDeadlineSnapshot {
  return {
    schemaVersion: 1,
    synthetic: false,
    sources: { assessor: provenance(), bor: null },
    townships: {
      "rogers-park": {
        townshipName: "Rogers Park",
        stages: {
          assessor: { noticeDate: "2026-06-01", openDate: "2026-06-15", lastFileDate: "2026-07-15" },
          bor: null,
        },
      },
    },
    ...over,
  }
}

/** A verified state as of the given instant, with a same-day retrieval. */
function verifiedAt(evaluatedAt: string, retrievedAt: string): OfficialDeadlineState {
  const state = evaluateOfficialDeadlineState({
    snapshot: snapshot({ sources: { assessor: provenance({ retrievedAt }), bor: null } }),
    township: resolution,
    stage: "assessor",
    evaluatedAt,
  })
  if (state.kind !== "verified") throw new Error(`fixture is not verified: ${state.reason}`)
  return state
}

/** Every capability a consumer may act on. Named once so no test can forget one. */
const CAPABILITIES = [
  "showDates",
  "showStatus",
  "showCountdown",
  "allowDeadlineCta",
  "allowReminderSignup",
  "allowDeadlineEmail",
  "allowCheckout",
  "allowStructuredData",
] as const

describe("daysRemainingAtRenderTime", () => {
  it("counts county calendar days, not elapsed 24-hour periods", () => {
    // 2026-07-14 23:00 CDT and 2026-07-14 08:00 CDT are 15 hours apart but are
    // the same filing day, so both are one day out.
    expect(daysRemainingAtRenderTime("2026-07-15", "2026-07-15T04:00:00.000Z")).toBe(1)
    expect(daysRemainingAtRenderTime("2026-07-15", "2026-07-14T13:00:00.000Z")).toBe(1)
    expect(daysRemainingAtRenderTime("2026-07-15", "2026-07-15T13:00:00.000Z")).toBe(0)
  })

  it("rolls over at county midnight rather than UTC midnight", () => {
    // 2026-07-14T04:59Z is 23:59 CDT on the 13th — still two days out. One
    // minute later it is the 14th in Chicago and the count drops, five hours
    // before UTC would have agreed.
    expect(daysRemainingAtRenderTime("2026-07-15", "2026-07-14T04:59:00.000Z")).toBe(2)
    expect(daysRemainingAtRenderTime("2026-07-15", "2026-07-14T05:00:00.000Z")).toBe(1)
  })

  it("is null rather than negative once the date has passed", () => {
    expect(daysRemainingAtRenderTime("2026-07-15", "2026-07-16T13:00:00.000Z")).toBeNull()
  })

  it("is null on an unusable date or clock", () => {
    expect(daysRemainingAtRenderTime("not a date", "2026-07-14T13:00:00.000Z")).toBeNull()
    expect(daysRemainingAtRenderTime("2026-07-15", "not an instant")).toBeNull()
  })
})

describe("projecting a pending state", () => {
  const pending = evaluateOfficialDeadlineState({
    snapshot: snapshot(),
    township: null,
    stage: "assessor",
    evaluatedAt: "2026-06-25T17:00:00.000Z",
  })

  it("renders the contract's neutral copy and suppresses every capability together", () => {
    const projection = projectDeadline(pending, "2026-06-25T17:00:00.000Z")

    expect(projection.available).toBe(false)
    if (projection.available) return

    expect(projection.notice).toBe("Official date unavailable or not freshly verified.")
    expect(projection.statusLabel).toBe("Pending official date")
    expect(projection.notice).toBe(PENDING_NOTICE)
    expect(projection.statusLabel).toBe(PENDING_STATUS_LABEL)
    expect(projection.reason).toBe("township_unresolved")

    for (const capability of CAPABILITIES) expect(projection[capability]).toBe(false)
  })

  it("exposes no date on the projection at all", () => {
    const json = JSON.stringify(projectDeadline(pending, "2026-06-25T17:00:00.000Z"))

    expect(json).not.toContain("2026-06-15")
    expect(json).not.toContain("2026-07-15")
    for (const key of ["openDate", "lastFileDate", "noticeDate", "daysRemaining", "status\""]) {
      expect(json).not.toContain(`"${key}`)
    }
  })
})

describe("projecting a verified state", () => {
  it("permits the full surface while the window is open", () => {
    const projection = projectDeadline(
      verifiedAt("2026-06-25T17:00:00.000Z", "2026-06-25T13:00:00.000Z"),
      "2026-06-25T17:05:00.000Z",
    )

    expect(projection.available).toBe(true)
    if (!projection.available) return

    expect(projection.status).toBe("open")
    expect(projection.lastFileDate).toBe("2026-07-15")
    expect(projection.townshipName).toBe("Rogers Park")
    expect(projection.daysRemaining).toBe(20)
    expect(projection.officialSourceUrl).toMatch(/^https:\/\/www\.cookcountyassessoril\.gov\//)
    for (const capability of CAPABILITIES) expect(projection[capability]).toBe(true)
  })

  it("shows an upcoming window without opening checkout or a filing CTA", () => {
    const projection = projectDeadline(
      verifiedAt("2026-06-10T17:00:00.000Z", "2026-06-10T13:00:00.000Z"),
      "2026-06-10T17:05:00.000Z",
    )

    expect(projection.available).toBe(true)
    if (!projection.available) return

    expect(projection.status).toBe("upcoming")
    // A homeowner may be told the window is coming and may ask to be reminded.
    // What they may not do is pay for a packet for a window that is not open.
    expect(projection.showDates).toBe(true)
    expect(projection.showCountdown).toBe(true)
    expect(projection.allowReminderSignup).toBe(true)
    expect(projection.allowDeadlineCta).toBe(false)
    expect(projection.allowCheckout).toBe(false)
  })

  it("stops selling and stops reminding once the window has closed", () => {
    const projection = projectDeadline(
      verifiedAt("2026-08-01T17:00:00.000Z", "2026-08-01T13:00:00.000Z"),
      "2026-08-01T17:05:00.000Z",
    )

    expect(projection.available).toBe(true)
    if (!projection.available) return

    expect(projection.status).toBe("closed")
    expect(projection.daysRemaining).toBeNull()
    expect(projection.showCountdown).toBe(false)
    expect(projection.allowDeadlineCta).toBe(false)
    expect(projection.allowCheckout).toBe(false)
    expect(projection.allowReminderSignup).toBe(false)
    expect(projection.allowDeadlineEmail).toBe(false)
  })
})

describe("a township identified only by the page slug", () => {
  /** What `/township/rogers-park` knows: the township, and nothing about the reader. */
  const slugIdentified = () => {
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot(),
      township: informationalTownship("rogers-park", "Rogers Park"),
      stage: "assessor",
      evaluatedAt: "2026-06-25T17:00:00.000Z",
    })
    if (state.kind !== "verified") throw new Error(`expected verified: ${state.reason}`)
    return state
  }

  it("still describes the county's published window", () => {
    // The alternative — refusing to show a township page its own township's
    // calendar — would make every one of the 38 township pages contentless, and
    // it is not what the rule protects against. The county published these
    // dates for this township; that much is true regardless of who is reading.
    const projection = projectDeadline(slugIdentified(), "2026-06-25T17:05:00.000Z")

    expect(projection.available).toBe(true)
    if (!projection.available) return

    expect(projection.eligible).toBe(false)
    expect(projection.openDate).toBe("2026-06-15")
    expect(projection.lastFileDate).toBe("2026-07-15")
    expect(projection.status).toBe("open")
    expect(projection.showDates).toBe(true)
    expect(projection.showStatus).toBe(true)
    expect(projection.allowStructuredData).toBe(true)
  })

  it("runs no countdown and opens no checkout, because it does not know whose parcel this is", () => {
    // A URL says which page someone opened. It is not evidence of where they
    // live, and a countdown or a Buy button drawn from it is an eligibility
    // claim made from a routing artefact.
    const projection = projectDeadline(slugIdentified(), "2026-06-25T17:05:00.000Z")

    expect(projection.available).toBe(true)
    if (!projection.available) return

    expect(projection.showCountdown).toBe(false)
    expect(projection.allowDeadlineCta).toBe(false)
    expect(projection.allowReminderSignup).toBe(false)
    expect(projection.allowDeadlineEmail).toBe(false)
    expect(projection.allowCheckout).toBe(false)
  })

  it("is the only difference from a PIN-resolved reader on the same window", () => {
    const bySlug = projectDeadline(slugIdentified(), "2026-06-25T17:05:00.000Z")
    const byRecord = projectDeadline(
      verifiedAt("2026-06-25T17:00:00.000Z", "2026-06-25T13:00:00.000Z"),
      "2026-06-25T17:05:00.000Z",
    )

    expect(bySlug.available && byRecord.available).toBe(true)
    if (!bySlug.available || !byRecord.available) return

    // Same dates, same status, same provenance — different permissions.
    expect(bySlug.openDate).toBe(byRecord.openDate)
    expect(bySlug.lastFileDate).toBe(byRecord.lastFileDate)
    expect(bySlug.status).toBe(byRecord.status)
    expect(bySlug.officialSourceUrl).toBe(byRecord.officialSourceUrl)
    expect(byRecord.allowCheckout).toBe(true)
    expect(bySlug.allowCheckout).toBe(false)
  })

  it("is refused outright when the identity is neither tier", () => {
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot(),
      // The shape a caller would reach for if they wanted to smuggle a
      // neighborhood or a city label past the resolver.
      township: { townshipKey: "rogers-park", townshipName: "Rogers Park",
        resolutionSource: "neighborhood_guess" } as never,
      stage: "assessor",
      evaluatedAt: "2026-06-25T17:00:00.000Z",
    })

    expect(state).toMatchObject({ kind: "pending", reason: "township_unresolved" })
  })
})

describe("the countdown cannot outlive what it was drawn from", () => {
  it("decrements as the render clock advances, without re-evaluating", () => {
    const state = verifiedAt("2026-07-01T17:00:00.000Z", "2026-07-01T13:00:00.000Z")

    // Same state object, three render instants. This is the case a prerendered
    // `daysRemaining` gets wrong.
    const days = ["2026-07-01T17:05:00.000Z", "2026-07-05T17:00:00.000Z", "2026-07-14T17:00:00.000Z"]
      .map((at) => projectDeadline(state, at))
      .map((p) => (p.available ? p.daysRemaining : "unavailable"))

    expect(days[0]).toBe(14)
    expect(days[1]).toBe("unavailable") // past the 900s serving ceiling
    expect(days[2]).toBe("unavailable")
  })

  it("expires at the 900-second serving ceiling and reports it as staleness", () => {
    const state = verifiedAt("2026-06-25T17:00:00.000Z", "2026-06-25T13:00:00.000Z")

    const inside = projectDeadline(state, "2026-06-25T17:14:00.000Z")
    const outside = projectDeadline(state, "2026-06-25T17:15:01.000Z")

    expect(inside.available).toBe(true)
    expect(outside.available).toBe(false)
    expect(outside.available === false && outside.reason).toBe("source_stale")
    expect(SERVING_AGE_CEILING_MS).toBe(900 * 1000)
  })

  it("fails closed when the county day turns over under a state verified late at night", () => {
    // Verified 2026-07-14 23:55 CDT from a fetch made that same Chicago day.
    // Six minutes later it is the 15th in Cook County: the retrieval is now a
    // prior-day fetch on the last filing day, which the same-day rule forbids.
    // Re-applying that rule at render time is the only thing that catches it —
    // the state itself was verified and its 900 seconds have not run out.
    const state = verifiedAt("2026-07-15T04:55:00.000Z", "2026-07-15T04:00:00.000Z")
    expect(state.kind === "verified" && state.status).toBe("open")

    const beforeMidnight = projectDeadline(state, "2026-07-15T04:59:00.000Z")
    const afterMidnight = projectDeadline(state, "2026-07-15T05:01:00.000Z")

    expect(beforeMidnight.available).toBe(true)
    expect(afterMidnight.available).toBe(false)
    expect(afterMidnight.available === false && afterMidnight.reason).toBe("source_stale")
  })

  it("refuses to render a state from the future", () => {
    const state = verifiedAt("2026-06-25T17:00:00.000Z", "2026-06-25T13:00:00.000Z")

    const projection = projectDeadline(state, "2026-06-25T16:00:00.000Z")

    expect(projection.available).toBe(false)
    expect(projection.available === false && projection.reason).toBe("source_from_future")
  })

  it("refuses to render against an unusable clock", () => {
    const state = verifiedAt("2026-06-25T17:00:00.000Z", "2026-06-25T13:00:00.000Z")

    const projection = projectDeadline(state, "whenever")

    expect(projection.available).toBe(false)
    expect(projection.available === false && projection.reason).toBe("date_invalid")
  })

  it("only ever degrades — no render clock turns a pending state into a date", () => {
    const pending = evaluateOfficialDeadlineState({
      snapshot: null,
      township: resolution,
      stage: "assessor",
      evaluatedAt: "2026-06-25T17:00:00.000Z",
    })

    for (const at of [
      "2026-06-25T17:00:00.000Z",
      "2026-06-25T17:00:01.000Z",
      "2026-07-01T17:00:00.000Z",
      "2027-01-01T17:00:00.000Z",
    ]) {
      expect(projectDeadline(pending, at).available).toBe(false)
    }
  })
})

export {}
