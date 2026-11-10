/** Read-only aggregate export. Deliberately NOT a decision-packet rate denominator. */
import type { AttributionSqlClient } from "@/lib/attribution/record";
import {
  isWellFormedAttributionCode,
  isWellFormedRegistryVersion,
} from "@/lib/attribution/registry";
import { freeCheckMeasurementEnabled } from "./free-check-measurement";

type Group = {
  attribution_state: "campaign" | "untagged_request" | "unknown";
  campaign_code: string | null;
  creative_code: string | null;
  registry_version: string;
  completed: string | bigint | number;
  supportive: string | bigint | number;
  allow_checkout: string | bigint | number;
};
export async function exportFreeCheckMeasurement(
  client: AttributionSqlClient,
  start: Date,
  end: Date,
) {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end
  )
    throw new Error("invalid_measurement_interval");
  const provenance = {
    schema: "ot.free_check_request_completions.v1",
    source: "ot_free_check_completion",
    intervalStartInclusive: start.toISOString(),
    intervalEndExclusive: end.toISOString(),
    unit: "server_evaluated_request_completion",
    deduplicatedPeople: false,
    // The ledger cannot count failed writes, pre-activation traffic or browsers
    // who never completed a check. Never silently substitute a zero for these.
    missingMeasurementCount: null,
    organicCount: null,
    coverage: "persisted_rows_only_not_total_traffic",
    // Verified internal tests are never written, so rows carry no test label.
    // Rows from before that classification was active (including the earliest
    // Production completions) may be staff tests: unknown, never "customer".
    internalTestRows: "not_persisted_when_classified",
    customerProvenance: "unverified_rows_may_include_unclassified_tests",
  } as const;
  if (!freeCheckMeasurementEnabled())
    return { ...provenance, status: "disabled", groups: null } as const;
  try {
    const rows = await client.$queryRaw<Group[]>`
      SELECT attribution_state, campaign_code, creative_code, registry_version,
        COUNT(*)::text AS completed,
        COUNT(*) FILTER (WHERE outcome_code = 'supportive')::text AS supportive,
        COUNT(*) FILTER (WHERE allow_checkout)::text AS allow_checkout
      FROM public.ot_free_check_completion
      WHERE completed_at >= ${start} AND completed_at < ${end}
      GROUP BY attribution_state, campaign_code, creative_code, registry_version
      ORDER BY attribution_state, campaign_code, creative_code, registry_version
    `;
    const count = (n: unknown) => {
      if (
        typeof n !== "string" ||
        !/^\d+$/.test(n) ||
        !Number.isSafeInteger(Number(n))
      )
        throw new Error("invalid_count");
      return Number(n);
    };
    const groups = rows.map((row) => {
      if (
        !["campaign", "untagged_request", "unknown"].includes(
          row.attribution_state,
        ) ||
        !isWellFormedRegistryVersion(row.registry_version)
      )
        throw new Error("invalid_group");
      if (row.attribution_state === "campaign") {
        if (
          !isWellFormedAttributionCode(row.campaign_code) ||
          (row.creative_code !== null &&
            !isWellFormedAttributionCode(row.creative_code))
        )
          throw new Error("invalid_codes");
      } else if (row.campaign_code !== null || row.creative_code !== null)
        throw new Error("invalid_codes");
      const completed = count(row.completed),
        supportive = count(row.supportive),
        allowCheckout = count(row.allow_checkout);
      if (supportive > completed || allowCheckout > supportive)
        throw new Error("invalid_counts");
      return {
        attributionState: row.attribution_state,
        campaignCode: row.campaign_code,
        creativeCode: row.creative_code,
        registryVersion: row.registry_version,
        completed,
        supportive,
        allowCheckout,
      };
    });
    return { ...provenance, status: "available", groups } as const;
  } catch {
    return { ...provenance, status: "unavailable", groups: null } as const;
  }
}
