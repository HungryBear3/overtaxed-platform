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
export const OT_T2_ARTIFACT_ORCHESTRATION_FLAG =
  "OT_T2_ARTIFACT_ORCHESTRATION_ENABLED"
export const OT_T2_PACKET_DOWNLOAD_FLAG = "OT_T2_PACKET_DOWNLOAD_ENABLED"
export const OT_T2_DELIVERY_FLAG = "OT_T2_DELIVERY_ENABLED"

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
 * Independent default-off gate for the T2 artifact ORCHESTRATION seam — the
 * runtime caller that schedules the binding workflow after a settled paid T2.
 *
 * Separate from the binding gate on purpose: binding is "may an artifact be
 * bound", orchestration is "may a webhook cause one to be attempted at all".
 * Both must be true before a paid order produces anything, and each is
 * activated in its own reviewed step.
 */
export function t2ArtifactOrchestrationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_ARTIFACT_ORCHESTRATION_FLAG] === "true"
}

/**
 * Independent default-off gate for the secure customer packet DOWNLOAD surface —
 * capability issuance and the authenticated read that spends one.
 *
 * Separate from binding and orchestration on purpose. Those answer "may a packet
 * exist"; this answers "may a customer fetch one". A deployment that is already
 * producing artifacts must still be able to keep the customer-facing route shut
 * while issuance, revocation and audit behaviour are reviewed on real data.
 */
export function t2PacketDownloadEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_PACKET_DOWNLOAD_FLAG] === "true"
}

/**
 * Independent default-off gate for DELIVERY orchestration — claiming a lease,
 * persisting a delivery attempt, and handing it to a transactional adapter.
 *
 * Being exactly "true" is necessary and deliberately not sufficient: delivery
 * additionally requires an explicitly injected provider adapter, and no adapter
 * ships in this slice (see lib/fulfillment-runtime/t2-delivery-orchestrator.ts).
 * Two independent things must therefore be true before anything can be sent, and
 * neither can be satisfied by an environment variable alone.
 */
export function t2DeliveryEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_DELIVERY_FLAG] === "true"
}
