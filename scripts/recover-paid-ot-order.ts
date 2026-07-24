/**
 * Stage one paid live Stripe Checkout Session for OT manual recovery.
 *
 * Dry run:
 *   npx tsx scripts/recover-paid-ot-order.ts cs_live_...
 *
 * Apply (all three gates required):
 *   OT_ORDER_RECOVERY_CONFIRM=cs_live_... npx tsx scripts/recover-paid-ot-order.ts \
 *     cs_live_... --apply --i-have-approval
 *
 * Apply never marks an order PAID and never sends fulfillment. It creates or
 * transitions only to PAID_RECOVERY_REQUIRED so an operator can verify the
 * durable order, price/product, filing window, acknowledgment, and notice
 * evidence through the normal recovery path.
 */
import Stripe from "stripe"
import { prisma } from "../lib/db"
import { otOrderFromPaidSession } from "../lib/billing/ot-order-from-session"

const RECOVERY_REASON = "MANUAL_RECOVERY_REQUIRES_CONTRACT_REVIEW"
const TERMINAL_OR_SETTLED = new Set(["PAID", "PAID_RECOVERY_REQUIRED", "CANCELLED", "REFUNDED"])

async function main() {
  const args = new Set(process.argv.slice(2))
  const sessionId = process.argv.slice(2).find((arg) => arg.startsWith("cs_"))
  if (!sessionId) throw new Error("Pass one Stripe Checkout Session ID")

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is required")

  const apply = args.has("--apply")
  if (apply) {
    if (!args.has("--i-have-approval")) throw new Error("Apply requires --i-have-approval")
    if (process.env.OT_ORDER_RECOVERY_CONFIRM !== sessionId) {
      throw new Error("Apply requires OT_ORDER_RECOVERY_CONFIRM to exactly match the session ID")
    }
  }

  const stripe = new Stripe(stripeKey)
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const providerOrder = otOrderFromPaidSession(session)
  const metadataOrderId = session.metadata?.orderId?.trim() || null
  const existingBySession = await prisma.oTOrder.findUnique({ where: { stripeSessionId: sessionId } })
  const existingById = metadataOrderId
    ? await prisma.oTOrder.findUnique({ where: { id: metadataOrderId } })
    : null

  if (existingBySession && existingById && existingBySession.id !== existingById.id) {
    throw new Error("Session ID and metadata orderId resolve to different OTOrder rows")
  }
  const existing = existingBySession ?? existingById
  const action = existing ? "TRANSITION_TO_RECOVERY" : "CREATE_RECOVERY"

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    action,
    sessionId,
    metadataOrderId,
    existing: existing ? { id: existing.id, status: existing.status, stripeSessionId: existing.stripeSessionId } : null,
    proposedStatus: "PAID_RECOVERY_REQUIRED",
    recoveryReason: RECOVERY_REASON,
    providerOrder,
  }, null, 2))

  if (!apply) return

  if (existing) {
    if (TERMINAL_OR_SETTLED.has(existing.status)) {
      throw new Error(`Refusing to mutate existing OTOrder in status ${existing.status}`)
    }
    const updated = await prisma.oTOrder.updateMany({
      where: {
        id: existing.id,
        status: existing.status,
        stripeSessionId: existing.stripeSessionId,
        checkoutKey: existing.checkoutKey,
        contractKey: existing.contractKey,
        attempt: existing.attempt,
        updatedAt: existing.updatedAt,
      },
      data: {
        status: "PAID_RECOVERY_REQUIRED",
        settledAmountCents: session.amount_total ?? 0,
        settledCurrency: session.currency?.toLowerCase() || "unknown",
        amountPaid: providerOrder.amountPaid,
        recoveryStripeSessionId: sessionId,
        recoveryReason: RECOVERY_REASON,
      },
    })
    if (updated.count !== 1) throw new Error("OTOrder changed before recovery persistence; rerun dry-run review")
    console.log(JSON.stringify({ written: true, id: existing.id, status: "PAID_RECOVERY_REQUIRED" }, null, 2))
    return
  }

  const written = await prisma.oTOrder.create({
    data: {
      ...providerOrder,
      status: "PAID_RECOVERY_REQUIRED",
      settledAmountCents: session.amount_total ?? 0,
      settledCurrency: session.currency?.toLowerCase() || "unknown",
      recoveryStripeSessionId: sessionId,
      recoveryReason: RECOVERY_REASON,
    },
  })
  console.log(JSON.stringify({ written: true, id: written.id, status: written.status }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
