/**
 * Compatibility adapter over the canonical official-deadline state.
 *
 * This module used to be the platform's dominant deadline authority: a
 * hard-coded 2025 map, a partial hard-coded 2026 map, and a hand-maintained
 * "source updated" string that four other modules concatenated into a
 * `verifiedAt` timestamp. None of it carried a retrieval time, a content hash,
 * or a parse status, so nothing downstream could tell a published date from a
 * typed-in one.
 *
 * All of that is gone. What remains is an adapter: callers name a township and
 * an instant, and get back a [[DeadlineProjection]] derived from the one
 * canonical snapshot. There is no date literal in this file and no status
 * arithmetic, which is what makes the removal durable — a future edit cannot
 * reintroduce a fallback here without reintroducing the data too.
 *
 * `ASSESSOR_CALENDAR_URL` is deliberately still exported. It is a neutral link
 * to the authority's own page, not a claim about a date, and it is what a
 * suppressed projection offers the reader instead of a deadline.
 */

import deadlineSnapshot from "@/data/deadlines/cook-county.json";
import {
  evaluateOfficialDeadlineState,
  projectDeadline,
  type DeadlineProjection,
  type DeadlineStage,
  type OfficialDeadlineSnapshot,
} from "@/lib/deadlines/official-source-state";
import {
  informationalTownship,
  townshipKeyFromName,
  type TownshipIdentity,
} from "@/lib/deadlines/township-resolution";

const ASSESSOR_CALENDAR_URL =
  "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";

/**
 * The committed snapshot.
 *
 * It is marked `synthetic: true` and its placeholder dates are in 1900, so
 * every evaluation against it returns `pending: synthetic_source`. That is the
 * intended committed state: the safe default is to refuse to name a deadline
 * until a real retrieval replaces the fixture.
 */
export const OFFICIAL_DEADLINE_SNAPSHOT =
  deadlineSnapshot as unknown as OfficialDeadlineSnapshot;

/**
 * Project a deadline for an already-resolved township identity.
 *
 * The identity decides what the projection is allowed to authorize: a
 * property-record resolution can drive a countdown, a reminder, and a
 * checkout; a page slug can only describe the county's published calendar.
 * See [[isEligibleIdentity]].
 */
export function projectTownshipDeadline(input: {
  township: TownshipIdentity | null;
  stage?: DeadlineStage;
  at: string;
}): DeadlineProjection {
  const stage = input.stage ?? "assessor";
  const state = evaluateOfficialDeadlineState({
    snapshot: OFFICIAL_DEADLINE_SNAPSHOT,
    township: input.township,
    stage,
    evaluatedAt: input.at,
  });
  return projectDeadline(state, input.at);
}

/**
 * Project a township's published calendar from its name alone.
 *
 * This is the informational tier and it cannot establish eligibility. Use it
 * for township pages, indexes, and campaign copy — anywhere the reader's own
 * parcel is unknown. Passing a name here never yields a countdown, a filing
 * CTA, a reminder signup, or a checkout, regardless of what the snapshot says.
 */
export function describeTownshipCalendar(
  township: string | null,
  at: string,
  stage: DeadlineStage = "assessor",
): DeadlineProjection {
  const name = township?.trim();
  if (!name) {
    return projectTownshipDeadline({ township: null, stage, at });
  }
  const key = townshipKeyFromName(name.replace(/\s*township\s*$/i, "").trim());
  const row = OFFICIAL_DEADLINE_SNAPSHOT.townships?.[key];
  return projectTownshipDeadline({
    township: informationalTownship(key, row?.townshipName ?? name),
    stage,
    at,
  });
}

export { ASSESSOR_CALENDAR_URL };
