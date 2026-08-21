/**
 * Official, verifiable sources for Cook County property-tax appeal deadlines.
 *
 * The source URLs come from the canonical snapshot's own provenance rather than
 * being retyped here, so the page cites the page we actually read. If those two
 * ever diverge, a homeowner is sent to verify against a document that is not
 * the one our date came from — which looks like corroboration and isn't.
 *
 * The old header on this file described `/deadlines` as "an INDICATIVE planning
 * aid" whose windows "were seeded from a design data set and are NOT a verified
 * per-year deadline feed". That was accurate, and it is exactly why those seed
 * dates no longer exist: a date good enough to publish is good enough to be
 * confirmed against its source, and one that isn't should be suppressed rather
 * than shipped behind a disclaimer. There is nothing left on the page for
 * `DEADLINE_VERIFY_NOTICE` to soften.
 */

import deadlineSnapshot from "@/data/deadlines/cook-county.json";
import { ASSESSOR_CALENDAR_URL } from "@/lib/appeals/township-deadlines";
import type {
  DeadlineStage,
  OfficialDeadlineSnapshot,
} from "@/lib/deadlines/official-source-state";

const SNAPSHOT = deadlineSnapshot as unknown as OfficialDeadlineSnapshot;

export interface OfficialSource {
  label: string;
  href: string;
  note: string;
}

/**
 * The URL the snapshot actually fetched for a stage, or a hard-coded fallback.
 *
 * The fallback is a link, not a date — the worst case is that a reader lands on
 * the authority's index page instead of the exact document we parsed. That is
 * the one thing safe to guess here, because it makes no claim about when the
 * page was read or what it said.
 */
function sourceUrlFor(stage: DeadlineStage, fallback: string): string {
  return SNAPSHOT.sources?.[stage]?.sourceUrl ?? fallback;
}

export const OFFICIAL_DEADLINE_SOURCES: readonly OfficialSource[] = [
  {
    label: "Cook County Assessor — Assessment & Appeal Calendar",
    href: sourceUrlFor("assessor", ASSESSOR_CALENDAR_URL),
    note: "The official filing deadline (last file date) for each township. Updated through the year as townships open.",
  },
  {
    label: "Cook County Board of Review — Appeals",
    href: sourceUrlFor("bor", "https://www.cookcountyboardofreview.com/residential-appeals"),
    note: "The second-level appeal window, which opens separately from the Assessor's and has its own deadline per township.",
  },
  {
    label: "Cook County Assessor — Property Search",
    href: "https://www.cookcountyassessoril.gov/address-search",
    note: "Look up your PIN, township, and current assessment by address.",
  },
] as const;

/**
 * Neutral copy for a surface that has no verified deadline to show.
 *
 * This replaces `DEADLINE_VERIFY_NOTICE`, which asked a reader to treat dates
 * on the page as "an indicative planning guide, not an official deadline". A
 * date shown next to that sentence is still a date a homeowner will plan
 * around; the disclaimer transferred the risk without removing it. Pending now
 * shows no date at all, and this sentence says why and points at who can
 * answer.
 */
export const DEADLINE_PENDING_NOTICE =
  "We have not verified this township's filing deadline against the county's published calendar, so we are not showing one. " +
  "Cook County publishes and revises appeal dates through the year, and they vary by township. " +
  "Confirm your exact filing deadline with the official county source below before you file.";

export { ASSESSOR_CALENDAR_URL };
