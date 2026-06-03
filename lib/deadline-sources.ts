/**
 * Official, verifiable sources for Cook County / Illinois property-tax appeal
 * deadlines.
 *
 * The /deadlines page shows a township calendar that is an INDICATIVE planning
 * aid only — the windows in `lib/townships.ts` were seeded from a design data
 * set and are NOT a verified per-year deadline feed. Cook County publishes the
 * authoritative dates progressively through the year, so any specific date a
 * homeowner relies on must be confirmed against the official sources below
 * before filing. We never present the on-site dates as the official deadline.
 *
 * Keep this list to pages we can actually stand behind: the Assessor's
 * Assessment & Appeal Calendar (the canonical deadline source), the Board of
 * Review (the second-level appeal body), and the Assessor address lookup.
 */

import { ASSESSOR_CALENDAR_URL } from "@/lib/appeals/township-deadlines";

export interface OfficialSource {
  label: string;
  href: string;
  note: string;
}

export const OFFICIAL_DEADLINE_SOURCES: readonly OfficialSource[] = [
  {
    label: "Cook County Assessor — Assessment & Appeal Calendar",
    href: ASSESSOR_CALENDAR_URL,
    note: "The official filing deadline (last file date) for each township. Updated through the year as townships open.",
  },
  {
    label: "Cook County Board of Review — Appeals",
    href: "https://www.cookcountyboardofreview.com/residential-appeals",
    note: "The second-level appeal window, which opens separately from the Assessor's and has its own deadline per township.",
  },
  {
    label: "Cook County Assessor — Property Search",
    href: "https://www.cookcountyassessoril.gov/address-search",
    note: "Look up your PIN, township, and current assessment by address.",
  },
] as const;

/** Canonical, reusable verify-before-filing copy. */
export const DEADLINE_VERIFY_NOTICE =
  "Dates shown here are an indicative planning guide, not an official deadline. " +
  "Cook County publishes and revises appeal dates throughout the year, and they vary by township. " +
  "Always confirm your exact filing deadline with the official county source below before you file.";

export { ASSESSOR_CALENDAR_URL };
