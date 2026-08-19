/**
 * The canonical official-deadline state.
 *
 * Eight modules on this branch independently decided whether a township's
 * appeal window was open, each from its own hard-coded schedule and its own
 * status arithmetic, none carrying provenance. They disagreed with each other
 * and none of them could say when it last checked. This module replaces all of
 * that with one question and one answer: given a resolved township, a stage,
 * and a snapshot of what the county published, is there a *currently verified*
 * date — and if not, why not.
 *
 * The answer is a discriminated union with exactly two arms, and the pending
 * arm carries no dates. That is the point: a caller cannot accidentally render
 * a stale date, because a state that failed verification does not contain one.
 */

import { isEligibleIdentity, type TownshipIdentity } from "./township-resolution"

/** Source retrieval may be at most this old by default. */
export const DEFAULT_SOURCE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * How long a single evaluation may be served before it must be re-evaluated.
 * Distinct from the TTL above: that bounds how old the county data is, this
 * bounds how long we may keep showing one conclusion drawn from it.
 */
export const SERVING_AGE_CEILING_MS = 900 * 1000

/**
 * Inside this many days of a close date — or any time the window is already
 * open — a prior-day fetch is not good enough. This is where a wrong answer
 * costs a homeowner their appeal, so the source must have been read today.
 */
export const SAME_DAY_REQUIRED_WITHIN_DAYS = 14

export const COUNTY_TIME_ZONE = "America/Chicago"

export type SourceAuthority = "cook_county_assessor" | "cook_county_board_of_review"

export type ParseStatus = "ok" | "http_error" | "hash_error" | "parse_error" | "schema_error"

export type SourceProvenance = {
  authority: SourceAuthority
  sourceUrl: string
  /** The actual HTTP retrieval instant. Not a build time, not a publish date. */
  retrievedAt: string
  /** The date the authority printed on the page, if any. Provenance only. */
  sourceUpdatedAt: string | null
  contentSha256: string
  httpStatus: number
  finalUrl: string
  parseStatus: ParseStatus
  parserVersion: string
}

export type DeadlineStage = "assessor" | "bor"

export type StageWindow = {
  noticeDate: string | null
  openDate: string
  lastFileDate: string
}

export type TownshipSnapshotRow = {
  townshipName: string
  stages: Partial<Record<DeadlineStage, StageWindow | null>>
}

export type OfficialDeadlineSnapshot = {
  schemaVersion: number
  /**
   * True when the rows below came from a local fixture rather than a retrieval
   * from the county. A synthetic snapshot can never produce a verified state —
   * see the guard in `evaluateOfficialDeadlineState`.
   *
   * The field is required rather than optional so that writing a snapshot is a
   * decision about its provenance. A default would eventually be inherited by
   * something real.
   */
  synthetic: boolean
  sources: Partial<Record<DeadlineStage, SourceProvenance | null>>
  townships: Record<string, TownshipSnapshotRow>
}

export type PendingReason =
  | "township_unresolved"
  | "source_unavailable"
  | "synthetic_source"
  | "source_stale"
  | "source_from_future"
  | "parse_failed"
  | "township_missing"
  | "stage_missing"
  | "date_invalid"

export type WindowStatus = "upcoming" | "open" | "closed"

export type OfficialDeadlineState =
  | {
      kind: "verified"
      stage: DeadlineStage
      township: TownshipIdentity
      /**
       * Whether this state may drive eligibility — a countdown, a reminder, a
       * filing CTA, a checkout — as opposed to merely describing a township's
       * published calendar. True only when the township came from an official
       * property record.
       */
      eligible: boolean
      noticeDate: string | null
      openDate: string
      lastFileDate: string
      status: WindowStatus
      provenance: SourceProvenance
      evaluatedAt: string
      freshnessExpiresAt: string
    }
  | {
      kind: "pending"
      reason: PendingReason
      /**
       * Provenance is carried on pending states only as far as it is safe to:
       * where the source came from and whether it parsed, never a date. An
       * operator needs to know which fetch failed; a renderer must not be able
       * to reach a stale window through the failure object.
       */
      provenance?: Pick<SourceProvenance, "authority" | "sourceUrl" | "parseStatus"> & {
        retrievedAt?: string
      }
    }

function pending(
  reason: PendingReason,
  source?: SourceProvenance | null,
): OfficialDeadlineState {
  if (!source) return { kind: "pending", reason }
  return {
    kind: "pending",
    reason,
    provenance: {
      authority: source.authority,
      sourceUrl: source.sourceUrl,
      parseStatus: source.parseStatus,
      retrievedAt: source.retrievedAt,
    },
  }
}

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Calendar date in Cook County's time zone, as YYYY-MM-DD. */
export function countyCalendarDay(instantMs: number): string {
  // en-CA formats as YYYY-MM-DD, which is what we want to compare as strings.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COUNTY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instantMs))
}

/** A YYYY-MM-DD county date, or null if it is not one. */
function parseCountyDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  // Round-trip so 2026-02-31 is rejected rather than rolled forward.
  return new Date(ms).toISOString().slice(0, 10) === value ? value : null
}

function daysBetweenCalendarDays(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00Z`)
  const to = Date.parse(`${toDay}T00:00:00Z`)
  return Math.round((to - from) / 86_400_000)
}

function windowStatusOn(today: string, openDate: string, lastFileDate: string): WindowStatus {
  return today < openDate ? "upcoming" : today > lastFileDate ? "closed" : "open"
}

/**
 * Whether this answer is close enough to the window that a prior-day fetch will
 * not do — the window is open now, or it opens or closes within two weeks and a
 * countdown is about to be drawn from it.
 *
 * Shared by evaluation and render-time projection on purpose. A state verified
 * at 23:55 with a same-day fetch is a prior-day fetch six minutes later, and the
 * only thing that catches it is asking the question again against the render
 * clock.
 */
function requiresSameDayFetch(
  today: string,
  openDate: string,
  lastFileDate: string,
): boolean {
  const status = windowStatusOn(today, openDate, lastFileDate)
  const daysToClose = daysBetweenCalendarDays(today, lastFileDate)
  const daysToOpen = daysBetweenCalendarDays(today, openDate)
  return (
    status === "open" ||
    (daysToClose >= 0 && daysToClose <= SAME_DAY_REQUIRED_WITHIN_DAYS) ||
    (daysToOpen >= 0 && daysToOpen <= SAME_DAY_REQUIRED_WITHIN_DAYS)
  )
}

export function evaluateOfficialDeadlineState(input: {
  snapshot: OfficialDeadlineSnapshot | null
  township: TownshipIdentity | null
  stage: DeadlineStage
  evaluatedAt: string
}): OfficialDeadlineState {
  const { snapshot, township, stage, evaluatedAt } = input

  const evaluatedMs = parseInstant(evaluatedAt)
  if (evaluatedMs === null) return { kind: "pending", reason: "date_invalid" }

  // Township identity first. Without it there is no row to look up.
  //
  // Both tiers of identity get past this gate, because a township page is
  // entitled to describe the county's published calendar. What separates them
  // is `eligible` below: only a property record turns a published window into
  // *your* deadline, with a countdown and a checkout attached.
  if (!township) return { kind: "pending", reason: "township_unresolved" }
  const eligible = isEligibleIdentity(township)
  if (!eligible && township.resolutionSource !== "page_slug") {
    return { kind: "pending", reason: "township_unresolved" }
  }

  if (!snapshot) return { kind: "pending", reason: "source_unavailable" }

  // A fixture is not a source. The snapshot committed on this branch was built
  // from local fixtures — no county page has been fetched — so it is marked
  // synthetic and can never resolve to a date. This is what makes "wired
  // fail-closed" true structurally rather than by inspection: every consumer
  // reads the canonical path, and the canonical path has nothing to give until
  // a real retrieval replaces the fixture.
  //
  // The check is on the data, not on NODE_ENV, so it cannot be switched off by
  // deploying.
  if (snapshot.synthetic) return { kind: "pending", reason: "synthetic_source" }

  const source = snapshot.sources?.[stage] ?? null
  if (!source) return { kind: "pending", reason: "source_unavailable" }

  if (source.parseStatus !== "ok") return pending("parse_failed", source)

  const retrievedMs = parseInstant(source.retrievedAt)
  if (retrievedMs === null) return pending("parse_failed", source)

  // A retrieval stamped after the moment we are evaluating is not a fresh
  // fetch; it is a broken clock or a fabricated timestamp. Either way it must
  // never be the thing that makes a stale source look current.
  if (retrievedMs > evaluatedMs) return pending("source_from_future", source)

  const sourceUpdatedMs = parseInstant(source.sourceUpdatedAt)
  if (sourceUpdatedMs !== null && sourceUpdatedMs > evaluatedMs) {
    return pending("source_from_future", source)
  }

  if (evaluatedMs - retrievedMs > DEFAULT_SOURCE_TTL_MS) {
    return pending("source_stale", source)
  }

  const row = snapshot.townships?.[township.townshipKey]
  if (!row) return pending("township_missing", source)

  const window = row.stages?.[stage] ?? null
  if (!window) return pending("stage_missing", source)

  const openDate = parseCountyDate(window.openDate)
  const lastFileDate = parseCountyDate(window.lastFileDate)
  if (!openDate || !lastFileDate) return pending("date_invalid", source)
  if (window.noticeDate != null && !parseCountyDate(window.noticeDate)) {
    return pending("date_invalid", source)
  }
  if (openDate > lastFileDate) return pending("date_invalid", source)

  const today = countyCalendarDay(evaluatedMs)
  const status = windowStatusOn(today, openDate, lastFileDate)

  if (
    requiresSameDayFetch(today, openDate, lastFileDate) &&
    countyCalendarDay(retrievedMs) !== today
  ) {
    return pending("source_stale", source)
  }

  return {
    kind: "verified",
    stage,
    township,
    eligible,
    noticeDate: window.noticeDate ?? null,
    openDate,
    lastFileDate,
    status,
    provenance: source,
    evaluatedAt: new Date(evaluatedMs).toISOString(),
    freshnessExpiresAt: new Date(evaluatedMs + SERVING_AGE_CEILING_MS).toISOString(),
  }
}

/**
 * Whether an already-computed state has aged past its serving ceiling.
 *
 * Callers that cache or prerender a state must check this before rendering it;
 * a verified state is a claim about a moment, not a fact about the world.
 */
export function isServedStateExpired(
  state: OfficialDeadlineState,
  now: string,
): boolean {
  if (state.kind !== "verified") return false
  const nowMs = parseInstant(now)
  const expiresMs = parseInstant(state.freshnessExpiresAt)
  if (nowMs === null || expiresMs === null) return true
  return nowMs > expiresMs
}

/* ---------------------------------------------------------------------------
 * Render-time projection
 *
 * The state above answers a question about one instant. Rendering happens at a
 * later one — after a cache, a prerender, or a page left open overnight — and
 * that gap is where every stale countdown on this branch came from. So nothing
 * renders the state directly. Consumers render a projection, which re-derives
 * status and countdown from the render clock and can only ever degrade: a
 * verified state may project as unavailable, never the reverse.
 * ------------------------------------------------------------------------- */

/** The two strings the contract fixes for any suppressed deadline. */
export const PENDING_NOTICE = "Official date unavailable or not freshly verified."
export const PENDING_STATUS_LABEL = "Pending official date"

/**
 * Everything a consumer is permitted to draw from a deadline.
 *
 * These travel together deliberately. The failure mode being designed out is
 * the page that suppressed the date but kept the countdown, or suppressed the
 * countdown but kept the checkout button — so suppression is one decision,
 * made here, and a consumer that reads any of these has already read all of
 * them.
 */
export type ProjectionCapabilities = {
  showDates: boolean
  showStatus: boolean
  showCountdown: boolean
  allowDeadlineCta: boolean
  allowReminderSignup: boolean
  allowDeadlineEmail: boolean
  allowCheckout: boolean
  allowStructuredData: boolean
}

const NOTHING_PERMITTED: ProjectionCapabilities = {
  showDates: false,
  showStatus: false,
  showCountdown: false,
  allowDeadlineCta: false,
  allowReminderSignup: false,
  allowDeadlineEmail: false,
  allowCheckout: false,
  allowStructuredData: false,
}

export type DeadlineProjection =
  | (ProjectionCapabilities & {
      available: false
      reason: PendingReason
      notice: typeof PENDING_NOTICE
      statusLabel: typeof PENDING_STATUS_LABEL
      /**
       * The authority's own page, when we know which one was consulted. This is
       * the only actionable thing an unavailable projection offers: we cannot
       * tell you the date, so here is who can.
       */
      officialSourceUrl: string | null
    })
  | (ProjectionCapabilities & {
      available: true
      /**
       * False when the township was identified by the page's own slug. Dates
       * and status may be shown; countdown, reminder, CTA, and checkout may
       * not. See [[isEligibleIdentity]].
       */
      eligible: boolean
      stage: DeadlineStage
      townshipKey: string
      townshipName: string
      noticeDate: string | null
      openDate: string
      lastFileDate: string
      status: WindowStatus
      statusLabel: string
      /** Null once the date has passed — never a negative countdown. */
      daysRemaining: number | null
      officialSourceUrl: string
      retrievedAt: string
      freshnessExpiresAt: string
    })

function unavailable(reason: PendingReason, sourceUrl: string | null): DeadlineProjection {
  return {
    ...NOTHING_PERMITTED,
    available: false,
    reason,
    notice: PENDING_NOTICE,
    statusLabel: PENDING_STATUS_LABEL,
    officialSourceUrl: sourceUrl,
  }
}

const STATUS_LABELS: Record<WindowStatus, string> = {
  upcoming: "Filing window not yet open",
  open: "Filing window open",
  closed: "Filing window closed",
}

/**
 * County calendar days from the render instant to the last filing day.
 *
 * Calendar days, not elapsed 24-hour periods: 23:00 and 08:00 on the same
 * Chicago day are both the same filing day. Null once the date has passed, so
 * a caller cannot render a negative countdown by forgetting to check.
 */
export function daysRemainingAtRenderTime(
  lastFileDate: string,
  renderedAt: string,
): number | null {
  const parsedLastFile = parseCountyDate(lastFileDate)
  const renderedMs = parseInstant(renderedAt)
  if (!parsedLastFile || renderedMs === null) return null

  const days = daysBetweenCalendarDays(countyCalendarDay(renderedMs), parsedLastFile)
  return days < 0 ? null : days
}

export function projectDeadline(
  state: OfficialDeadlineState,
  renderedAt: string,
): DeadlineProjection {
  const renderedMs = parseInstant(renderedAt)

  if (state.kind !== "verified") {
    return unavailable(state.reason, state.provenance?.sourceUrl ?? null)
  }

  const sourceUrl = state.provenance.sourceUrl
  if (renderedMs === null) return unavailable("date_invalid", sourceUrl)

  const evaluatedMs = parseInstant(state.evaluatedAt)
  const retrievedMs = parseInstant(state.provenance.retrievedAt)
  if (evaluatedMs === null || retrievedMs === null) {
    return unavailable("date_invalid", sourceUrl)
  }

  // Rendering before the evaluation that produced this state is a clock moving
  // backwards. Whatever else is true, this projection is not evidence of
  // anything current.
  if (renderedMs < evaluatedMs) return unavailable("source_from_future", sourceUrl)

  if (isServedStateExpired(state, renderedAt)) return unavailable("source_stale", sourceUrl)

  const today = countyCalendarDay(renderedMs)

  // The same-day rule, asked again against the render clock. A state verified
  // at 23:55 from a same-day fetch is a prior-day fetch six minutes later, and
  // its 900 seconds have not run out — this is the only check that catches it.
  if (
    requiresSameDayFetch(today, state.openDate, state.lastFileDate) &&
    countyCalendarDay(retrievedMs) !== today
  ) {
    return unavailable("source_stale", sourceUrl)
  }

  const status = windowStatusOn(today, state.openDate, state.lastFileDate)
  const daysRemaining = daysRemainingAtRenderTime(state.lastFileDate, renderedAt)

  // A closed window may still be described — a homeowner who arrives late is
  // owed the truth about why — but nothing may be sold, promised, or scheduled
  // against it. Commerce and filing CTAs require the window to be open now;
  // "upcoming" is not "open", however close it is.
  //
  // Eligibility is the second gate. A township page identified only by its slug
  // may state what the county published; it may not run a countdown, take a
  // reminder signup, or open a checkout, because it does not know whose
  // property the reader owns.
  const open = status === "open" && state.eligible
  const live = status !== "closed" && state.eligible

  return {
    available: true,
    eligible: state.eligible,
    stage: state.stage,
    townshipKey: state.township.townshipKey,
    townshipName: state.township.townshipName,
    noticeDate: state.noticeDate,
    openDate: state.openDate,
    lastFileDate: state.lastFileDate,
    status,
    statusLabel: STATUS_LABELS[status],
    daysRemaining,
    officialSourceUrl: sourceUrl,
    retrievedAt: state.provenance.retrievedAt,
    freshnessExpiresAt: state.freshnessExpiresAt,
    showDates: true,
    showStatus: true,
    showCountdown: live && daysRemaining !== null,
    allowDeadlineCta: open,
    allowReminderSignup: live,
    allowDeadlineEmail: live,
    allowCheckout: open,
    allowStructuredData: true,
  }
}
