import type { Prisma } from "@prisma/client"

type Tx = Prisma.TransactionClient
export const reversalTypes = new Set(["charge.refunded", "refund.created", "refund.updated", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated"])
export function providerId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value
  if (value && typeof value === "object" && "id" in value) return providerId((value as {id: unknown}).id)
  return null
}
// Any refund lifecycle signal (including pending/failed) or dispute is a
// conservative manual hold. No event, including won/closed, restores access.
export async function recordReversal(tx: Tx, eventId: string, type: string, paymentIntent: string) {
  if (!reversalTypes.has(type) || !paymentIntent.startsWith("pi_")) throw new Error("Invalid reversal binding")
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(7012091219)::text`
  await tx.$executeRaw`INSERT INTO ot_settlement_reversal (event_id, event_type, payment_intent) VALUES (${eventId}, ${type}, ${paymentIntent}) ON CONFLICT (event_id) DO NOTHING`
  const prior = await tx.$queryRaw<Array<{payment_intent: string, event_type: string}>>`SELECT payment_intent, event_type FROM ot_settlement_reversal WHERE event_id = ${eventId}`
  if (prior[0]?.payment_intent !== paymentIntent || prior[0]?.event_type !== type) throw new Error("Reversal event binding mismatch")
  await tx.$executeRaw`UPDATE ot_order SET status = 'SETTLEMENT_HOLD' WHERE id IN (SELECT order_id FROM ot_payment_binding WHERE payment_intent = ${paymentIntent}) AND status NOT IN ('CANCELLED', 'REFUNDED')`
}
// Called only after signed session + exact persisted contract + line-item
// validation. Never infer ownership from charge metadata or customer email.
export async function bindPayment(tx: Tx, orderId: string, sessionId: string, paymentIntent: string) {
  if (!paymentIntent.startsWith("pi_")) throw new Error("Missing OT PaymentIntent")
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(7012091219)::text`
  await tx.$executeRaw`INSERT INTO ot_payment_binding (order_id, session_id, payment_intent) SELECT id, ${sessionId}, ${paymentIntent} FROM ot_order WHERE id = ${orderId} AND "stripeSessionId" = ${sessionId} ON CONFLICT (order_id) DO NOTHING`
  const binding = await tx.$queryRaw<Array<{session_id: string, payment_intent: string}>>`SELECT session_id, payment_intent FROM ot_payment_binding WHERE order_id = ${orderId}`
  if (binding[0]?.session_id !== sessionId || binding[0]?.payment_intent !== paymentIntent) throw new Error("OT payment binding mismatch")
  await tx.$executeRaw`UPDATE ot_order SET status = 'SETTLEMENT_HOLD' WHERE id = ${orderId} AND status NOT IN ('CANCELLED', 'REFUNDED') AND EXISTS (SELECT 1 FROM ot_settlement_reversal WHERE payment_intent = ${paymentIntent})`
}
