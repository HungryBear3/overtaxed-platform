/**
 * Schedule-based monitoring: align checks with Cook County government release cadence.
 * - Reassessment season: Jan–Aug (data typically published during appeal cycles)
 * - Active townships: only check properties in townships with open or recently closed appeal windows
 */
import deadlineSnapshot from "@/data/deadlines/cook-county.json"
import {
  evaluateOfficialDeadlineState,
  type OfficialDeadlineSnapshot,
} from "@/lib/deadlines/official-source-state"
import { informationalTownship, townshipKeyFromName } from "@/lib/deadlines/township-resolution"

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
  const active = new Set<string>()
  const snapshot = deadlineSnapshot as unknown as OfficialDeadlineSnapshot
  const evaluatedAt = date.toISOString()

  for (const [townshipKey, row] of Object.entries(snapshot.townships)) {
    const state = evaluateOfficialDeadlineState({
      snapshot,
      township: informationalTownship(townshipKey, row.townshipName),
      stage: "assessor",
      evaluatedAt,
    })
    if (state.kind !== "verified") continue

    const windowStart = addDays(parseDate(state.noticeDate ?? state.openDate), -LEAD_DAYS)
    const windowEnd = addDays(parseDate(state.lastFileDate), TRAIL_DAYS)
    const d = date
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

/**
 * Normalize a township name to the canonical snapshot key.
 *
 * This used to produce a space-separated form ("elk grove") matching the
 * hard-coded maps, while the canonical snapshot is keyed the way
 * [[townshipKeyFromName]] writes it ("elk-grove"). Two normalization dialects
 * over the same names is a silent-miss bug: a lookup in the wrong dialect finds
 * nothing and reads as "no deadline published" rather than as an error. There
 * is now one key space, and it is the canonical one.
 */
export function normalizeTownshipForMatch(township: string | null): string | null {
  if (!township?.trim()) return null
  const bare = township.trim().replace(/\s*township\s*$/i, "").trim()
  return bare ? townshipKeyFromName(bare) : null
}
