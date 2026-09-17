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
 *
 * Apply also refuses any order on SETTLEMENT_HOLD, and confirms the transition
 * by re-reading the row rather than trusting the affected-row count. Success is
 * only ever reported from what the database actually persisted.
 */
import Stripe from "stripe"
import { prisma } from "../lib/db"
import { otOrderFromPaidSession } from "../lib/billing/ot-order-from-session"

const RECOVERY_REASON = "MANUAL_RECOVERY_REQUIRES_CONTRACT_REVIEW"
/**
 * SETTLEMENT_HOLD belongs here: a held order has reversal evidence against it,
 * so staging recovery on top of it is exactly the mutation the hold exists to
 * prevent. It cannot be left to the CAS either — `ot_preserve_settlement_hold`
 * is a BEFORE UPDATE trigger that rewrites `NEW.status` instead of failing the
 * statement, so the update still reports one affected row.
 */
const TERMINAL_OR_SETTLED = new Set([
  "PAID",
  "PAID_RECOVERY_REQUIRED",
  "CANCELLED",
  "REFUNDED",
  "SETTLEMENT_HOLD",
])

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

    // A matched row is not a persisted transition. The hold trigger can rewrite
    // NEW.status while every other column in `data` still lands, which leaves a
    // held order carrying this run's recovery fields and an affected count of 1.
    // Only the row that came back out of the database may be reported.
    const persisted = await prisma.oTOrder.findUnique({ where: { id: existing.id } })
    if (
      !persisted ||
      persisted.status !== "PAID_RECOVERY_REQUIRED" ||
      persisted.recoveryStripeSessionId !== sessionId ||
      persisted.recoveryReason !== RECOVERY_REASON
    ) {
      // Deliberately no restoration: the pre-update column values are not
      // reconstructible here, and rewriting a held row is the same unsafe
      // mutation this script just refused. Hand the row to an operator instead.
      throw new Error(
        `Recovery did not persist for OTOrder ${existing.id}: status=${persisted?.status ?? "ROW_MISSING"} ` +
          `recoveryStripeSessionId=${persisted?.recoveryStripeSessionId ?? "null"} ` +
          `recoveryReason=${persisted?.recoveryReason ?? "null"}. ` +
          "The guarded update's non-status columns may have been written and are NOT rolled back. " +
          "Inspect the row and its settlement evidence before any further action.",
      )
    }

    console.log(JSON.stringify({
      written: true,
      id: persisted.id,
      status: persisted.status,
      recoveryStripeSessionId: persisted.recoveryStripeSessionId,
      recoveryReason: persisted.recoveryReason,
    }, null, 2))
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

// Running on import is the script's behaviour under `tsx`. The settled promise
// is exported only so tests can await a full run instead of racing it.
export const completed = main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
