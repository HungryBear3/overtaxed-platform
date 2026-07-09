/**
 * Cook County township appeal deadlines (from Assessor's Assessment & Appeal Calendar).
 * Source: https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines
 * Updated periodically when the calendar changes.
 *
 * Key: township name (case-insensitive match)
 * Values: noticeDate and lastFileDate for Assessor appeals (YYYY-MM-DD)
 */

export const TOWNSHIP_DEADLINES_2025: Record<
  string,
  { noticeDate: string; lastFileDate: string }
> = {
  "norwood park": { noticeDate: "2025-03-24", lastFileDate: "2025-05-05" },
  evanston: { noticeDate: "2025-04-09", lastFileDate: "2025-05-21" },
  "new trier": { noticeDate: "2025-04-23", lastFileDate: "2025-06-05" },
  "elk grove": { noticeDate: "2025-05-06", lastFileDate: "2025-06-18" },
  maine: { noticeDate: "2025-06-04", lastFileDate: "2025-07-18" },
  northfield: { noticeDate: "2025-06-17", lastFileDate: "2025-07-31" },
  barrington: { noticeDate: "2025-07-03", lastFileDate: "2025-08-15" },
  leyden: { noticeDate: "2025-07-21", lastFileDate: "2025-09-02" },
  wheeling: { noticeDate: "2025-08-18", lastFileDate: "2025-09-30" },
  palatine: { noticeDate: "2025-09-09", lastFileDate: "2025-10-22" },
  niles: { noticeDate: "2025-10-22", lastFileDate: "2025-12-05" },
  schaumburg: { noticeDate: "2025-10-02", lastFileDate: "2025-11-17" },
  hanover: { noticeDate: "2025-11-06", lastFileDate: "2025-12-22" },
  riverside: { noticeDate: "2025-03-07", lastFileDate: "2025-04-18" },
  "river forest": { noticeDate: "2025-03-07", lastFileDate: "2025-04-18" },
  "rogers park": { noticeDate: "2025-03-12", lastFileDate: "2025-04-23" },
  berwyn: { noticeDate: "2025-03-25", lastFileDate: "2025-05-06" },
  "oak park": { noticeDate: "2025-04-08", lastFileDate: "2025-05-20" },
  palos: { noticeDate: "2025-04-19", lastFileDate: "2025-06-02" },
  cicero: { noticeDate: "2025-04-24", lastFileDate: "2025-06-06" },
  "lake view": { noticeDate: "2025-05-23", lastFileDate: "2025-07-09" },
  lyons: { noticeDate: "2025-06-02", lastFileDate: "2025-07-16" },
  stickney: { noticeDate: "2025-06-11", lastFileDate: "2025-07-25" },
  "west chicago": { noticeDate: "2025-07-09", lastFileDate: "2025-08-20" },
  lemont: { noticeDate: "2025-07-21", lastFileDate: "2025-09-02" },
  bremen: { noticeDate: "2025-07-10", lastFileDate: "2025-08-21" },
  jefferson: { noticeDate: "2025-08-21", lastFileDate: "2025-10-03" },
  "hyde park": { noticeDate: "2025-08-04", lastFileDate: "2025-09-16" },
  proviso: { noticeDate: "2025-08-25", lastFileDate: "2025-10-07" },
  calumet: { noticeDate: "2025-07-30", lastFileDate: "2025-09-11" },
  rich: { noticeDate: "2025-10-21", lastFileDate: "2025-12-04" },
  worth: { noticeDate: "2025-08-11", lastFileDate: "2025-09-23" },
  orland: { noticeDate: "2025-09-10", lastFileDate: "2025-10-23" },
  thornton: { noticeDate: "2025-10-01", lastFileDate: "2025-11-14" },
  bloom: { noticeDate: "2025-10-24", lastFileDate: "2025-12-09" },
  "south chicago": { noticeDate: "2025-10-15", lastFileDate: "2025-11-28" },
  lake: { noticeDate: "2025-09-22", lastFileDate: "2025-11-04" },
  "north chicago": { noticeDate: "2025-10-07", lastFileDate: "2025-11-20" },
}

/**
 * Verified Tax Year 2026 Assessor appeal deadlines.
 *
 * Source: Cook County Assessor Assessment & Appeal Calendar
 *   https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines
 * Calendar "Last Updated" marker at time of capture: 2026-07-07.
 *
 * IMPORTANT — DO NOT INFER OR BACKFILL:
 * Only townships the Assessor has actually published a 2026 Last File Date for
 * appear here. The Assessor releases townships progressively through the year,
 * so most are not yet listed. A township missing from this map is "pending an
 * official date" — it must NOT fall back to a prior-year (2025) date or to the
 * indicative design-seed windows in lib/townships.ts.
 *
 * Key: township name (lowercase, no "Township" suffix). Dates are ISO (YYYY-MM-DD).
 */
export const TOWNSHIP_DEADLINES_2026: Record<
  string,
  { noticeDate: string; lastFileDate: string }
> = {
  // South & West Suburban Cook County (2026 triennial reassessment cycle)
  berwyn: { noticeDate: "2026-05-20", lastFileDate: "2026-07-06" },
  "oak park": { noticeDate: "2026-05-06", lastFileDate: "2026-06-18" },
  riverside: { noticeDate: "2026-04-24", lastFileDate: "2026-06-08" },
  "river forest": { noticeDate: "2026-04-20", lastFileDate: "2026-06-02" },
  palos: { noticeDate: "2026-06-03", lastFileDate: "2026-07-17" },
  stickney: { noticeDate: "2026-06-29", lastFileDate: "2026-08-12" },
  cicero: { noticeDate: "2026-06-17", lastFileDate: "2026-07-31" },
  // North Suburbs & City of Chicago (annual appeal windows)
  // NOTE: the official Assessor calendar spells this township "Lakeview" (one
  // word), but our township roster (lib/townships.ts) uses "Lake View" (two
  // words). The key here MUST match the roster spelling so getOfficial2026Deadline
  // resolves it — do not change it to "lakeview". Covered by deadlines-2026 test.
  "lake view": { noticeDate: "2026-05-28", lastFileDate: "2026-07-13" },
  "new trier": { noticeDate: "2026-05-07", lastFileDate: "2026-06-22" },
  evanston: { noticeDate: "2026-04-22", lastFileDate: "2026-06-04" },
  "norwood park": { noticeDate: "2026-04-13", lastFileDate: "2026-05-26" },
  "rogers park": { noticeDate: "2026-04-17", lastFileDate: "2026-06-01" },
  maine: { noticeDate: "2026-06-05", lastFileDate: "2026-07-21" },
  "elk grove": { noticeDate: "2026-06-22", lastFileDate: "2026-08-04" },
}

/** Human-visible "last updated" marker from the official 2026 calendar capture. */
export const TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED = "2026-07-07"

const ASSESSOR_CALENDAR_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"

export function getTownshipDeadline(township: string | null): {
  noticeDate: string
  lastFileDate: string
  calendarUrl: string
} | null {
  if (!township?.trim()) return null
  // Normalize: lowercase, trim, remove "Township" suffix
  const key = township.trim().toLowerCase().replace(/\s*township\s*$/i, "").trim()
  const dates = TOWNSHIP_DEADLINES_2025[key]
  if (!dates) return null
  return { ...dates, calendarUrl: ASSESSOR_CALENDAR_URL }
}

function normalizeTownshipKey(township: string): string {
  return township.trim().toLowerCase().replace(/\s*township\s*$/i, "").trim()
}

/**
 * Official Tax Year 2026 Assessor deadline for a township, or null when the
 * Assessor has not yet published one. Never falls back to a prior year.
 */
export function getOfficial2026Deadline(township: string | null): {
  noticeDate: string
  lastFileDate: string
  calendarUrl: string
} | null {
  if (!township?.trim()) return null
  const dates = TOWNSHIP_DEADLINES_2026[normalizeTownshipKey(township)]
  if (!dates) return null
  return { ...dates, calendarUrl: ASSESSOR_CALENDAR_URL }
}

export { ASSESSOR_CALENDAR_URL }
