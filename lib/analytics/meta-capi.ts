/**
 * Meta Conversions API posture: DEFERRED. There is no send path.
 *
 * A CAPI event is only useful with `user_data` Meta can match — hashed
 * contact data, IP and user agent, or consented `fbp`/`fbc` cookies. None is
 * available on terms Phase B can defend:
 *
 *   - the signed checkout metadata carries no durable marketing consent;
 *   - it carries no consented, bounded `fbp`/`fbc` values;
 *   - the purchase contract (./funnel-contract) forbids every customer
 *     identifier a match would need, so the webhook's purchase cannot be
 *     repurposed as one.
 *
 * So the server purchase has no Meta counterpart: `buildMetaServerPurchaseEvent`
 * always returns a null event with these reasons, whatever it is given. This
 * module imports nothing, reads no environment variable and makes no request,
 * so no configuration can switch it on. Activating CAPI is a new design —
 * durable consent, consented click identifiers carried through signed checkout
 * metadata, and a policy review — not a flag.
 */

export const META_CAPI_POSTURE = Object.freeze({
  status: "DEFERRED" as const,
  server_event: null,
  reasons: Object.freeze([
    "NO_DURABLE_MARKETING_CONSENT_IN_SIGNED_CHECKOUT_METADATA",
    "NO_CONSENTED_BOUNDED_FBP_FBC_IN_SIGNED_CHECKOUT_METADATA",
    "MATCHING_REQUIRES_USER_DATA_THE_PURCHASE_CONTRACT_FORBIDS",
  ] as const),
})

export type MetaServerPurchaseDecision = {
  status: typeof META_CAPI_POSTURE.status
  event: null
  reasons: typeof META_CAPI_POSTURE.reasons
}

/** The Meta server event for a settled purchase: always none. */
export function buildMetaServerPurchaseEvent(_settledPurchase: unknown): MetaServerPurchaseDecision {
  return { status: META_CAPI_POSTURE.status, event: null, reasons: META_CAPI_POSTURE.reasons }
}
