"use client";
import { useEffect, useState } from "react";
import { buildTownship2026Views, count2026Views, official2026Provenance } from "@/lib/deadlines-2026";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";

// Deterministic SSR/hydration state: never serve import-time deadline claims.
const unavailable = buildTownship2026Views(new Date(0), {
  schemaVersion: 1, synthetic: true, sources: { assessor: null, bor: null }, townships: {},
});
const sourceReasons = new Set(["source_unavailable", "synthetic_source", "source_stale", "source_from_future", "parse_failed"]);
export function summarizeCalendar(VIEWS: ReturnType<typeof buildTownship2026Views>) {
  const COUNTS = count2026Views(VIEWS);
  return { VIEWS, COUNTS, PROVENANCE: official2026Provenance(VIEWS),
    NOTHING_VERIFIED: COUNTS.official === 0,
    ALL_PENDING_AT_SOURCE: COUNTS.pending > 0 && VIEWS.every(v => v.official || (v.pendingReason !== undefined && sourceReasons.has(v.pendingReason))),
  };
}
export const unavailableCalendar = summarizeCalendar(unavailable);

/** Informational-only reevaluation. Never fetches, renews provenance or signs eligibility. */
export function useInformationalCalendar(snapshot?: OfficialDeadlineSnapshot) {
  const [evaluated, setEvaluated] = useState<{ snapshot?: OfficialDeadlineSnapshot; calendar: typeof unavailableCalendar } | null>(null);
  useEffect(() => {
    const update = () => setEvaluated({ snapshot, calendar: document.visibilityState === "hidden"
      ? unavailableCalendar : summarizeCalendar(buildTownship2026Views(new Date(), snapshot)) });
    update();
    // Frozen/background timers may pause; focus and visibility always reevaluate.
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [snapshot]);
  // Never reuse an earlier snapshot while a replacement's effect is pending.
  return evaluated && evaluated.snapshot === snapshot ? evaluated.calendar : unavailableCalendar;
}
