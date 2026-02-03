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

export { ASSESSOR_CALENDAR_URL }
