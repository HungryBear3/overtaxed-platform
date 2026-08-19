/** @jest-environment node */

/**
 * The canonical deadline state.
 *
 * Every date on the site currently comes from one of eight independent
 * schedules, each with its own status math and none with provenance. This
 * module is the single one that may answer "is this window open, and how do we
 * know". Its whole job is to say "pending" more often than the old code said
 * anything, so the tests below are mostly about refusing to answer.
 *
 * The rules under test come from the frozen contract:
 *   - source retrieval at most 24h old by default;
 *   - same America/Chicago calendar day when the window is open or closing
 *     within 14 days, or when the answer drives a countdown, CTA, reminder,
 *     email, or checkout decision;
 *   - a 900-second ceiling on how long one evaluation may be served;
 *   - a retrieval timestamp in the future is never freshness;
 *   - future timestamp, stale/unavailable source, parse/schema/hash failure,
 *     unresolved township, missing stage, or invalid date => pending.
 */

import {
  DEFAULT_SOURCE_TTL_MS,
  SERVING_AGE_CEILING_MS,
  SAME_DAY_REQUIRED_WITHIN_DAYS,
  evaluateOfficialDeadlineState,
  isServedStateExpired,
  type OfficialDeadlineSnapshot,
  type SourceProvenance,
} from "@/lib/deadlines/official-source-state"
import type { TownshipResolution } from "@/lib/deadlines/township-resolution"

const CHICAGO_NOON_UTC = "2026-06-25T17:00:00.000Z" // 12:00 CDT

const resolution: TownshipResolution = {
  inputKind: "pin",
  normalizedPin: "10361040340000",
  normalizedAddress: null,
  townshipKey: "rogers-park",
  townshipName: "Rogers Park",
  resolutionSource: "official_property_record",
  resolvedAt: CHICAGO_NOON_UTC,
}

function provenance(over: Partial<SourceProvenance> = {}): SourceProvenance {
  return {
    authority: "cook_county_assessor",
    sourceUrl: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
    retrievedAt: "2026-06-25T13:00:00.000Z", // 08:00 CDT, same Chicago day
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
    // These fixtures stand in for a real retrieval, so they are marked as one.
    // The synthetic flag is tested on its own below.
    synthetic: false,
    // Both stages fetched successfully; only the assessor stage has a window
    // for this township. That is the ordinary mid-cycle shape — the Board's
    // calendar is published, this township just is not on it yet — and it is
    // what separates "we could not read the source" from "the source does not
    // say", which are different pending reasons and different operator actions.
    sources: {
      assessor: provenance(),
      bor: provenance({
        authority: "cook_county_board_of_review",
        sourceUrl: "https://www.cookcountyboardofreview.com/appeal-calendar",
        finalUrl: "https://www.cookcountyboardofreview.com/appeal-calendar",
      }),
    },
    townships: {
      "rogers-park": {
        townshipName: "Rogers Park",
        stages: {
          assessor: {
            noticeDate: "2026-06-01",
            openDate: "2026-06-15",
            lastFileDate: "2026-07-15",
          },
          bor: null,
        },
      },
    },
    ...over,
  }
}

function evaluate(over: Parameters<typeof evaluateOfficialDeadlineState>[0] | object = {}) {
  return evaluateOfficialDeadlineState({
    snapshot: snapshot(),
    township: resolution,
    stage: "assessor",
    evaluatedAt: CHICAGO_NOON_UTC,
    ...over,
  } as Parameters<typeof evaluateOfficialDeadlineState>[0])
}

describe("frozen constants", () => {
  it("are the contract's numbers, not configuration", () => {
    expect(DEFAULT_SOURCE_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(SERVING_AGE_CEILING_MS).toBe(900 * 1000)
    expect(SAME_DAY_REQUIRED_WITHIN_DAYS).toBe(14)
  })
})

describe("verified state", () => {
  it("resolves an open window fetched today into a verified state carrying its provenance", () => {
    const state = evaluate()

    expect(state.kind).toBe("verified")
    if (state.kind !== "verified") return

    expect(state.stage).toBe("assessor")
    expect(state.status).toBe("open")
    expect(state.openDate).toBe("2026-06-15")
    expect(state.lastFileDate).toBe("2026-07-15")
    expect(state.township.townshipKey).toBe("rogers-park")
    expect(state.provenance.contentSha256).toHaveLength(64)
    expect(state.provenance.sourceUrl).toMatch(/^https:\/\/www\.cookcountyassessoril\.gov\//)
  })

  it("expires the served evaluation 900 seconds after it was made", () => {
    const state = evaluate()
    if (state.kind !== "verified") throw new Error("expected verified")

    expect(Date.parse(state.freshnessExpiresAt) - Date.parse(state.evaluatedAt)).toBe(
      SERVING_AGE_CEILING_MS,
    )
    expect(isServedStateExpired(state, "2026-06-25T17:14:00.000Z")).toBe(false)
    expect(isServedStateExpired(state, "2026-06-25T17:15:01.000Z")).toBe(true)
  })

  it("labels a window that has not opened yet as upcoming, and a passed one as closed", () => {
    const upcoming = evaluate({ evaluatedAt: "2026-06-10T17:00:00.000Z" })
    // Retrieval must still be same-day for the countdown rule, so move it too.
    const upcomingSameDay = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        sources: { assessor: provenance({ retrievedAt: "2026-06-10T13:00:00.000Z" }), bor: null },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: "2026-06-10T17:00:00.000Z",
    })
    expect(upcoming.kind).toBe("pending") // stale retrieval, proving the rule bites
    expect(upcomingSameDay.kind === "verified" && upcomingSameDay.status).toBe("upcoming")

    const closed = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        sources: { assessor: provenance({ retrievedAt: "2026-08-01T13:00:00.000Z" }), bor: null },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: "2026-08-01T17:00:00.000Z",
    })
    expect(closed.kind === "verified" && closed.status).toBe("closed")
  })
})

describe("freshness", () => {
  it("rejects a retrieval older than the 24h default even when the window is far off", () => {
    // Window opens 2026-06-15; evaluate three months earlier so the same-day
    // rule is not what fails. Only the TTL should — which means the published
    // date has to move back with the retrieval, since a source stamped after
    // the evaluation instant is rejected as from-the-future first.
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        sources: {
          assessor: provenance({
            retrievedAt: "2026-03-01T13:00:00.000Z",
            sourceUpdatedAt: "2026-01-15T00:00:00.000Z",
          }),
          bor: null,
        },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: "2026-03-03T17:00:00.000Z",
    })

    expect(state).toMatchObject({ kind: "pending", reason: "source_stale" })
  })

  it("accepts a prior-day retrieval inside 24h only when the window is far away", () => {
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        sources: {
          assessor: provenance({
            retrievedAt: "2026-03-02T20:00:00.000Z",
            sourceUpdatedAt: "2026-01-15T00:00:00.000Z",
          }),
          bor: null,
        },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: "2026-03-03T17:00:00.000Z",
    })

    expect(state.kind).toBe("verified")
  })

  it("rejects a prior-day retrieval once the window is open, even inside 24h", () => {
    // 2026-06-24 21:00 CDT is 15 hours before evaluation — inside the TTL, and
    // on the previous America/Chicago calendar day. The window is open, so the
    // same-day rule applies and a still-fresh-by-TTL fetch is not enough.
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        sources: { assessor: provenance({ retrievedAt: "2026-06-25T02:00:00.000Z" }), bor: null },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: CHICAGO_NOON_UTC,
    })

    expect(state).toMatchObject({ kind: "pending", reason: "source_stale" })
  })

  it("rejects a prior-day retrieval when the window closes within 14 days", () => {
    // Evaluate 2026-07-05: 10 days before the 2026-07-15 last-file date.
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        sources: { assessor: provenance({ retrievedAt: "2026-07-05T02:00:00.000Z" }), bor: null },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: "2026-07-05T17:00:00.000Z",
    })

    expect(state).toMatchObject({ kind: "pending", reason: "source_stale" })
  })

  it("never treats a future retrieval timestamp as freshness", () => {
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        sources: { assessor: provenance({ retrievedAt: "2026-06-26T13:00:00.000Z" }), bor: null },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: CHICAGO_NOON_UTC,
    })

    expect(state).toMatchObject({ kind: "pending", reason: "source_from_future" })
  })

  it("rejects a source-updated date in the future", () => {
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        sources: {
          assessor: provenance({ sourceUpdatedAt: "2027-01-01T00:00:00.000Z" }),
          bor: null,
        },
        }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: CHICAGO_NOON_UTC,
    })

    expect(state).toMatchObject({ kind: "pending", reason: "source_from_future" })
  })
})

describe("pending reasons", () => {
  it("is pending when the township never resolved", () => {
    expect(evaluate({ township: null })).toMatchObject({
      kind: "pending",
      reason: "township_unresolved",
    })
  })

  it("is pending when there is no snapshot at all", () => {
    expect(evaluate({ snapshot: null })).toMatchObject({
      kind: "pending",
      reason: "source_unavailable",
    })
  })

  it("is pending when the resolved township is absent from the snapshot", () => {
    expect(
      evaluate({
        township: { ...resolution, townshipKey: "berwyn", townshipName: "Berwyn" },
      }),
    ).toMatchObject({ kind: "pending", reason: "township_missing" })
  })

  it("is pending on a synthetic snapshot no matter how well-formed it is", () => {
    // Everything else about this snapshot is valid: fetched today, parsed, the
    // window is open, the township is resolved. It still cannot produce a date,
    // because the rows came from a fixture rather than from the county. This is
    // the guard that lets the branch wire all 52 consumers to the canonical
    // path without shipping a single fabricated deadline.
    const state = evaluate({ snapshot: snapshot({ synthetic: true }) })

    expect(state).toMatchObject({ kind: "pending", reason: "synthetic_source" })
    expect(JSON.stringify(state)).not.toContain("2026-07-15")
  })

  it("is pending when the stage was never fetched", () => {
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({ sources: { assessor: provenance(), bor: null } }),
      township: resolution,
      stage: "bor",
      evaluatedAt: CHICAGO_NOON_UTC,
    })

    expect(state).toMatchObject({ kind: "pending", reason: "source_unavailable" })
  })

  it("is pending when the requested stage is missing, and never borrows the other stage", () => {
    // The Board's calendar was fetched and parsed; it simply has no window for
    // Rogers Park. The assessor stage does — and the answer must not be that
    // one. A stage that silently falls back to its sibling is how a homeowner
    // gets shown an assessor deadline for a Board appeal.
    const state = evaluate({ stage: "bor" })

    expect(state).toMatchObject({ kind: "pending", reason: "stage_missing" })
    expect(JSON.stringify(state)).not.toContain("2026-07-15")
  })

  for (const parseStatus of ["http_error", "hash_error", "parse_error", "schema_error"] as const) {
    it(`is pending when the source parse status is ${parseStatus}`, () => {
      const state = evaluateOfficialDeadlineState({
        snapshot: snapshot({
          sources: { assessor: provenance({ parseStatus }), bor: null },
        }),
        township: resolution,
        stage: "assessor",
        evaluatedAt: CHICAGO_NOON_UTC,
      })

      expect(state).toMatchObject({ kind: "pending", reason: "parse_failed" })
    })
  }

  it("is pending on an unparseable date rather than guessing one", () => {
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        townships: {
          "rogers-park": {
            townshipName: "Rogers Park",
            stages: {
              assessor: { noticeDate: null, openDate: "2026-06-15", lastFileDate: "not a date" },
              bor: null,
            },
          },
        },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: CHICAGO_NOON_UTC,
    })

    expect(state).toMatchObject({ kind: "pending", reason: "date_invalid" })
  })

  it("is pending when the window closes before it opens", () => {
    const state = evaluateOfficialDeadlineState({
      snapshot: snapshot({
        townships: {
          "rogers-park": {
            townshipName: "Rogers Park",
            stages: {
              assessor: { noticeDate: null, openDate: "2026-07-15", lastFileDate: "2026-06-15" },
              bor: null,
            },
          },
        },
      }),
      township: resolution,
      stage: "assessor",
      evaluatedAt: CHICAGO_NOON_UTC,
    })

    expect(state).toMatchObject({ kind: "pending", reason: "date_invalid" })
  })

  it("carries no window date on any pending state", () => {
    // A pending state may carry provenance — which source, whether it parsed,
    // when it was fetched — because an operator has to know which fetch failed.
    // What it may never carry is a *window* date, because that is the thing a
    // renderer would reach for. So the assertion is on the county dates in the
    // fixture and on the field names that would hold one, not on any timestamp:
    // banning every date string would also ban `retrievedAt`, which is the part
    // that is deliberately kept.
    const FORBIDDEN_KEYS = ["noticeDate", "openDate", "lastFileDate", "status"]

    for (const state of [
      evaluate({ township: null }),
      evaluate({ snapshot: null }),
      evaluate({ stage: "bor" }),
      evaluateOfficialDeadlineState({
        snapshot: snapshot({
          sources: { assessor: provenance({ parseStatus: "schema_error" }), bor: null },
        }),
        township: resolution,
        stage: "assessor",
        evaluatedAt: CHICAGO_NOON_UTC,
      }),
    ]) {
      const json = JSON.stringify(state)
      expect(json).not.toContain("2026-06-01") // notice
      expect(json).not.toContain("2026-06-15") // open
      expect(json).not.toContain("2026-07-15") // last file
      for (const key of FORBIDDEN_KEYS) expect(json).not.toContain(`"${key}"`)
    }
  })
})

export {}
