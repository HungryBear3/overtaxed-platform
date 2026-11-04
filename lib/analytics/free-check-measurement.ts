/** Server-only completion ledger. Units are evaluated requests, NOT people or leads. */
import { randomUUID } from "node:crypto";
import { deriveFreeCheckOutcomeParams } from "./free-check-funnel";
import {
  resolveAttributionCodes,
  shippedAttributionRegistry,
} from "@/lib/attribution/registry";
import type { AttributionSqlClient } from "@/lib/attribution/record";

export type MeasurementStatus =
  | "disabled"
  | "excluded"
  | "recorded"
  | "unavailable";
export type MeasurementAttribution =
  | "campaign"
  | "untagged_request"
  | "unknown";

// This switch is independent of checkout attribution; neither activates the other.
export function freeCheckMeasurementEnabled(): boolean {
  return process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED === "1";
}

export function resolveFreeCheckMeasurementAttribution(
  body: Record<string, unknown>,
) {
  const registry = shippedAttributionRegistry();
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const supplied =
    has("attributionCampaignCode") || has("attributionCreativeCode");
  const invalidType = [
    "attributionCampaignCode",
    "attributionCreativeCode",
  ].some((key) => has(key) && typeof body[key] !== "string");
  const resolved = invalidType
    ? null
    : resolveAttributionCodes(
        {
          campaignCode: body.attributionCampaignCode as string | undefined,
          creativeCode: body.attributionCreativeCode as string | undefined,
        },
        registry,
      );
  // An absent client observation is not an observed untagged request. Older
  // clients, lost capture and explicit rejected tags are all UNKNOWN.
  const state: MeasurementAttribution =
    resolved?.ok && resolved.attribution
      ? "campaign"
      : !supplied && body.freeCheckAttributionObservation === "untagged"
        ? "untagged_request"
        : "unknown";
  return {
    state,
    campaign:
      state === "campaign" && resolved?.ok
        ? (resolved.attribution?.campaignCode ?? null)
        : null,
    creative:
      state === "campaign" && resolved?.ok
        ? (resolved.attribution?.creativeCode ?? null)
        : null,
    registryVersion: registry.version,
  };
}

export async function recordFreeCheckCompletion(
  input: {
    body: Record<string, unknown>;
    outcome: unknown;
    windowStatus: unknown;
    preview: boolean;
  },
  client?: AttributionSqlClient,
): Promise<MeasurementStatus> {
  if (!freeCheckMeasurementEnabled()) return "disabled";
  // Vercel Preview and non-canonical hosts may use real county reads; neither
  // may enter the ledger. `preview` carries the route's host decision.
  if (process.env.VERCEL_ENV !== "production" || input.preview)
    return "excluded";
  const params = deriveFreeCheckOutcomeParams(input);
  if (!params) return "excluded";
  const attribution = resolveFreeCheckMeasurementAttribution(input.body);
  try {
    const db = client ?? (await import("@/lib/db/prisma")).prisma;
    // No automatic retry: an uncertain commit must never be counted twice by
    // this server invocation. New HTTP evaluations deliberately get new UUIDs.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = db.$executeRaw`
      INSERT INTO ot_free_check_completion
        (completion_id, attribution_state, campaign_code, creative_code, registry_version,
         outcome_code, outcome_reason, allow_checkout, window_status)
      VALUES (${randomUUID()}::uuid, ${attribution.state}, ${attribution.campaign},
        ${attribution.creative}, ${attribution.registryVersion}, ${params.outcome_code},
        ${params.outcome_reason}, ${params.allow_checkout}, ${params.window_status})
    `;
    try {
      const affected = await Promise.race([
        write,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("measurement_deadline")),
            750,
          );
        }),
      ]);
      return affected === 1 ? "recorded" : "unavailable";
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    // Never log the driver error or request: either can contain private data.
    console.warn("[free-check-measurement] unavailable");
    return "unavailable";
  }
}
