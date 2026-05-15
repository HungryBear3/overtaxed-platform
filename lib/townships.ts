/**
 * Cook County's 38 townships, organized by triennial reassessment cycle.
 *
 * Ported from /Users/abigailclaw/.openclaw/workspace/rex/ot-design-fetch-.../project/townships-data.js
 *
 * REFERENCE_DATE pins "open / opening-soon / closed" deterministically for
 * the design's reference state. In a follow-up pass we can swap this for
 * Date.now() once Rex confirms operator behavior at year boundaries.
 *
 * Schema:
 *   slug          — URL-safe identifier (used for /township/[slug] pages)
 *   name          — Display name (no "Township" suffix; UI adds it)
 *   district      — "south-west-suburbs" | "north-suburbs" | "chicago"
 *   cycleYear     — Year this township is in active triennial reassessment
 *   openDate      — ISO date the appeal window opens
 *   closeDate     — ISO date the window closes
 *   neighbors     — 3-4 nearby townships (for cross-linking)
 *   avgAssessed   — Sample county data: average assessed value (rounded)
 *   avgReduction  — Sample data: average successful appeal reduction (%)
 *   avgSavings    — Sample data: typical first-year savings ($)
 */

export type TownshipStatus = "open" | "opening-soon" | "closed";
export type TownshipDistrict =
  | "south-west-suburbs"
  | "north-suburbs"
  | "chicago";

export interface RawTownship {
  slug: string;
  name: string;
  district: TownshipDistrict;
  cycleYear: number;
  openDate: string;
  closeDate: string;
  neighbors: string[];
  avgAssessed: number;
  avgReduction: number;
  avgSavings: number;
}

export interface Township extends RawTownship {
  status: TownshipStatus;
  daysUntilOpen: number;
  daysUntilClose: number;
  openDateLong: string;
  closeDateLong: string;
  openDateShort: string;
  closeDateShort: string;
}

export const REFERENCE_DATE = new Date("2026-05-12T12:00:00Z");

const RAW_TOWNSHIPS: RawTownship[] = [
  // ───── 2026 cycle: South & West Suburbs (currently in appeal season) ─────
  { slug: "berwyn",       name: "Berwyn",       district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-15", closeDate: "2026-05-19", neighbors: ["cicero", "riverside", "stickney"],            avgAssessed: 28400, avgReduction: 11.2, avgSavings: 980 },
  { slug: "bloom",        name: "Bloom",        district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-22", closeDate: "2026-05-26", neighbors: ["bremen", "rich", "thornton"],                avgAssessed: 19800, avgReduction: 13.6, avgSavings: 1240 },
  { slug: "bremen",       name: "Bremen",       district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-08", closeDate: "2026-05-12", neighbors: ["bloom", "orland", "thornton"],               avgAssessed: 22600, avgReduction: 12.8, avgSavings: 1120 },
  { slug: "calumet",      name: "Calumet",      district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-05-04", closeDate: "2026-06-08", neighbors: ["thornton", "worth", "bremen"],               avgAssessed: 18200, avgReduction: 14.1, avgSavings: 1310 },
  { slug: "cicero",       name: "Cicero",       district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-15", closeDate: "2026-05-19", neighbors: ["berwyn", "stickney", "proviso"],             avgAssessed: 26900, avgReduction: 10.9, avgSavings: 940 },
  { slug: "lemont",       name: "Lemont",       district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-05-13", closeDate: "2026-06-15", neighbors: ["palos", "orland", "lyons"],                  avgAssessed: 38100, avgReduction: 9.7,  avgSavings: 1180 },
  { slug: "lyons",        name: "Lyons",        district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-05-06", closeDate: "2026-06-09", neighbors: ["riverside", "proviso", "lemont"],            avgAssessed: 31200, avgReduction: 11.4, avgSavings: 1090 },
  { slug: "oak-park",     name: "Oak Park",     district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-29", closeDate: "2026-06-02", neighbors: ["proviso", "river-forest", "berwyn"],         avgAssessed: 51400, avgReduction: 10.2, avgSavings: 1620 },
  { slug: "orland",       name: "Orland",       district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-05-20", closeDate: "2026-06-23", neighbors: ["palos", "bremen", "lemont"],                 avgAssessed: 36700, avgReduction: 10.8, avgSavings: 1240 },
  { slug: "palos",        name: "Palos",        district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-05-13", closeDate: "2026-06-15", neighbors: ["orland", "worth", "lemont"],                 avgAssessed: 33800, avgReduction: 10.4, avgSavings: 1130 },
  { slug: "proviso",      name: "Proviso",      district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-22", closeDate: "2026-05-26", neighbors: ["oak-park", "river-forest", "lyons"],         avgAssessed: 27300, avgReduction: 11.7, avgSavings: 1010 },
  { slug: "rich",         name: "Rich",         district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-29", closeDate: "2026-06-02", neighbors: ["bloom", "bremen", "thornton"],               avgAssessed: 21400, avgReduction: 13.2, avgSavings: 1190 },
  { slug: "river-forest", name: "River Forest", district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-29", closeDate: "2026-06-02", neighbors: ["oak-park", "proviso", "lyons"],              avgAssessed: 64200, avgReduction: 9.4,  avgSavings: 1820 },
  { slug: "riverside",    name: "Riverside",    district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-05-06", closeDate: "2026-06-09", neighbors: ["berwyn", "lyons", "stickney"],               avgAssessed: 42800, avgReduction: 10.1, avgSavings: 1380 },
  { slug: "stickney",     name: "Stickney",     district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-04-15", closeDate: "2026-05-19", neighbors: ["cicero", "berwyn", "riverside"],             avgAssessed: 24100, avgReduction: 11.0, avgSavings: 920 },
  { slug: "thornton",     name: "Thornton",     district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-05-04", closeDate: "2026-06-08", neighbors: ["calumet", "bloom", "rich"],                  avgAssessed: 17900, avgReduction: 14.3, avgSavings: 1280 },
  { slug: "worth",        name: "Worth",        district: "south-west-suburbs", cycleYear: 2026, openDate: "2026-05-20", closeDate: "2026-06-23", neighbors: ["palos", "calumet", "orland"],                avgAssessed: 28800, avgReduction: 11.2, avgSavings: 1040 },

  // ───── 2027 cycle: North Suburbs ─────
  { slug: "barrington",   name: "Barrington",   district: "north-suburbs", cycleYear: 2027, openDate: "2027-04-21", closeDate: "2027-05-25", neighbors: ["palatine", "hanover", "wheeling"],            avgAssessed: 71200, avgReduction: 8.9,  avgSavings: 1640 },
  { slug: "elk-grove",    name: "Elk Grove",    district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-05", closeDate: "2027-06-08", neighbors: ["schaumburg", "wheeling", "leyden"],           avgAssessed: 36800, avgReduction: 10.3, avgSavings: 1190 },
  { slug: "evanston",     name: "Evanston",     district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-19", closeDate: "2027-06-22", neighbors: ["new-trier", "niles", "northfield"],          avgAssessed: 48600, avgReduction: 9.6,  avgSavings: 1480 },
  { slug: "hanover",      name: "Hanover",      district: "north-suburbs", cycleYear: 2027, openDate: "2027-04-21", closeDate: "2027-05-25", neighbors: ["barrington", "schaumburg", "palatine"],      avgAssessed: 33400, avgReduction: 10.7, avgSavings: 1110 },
  { slug: "leyden",       name: "Leyden",       district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-12", closeDate: "2027-06-15", neighbors: ["norwood-park", "elk-grove", "maine"],        avgAssessed: 32600, avgReduction: 10.5, avgSavings: 1080 },
  { slug: "maine",        name: "Maine",        district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-12", closeDate: "2027-06-15", neighbors: ["niles", "leyden", "norwood-park"],           avgAssessed: 41800, avgReduction: 9.8,  avgSavings: 1240 },
  { slug: "new-trier",    name: "New Trier",    district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-26", closeDate: "2027-06-29", neighbors: ["evanston", "northfield", "niles"],           avgAssessed: 92400, avgReduction: 8.2,  avgSavings: 1980 },
  { slug: "niles",        name: "Niles",        district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-19", closeDate: "2027-06-22", neighbors: ["evanston", "maine", "norwood-park"],         avgAssessed: 39200, avgReduction: 10.0, avgSavings: 1200 },
  { slug: "northfield",   name: "Northfield",   district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-26", closeDate: "2027-06-29", neighbors: ["new-trier", "evanston", "wheeling"],         avgAssessed: 86700, avgReduction: 8.4,  avgSavings: 1860 },
  { slug: "norwood-park", name: "Norwood Park", district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-12", closeDate: "2027-06-15", neighbors: ["niles", "maine", "leyden"],                  avgAssessed: 37300, avgReduction: 10.1, avgSavings: 1130 },
  { slug: "palatine",     name: "Palatine",     district: "north-suburbs", cycleYear: 2027, openDate: "2027-04-28", closeDate: "2027-06-01", neighbors: ["barrington", "schaumburg", "wheeling"],      avgAssessed: 44800, avgReduction: 9.7,  avgSavings: 1290 },
  { slug: "schaumburg",   name: "Schaumburg",   district: "north-suburbs", cycleYear: 2027, openDate: "2027-04-28", closeDate: "2027-06-01", neighbors: ["palatine", "hanover", "elk-grove"],          avgAssessed: 41200, avgReduction: 9.9,  avgSavings: 1220 },
  { slug: "wheeling",     name: "Wheeling",     district: "north-suburbs", cycleYear: 2027, openDate: "2027-05-05", closeDate: "2027-06-08", neighbors: ["palatine", "northfield", "elk-grove"],       avgAssessed: 42600, avgReduction: 9.7,  avgSavings: 1240 },

  // ───── 2028 cycle: City of Chicago ─────
  { slug: "hyde-park",    name: "Hyde Park",    district: "chicago", cycleYear: 2028, openDate: "2028-05-15", closeDate: "2028-06-19", neighbors: ["lake", "south-chicago", "lake-view"],         avgAssessed: 39600, avgReduction: 10.4, avgSavings: 1180 },
  { slug: "jefferson",    name: "Jefferson",    district: "chicago", cycleYear: 2028, openDate: "2028-05-01", closeDate: "2028-06-05", neighbors: ["lake-view", "rogers-park", "north-chicago"], avgAssessed: 41200, avgReduction: 10.2, avgSavings: 1210 },
  { slug: "lake",         name: "Lake",         district: "chicago", cycleYear: 2028, openDate: "2028-05-15", closeDate: "2028-06-19", neighbors: ["hyde-park", "south-chicago", "west-chicago"], avgAssessed: 28700, avgReduction: 11.4, avgSavings: 1080 },
  { slug: "lake-view",    name: "Lake View",    district: "chicago", cycleYear: 2028, openDate: "2028-05-08", closeDate: "2028-06-12", neighbors: ["jefferson", "north-chicago", "hyde-park"],   avgAssessed: 56800, avgReduction: 9.4,  avgSavings: 1520 },
  { slug: "north-chicago",name: "North Chicago",district: "chicago", cycleYear: 2028, openDate: "2028-05-08", closeDate: "2028-06-12", neighbors: ["lake-view", "rogers-park", "west-chicago"],  avgAssessed: 48200, avgReduction: 9.7,  avgSavings: 1380 },
  { slug: "rogers-park",  name: "Rogers Park",  district: "chicago", cycleYear: 2028, openDate: "2028-05-01", closeDate: "2028-06-05", neighbors: ["jefferson", "north-chicago", "lake-view"],   avgAssessed: 33400, avgReduction: 10.8, avgSavings: 1110 },
  { slug: "south-chicago",name: "South Chicago",district: "chicago", cycleYear: 2028, openDate: "2028-05-22", closeDate: "2028-06-26", neighbors: ["hyde-park", "lake", "west-chicago"],        avgAssessed: 24800, avgReduction: 12.0, avgSavings: 1020 },
  { slug: "west-chicago", name: "West Chicago", district: "chicago", cycleYear: 2028, openDate: "2028-05-22", closeDate: "2028-06-26", neighbors: ["lake", "north-chicago", "south-chicago"],   avgAssessed: 31600, avgReduction: 11.0, avgSavings: 1060 },
];

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDateLong(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const TOWNSHIPS: Township[] = RAW_TOWNSHIPS.map((t) => {
  const open = new Date(t.openDate + "T12:00:00Z");
  const close = new Date(t.closeDate + "T12:00:00Z");
  const daysUntilOpen = daysBetween(REFERENCE_DATE, open);
  const daysUntilClose = daysBetween(REFERENCE_DATE, close);

  let status: TownshipStatus;
  if (REFERENCE_DATE >= open && REFERENCE_DATE <= close) status = "open";
  else if (daysUntilOpen > 0 && daysUntilOpen <= 30) status = "opening-soon";
  else status = "closed";

  return {
    ...t,
    status,
    daysUntilOpen,
    daysUntilClose,
    openDateLong: formatDateLong(t.openDate),
    closeDateLong: formatDateLong(t.closeDate),
    openDateShort: formatDateShort(t.openDate),
    closeDateShort: formatDateShort(t.closeDate),
  };
});

export const TOWNSHIP_STATUS_COUNTS: Record<TownshipStatus | "total", number> =
  TOWNSHIPS.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      acc.total = (acc.total || 0) + 1;
      return acc;
    },
    { open: 0, "opening-soon": 0, closed: 0, total: 0 } as Record<
      TownshipStatus | "total",
      number
    >,
  );

export const TOWNSHIPS_BY_SLUG: Record<string, Township> = Object.fromEntries(
  TOWNSHIPS.map((t) => [t.slug, t]),
);

export function getTownshipSlugs(): string[] {
  return TOWNSHIPS.map((t) => t.slug);
}

export function getTownshipBySlug(slug: string): Township | undefined {
  return TOWNSHIPS_BY_SLUG[slug];
}

/** Ticker items derived only from verifiable township deadline data. */
export function buildTickerItems(): string[] {
  const open = TOWNSHIPS.filter((t) => t.status === "open");
  const openingSoon = TOWNSHIPS.filter((t) => t.status === "opening-soon");
  const items: string[] = [];

  if (open.length) {
    const opened = [...open].sort(
      (a, b) => Math.abs(a.daysUntilOpen) - Math.abs(b.daysUntilOpen),
    )[0];
    const n = Math.abs(opened.daysUntilOpen);
    items.push(
      `${opened.name} window opened ${n} day${n === 1 ? "" : "s"} ago`,
    );

    const soonest = [...open].sort(
      (a, b) => a.daysUntilClose - b.daysUntilClose,
    )[0];
    items.push(
      `${soonest.name} closes in ${soonest.daysUntilClose} day${soonest.daysUntilClose === 1 ? "" : "s"}`,
    );
  }

  if (openingSoon.length) {
    const next = [...openingSoon].sort((a, b) => a.daysUntilOpen - b.daysUntilOpen)[0];
    items.push(
      `${next.name} opens in ${next.daysUntilOpen} day${next.daysUntilOpen === 1 ? "" : "s"}`,
    );
  }

  items.push(`${TOWNSHIP_STATUS_COUNTS.open} open / ${TOWNSHIP_STATUS_COUNTS["opening-soon"]} opening soon`);
  return items;
}
