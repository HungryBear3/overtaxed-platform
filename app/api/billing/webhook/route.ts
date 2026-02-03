// POST /api/billing/webhook - Handle Stripe webhook events
import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe/client"
import { prisma } from "@/lib/db"

export async function POST(request: NextRequest) {
  console.log("[webhook] Received webhook request")
  
  if (!stripe) {
    console.error("[webhook] Stripe not configured")
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
  }

  const sig = request.headers.get("stripe-signature")
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  
  if (!sig) {
    console.error("[webhook] Missing stripe-signature header")
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }
  
  if (!webhookSecret) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET not configured")
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
  }

  let event
  try {
    const body = await request.text()
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
    console.log(`[webhook] Event verified: ${event.type}`)
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const data = event.data.object as unknown as Record<string, unknown>
  const metadata = (data.metadata ?? {}) as Record<string, string | undefined>

  switch (event.type) {
    case "checkout.session.completed": {
      console.log("[webhook] Processing checkout.session.completed")
      const userId = metadata.userId
      const plan = metadata.plan
      const propertyCountStr = metadata.propertyCount

      if (!userId || !plan) {
        console.error("[webhook] Missing userId or plan in metadata")
        break
      }

      const subscriptionQuantity =
        propertyCountStr != null ? Math.max(1, parseInt(propertyCountStr, 10) || 1) : null
      const stripeCustomerId = (data.customer as string) ?? null
      const stripeSubscriptionId = (data.subscription as string) ?? null

      try {
        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionTier: plan as "STARTER" | "GROWTH" | "PORTFOLIO",
            subscriptionStatus: "ACTIVE",
            subscriptionStartDate: new Date(),
            subscriptionQuantity: subscriptionQuantity ?? undefined,
            stripeCustomerId: stripeCustomerId ?? undefined,
            stripeSubscriptionId: stripeSubscriptionId ?? undefined,
          },
        })
        console.log(
          `[webhook] SUCCESS: User ${userId} subscribed to ${plan}, quantity=${subscriptionQuantity}, tier=${updatedUser.subscriptionTier}`
        )
      } catch (dbError) {
        console.error(`[webhook] Database error updating user ${userId}:`, dbError)
      }
      break
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscriptionId = data.id as string
      const customerId = data.customer as string | undefined
      const status = data.status as string
      console.log(`[webhook] Subscription ${event.type} id=${subscriptionId}, status=${status}`)

      try {
        // Find user by stored stripeSubscriptionId or by customer email
        let user = await prisma.user.findFirst({
          where: { stripeSubscriptionId: subscriptionId },
        })
        if (!user && customerId) {
          const customer = await stripe.customers.retrieve(customerId)
          if (customer && !("deleted" in customer) && customer.email) {
            user = await prisma.user.findUnique({ where: { email: customer.email } })
          }
        }
        if (!user) {
          console.log("[webhook] No user found for subscription", subscriptionId)
          break
        }

        const newStatus =
          status === "active" ? "ACTIVE" :
          status === "past_due" ? "PAST_DUE" :
          status === "canceled" ? "CANCELLED" : "INACTIVE"

        let quantity: number | null = null
        const items = (data.items as { data?: Array<{ quantity?: number }> })?.data
        if (items?.[0]?.quantity != null) quantity = items[0].quantity
        else {
          const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data"] })
          const firstItem = sub.items?.data?.[0]
          if (firstItem?.quantity != null) quantity = firstItem.quantity
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: newStatus,
            ...(quantity != null && quantity > 0 && { subscriptionQuantity: quantity }),
            ...(status === "canceled" || status === "unpaid"
              ? { subscriptionQuantity: null, stripeSubscriptionId: null }
              : {}),
          },
        })
        console.log(
          `[webhook] Updated user ${user.id} status=${newStatus}${quantity != null ? ` quantity=${quantity}` : ""}`
        )
      } catch (err) {
        console.error("[webhook] Error processing subscription update:", err)
      }
      break
    }

    case "invoice.payment_failed": {
      const customerId = data.customer as string | undefined
      console.log(`[webhook] Payment failed for customer ${customerId}`)
      
      if (customerId) {
        try {
          const customer = await stripe.customers.retrieve(customerId)
          if (customer && !('deleted' in customer) && customer.email) {
            await prisma.user.updateMany({
              where: { email: customer.email },
              data: { subscriptionStatus: "PAST_DUE" },
            })
            console.log(`[webhook] Marked user with email ${customer.email} as PAST_DUE`)
          }
        } catch (err) {
          console.error("[webhook] Error processing payment failure:", err)
        }
      }
      break
    }

    default:
      console.log(`[webhook] Unhandled event: ${event.type}`)
  }

  return NextResponse.json({ received: true })
}
