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
      const mode = data.mode as string | undefined

      if (!userId || !plan) {
        console.error("[webhook] Missing userId or plan in metadata")
        break
      }

      const stripeCustomerId = (data.customer as string) ?? null
      const stripeSubscriptionId = (data.subscription as string) ?? null

      // One-time payment (e.g. DIY/comps-only $69)
      if (mode === "payment") {
        try {
          await prisma.user.update({
            where: { id: userId },
            data: {
              subscriptionTier: "COMPS_ONLY",
              subscriptionStatus: "ACTIVE",
              subscriptionQuantity: 1,
              stripeCustomerId: stripeCustomerId ?? undefined,
            },
          })
          console.log(`[webhook] SUCCESS: User ${userId} DIY/comps-only payment completed`)
        } catch (dbError) {
          console.error(`[webhook] Database error updating user ${userId}:`, dbError)
        }
        break
      }

      // Subscription (Starter, Growth, Portfolio) — use subscription line item quantity as source of truth when available
      let subscriptionQuantity =
        propertyCountStr != null ? Math.max(1, parseInt(propertyCountStr, 10) || 1) : null
      if (stripeSubscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
            expand: ["items.data"],
          })
          const firstItem = subscription.items?.data?.[0]
          if (firstItem?.quantity != null) {
            subscriptionQuantity = firstItem.quantity
          }
        } catch (err) {
          console.warn("[webhook] Could not fetch subscription for quantity fallback:", err)
        }
      }
      // Sum quantities across ALL subscriptions for this customer (Starter + Growth etc.) so we don't overwrite with a single subscription's quantity
      let quantityToStore = subscriptionQuantity
      if (stripeCustomerId && stripe) {
        try {
          const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "active", limit: 100 })
          const trialing = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "trialing", limit: 100 })
          const pastDue = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "past_due", limit: 100 })
          const all = [...subs.data, ...trialing.data, ...pastDue.data]
          const sum = all.reduce((acc, s) => acc + (s.items?.data?.reduce((a, i) => a + (i.quantity ?? 0), 0) ?? 0), 0)
          if (sum > 0) quantityToStore = sum
        } catch (_) {}
      }
      try {
        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionTier: plan as "STARTER" | "GROWTH" | "PORTFOLIO",
            subscriptionStatus: "ACTIVE",
            subscriptionStartDate: new Date(),
            subscriptionQuantity: quantityToStore ?? undefined,
            stripeCustomerId: stripeCustomerId ?? undefined,
            stripeSubscriptionId: stripeSubscriptionId ?? undefined,
          },
        })
        console.log(
          `[webhook] SUCCESS: User ${userId} subscribed to ${plan}, quantity=${quantityToStore}, tier=${updatedUser.subscriptionTier}`
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

        // Sum quantities across all active/trialing/past_due subscriptions for this customer (remaining subs after cancel)
        let quantityToStore: number | null = null
        if (customerId) {
          try {
            const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 100 })
            const trialing = await stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 100 })
            const pastDue = await stripe.subscriptions.list({ customer: customerId, status: "past_due", limit: 100 })
            const all = [...subs.data, ...trialing.data, ...pastDue.data]
            const sum = all.reduce((acc, s) => acc + (s.items?.data?.reduce((a, i) => a + (i.quantity ?? 0), 0) ?? 0), 0)
            quantityToStore = sum > 0 ? sum : null
          } catch (_) {}
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: newStatus,
            ...(quantityToStore != null ? { subscriptionQuantity: quantityToStore } : { subscriptionQuantity: null }),
            ...(status === "canceled" || status === "unpaid" ? { stripeSubscriptionId: null } : {}),
          },
        })
        console.log(
          `[webhook] Updated user ${user.id} status=${newStatus}${quantityToStore != null ? ` quantity=${quantityToStore}` : ""}`
        )
      } catch (err) {
        console.error("[webhook] Error processing subscription update:", err)
      }
      break
    }

    case "invoice.paid": {
      const inv = data as { metadata?: Record<string, string>; subscription?: string }
      const meta = inv.metadata ?? {}
      const subscriptionId = meta.subscriptionId
      const newQuantityStr = meta.newQuantity
      if (subscriptionId && newQuantityStr) {
        const newQuantity = parseInt(newQuantityStr, 10)
        if (newQuantity >= 1) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId)
            const itemId = sub.items.data[0]?.id
            if (itemId) {
              await stripe.subscriptions.update(subscriptionId, {
                items: [{ id: itemId, quantity: newQuantity }],
              })
              console.log(`[webhook] Updated subscription ${subscriptionId} to quantity ${newQuantity} after add-slots invoice paid`)
            }
          } catch (err) {
            console.error("[webhook] Error updating subscription after invoice.paid:", err)
          }
        }
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
