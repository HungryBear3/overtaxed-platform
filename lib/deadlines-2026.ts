/**
 * View model for the /deadlines page.
 *
 * This module is a pure adapter: it reshapes the canonical projection into what
 * the page renders and does no date arithmetic of its own. It previously
 * derived open/closed by comparing a hard-coded Last File Date to `now`, which
 * made it the fourth module on this branch with its own opinion about whether a
 * window was open. Status, labels, and any countdown now all come from
 * [[projectDeadline]], so the index cannot disagree with the township page.
 *
 * `/deadlines` describes the county's published calendar to an anonymous
 * reader, so every row here is the informational tier. Dates and status may
 * render; countdowns, CTAs, reminders, and checkout may not — the page does not
 * know whose property the reader owns.
 */

import {
  TOWNSHIPS,
  formatDateLong,
  formatDateShort,
  type TownshipDistrict,
} from "@/lib/townships";
import { describeTownshipCalendar } from "@/lib/appeals/township-deadlines";
import type { PendingReason } from "@/lib/deadlines/official-source-state";

export type Deadline2026Status = "open" | "closed" | "upcoming" | "pending";

export interface Township2026View {
  slug: string;
  name: string;
  district: TownshipDistrict;
  cycleYear: number;
  /** True only when the canonical state verified a window for this township. */
  official: boolean;
  status: Deadline2026Status;
  /** Why the row is pending, when it is. */
  pendingReason?: PendingReason;
  /** Official Assessor Last File Date (ISO). Present only when official. */
  lastFileDate?: string;
  /** Official Reassessment Notice Date (ISO). Present only when official. */
  noticeDate?: string;
  /** Official Assessor window open date (ISO). Present only when official. */
  openDate?: string;
  /** "Jul 6, 2026" — present only when official. */
  lastFileLabel?: string;
  /** "Jul 6" — present only when official. */
  lastFileLabelShort?: string;
  /** "April 15, 2026" — present only when official. */
  openLabel?: string;
  /** The authority page the date came from. Present only when official. */
  officialSourceUrl?: string;
  /** Real retrieval instant backing the date. Present only when official. */
  retrievedAt?: string;
  /**
   * Days from `now` to the Last File Date.
   *
   * Present only when the projection cleared a countdown, which the
   * informational tier never does. It survives on the type because an
   * eligibility-tier caller may reuse this view shape.
   */
  daysUntilLastFile?: number;
  /**
   * Whether this view may offer a deadline reminder signup.
   *
   * Always present and false by default rather than optional. A township page
   * identifies its township by slug, so the projection behind it is the
   * informational tier and this is never true today — which is the controller's
   * ruling of 2026-08-19 in one field: "Without a verified PIN/property-record
   * match: no personalized eligibility claim, countdown, reminder signup,
   * deadline CTA, filing/payment CTA, or checkout."
   *
   * It was missing from this view entirely, so the page rendered its reminder
   * form on every township regardless of state — the date, countdown and CTA
   * were suppressed and the email capture beside them was not. Suppression is
   * meant to be one decision.
   */
  allowReminderSignup: boolean;
}

/**
 * Build the per-township view. `now` is injectable for deterministic tests.
 */
export function buildTownship2026Views(now: Date = new Date()): Township2026View[] {
  const at = now.toISOString();
  return TOWNSHIPS.map((t) => {
    const projection = describeTownshipCalendar(t.name, at);
    const base = {
      slug: t.slug,
      name: t.name,
      district: t.district,
      cycleYear: t.cycleYear,
    };

    if (!projection.available) {
      return {
        ...base,
        official: false,
        status: "pending" as const,
        pendingReason: projection.reason,
        allowReminderSignup: false,
      };
    }

    return {
      ...base,
      official: true,
      status: projection.status,
      lastFileDate: projection.lastFileDate,
      noticeDate: projection.noticeDate ?? undefined,
      openDate: projection.openDate,
      lastFileLabel: formatDateLong(projection.lastFileDate),
      lastFileLabelShort: formatDateShort(projection.lastFileDate),
      openLabel: formatDateLong(projection.openDate),
      officialSourceUrl: projection.officialSourceUrl,
      retrievedAt: projection.retrievedAt,
      allowReminderSignup: projection.allowReminderSignup,
      ...(projection.showCountdown && projection.daysRemaining !== null
        ? { daysUntilLastFile: projection.daysRemaining }
        : {}),
    };
  });
}

/**
 * The provenance to print under a page that shows any of these dates.
 *
 * CC-08 requires a source and a retrieval timestamp wherever a deadline
 * appears, and there is no default for either. The page previously printed
 * `TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED` — the day a developer last edited a
 * constant — as though it were a retrieval. Returns null when no row verified,
 * which is the case in which the page has no date to attribute and must say so
 * rather than name a source it did not read.
 */
export function official2026Provenance(
  views: Township2026View[],
): { source: string; retrievedAt: string } | null {
  const verified = views.filter((v) => v.official && v.retrievedAt)
  if (!verified.length) return null

  // Oldest retrieval across the rows actually shown. Attributing the freshest
  // one would overstate the page: a reader would take the newest timestamp as
  // covering every date on it.
  const retrievedAt = verified
    .map((v) => v.retrievedAt as string)
    .reduce((oldest, current) => (current < oldest ? current : oldest))

  return { source: "the Cook County Assessor", retrievedAt }
}

export interface Deadline2026Counts {
  open: number;
  closed: number;
  upcoming: number;
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
      else if (v.status === "upcoming") acc.upcoming += 1;
      else acc.pending += 1;
      if (v.official) acc.official += 1;
      return acc;
    },
    { open: 0, closed: 0, upcoming: 0, pending: 0, official: 0, total: 0 },
  );
}
