/**
 * Recover one paid live Stripe Checkout Session that is missing its OTOrder row.
 *
 * Dry run:
 *   npx tsx scripts/recover-paid-ot-order.ts cs_live_...
 *
 * Apply (all three gates required):
 *   OT_ORDER_RECOVERY_CONFIRM=cs_live_... npx tsx scripts/recover-paid-ot-order.ts \
 *     cs_live_... --apply --i-have-approval
 *
 * This script creates/updates only OTOrder. It does not email, refund, charge,
 * create an appeal/packet, or mutate Stripe.
 */
import Stripe from "stripe"
import { prisma } from "../lib/db"
import { otOrderFromPaidSession } from "../lib/billing/ot-order-from-session"

async function main() {
  const args = new Set(process.argv.slice(2))
  const sessionId = process.argv.slice(2).find((arg) => arg.startsWith("cs_"))
  if (!sessionId) throw new Error("Pass one Stripe Checkout Session ID")

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is required")

  const apply = args.has("--apply")
  if (apply) {
    if (!args.has("--i-have-approval")) {
      throw new Error("Apply requires --i-have-approval")
    }
    if (process.env.OT_ORDER_RECOVERY_CONFIRM !== sessionId) {
      throw new Error("Apply requires OT_ORDER_RECOVERY_CONFIRM to exactly match the session ID")
    }
  }

  const stripe = new Stripe(stripeKey)
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const order = otOrderFromPaidSession(session)
  const existing = await prisma.oTOrder.findUnique({
    where: { stripeSessionId: sessionId },
  })

  console.log(
    JSON.stringify(
      {
        mode: apply ? "APPLY" : "DRY_RUN",
        action: existing ? "UPDATE" : "CREATE",
        order,
      },
      null,
      2,
    ),
  )

  if (!apply) return

  const written = await prisma.oTOrder.upsert({
    where: { stripeSessionId: sessionId },
    update: order,
    create: order,
  })
  console.log(JSON.stringify({ written: true, id: written.id, status: written.status }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
