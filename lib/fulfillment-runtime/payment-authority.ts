import { Prisma } from "@prisma/client";

/** Immutable binding evidence, read without taking advisory locks. Callers retain
 * order-first serialization; a missing binding (including historical PAID rows)
 * is never delivery authority. A reversal is denied even before status converges.
 * The ledger is the sole PaymentIntent authority; orders carry only session ID.
 * A legitimate full discount has no PaymentIntent: its sole authority is the
 * immutable zero-total settlement row for the exact order + session, whose
 * discount equals the durable checkout price, on an order settled at zero.
 */
export function trustedPaymentAuthority(orderAlias: "ot_order" | "o" = "ot_order", neutral = false): Prisma.Sql {
  const order = Prisma.raw(`"${orderAlias}"`);
  const binding = Prisma.raw(neutral ? '"ot_neutral_runtime_payment_binding"' : '"ot_payment_binding"');
  const reversal = Prisma.raw(neutral ? '"ot_neutral_runtime_settlement_reversal"' : '"ot_settlement_reversal"');
  const zeroTotal = Prisma.raw(neutral ? '"ot_neutral_runtime_zero_total_settlement"' : '"ot_zero_total_settlement"');
  return Prisma.sql`(EXISTS (
    SELECT 1 FROM ${binding} b
    WHERE b.order_id = ${order}."id"
      AND b.session_id = ${order}."stripeSessionId"
      AND b.payment_intent LIKE 'pi_%'
      AND NOT EXISTS (
        SELECT 1 FROM ${reversal} r
        WHERE r.payment_intent = b.payment_intent
      )
  ) OR EXISTS (
    SELECT 1 FROM ${zeroTotal} z
    WHERE z.order_id = ${order}."id"
      AND z.session_id = ${order}."stripeSessionId"
      AND z.discount_cents = z.subtotal_cents
      AND ${order}."settledAmountCents" = 0
      AND ${order}."checkoutAmountCents" = z.subtotal_cents
  ))`;
}

/** Exact neutral T2 settled amount: the paid 6900/69 branch, or a legitimate
 * full discount settled at 0/0 on a durable 6900 USD checkout whose exact
 * immutable zero-total settlement row matches the order + session. Callers
 * still AND `trustedPaymentAuthority("o", true)` and all reservation checks. */
export function neutralSettledAmountAuthority(orderAlias: "o"): Prisma.Sql {
  const order = Prisma.raw(`"${orderAlias}"`);
  return Prisma.sql`lower(${order}."settledCurrency")='usd' AND (
    (${order}."settledAmountCents"=6900 AND ${order}."amountPaid"=69)
    OR (${order}."settledAmountCents"=0 AND ${order}."amountPaid"=0
      AND ${order}."checkoutAmountCents"=6900 AND lower(${order}."checkoutCurrency")='usd'
      AND EXISTS (
        SELECT 1 FROM "ot_neutral_runtime_zero_total_settlement" z
        WHERE z."order_id" = ${order}."id"
          AND z."session_id" = ${order}."stripeSessionId"
          AND z."subtotal_cents" = 6900
          AND z."discount_cents" = 6900
      ))
  )`;
}

/** Exact zero-total settlement for a neutral runtime order (LEFT JOIN, alias `zt`). */
export function neutralZeroTotalSettlementJoin(orderAlias: "o"): Prisma.Sql {
  const order = Prisma.raw(`"${orderAlias}"`);
  return Prisma.sql`LEFT JOIN "ot_neutral_runtime_zero_total_settlement" zt
    ON zt."order_id" = ${order}."id"
   AND zt."session_id" = ${order}."stripeSessionId"
   AND zt."discount_cents" = zt."subtotal_cents"
   AND ${order}."settledAmountCents" = 0
   AND ${order}."checkoutAmountCents" = zt."subtotal_cents"`;
}

/** Digest input binding QA/promotion evidence to the order's settlement. The
 * PaymentIntent form is byte-identical to the historical binding; a zero-total
 * settlement uses its own namespace and never poses as a PaymentIntent. */
export function neutralPaymentBindingInput(r: {
  orderId: string;
  sessionId: string | null;
  paymentIntent: string | null;
  zeroTotalPromotionCode?: string | null;
}): string | null {
  if (!r.sessionId) return r.paymentIntent ? `neutral-payment/v1\0${r.orderId}\0${r.sessionId}\0${r.paymentIntent}` : null;
  if (r.paymentIntent) return `neutral-payment/v1\0${r.orderId}\0${r.sessionId}\0${r.paymentIntent}`;
  if (r.zeroTotalPromotionCode) return `neutral-zero-total/v1\0${r.orderId}\0${r.sessionId}\0${r.zeroTotalPromotionCode}`;
  return null;
}
