/**
 * OT T2 delivery-evidence writes — strict default-off feature flag.
 *
 * Phase 2 Slice 1 reads this flag only at the paid-T2 persistence seam. When it
 * is absent, false, or malformed the seam returns before touching the evidence
 * store. Migration and explicit activation remain separate release steps.
 *
 * Convention matches the OT house style (e.g. OT_FORCE_PREVIEW_STUB): a strict
 * `=== "true"` compare, with no fallback that can enable it.
 */
export const OT_T2_FULFILLMENT_EVIDENCE_FLAG = "OT_T2_FULFILLMENT_EVIDENCE_ENABLED"

export function t2FulfillmentEvidenceWritesEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_FULFILLMENT_EVIDENCE_FLAG] === "true"
}
