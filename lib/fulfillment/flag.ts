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
export const OT_T2_DELIVERY_ADAPTER_FLAG = "OT_T2_DELIVERY_ADAPTER_ENABLED"
export const OT_T2_DELIVERY_CALLBACK_FLAG = "OT_T2_DELIVERY_CALLBACK_ENABLED"
export const OT_T2_DELIVERY_RECOVERY_FLAG = "OT_T2_DELIVERY_RECOVERY_ENABLED"

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
 * additionally requires an explicitly injected provider adapter (see
 * lib/fulfillment-runtime/t2-delivery-orchestrator.ts), and the only real adapter
 * is itself behind [[t2DeliveryAdapterEnabled]] AND a complete validated
 * configuration. Three independent things must therefore be true before anything
 * can be sent, and none of them can be satisfied by this variable alone.
 */
export function t2DeliveryEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_DELIVERY_FLAG] === "true"
}

/**
 * Independent default-off gate for the REAL provider adapter.
 *
 * `OT_T2_DELIVERY_ENABLED` answers "may a delivery attempt be persisted and
 * leased at all". This answers the narrower question "may the Resend adapter be
 * constructed and injected". Keeping them apart means the delivery machinery can
 * be exercised with a synthetic adapter — in a test, in a rehearsal — without the
 * environment being one command away from talking to a real mail provider.
 *
 * Being exactly "true" is still not sufficient: the adapter additionally requires
 * a complete, validated configuration (API key, sender identity, packet base URL)
 * and refuses to construct without one. See t2-resend-adapter.ts.
 */
export function t2DeliveryAdapterEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_DELIVERY_ADAPTER_FLAG] === "true"
}

/**
 * Independent default-off gate for the signed provider CALLBACK endpoint.
 *
 * Separate from the adapter gate on purpose, and in both directions. A
 * deployment may need to accept provider evidence for mail it has already sent
 * while the sender itself is shut off; and a deployment that is sending must
 * never be able to open an event-ingestion endpoint merely because the sender
 * flag was flipped. Being exactly "true" is necessary and not sufficient: the
 * endpoint additionally requires OT_T2_RESEND_WEBHOOK_SECRET and fails closed
 * without it in EVERY environment, development and test included.
 */
export function t2DeliveryCallbackEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_DELIVERY_CALLBACK_FLAG] === "true"
}

/**
 * Independent default-off gate for the bounded admin delivery-RECOVERY control.
 *
 * Recovery can end an unresolved send and can re-apply stored provider evidence.
 * It can never regenerate an artifact and can never authorize a new send, but it
 * is still an authenticated write against paid evidence, so it gets its own
 * switch rather than riding on the console's.
 */
export function t2DeliveryRecoveryEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OT_T2_DELIVERY_RECOVERY_FLAG] === "true"
}
