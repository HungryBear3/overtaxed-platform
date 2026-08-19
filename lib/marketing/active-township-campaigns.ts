/**
 * The four approved township landing-page campaigns.
 *
 * Copy lives here; dates never do. Phase and every date come from
 * [[describeTownshipCalendar]], so this module is not a fifth opinion about
 * whether a window is open.
 */
import {
  ASSESSOR_CALENDAR_URL,
  describeTownshipCalendar,
} from "@/lib/appeals/township-deadlines";
import type { PendingReason } from "@/lib/deadlines/official-source-state";

export const ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS = [
  "cicero",
  "elk-grove",
  "stickney",
  "west-chicago",
] as const;

export type ActiveTownshipCampaignSlug =
  (typeof ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS)[number];

interface CampaignCopy {
  name: string;
  campaignId: string;
  localContext: string;
  evidenceContext: string;
}

const COPY: Record<ActiveTownshipCampaignSlug, CampaignCopy> = {
  cicero: {
    name: "Cicero",
    campaignId: "ot_2026_cicero_deadline",
    localContext:
      "Cicero is in Cook County's 2026 south and west suburban reassessment cycle.",
    evidenceContext:
      "A useful review compares your assessment with relevant public-record properties, not a countywide average.",
  },
  "elk-grove": {
    name: "Elk Grove",
    campaignId: "ot_2026_elk_grove_deadline",
    localContext:
      "Elk Grove's Assessor window follows its own published township schedule.",
    evidenceContext:
      "Your free check starts with the subject property's Cook County record and nearby public-record comparisons.",
  },
  stickney: {
    name: "Stickney",
    campaignId: "ot_2026_stickney_deadline",
    localContext:
      "Stickney is part of Cook County's 2026 south and west suburban reassessment cycle.",
    evidenceContext:
      "The comparison should account for the subject property's characteristics and relevant local assessments.",
  },
  "west-chicago": {
    name: "West Chicago",
    campaignId: "ot_2026_west_chicago_deadline",
    localContext:
      "West Chicago has a separately published 2026 Assessor filing window.",
    evidenceContext:
      "The free check uses public Cook County records to show whether a closer review may be worthwhile.",
  },
};

export type TownshipCampaignPhase =
  | "upcoming"
  | "active"
  | "expired"
  | "pending";

interface CampaignBase extends CampaignCopy {
  slug: ActiveTownshipCampaignSlug;
  calendarUrl: string;
}

/**
 * A campaign whose window this site actually verified against the Assessor's
 * published calendar.
 */
export interface VerifiedTownshipCampaign extends CampaignBase {
  official: true;
  phase: Exclude<TownshipCampaignPhase, "pending">;
  noticeDate: string;
  lastFileDate: string;
  /** The retrieval instant behind the dates. Required for CC-08/CC-16. */
  retrievedAt: string;
  /**
   * Null whenever the projection did not clear a countdown, which on a campaign
   * landing page is always: the reader is anonymous, so this is the
   * informational tier. It was `number` before, which forced every caller to
   * render some number and left `0` as the only way to say "we don't know" —
   * indistinguishable from "today is the last day".
   */
  daysRemaining: number | null;
}

/**
 * A campaign with no verified window.
 *
 * The unavailable arm carries no dates at all, so a landing page cannot render
 * one by reaching past a boolean. `getActiveTownshipCampaign` used to return
 * `null` in this case and the route turned that into a 404 — on four URLs that
 * are in the sitemap, are the destination of paid and organic campaigns, and
 * may already be indexed. A page that has nothing to promise should say so;
 * disappearing is not the neutral outcome it looks like.
 */
export interface PendingTownshipCampaign extends CampaignBase {
  official: false;
  phase: "pending";
  pendingReason: PendingReason;
}

export type ActiveTownshipCampaign =
  | VerifiedTownshipCampaign
  | PendingTownshipCampaign;

export function getActiveTownshipCampaign(
  slug: string,
  now: Date = new Date(),
): ActiveTownshipCampaign | null {
  if (
    !ACTIVE_TOWNSHIP_CAMPAIGN_SLUGS.includes(slug as ActiveTownshipCampaignSlug)
  ) {
    return null;
  }
  const typedSlug = slug as ActiveTownshipCampaignSlug;
  const copy = COPY[typedSlug];
  const base: CampaignBase = {
    ...copy,
    slug: typedSlug,
    calendarUrl: ASSESSOR_CALENDAR_URL,
  };

  // A campaign landing page is read by an anonymous visitor, so this is the
  // informational tier: it may state what the county published and never runs
  // a countdown or opens a checkout against it. Phase and dates come from the
  // projection; this module performs no date arithmetic.
  const projection = describeTownshipCalendar(copy.name, now.toISOString());
  if (!projection.available) {
    return { ...base, official: false, phase: "pending", pendingReason: projection.reason };
  }

  const phase =
    projection.status === "upcoming"
      ? "upcoming"
      : projection.status === "open"
        ? "active"
        : "expired";

  return {
    ...base,
    official: true,
    noticeDate: projection.noticeDate ?? projection.openDate,
    lastFileDate: projection.lastFileDate,
    phase,
    retrievedAt: projection.retrievedAt,
    daysRemaining: projection.showCountdown ? projection.daysRemaining : null,
  };
}

export function formatCampaignDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function buildCampaignFreeCheckHref(
  campaign: ActiveTownshipCampaign,
  placement: "hero" | "body",
): string {
  const params = new URLSearchParams({
    utm_source: "township_deadline_page",
    utm_medium: "organic",
    utm_campaign: campaign.campaignId,
    utm_content: placement,
  });
  return `/?${params.toString()}#hero-check`;
}
