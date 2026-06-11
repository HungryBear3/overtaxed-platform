/**
 * Read-only inspection helper for the 2 paid T2 orders from 2026-06-05.
 *
 * Customer: 6712sparnell@gmail.com
 * Sessions: cs_live_a1BfP4TMuBUGZDo4oJETyIxQCs2tYZVLsh0Phq2cfZqLlESHL6MRYmeAOb ($69)
 *           cs_live_a1d0s5PxhdXBVK4W3UZpCOc7i5u6EXNZ8SN2iOwPWK8On0ZSZWXEaVseFD ($69)
 *
 * Run: npx tsx scripts/backfill-june5-orders.ts
 *
 * Safety: this script does not write to the database, send email, contact the customer,
 * or suggest a refund path. Alexy clarified these should proceed as two orders after
 * customer/property re-verification.
 */

import Stripe from "stripe"

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!

const SESSIONS = [
  "cs_live_a1BfP4TMuBUGZDo4oJETyIxQCs2tYZVLsh0Phq2cfZqLlESHL6MRYmeAOb",
  "cs_live_a1d0s5PxhdXBVK4W3UZpCOc7i5u6EXNZ8SN2iOwPWK8On0ZSZWXEaVseFD",
]

async function main() {
  const stripe = new Stripe(STRIPE_KEY)

  const orders: Array<{
    sessionId: string
    tier: string
    customerEmail: string
    customerName: string
    propertyPin: string
    amountPaid: number
    paidAt: string
    paymentStatus: string | null
  }> = []

  for (const sessionId of SESSIONS) {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    orders.push({
      sessionId,
      tier: session.metadata?.tier ?? "T2",
      customerEmail: session.customer_details?.email ?? "",
      customerName: session.customer_details?.name ?? "",
      propertyPin: session.metadata?.propertyPin ?? "",
      amountPaid: (session.amount_total ?? 0) / 100,
      paidAt: new Date(session.created * 1000).toISOString(),
      paymentStatus: session.payment_status,
    })
  }

  console.log(`\nFound ${orders.length} Stripe sessions:\n`)
  orders.forEach((o) => console.log(JSON.stringify(o, null, 2)))

  console.log("\nNext steps — manual approval/customer verification required:")
  console.log("1. Confirm whether the two paid orders map to two separate properties/appeals.")
  console.log("2. Confirm the second property address/PIN with the customer before fulfillment.")
  console.log("3. Only after approval, create/link fulfillment records or send any customer email.")
}

main().catch((err) => {
  console.error("Inspection failed:", err)
  process.exit(1)
})
