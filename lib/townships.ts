/**
 * Cook County's 38 townships as a descriptive roster.
 *
 * This file used to carry a second appeal calendar: a hand-typed `openDate`
 * and `closeDate` for every township — including 2027 and 2028 windows the
 * county has not published — plus a `REFERENCE_DATE` pinned to a single
 * afternoon in May 2026 that every "open / opening-soon / closed" badge and
 * every "closes in N days" countdown on the site was computed against. The
 * header said so out loud, and promised a follow-up pass to "swap this for
 * Date.now() once Rex confirms operator behavior at year boundaries".
 *
 * Swapping in `Date.now()` would have been the wrong fix. The defect was never
 * that the clock was frozen; it was that this file answered a question it had
 * no evidence for. A design-seed date run against a live clock produces a
 * countdown that is wrong and moving, which is worse than one that is wrong and
 * still. Those dates are gone rather than re-timed.
 *
 * What is left is the part that was always true and never needed a source: the
 * roster. Which townships exist, what they are called, which URL slug each one
 * owns, which triennial district and cycle year it belongs to, and which
 * neighbours to cross-link. None of that expires, so none of it needs
 * provenance. Every date and every status now comes from the canonical state in
 * [[lib/deadlines/official-source-state]], reached through
 * [[lib/appeals/township-deadlines]].
 *
 * Schema:
 *   slug          — URL-safe identifier (used for /township/[slug] pages)
 *   name          — Display name (no "Township" suffix; UI adds it)
 *   district      — "south-west-suburbs" | "north-suburbs" | "chicago"
 *   cycleYear     — Year this township is in active triennial reassessment
 *   neighbors     — 3-4 nearby townships (for cross-linking)
 *
 * The three `avg*` fields — `avgAssessed`, `avgReduction`, `avgSavings` — are
 * gone too. They were design-set sample figures, as this header used to say out
 * loud, and the township page rendered all three under the heading
 * "Public-record context" over the source line "Cook County public records and
 * internal modeling", on 38 indexable pages. `avgSavings` is an averaged
 * savings figure, which BL-B1 bans outright; `avgAssessed` was invented and
 * attributed to the county. Suppressing the render alone would have left the
 * numbers one JSX line away from returning, so the fields are removed with it.
 * Real measured figures, if they are ever published, need provenance these
 * never had.
 */

import { describeTownshipCalendar } from "@/lib/appeals/township-deadlines";

export type TownshipDistrict =
  | "south-west-suburbs"
  | "north-suburbs"
  | "chicago";

/**
 * One roster row. Carries no window, status, or countdown by construction —
 * ask [[projectTownshipDeadline]] for those, and be ready for it to say no.
 */
export interface Township {
  slug: string;
  name: string;
  district: TownshipDistrict;
  cycleYear: number;
  neighbors: string[];
}

export const TOWNSHIPS: Township[] = [
  // ───── 2026 cycle: South & West Suburbs ─────
  { slug: "berwyn",       name: "Berwyn",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["cicero", "riverside", "stickney"] },
  { slug: "bloom",        name: "Bloom",        district: "south-west-suburbs", cycleYear: 2026, neighbors: ["bremen", "rich", "thornton"] },
  { slug: "bremen",       name: "Bremen",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["bloom", "orland", "thornton"] },
  { slug: "calumet",      name: "Calumet",      district: "south-west-suburbs", cycleYear: 2026, neighbors: ["thornton", "worth", "bremen"] },
  { slug: "cicero",       name: "Cicero",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["berwyn", "stickney", "proviso"] },
  { slug: "lemont",       name: "Lemont",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["palos", "orland", "lyons"] },
  { slug: "lyons",        name: "Lyons",        district: "south-west-suburbs", cycleYear: 2026, neighbors: ["riverside", "proviso", "lemont"] },
  { slug: "oak-park",     name: "Oak Park",     district: "south-west-suburbs", cycleYear: 2026, neighbors: ["proviso", "river-forest", "berwyn"] },
  { slug: "orland",       name: "Orland",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["palos", "bremen", "lemont"] },
  { slug: "palos",        name: "Palos",        district: "south-west-suburbs", cycleYear: 2026, neighbors: ["orland", "worth", "lemont"] },
  { slug: "proviso",      name: "Proviso",      district: "south-west-suburbs", cycleYear: 2026, neighbors: ["oak-park", "river-forest", "lyons"] },
  { slug: "rich",         name: "Rich",         district: "south-west-suburbs", cycleYear: 2026, neighbors: ["bloom", "bremen", "thornton"] },
  { slug: "river-forest", name: "River Forest", district: "south-west-suburbs", cycleYear: 2026, neighbors: ["oak-park", "proviso", "lyons"] },
  { slug: "riverside",    name: "Riverside",    district: "south-west-suburbs", cycleYear: 2026, neighbors: ["berwyn", "lyons", "stickney"] },
  { slug: "stickney",     name: "Stickney",     district: "south-west-suburbs", cycleYear: 2026, neighbors: ["cicero", "berwyn", "riverside"] },
  { slug: "thornton",     name: "Thornton",     district: "south-west-suburbs", cycleYear: 2026, neighbors: ["calumet", "bloom", "rich"] },
  { slug: "worth",        name: "Worth",        district: "south-west-suburbs", cycleYear: 2026, neighbors: ["palos", "calumet", "orland"] },

  // ───── 2027 cycle: North Suburbs ─────
  { slug: "barrington",   name: "Barrington",   district: "north-suburbs", cycleYear: 2027, neighbors: ["palatine", "hanover", "wheeling"] },
  { slug: "elk-grove",    name: "Elk Grove",    district: "north-suburbs", cycleYear: 2027, neighbors: ["schaumburg", "wheeling", "leyden"] },
  { slug: "evanston",     name: "Evanston",     district: "north-suburbs", cycleYear: 2027, neighbors: ["new-trier", "niles", "northfield"] },
  { slug: "hanover",      name: "Hanover",      district: "north-suburbs", cycleYear: 2027, neighbors: ["barrington", "schaumburg", "palatine"] },
  { slug: "leyden",       name: "Leyden",       district: "north-suburbs", cycleYear: 2027, neighbors: ["norwood-park", "elk-grove", "maine"] },
  { slug: "maine",        name: "Maine",        district: "north-suburbs", cycleYear: 2027, neighbors: ["niles", "leyden", "norwood-park"] },
  { slug: "new-trier",    name: "New Trier",    district: "north-suburbs", cycleYear: 2027, neighbors: ["evanston", "northfield", "niles"] },
  { slug: "niles",        name: "Niles",        district: "north-suburbs", cycleYear: 2027, neighbors: ["evanston", "maine", "norwood-park"] },
  { slug: "northfield",   name: "Northfield",   district: "north-suburbs", cycleYear: 2027, neighbors: ["new-trier", "evanston", "wheeling"] },
  { slug: "norwood-park", name: "Norwood Park", district: "north-suburbs", cycleYear: 2027, neighbors: ["niles", "maine", "leyden"] },
  { slug: "palatine",     name: "Palatine",     district: "north-suburbs", cycleYear: 2027, neighbors: ["barrington", "schaumburg", "wheeling"] },
  { slug: "schaumburg",   name: "Schaumburg",   district: "north-suburbs", cycleYear: 2027, neighbors: ["palatine", "hanover", "elk-grove"] },
  { slug: "wheeling",     name: "Wheeling",     district: "north-suburbs", cycleYear: 2027, neighbors: ["palatine", "northfield", "elk-grove"] },

  // ───── 2028 cycle: City of Chicago ─────
  { slug: "hyde-park",    name: "Hyde Park",    district: "chicago", cycleYear: 2028, neighbors: ["lake", "south-chicago", "lake-view"] },
  { slug: "jefferson",    name: "Jefferson",    district: "chicago", cycleYear: 2028, neighbors: ["lake-view", "rogers-park", "north-chicago"] },
  { slug: "lake",         name: "Lake",         district: "chicago", cycleYear: 2028, neighbors: ["hyde-park", "south-chicago", "west-chicago"] },
  { slug: "lake-view",    name: "Lake View",    district: "chicago", cycleYear: 2028, neighbors: ["jefferson", "north-chicago", "hyde-park"] },
  { slug: "north-chicago",name: "North Chicago",district: "chicago", cycleYear: 2028, neighbors: ["lake-view", "rogers-park", "west-chicago"] },
  { slug: "rogers-park",  name: "Rogers Park",  district: "chicago", cycleYear: 2028, neighbors: ["jefferson", "north-chicago", "lake-view"] },
  { slug: "south-chicago",name: "South Chicago",district: "chicago", cycleYear: 2028, neighbors: ["hyde-park", "lake", "west-chicago"] },
  { slug: "west-chicago", name: "West Chicago", district: "chicago", cycleYear: 2028, neighbors: ["lake", "north-chicago", "south-chicago"] },
];

export const TOWNSHIPS_BY_SLUG: Record<string, Township> = Object.fromEntries(
  TOWNSHIPS.map((t) => [t.slug, t]),
);

export function getTownshipSlugs(): string[] {
  return TOWNSHIPS.map((t) => t.slug);
}

export function getTownshipBySlug(slug: string): Township | undefined {
  return TOWNSHIPS_BY_SLUG[slug];
}

/**
 * Render an ISO calendar day as "July 6, 2026".
 *
 * A formatter, not a source. It is kept here because the roster is where the
 * site's date presentation was already standardised, and it is safe to keep for
 * the same reason the roster is: it invents nothing. Give it a day that came
 * from the canonical state.
 */
export function formatDateLong(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** As [[formatDateLong]], abbreviated: "Jul 6". */
export function formatDateShort(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The standing ticker line, shown when there is nothing verified to announce.
 *
 * The previous fallback read "Township schedules checked regularly · see
 * current schedule →". Nothing in the codebase checked anything regularly, and
 * a reader who trusted that sentence would have had no way to find out. This
 * one only points at the page.
 */
export const TICKER_STANDING_ITEM =
  "Cook County appeal deadlines vary by township · see the deadline calendar →";

/**
 * Ticker items for the site header.
 *
 * The ticker renders on every public page, to a reader whose property we have
 * not identified. That puts it at the informational tier: it may describe what
 * the Assessor published, and it may not run a countdown, imply eligibility, or
 * push a deadline-driven CTA. So each item here names a township and a verified
 * Last File Date, and nothing else — no "closes in 6 days", no "act now".
 *
 * A township only appears if the canonical state actually verified a window for
 * it. When none has, the ticker carries the standing item alone. That is the
 * intended resting state of an un-refreshed deployment, not a failure mode: an
 * empty ticker is a page that isn't claiming anything.
 *
 * `now` is injectable for deterministic tests.
 */
export function buildTickerItems(now: Date = new Date()): string[] {
  const at = now.toISOString();
  const items: string[] = [];

  for (const township of TOWNSHIPS) {
    if (items.length >= 3) break;
    const projection = describeTownshipCalendar(township.name, at);
    if (!projection.available || projection.status !== "open") continue;
    items.push(
      `${township.name} — Assessor window open, last file date ${formatDateLong(projection.lastFileDate)}`,
    );
  }

  items.push(TICKER_STANDING_ITEM);
  return items;
}
