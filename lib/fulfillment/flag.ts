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
export const OT_T2_EVIDENCE_CONSOLE_FLAG = "OT_T2_EVIDENCE_CONSOLE_ENABLED"
export const OT_T2_MANUAL_REVIEW_CONTROL_FLAG =
  "OT_T2_MANUAL_REVIEW_CONTROL_ENABLED"
export const OT_T2_ARTIFACT_BINDING_FLAG = "OT_T2_ARTIFACT_BINDING_ENABLED"

export function t2FulfillmentEvidenceWritesEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_FULFILLMENT_EVIDENCE_FLAG] === "true"
}

/**
 * Admin evidence-console visibility/read gate. This is deliberately independent
 * from the fulfillment write gate: Production may accept new evidence while the
 * admin surface remains unavailable until separately reviewed and activated.
 */
export function t2EvidenceConsoleEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_EVIDENCE_CONSOLE_FLAG] === "true"
}

/** Independent default-off gate for the one-way admin hold control. */
export function t2ManualReviewControlEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_MANUAL_REVIEW_CONTROL_FLAG] === "true"
}

/**
 * Independent default-off gate for Phase 2 Slice 2 artifact identity/provenance
 * binding writes.
 *
 * This is deliberately NOT folded into the Phase 1 write gate. That gate
 * (`OT_T2_FULFILLMENT_EVIDENCE_ENABLED`) is already exactly "true" in
 * Production, so reusing it would silently activate artifact binding the moment
 * this code deployed. Binding gets its own switch so schema, code, and
 * activation stay three separately reviewed steps.
 */
export function t2ArtifactBindingEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_ARTIFACT_BINDING_FLAG] === "true"
}

/**
 * Independent default-off gate for Phase 1 confirmation-email delivery
 * evidence writes on the paid OT settlement path. Deliberately NOT folded into
 * the T2 write gate above (already "true" in Production): migration, deploy,
 * and activation stay separately reviewed steps. While off, the webhook's
 * confirmation-email behavior is exactly the legacy fire-and-forget path.
 * Promotion gate: enable only after the migration is applied and evidence
 * writes are observed no-op-safe in Preview.
 */
export const OT_CONFIRMATION_EVIDENCE_FLAG = "OT_CONFIRMATION_EVIDENCE_ENABLED"

export function confirmationEvidenceWritesEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_CONFIRMATION_EVIDENCE_FLAG] === "true"
}
