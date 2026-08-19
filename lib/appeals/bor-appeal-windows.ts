/**
 * Board of Review windows, at the BOR stage of the canonical state.
 *
 * This file used to be a hard-coded map of 35 township keys to 2026 open/close
 * dates, with a comment instructing a developer to "update this file each year".
 * Three things were wrong with it, and they are worth naming because the same
 * three recur across every module this rebuild replaced.
 *
 * It had no provenance. Nothing in it recorded where the dates came from, when
 * they were read, or whether the Board had since revised them — so a stale
 * entry and a current one were indistinguishable, and the file would keep
 * answering with confidence long after it stopped being true.
 *
 * It was keyed in its own dialect (`"north chicago"`, `"city of chicago"`)
 * rather than the canonical township key, so a lookup that missed returned
 * `undefined` and read downstream as "no window published" instead of as an
 * error.
 *
 * And it was the wrong stage of the wrong product. BOR is held: under the
 * Board's own rules only a licensed attorney or the taxpayer personally may
 * practise before it, which is what CC-11 says on every surface that mentions
 * the Board. A date map is not the thing standing between a homeowner and a BOR
 * filing; the honest answer at this stage is the county's own page.
 *
 * What remains is a stage-specific adapter over the one canonical state. It
 * carries no dates of its own, and it returns an unavailable projection unless
 * the snapshot actually verified a BOR window for that township.
 */

import {
  OFFICIAL_DEADLINE_SNAPSHOT,
  projectTownshipDeadline,
} from "@/lib/appeals/township-deadlines";
import type { DeadlineProjection } from "@/lib/deadlines/official-source-state";
import {
  informationalTownship,
  townshipKeyFromName,
  type TownshipIdentity,
} from "@/lib/deadlines/township-resolution";

/**
 * The BOR window for a township established by an official property record.
 *
 * Eligibility tier. Pass an identity built from a PIN or address match, not a
 * name — see [[isEligibleIdentity]].
 */
export function projectBorWindow(
  township: TownshipIdentity | null,
  at: string,
): DeadlineProjection {
  return projectTownshipDeadline({ township, stage: "bor", at });
}

/**
 * The BOR window for a township named on a page.
 *
 * Informational tier: this may describe what the Board published and can never
 * open a checkout, run a countdown, or take a reminder signup. Every surface
 * that renders this must co-render CC-11.
 */
export function describeBorWindow(
  township: string | null,
  at: string,
): DeadlineProjection {
  const name = township?.trim();
  if (!name) return projectBorWindow(null, at);

  const key = townshipKeyFromName(name.replace(/\s*township\s*$/i, "").trim());
  const row = OFFICIAL_DEADLINE_SNAPSHOT.townships?.[key];
  return projectBorWindow(
    informationalTownship(key, row?.townshipName ?? name),
    at,
  );
}
