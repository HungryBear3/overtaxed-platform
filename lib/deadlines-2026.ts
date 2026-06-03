/**
 * View model for the /deadlines page, built from OFFICIAL Tax Year 2026 data only.
 *
 * Rules (enforced by tests):
 *   - A township shows a specific 2026 date ONLY if the Cook County Assessor has
 *     published one (see TOWNSHIP_DEADLINES_2026). Otherwise its status is
 *     "pending" and it shows "Pending official date" — never an inferred or
 *     prior-year (2025) date, and never the indicative design-seed window.
 *   - "open" / "closed" is derived from the official Last File Date relative to
 *     `now`, so the page can't claim a window is open after its real deadline.
 */

import {
  TOWNSHIPS,
  formatDateLong,
  formatDateShort,
  daysBetween,
  type TownshipDistrict,
} from "@/lib/townships";
import { getOfficial2026Deadline } from "@/lib/appeals/township-deadlines";

export type Deadline2026Status = "open" | "closed" | "pending";

export interface Township2026View {
  slug: string;
  name: string;
  district: TownshipDistrict;
  cycleYear: number;
  /** True only when the Assessor has published a 2026 Last File Date. */
  official: boolean;
  status: Deadline2026Status;
  /** Official Assessor Last File Date (ISO). Present only when official. */
  lastFileDate?: string;
  /** Official Reassessment Notice Date (ISO). Present only when official. */
  noticeDate?: string;
  /** "Jul 6, 2026" — present only when official. */
  lastFileLabel?: string;
  /** "Jul 6" — present only when official. */
  lastFileLabelShort?: string;
  /** Days from `now` to the Last File Date (negative if past). Official only. */
  daysUntilLastFile?: number;
}

/**
 * Build the per-township 2026 view. `now` is injectable for deterministic tests.
 */
export function buildTownship2026Views(now: Date = new Date()): Township2026View[] {
  return TOWNSHIPS.map((t) => {
    const official = getOfficial2026Deadline(t.name);
    if (!official) {
      return {
        slug: t.slug,
        name: t.name,
        district: t.district,
        cycleYear: t.cycleYear,
        official: false,
        status: "pending" as const,
      };
    }
    const lastFile = new Date(official.lastFileDate + "T12:00:00Z");
    const daysUntilLastFile = daysBetween(now, lastFile);
    return {
      slug: t.slug,
      name: t.name,
      district: t.district,
      cycleYear: t.cycleYear,
      official: true,
      status: daysUntilLastFile >= 0 ? ("open" as const) : ("closed" as const),
      lastFileDate: official.lastFileDate,
      noticeDate: official.noticeDate,
      lastFileLabel: formatDateLong(official.lastFileDate),
      lastFileLabelShort: formatDateShort(official.lastFileDate),
      daysUntilLastFile,
    };
  });
}

export interface Deadline2026Counts {
  open: number;
  closed: number;
  pending: number;
  official: number;
  total: number;
}

export function count2026Views(views: Township2026View[]): Deadline2026Counts {
  return views.reduce<Deadline2026Counts>(
    (acc, v) => {
      acc.total += 1;
      if (v.status === "open") acc.open += 1;
      else if (v.status === "closed") acc.closed += 1;
      else acc.pending += 1;
      if (v.official) acc.official += 1;
      return acc;
    },
    { open: 0, closed: 0, pending: 0, official: 0, total: 0 },
  );
}
