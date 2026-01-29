// POST /api/billing/webhook - Handle Stripe webhook events
import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe/client"
import { prisma } from "@/lib/db"

export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
  }

  const sig = request.headers.get("stripe-signature")
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  let event
  try {
    const body = await request.text()
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error("Webhook signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const data = event.data.object as unknown as Record<string, unknown>
  const metadata = (data.metadata ?? {}) as Record<string, string | undefined>

  switch (event.type) {
    case "checkout.session.completed": {
      const userId = metadata.userId
      const plan = metadata.plan
      if (!userId || !plan) break

      await prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionTier: plan as "STARTER" | "GROWTH" | "PORTFOLIO",
          subscriptionStatus: "ACTIVE",
          subscriptionStartDate: new Date(),
        },
      })
      console.log(`[webhook] User ${userId} subscribed to ${plan}`)
      break
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // Look up user by Stripe customer if you store stripeCustomerId
      const customerId = data.customer as string | undefined
      const status = data.status as string
      if (!customerId) break

      // Skip if you don't store stripeCustomerId – would need to map via email
      console.log(`[webhook] Subscription ${event.type} for customer ${customerId}, status=${status}`)
      break
    }

    case "invoice.payment_failed": {
      // Notify user or mark as PAST_DUE
      const customerId = data.customer as string | undefined
      console.log(`[webhook] Payment failed for customer ${customerId}`)
      break
    }

    default:
      console.log(`[webhook] Unhandled event: ${event.type}`)
  }

  return NextResponse.json({ received: true })
}
