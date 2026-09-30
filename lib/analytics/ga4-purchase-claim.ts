/**
 * Durable, winner-only ownership of the one GA4 purchase a settled Checkout
 * Session may produce.
 *
 * The webhook reaches the purchase send more than once for one transaction by
 * design: a redelivery re-enters to retry T2 evidence, a retry follows a
 * released event claim, and a different event can name an already-paid
 * session. None of those may transmit again. Ownership is a row in the
 * webhook's existing idempotency table (`stripe_event`, unique primary key),
 * keyed by the transaction id under a prefix no Stripe event id can have, so
 * it needs no migration, is decided by the database under concurrency, and is
 * never released: the Stripe event claim can be deleted for a retry, this row
 * cannot be.
 *
 * The claim is taken immediately before transport and only when a send would
 * otherwise happen. What that buys, and what it cannot:
 *   - at most one transport per transaction, across every event and retry;
 *   - a crash or timeout after the claim, or a provider error, leaves the
 *     purchase claimed and unsent — it is never retried, so GA can be missing
 *     a purchase but never counts one twice;
 *   - a store that cannot record the claim means no send at all.
 * Exactly-once delivery to GA is not possible from here and is not claimed.
 */

export const GA_PURCHASE_CLAIM_TYPE = "ot.ga4_purchase_transport"

export type GaPurchaseClaim = "won" | "already_claimed" | "unavailable"

/** The slice of the Prisma client a claim needs: an insert against a unique key. */
export type GaPurchaseClaimStore = {
  stripeEvent: { create(args: { data: { id: string; type: string } }): Promise<unknown> }
}

/** Stripe event ids are `evt_…`; this key space cannot meet them. */
function claimId(transactionId: string): string {
  return `ga4_purchase:${transactionId}`
}

export async function claimGaPurchaseTransport(
  store: GaPurchaseClaimStore,
  transactionId: string,
): Promise<GaPurchaseClaim> {
  try {
    await store.stripeEvent.create({ data: { id: claimId(transactionId), type: GA_PURCHASE_CLAIM_TYPE } })
    return "won"
  } catch (error) {
    return (error as { code?: unknown } | null)?.code === "P2002" ? "already_claimed" : "unavailable"
  }
}
