import { TOWNSHIPS, daysBetween } from "@/lib/townships";
import {
  ASSESSOR_CALENDAR_URL,
  TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
  getOfficial2026Deadline,
} from "@/lib/appeals/township-deadlines";

export type FreeCheckAppealWindowStatus = {
  township: string;
  status: "open" | "closed" | "future_cycle" | "unknown";
  openDate: string | null;
  closeDate: string | null;
  filingUrl: string;
  note: string | null;
};

const filingUrl = "https://www.cookcountyassessoril.gov/online-appeals";

function normalizeTownshipName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*township$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function statusForOfficialWindow(
  noticeDate: string,
  lastFileDate: string,
  now: Date,
): "open" | "closed" | "future_cycle" {
  const notice = new Date(`${noticeDate}T12:00:00Z`);
  const lastFile = new Date(`${lastFileDate}T12:00:00Z`);
  if (daysBetween(now, notice) > 0) return "future_cycle";
  if (daysBetween(now, lastFile) >= 0) return "open";
  return "closed";
}

export function getFreeCheckAppealWindowStatus(
  township: string | null,
  now: Date = new Date(),
): FreeCheckAppealWindowStatus {
  if (!township) {
    return {
      township: "Unknown",
      status: "unknown",
      openDate: null,
      closeDate: null,
      filingUrl,
      note: null,
    };
  }

  const key = normalizeTownshipName(township);
  const canonical = TOWNSHIPS.find(
    (t) => normalizeTownshipName(t.name) === key,
  );

  if (!canonical) {
    return {
      township,
      status: "unknown",
      openDate: null,
      closeDate: null,
      filingUrl,
      note: `Check ${ASSESSOR_CALENDAR_URL} for your township's exact appeal dates.`,
    };
  }

  const official = getOfficial2026Deadline(canonical.name);

  if (!official) {
    return {
      township: canonical.name,
      status: "future_cycle",
      openDate: null,
      closeDate: null,
      filingUrl,
      note: `${canonical.name}'s official 2026 Assessor date is pending. Verify exact filing dates at the Cook County Assessor calendar; do not rely on prior-year or planning dates.`,
    };
  }

  const status = statusForOfficialWindow(
    official.noticeDate,
    official.lastFileDate,
    now,
  );

  return {
    township: canonical.name,
    status,
    openDate: official.noticeDate,
    closeDate: official.lastFileDate,
    filingUrl,
    note: `Verified against the Cook County Assessor calendar on ${TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}. Schedules can change — always confirm before filing.`,
  };
}
