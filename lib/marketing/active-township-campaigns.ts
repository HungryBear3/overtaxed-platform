import {
  ASSESSOR_CALENDAR_URL,
  getOfficial2026Deadline,
} from "@/lib/appeals/township-deadlines";

const DAY_MS = 86_400_000;
const CAMPAIGN_TIME_ZONE = "America/Chicago";

function chicagoDateIso(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CAMPAIGN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function calendarDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T12:00:00Z`).getTime();
  const to = new Date(`${toIso}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

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

export type TownshipCampaignPhase = "upcoming" | "active" | "expired";

export interface ActiveTownshipCampaign extends CampaignCopy {
  slug: ActiveTownshipCampaignSlug;
  noticeDate: string;
  lastFileDate: string;
  phase: TownshipCampaignPhase;
  daysRemaining: number;
  calendarUrl: string;
}

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
  const official = getOfficial2026Deadline(copy.name);
  if (!official) return null;

  const localDate = chicagoDateIso(now);
  const phase =
    localDate < official.noticeDate
      ? "upcoming"
      : localDate <= official.lastFileDate
        ? "active"
        : "expired";

  return {
    ...copy,
    slug: typedSlug,
    noticeDate: official.noticeDate,
    lastFileDate: official.lastFileDate,
    phase,
    daysRemaining: calendarDaysBetween(localDate, official.lastFileDate),
    calendarUrl: ASSESSOR_CALENDAR_URL,
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
