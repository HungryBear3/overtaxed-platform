// POST /api/billing/webhook - Handle Stripe webhook events
import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe/client"
import { prisma } from "@/lib/db"
import { generatePacketForInvoice } from "@/lib/packet/generate-and-deliver"
import { sendNewOrderAlert, sendOrderConfirmation } from "@/lib/email/send"

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

  // Idempotency: claim the event row before doing business work. Two changes
  // vs. the prior "check first, write later" pattern:
  //  1. We INSERT first. The unique PK on StripeEvent.id means concurrent
  //     deliveries race here, and at most one can win.
  //  2. If business work fails, we DELETE the row at the bottom so Stripe
  //     retries correctly. (See the `eventClaimed` flag near the end.)
  let eventClaimed = false
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } })
    eventClaimed = true
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === "P2002") {
      console.log(`[webhook] Duplicate event ${event.id} (${event.type}) — skipping`)
      return NextResponse.json({ received: true })
    }
    throw e
  }

  /** Release the StripeEvent claim so Stripe retries. Must be awaited before
   *  any 500 response or before rethrowing into the outer try/catch. */
  const releaseEventClaim = async () => {
    if (!eventClaimed) return
    eventClaimed = false
    try {
      await prisma.stripeEvent.delete({ where: { id: event.id } })
    } catch (err) {
      console.error(`[webhook] Failed to release StripeEvent claim ${event.id}:`, err)
    }
  }

  const data = event.data.object as unknown as Record<string, unknown>
  const metadata = (data.metadata ?? {}) as Record<string, string | undefined>

  switch (event.type) {
    case "checkout.session.completed": {
      console.log("[webhook] Processing checkout.session.completed")
      const invoiceId = metadata.invoiceId
      if (invoiceId) {
        // Required business work for an invoiceId-driven one-time payment:
        //   1. Mark the Invoice PAID (paidAt, paymentMethod).
        //   2. For COMPS_ONLY: persist the user-state side effects (tier patch
        //      or stripeCustomerId backfill) — these are required because the
        //      account UI and invoice-history surfaces depend on them.
        //
        // Any failure across these required writes must release the StripeEvent
        // claim and return 500 so Stripe retries. The packet generation handoff
        // itself is fire-and-forget by design — its idempotent atomic claim
        // (NOT_STARTED → GENERATING) is the right retry surface for the
        // generation step, and its failures are captured on Invoice.packetStatus
        // / packetLastError, NOT on the Stripe event. We trigger it AFTER the
        // required writes succeed.
        let isCompsOnlyTrigger = false
        try {
          const updated = await prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: "PAID", paidAt: new Date(), paymentMethod: "credit_card" },
          })
          console.log(`[webhook] Marked invoice ${invoiceId} as PAID (type=${updated.invoiceType})`)

          if (updated.invoiceType === "COMPS_ONLY" && updated.userId) {
            // One-off packet purchases must NOT downgrade an existing recurring
            // subscription (STARTER / GROWTH / PORTFOLIO / PERFORMANCE).
            const existing = await prisma.user.findUnique({
              where: { id: updated.userId },
              select: { subscriptionTier: true, stripeCustomerId: true },
            })
            const stronger = new Set([
              "STARTER",
              "GROWTH",
              "PORTFOLIO",
              "PERFORMANCE",
            ])
            const hasStrongerPlan = existing?.subscriptionTier
              ? stronger.has(existing.subscriptionTier as string)
              : false

            if (hasStrongerPlan) {
              if (!existing?.stripeCustomerId && (data.customer as string)) {
                await prisma.user.update({
                  where: { id: updated.userId },
                  data: { stripeCustomerId: (data.customer as string) },
                })
              }
            } else {
              await prisma.user.update({
                where: { id: updated.userId },
                data: {
                  subscriptionTier: "COMPS_ONLY",
                  subscriptionStatus: "ACTIVE",
                  subscriptionQuantity: 1,
                  stripeCustomerId: ((data.customer as string) ?? null) ?? undefined,
                },
              })
            }
            isCompsOnlyTrigger = true
          }
        } catch (err) {
          console.error(
            `[webhook] CRITICAL: invoiceId branch failed for ${invoiceId}; releasing claim so Stripe retries:`,
            err,
          )
          await releaseEventClaim()
          return NextResponse.json({ error: "Database error" }, { status: 500 })
        }

        // Required writes committed. Trigger the packet engine for COMPS_ONLY only.
        if (isCompsOnlyTrigger) {
          generatePacketForInvoice(invoiceId).catch((err) =>
            console.error(`[webhook] packet generation trigger failed for ${invoiceId}:`, err),
          )
        }
        break
      }

      // New billing overhaul path: T1/T2/T3 one-time tier purchases
      // These sessions come from /api/checkout/session and carry {tier, propertyPin}
      // without a userId (anonymous checkout). Notify ops; T1 can auto-generate a packet.
      if (metadata.tier) {
        const tier = metadata.tier
        const propertyPin = metadata.propertyPin ?? ""
        const customerDetails = data.customer_details as Record<string, unknown> | null
        const customerEmail = (customerDetails?.email as string) ?? ""
        const customerName = (customerDetails?.name as string) ?? ""
        const amountPaid = ((data.amount_total as number) ?? 0) / 100
        const sessionId = (data.id as string) ?? ""

        const customerAddress = metadata.customerAddress ?? ""
        console.log(`[webhook] New ${tier} order — ${customerEmail} — $${amountPaid} — session ${sessionId}`)

        sendNewOrderAlert({ tier, customerEmail, customerName, propertyPin: propertyPin || customerAddress, amountPaid, sessionId }).catch((err) =>
          console.error("[webhook] sendNewOrderAlert failed:", err),
        )

        if (customerEmail) {
          sendOrderConfirmation({ tier, customerEmail, customerName, address: customerAddress || propertyPin || undefined, amountPaid }).catch((err) =>
            console.error("[webhook] sendOrderConfirmation failed:", err),
          )
        }
        break
      }

      const userId = metadata.userId
      const plan = metadata.plan
      const propertyCountStr = metadata.propertyCount
      const referralCode = metadata.referralCode
      const mode = data.mode as string | undefined

      if (!userId || !plan) {
        console.error("[webhook] Missing userId or plan in metadata")
        break
      }

      // Track referral conversion — guard against double-counting on webhook replay
      if (referralCode) {
        try {
          const amountTotal = (data.amount_total as number | null) ?? 0
          const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } })
          const alreadyTracked = existingUser?.referralCode === referralCode
          if (!alreadyTracked) {
            await prisma.referral.upsert({
              where: { code: referralCode },
              update: {
                conversions: { increment: 1 },
                revenue: { increment: amountTotal / 100 },
              },
              create: { code: referralCode, conversions: 1, revenue: amountTotal / 100 },
            })
            await prisma.user.update({
              where: { id: userId },
              data: { referralCode },
            })
            console.log(`[webhook] Referral conversion tracked: code=${referralCode} user=${userId}`)
          } else {
            console.log(`[webhook] Referral already tracked for user=${userId}, skipping`)
          }
        } catch (refErr) {
          console.error("[webhook] Referral tracking error:", refErr)
        }
      }

      const stripeCustomerId = (data.customer as string) ?? null
      const stripeSubscriptionId = (data.subscription as string) ?? null

      // One-time payment: add-slots (update existing subscription) or DIY/comps-only
      if (mode === "payment") {
        const addSlots = metadata.addSlots === "true"
        const subscriptionId = metadata.subscriptionId
        const newQuantityStr = metadata.newQuantity

        if (addSlots && subscriptionId && newQuantityStr) {
          const newQuantity = parseInt(newQuantityStr, 10)
          if (newQuantity >= 1 && stripe) {
            try {
              const sub = await stripe.subscriptions.retrieve(subscriptionId)
              const customerId = sub.customer as string
              const itemId = sub.items.data[0]?.id
              if (itemId) {
                await stripe.subscriptions.update(subscriptionId, {
                  items: [{ id: itemId, quantity: newQuantity }],
                })
                // Store total slots: use propertyCount from metadata (add-slots sends new total); else sum all subscriptions
                const propertyCountStr = metadata.propertyCount
                let totalSlots: number | null = propertyCountStr ? parseInt(propertyCountStr, 10) : null
                if (totalSlots == null || totalSlots < 1) {
                  totalSlots = null
                  if (customerId) {
                    try {
                      const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 100 })
                      const trialing = await stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 100 })
                      const pastDue = await stripe.subscriptions.list({ customer: customerId, status: "past_due", limit: 100 })
                      const all = [...subs.data, ...trialing.data, ...pastDue.data]
                      const sum = all.reduce((acc, s) => acc + (s.items?.data?.reduce((a, i) => a + (i.quantity ?? 0), 0) ?? 0), 0)
                      if (sum > 0) totalSlots = sum
                    } catch (_) {}
                  }
                }
                await prisma.user.update({
                  where: { id: userId },
                  data: { subscriptionQuantity: totalSlots ?? newQuantity },
                })
                console.log(`[webhook] Add-slots: updated subscription ${subscriptionId} to quantity ${newQuantity}, total slots=${totalSlots ?? newQuantity}`)
              }
            } catch (err) {
              console.error("[webhook] Error updating subscription after add-slots payment:", err)
            }
          }
        } else {
          try {
            // Don't downgrade an existing recurring plan to COMPS_ONLY on a
            // one-off purchase. Same logic as the invoiceId branch above.
            const existing = await prisma.user.findUnique({
              where: { id: userId },
              select: { subscriptionTier: true, stripeCustomerId: true },
            })
            const stronger = new Set(["STARTER", "GROWTH", "PORTFOLIO", "PERFORMANCE"])
            const hasStrongerPlan = existing?.subscriptionTier
              ? stronger.has(existing.subscriptionTier as string)
              : false
            if (hasStrongerPlan) {
              if (!existing?.stripeCustomerId && stripeCustomerId) {
                await prisma.user.update({
                  where: { id: userId },
                  data: { stripeCustomerId },
                })
              }
              console.log(
                `[webhook] DIY purchase: preserving recurring tier=${existing?.subscriptionTier} for user ${userId}`,
              )
            } else {
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
            }
          } catch (dbError) {
            console.error(`[webhook] Database error updating user ${userId}:`, dbError)
            await releaseEventClaim()
            return NextResponse.json({ error: "Database error" }, { status: 500 })
          }
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
        await releaseEventClaim()
        return NextResponse.json({ error: "Database error" }, { status: 500 })
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
        await releaseEventClaim()
        return NextResponse.json({ error: "Database error" }, { status: 500 })
      }
      break
    }

    case "invoice.paid": {
      const inv = data as { metadata?: Record<string, string>; subscription?: string }
      const meta = inv.metadata ?? {}
      const ourInvoiceId = meta.ourInvoiceId
      if (ourInvoiceId) {
        try {
          await prisma.invoice.update({
            where: { id: ourInvoiceId },
            data: { status: "PAID", paidAt: new Date(), paymentMethod: "credit_card" },
          })
          console.log(`[webhook] Marked invoice ${ourInvoiceId} as PAID (Performance Fee Stripe Invoice)`)
        } catch (err) {
          console.error(
            `[webhook] CRITICAL: invoice.paid failed marking ${ourInvoiceId} PAID; releasing claim so Stripe retries:`,
            err,
          )
          await releaseEventClaim()
          return NextResponse.json({ error: "Database error" }, { status: 500 })
        }
        break
      }
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

    case "payment_intent.succeeded": {
      const invoiceId = metadata.invoiceId
      if (invoiceId) {
        try {
          await prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: "PAID", paidAt: new Date(), paymentMethod: "credit_card" },
          })
          console.log(`[webhook] Marked invoice ${invoiceId} as PAID (Performance Fee)`)
        } catch (err) {
          console.error(
            `[webhook] CRITICAL: payment_intent.succeeded failed marking ${invoiceId} PAID; releasing claim so Stripe retries:`,
            err,
          )
          await releaseEventClaim()
          return NextResponse.json({ error: "Database error" }, { status: 500 })
        }
      }
      break
    }

    default:
      console.log(`[webhook] Unhandled event: ${event.type}`)
  }

  // The StripeEvent claim was taken at the top of the handler and is left in
  // place on success. Internal 500 returns above call releaseEventClaim() so
  // Stripe retries correctly.
  return NextResponse.json({ received: true })
}
