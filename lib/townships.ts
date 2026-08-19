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
 *   avgAssessed   — Sample county data: average assessed value (rounded)
 *   avgReduction  — Sample data: average successful appeal reduction (%)
 *   avgSavings    — Sample data: typical first-year savings ($)
 *
 * The three `avg*` fields are design-set sample figures, not measured OverTaxed
 * results. They are outside this rebuild's authorized scope — it governs
 * deadline state and free-check eligibility — so they are left as they are and
 * flagged for a separate decision rather than quietly changed here.
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
  avgAssessed: number;
  avgReduction: number;
  avgSavings: number;
}

export const TOWNSHIPS: Township[] = [
  // ───── 2026 cycle: South & West Suburbs ─────
  { slug: "berwyn",       name: "Berwyn",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["cicero", "riverside", "stickney"],            avgAssessed: 28400, avgReduction: 11.2, avgSavings: 980 },
  { slug: "bloom",        name: "Bloom",        district: "south-west-suburbs", cycleYear: 2026, neighbors: ["bremen", "rich", "thornton"],                avgAssessed: 19800, avgReduction: 13.6, avgSavings: 1240 },
  { slug: "bremen",       name: "Bremen",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["bloom", "orland", "thornton"],               avgAssessed: 22600, avgReduction: 12.8, avgSavings: 1120 },
  { slug: "calumet",      name: "Calumet",      district: "south-west-suburbs", cycleYear: 2026, neighbors: ["thornton", "worth", "bremen"],               avgAssessed: 18200, avgReduction: 14.1, avgSavings: 1310 },
  { slug: "cicero",       name: "Cicero",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["berwyn", "stickney", "proviso"],             avgAssessed: 26900, avgReduction: 10.9, avgSavings: 940 },
  { slug: "lemont",       name: "Lemont",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["palos", "orland", "lyons"],                  avgAssessed: 38100, avgReduction: 9.7,  avgSavings: 1180 },
  { slug: "lyons",        name: "Lyons",        district: "south-west-suburbs", cycleYear: 2026, neighbors: ["riverside", "proviso", "lemont"],            avgAssessed: 31200, avgReduction: 11.4, avgSavings: 1090 },
  { slug: "oak-park",     name: "Oak Park",     district: "south-west-suburbs", cycleYear: 2026, neighbors: ["proviso", "river-forest", "berwyn"],         avgAssessed: 51400, avgReduction: 10.2, avgSavings: 1620 },
  { slug: "orland",       name: "Orland",       district: "south-west-suburbs", cycleYear: 2026, neighbors: ["palos", "bremen", "lemont"],                 avgAssessed: 36700, avgReduction: 10.8, avgSavings: 1240 },
  { slug: "palos",        name: "Palos",        district: "south-west-suburbs", cycleYear: 2026, neighbors: ["orland", "worth", "lemont"],                 avgAssessed: 33800, avgReduction: 10.4, avgSavings: 1130 },
  { slug: "proviso",      name: "Proviso",      district: "south-west-suburbs", cycleYear: 2026, neighbors: ["oak-park", "river-forest", "lyons"],         avgAssessed: 27300, avgReduction: 11.7, avgSavings: 1010 },
  { slug: "rich",         name: "Rich",         district: "south-west-suburbs", cycleYear: 2026, neighbors: ["bloom", "bremen", "thornton"],               avgAssessed: 21400, avgReduction: 13.2, avgSavings: 1190 },
  { slug: "river-forest", name: "River Forest", district: "south-west-suburbs", cycleYear: 2026, neighbors: ["oak-park", "proviso", "lyons"],              avgAssessed: 64200, avgReduction: 9.4,  avgSavings: 1820 },
  { slug: "riverside",    name: "Riverside",    district: "south-west-suburbs", cycleYear: 2026, neighbors: ["berwyn", "lyons", "stickney"],               avgAssessed: 42800, avgReduction: 10.1, avgSavings: 1380 },
  { slug: "stickney",     name: "Stickney",     district: "south-west-suburbs", cycleYear: 2026, neighbors: ["cicero", "berwyn", "riverside"],             avgAssessed: 24100, avgReduction: 11.0, avgSavings: 920 },
  { slug: "thornton",     name: "Thornton",     district: "south-west-suburbs", cycleYear: 2026, neighbors: ["calumet", "bloom", "rich"],                  avgAssessed: 17900, avgReduction: 14.3, avgSavings: 1280 },
  { slug: "worth",        name: "Worth",        district: "south-west-suburbs", cycleYear: 2026, neighbors: ["palos", "calumet", "orland"],                avgAssessed: 28800, avgReduction: 11.2, avgSavings: 1040 },

  // ───── 2027 cycle: North Suburbs ─────
  { slug: "barrington",   name: "Barrington",   district: "north-suburbs", cycleYear: 2027, neighbors: ["palatine", "hanover", "wheeling"],            avgAssessed: 71200, avgReduction: 8.9,  avgSavings: 1640 },
  { slug: "elk-grove",    name: "Elk Grove",    district: "north-suburbs", cycleYear: 2027, neighbors: ["schaumburg", "wheeling", "leyden"],           avgAssessed: 36800, avgReduction: 10.3, avgSavings: 1190 },
  { slug: "evanston",     name: "Evanston",     district: "north-suburbs", cycleYear: 2027, neighbors: ["new-trier", "niles", "northfield"],           avgAssessed: 48600, avgReduction: 9.6,  avgSavings: 1480 },
  { slug: "hanover",      name: "Hanover",      district: "north-suburbs", cycleYear: 2027, neighbors: ["barrington", "schaumburg", "palatine"],      avgAssessed: 33400, avgReduction: 10.7, avgSavings: 1110 },
  { slug: "leyden",       name: "Leyden",       district: "north-suburbs", cycleYear: 2027, neighbors: ["norwood-park", "elk-grove", "maine"],        avgAssessed: 32600, avgReduction: 10.5, avgSavings: 1080 },
  { slug: "maine",        name: "Maine",        district: "north-suburbs", cycleYear: 2027, neighbors: ["niles", "leyden", "norwood-park"],           avgAssessed: 41800, avgReduction: 9.8,  avgSavings: 1240 },
  { slug: "new-trier",    name: "New Trier",    district: "north-suburbs", cycleYear: 2027, neighbors: ["evanston", "northfield", "niles"],           avgAssessed: 92400, avgReduction: 8.2,  avgSavings: 1980 },
  { slug: "niles",        name: "Niles",        district: "north-suburbs", cycleYear: 2027, neighbors: ["evanston", "maine", "norwood-park"],         avgAssessed: 39200, avgReduction: 10.0, avgSavings: 1200 },
  { slug: "northfield",   name: "Northfield",   district: "north-suburbs", cycleYear: 2027, neighbors: ["new-trier", "evanston", "wheeling"],         avgAssessed: 86700, avgReduction: 8.4,  avgSavings: 1860 },
  { slug: "norwood-park", name: "Norwood Park", district: "north-suburbs", cycleYear: 2027, neighbors: ["niles", "maine", "leyden"],                  avgAssessed: 37300, avgReduction: 10.1, avgSavings: 1130 },
  { slug: "palatine",     name: "Palatine",     district: "north-suburbs", cycleYear: 2027, neighbors: ["barrington", "schaumburg", "wheeling"],      avgAssessed: 44800, avgReduction: 9.7,  avgSavings: 1290 },
  { slug: "schaumburg",   name: "Schaumburg",   district: "north-suburbs", cycleYear: 2027, neighbors: ["palatine", "hanover", "elk-grove"],          avgAssessed: 41200, avgReduction: 9.9,  avgSavings: 1220 },
  { slug: "wheeling",     name: "Wheeling",     district: "north-suburbs", cycleYear: 2027, neighbors: ["palatine", "northfield", "elk-grove"],       avgAssessed: 42600, avgReduction: 9.7,  avgSavings: 1240 },

  // ───── 2028 cycle: City of Chicago ─────
  { slug: "hyde-park",    name: "Hyde Park",    district: "chicago", cycleYear: 2028, neighbors: ["lake", "south-chicago", "lake-view"],         avgAssessed: 39600, avgReduction: 10.4, avgSavings: 1180 },
  { slug: "jefferson",    name: "Jefferson",    district: "chicago", cycleYear: 2028, neighbors: ["lake-view", "rogers-park", "north-chicago"], avgAssessed: 41200, avgReduction: 10.2, avgSavings: 1210 },
  { slug: "lake",         name: "Lake",         district: "chicago", cycleYear: 2028, neighbors: ["hyde-park", "south-chicago", "west-chicago"], avgAssessed: 28700, avgReduction: 11.4, avgSavings: 1080 },
  { slug: "lake-view",    name: "Lake View",    district: "chicago", cycleYear: 2028, neighbors: ["jefferson", "north-chicago", "hyde-park"],   avgAssessed: 56800, avgReduction: 9.4,  avgSavings: 1520 },
  { slug: "north-chicago",name: "North Chicago",district: "chicago", cycleYear: 2028, neighbors: ["lake-view", "rogers-park", "west-chicago"],  avgAssessed: 48200, avgReduction: 9.7,  avgSavings: 1380 },
  { slug: "rogers-park",  name: "Rogers Park",  district: "chicago", cycleYear: 2028, neighbors: ["jefferson", "north-chicago", "lake-view"],   avgAssessed: 33400, avgReduction: 10.8, avgSavings: 1110 },
  { slug: "south-chicago",name: "South Chicago",district: "chicago", cycleYear: 2028, neighbors: ["hyde-park", "lake", "west-chicago"],        avgAssessed: 24800, avgReduction: 12.0, avgSavings: 1020 },
  { slug: "west-chicago", name: "West Chicago", district: "chicago", cycleYear: 2028, neighbors: ["lake", "north-chicago", "south-chicago"],   avgAssessed: 31600, avgReduction: 11.0, avgSavings: 1060 },
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
