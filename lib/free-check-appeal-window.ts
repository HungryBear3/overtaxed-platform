import { REFERENCE_DATE, TOWNSHIPS, daysBetween } from "@/lib/townships";

export type FreeCheckAppealWindowStatus = {
  township: string;
  status: "open" | "closed" | "future_cycle" | "unknown";
  openDate: string | null;
  closeDate: string | null;
  filingUrl: string;
  note: string | null;
};

const filingUrl = "https://www.cookcountyassessor.com/online-appeals";

function normalizeTownshipName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*township$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function statusForWindow(openDate: string, closeDate: string): "open" | "closed" | "future_cycle" {
  const open = new Date(`${openDate}T12:00:00Z`);
  const close = new Date(`${closeDate}T12:00:00Z`);
  if (REFERENCE_DATE >= open && REFERENCE_DATE <= close) return "open";
  if (daysBetween(REFERENCE_DATE, open) > 0) return "future_cycle";
  return "closed";
}

export function getFreeCheckAppealWindowStatus(township: string | null): FreeCheckAppealWindowStatus {
  if (!township) {
    return { township: "Unknown", status: "unknown", openDate: null, closeDate: null, filingUrl, note: null };
  }

  const key = normalizeTownshipName(township);
  const canonical = TOWNSHIPS.find((t) => normalizeTownshipName(t.name) === key);

  if (!canonical) {
    return {
      township,
      status: "unknown",
      openDate: null,
      closeDate: null,
      filingUrl,
      note: `Check ${filingUrl} for your township's exact appeal dates.`,
    };
  }

  const status = statusForWindow(canonical.openDate, canonical.closeDate);
  return {
    township: canonical.name,
    status,
    openDate: canonical.openDate,
    closeDate: canonical.closeDate,
    filingUrl,
    note:
      status === "future_cycle"
        ? `${canonical.name} is in the ${canonical.cycleYear} reassessment cycle; verify exact filing dates at cookcountyassessor.com.`
        : "Dates are approximate — verify at cookcountyassessor.com",
  };
}
