/**
 * OT T2 delivery-evidence foundation — default-off feature flag (Phase 1).
 *
 * This flag gates *future* T2 fulfillment-evidence writes. In Phase 1 nothing
 * reads it in a runtime path: settlement, webhook, admin, cron, worker, email,
 * packet generation, and customer flows are all untouched. It exists so a later
 * phase can gate evidence writes behind an explicit, default-off switch.
 *
 * Convention matches the OT house style (e.g. OT_FORCE_PREVIEW_STUB): a strict
 * `=== "true"` compare, so the flag is OFF when the env var is absent, false, or
 * malformed/unrecognized. There is no hidden fallback that can enable it.
 */
export const OT_T2_FULFILLMENT_EVIDENCE_FLAG = "OT_T2_FULFILLMENT_EVIDENCE_ENABLED"

export function t2FulfillmentEvidenceWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OT_T2_FULFILLMENT_EVIDENCE_FLAG] === "true"
}
