import { Prisma } from "@prisma/client";

/** Immutable binding evidence, read without taking advisory locks. Callers retain
 * order-first serialization; a missing binding (including historical PAID rows)
 * is never delivery authority. A reversal is denied even before status converges.
 * The ledger is the sole PaymentIntent authority; orders carry only session ID.
 */
export function trustedPaymentAuthority(orderAlias: "ot_order" | "o" = "ot_order"): Prisma.Sql {
  const order = Prisma.raw(`"${orderAlias}"`);
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ot_payment_binding" b
    WHERE b.order_id = ${order}."id"
      AND b.session_id = ${order}."stripeSessionId"
      AND b.payment_intent LIKE 'pi_%'
      AND NOT EXISTS (
        SELECT 1 FROM "ot_settlement_reversal" r
        WHERE r.payment_intent = b.payment_intent
      )
  )`;
}
