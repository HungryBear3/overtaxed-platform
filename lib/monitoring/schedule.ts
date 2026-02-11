/**
 * Schedule-based monitoring: align checks with Cook County government release cadence.
 * - Reassessment season: Jan–Aug (data typically published during appeal cycles)
 * - Active townships: only check properties in townships with open or recently closed appeal windows
 */
import { TOWNSHIP_DEADLINES_2025 } from "@/lib/appeals/township-deadlines"

/** Cook County reassessment season: January through August. No checks Sep–Dec to reduce pings. */
const SEASON_START_MONTH = 1
const SEASON_END_MONTH = 8

/** Days before notice date to start checking (data may appear early) */
const LEAD_DAYS = 14
/** Days after filing deadline to keep checking (final values may be certified late) */
const TRAIL_DAYS = 45

export function isInReassessmentSeason(date: Date = new Date()): boolean {
  const month = date.getMonth() + 1 // 1–12
  return month >= SEASON_START_MONTH && month <= SEASON_END_MONTH
}

/**
 * Township names where the appeal window is currently "active" (open or recently closed).
 * We only run assessment checks for properties in these townships to reduce API pings.
 * A township is active when: noticeDate - LEAD_DAYS <= today <= lastFileDate + TRAIL_DAYS
 */
export function getActiveTownshipNamesForChecks(date: Date = new Date()): Set<string> {
  const today = date.toISOString().slice(0, 10)
  const active = new Set<string>()

  for (const [townshipKey, dates] of Object.entries(TOWNSHIP_DEADLINES_2025)) {
    const notice = dates.noticeDate
    const lastFile = dates.lastFileDate
    if (!notice || !lastFile) continue

    const windowStart = addDays(parseDate(notice), -LEAD_DAYS)
    const windowEnd = addDays(parseDate(lastFile), TRAIL_DAYS)
    const d = parseDate(today)
    if (d >= windowStart && d <= windowEnd) {
      active.add(townshipKey)
    }
  }
  return active
}

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y!, m! - 1, d!)
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** Normalize township name for matching (same as getTownshipDeadline) */
export function normalizeTownshipForMatch(township: string | null): string | null {
  if (!township?.trim()) return null
  return township.trim().toLowerCase().replace(/\s*township\s*$/i, "").trim()
}
