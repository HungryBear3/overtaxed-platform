// POST /api/billing/checkout - Create Stripe checkout session for a subscription plan
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { stripe, PRICE_IDS } from "@/lib/stripe/client"
import {
  GROWTH_MIN_PROPERTIES,
  GROWTH_MAX_PROPERTIES,
  GROWTH_PRICE_PER_PROPERTY,
  PORTFOLIO_MIN_PROPERTIES,
  PORTFOLIO_MAX_PROPERTIES,
  PORTFOLIO_PRICE_PER_PROPERTY,
  requiresCustomPricing,
} from "@/lib/billing/pricing"
import { z } from "zod"

const schema = z.object({
  plan: z.enum(["STARTER", "GROWTH", "PORTFOLIO"]),
  propertyCount: z.number().int().min(1).optional(), // Optional: if not provided, use user's current count
})

export async function POST(request: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
    }

    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionQuantity: true,
      },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Get property count (from request or user's current count)
    const propertyCount = parsed.data.propertyCount ?? await prisma.property.count({ where: { userId: user.id } })
    let currentQty = user.subscriptionQuantity ?? 0
    // If DB quantity is 0 but we have a subscription, use Stripe's quantity so "add slots" path works
    if (currentQty === 0 && user.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId)
        const q = sub.items.data[0]?.quantity
        if (typeof q === "number") currentQty = q
      } catch {
        // ignore
      }
    }

    // Require Starter before first Growth; allow existing Growth to add more. Same for Portfolio.
    const currentTier = user.subscriptionTier ?? "COMPS_ONLY"
    if (parsed.data.plan === "GROWTH") {
      const allowedFromStarterOrGrowth = currentTier === "STARTER" || currentTier === "GROWTH"
      if (!allowedFromStarterOrGrowth) {
        return NextResponse.json(
          {
            error:
              "You must subscribe to Starter (1–2 properties) first before upgrading to Growth. Please choose Starter on the pricing page.",
          },
          { status: 400 }
        )
      }
    }
    if (parsed.data.plan === "PORTFOLIO") {
      const allowedFromGrowthOrPortfolio = currentTier === "GROWTH" || currentTier === "PORTFOLIO"
      if (!allowedFromGrowthOrPortfolio) {
        return NextResponse.json(
          {
            error:
              "You must be on Growth and use all 9 Growth slots before upgrading to Portfolio. Subscribe to Starter first, then Growth (1–9 properties).",
          },
          { status: 400 }
        )
      }
      // First-time upgrade to Portfolio: require 9 Growth slots used
      if (currentTier === "GROWTH" && propertyCount < GROWTH_MAX_PROPERTIES) {
        return NextResponse.json(
          {
            error: `Portfolio is available after you use all 9 Growth slots. You have ${propertyCount} properties. Add more properties on Growth first, then upgrade to Portfolio.`,
          },
          { status: 400 }
        )
      }
    }

    // Check for custom pricing requirement
    if (requiresCustomPricing(propertyCount)) {
      return NextResponse.json(
        { error: "Properties beyond 20 require custom pricing. Please contact us." },
        { status: 400 }
      )
    }

    // Select Stripe price ID and quantity based on plan
    // When upgrading to a higher tier with fewer properties, allow subscription at minimum quantity
    // so users can "grow into" the plan (e.g. 2 properties -> upgrade to Growth at 3-property minimum)
    let priceId: string | undefined
    let quantity: number = 1

    if (parsed.data.plan === "STARTER") {
      priceId = PRICE_IDS.STARTER
      quantity = Math.min(Math.max(propertyCount, 1), 2) // 1-2 properties only
    } else if (parsed.data.plan === "GROWTH") {
      if (propertyCount > GROWTH_MAX_PROPERTIES) {
        return NextResponse.json(
          { error: `Growth is for 1–9 properties. You selected ${propertyCount}. Choose Portfolio (1–20) or contact us for 20+.` },
          { status: 400 }
        )
      }
      priceId = PRICE_IDS.GROWTH_PER_PROPERTY
      quantity = Math.max(propertyCount, GROWTH_MIN_PROPERTIES)
      quantity = Math.min(quantity, GROWTH_MAX_PROPERTIES)
    } else if (parsed.data.plan === "PORTFOLIO") {
      if (propertyCount > PORTFOLIO_MAX_PROPERTIES) {
        return NextResponse.json(
          { error: "Portfolio is for up to 20 properties. Contact us for custom pricing." },
          { status: 400 }
        )
      }
      priceId = PRICE_IDS.PORTFOLIO_PER_PROPERTY
      quantity = Math.max(propertyCount, PORTFOLIO_MIN_PROPERTIES)
      quantity = Math.min(quantity, PORTFOLIO_MAX_PROPERTIES)
    }

    if (!priceId) {
      return NextResponse.json({ error: "Price not configured for this plan" }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

    // If user has a Stripe customer ID that was deleted in Stripe, clear it so checkout uses customer_email (new customer)
    let customerIdForCheckout: string | null = user.stripeCustomerId
    if (user.stripeCustomerId) {
      try {
        await stripe.customers.retrieve(user.stripeCustomerId)
      } catch {
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: null, stripeSubscriptionId: null, subscriptionQuantity: null },
        })
        customerIdForCheckout = null
      }
    }

    // When adding slots to existing Growth or Portfolio subscription, update subscription instead of new checkout (prorated charge for additional only)
    const isAddingSlots =
      parsed.data.plan === "GROWTH" &&
      currentTier === "GROWTH" &&
      propertyCount > currentQty &&
      currentQty > 0 &&
      user.stripeSubscriptionId
    const isAddingPortfolioSlots =
      parsed.data.plan === "PORTFOLIO" &&
      currentTier === "PORTFOLIO" &&
      propertyCount > currentQty &&
      currentQty > 0 &&
      user.stripeSubscriptionId

    // Add slots: create invoice for proration only; subscription is updated in webhook on invoice.paid (so we don't show 10 slots before payment)
    if ((isAddingSlots || isAddingPortfolioSlots) && user.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId)
        const customerId = sub.customer as string
        const additionalSlots = quantity - currentQty
        const pricePerSlotCents =
          parsed.data.plan === "GROWTH"
            ? GROWTH_PRICE_PER_PROPERTY * 100
            : PORTFOLIO_PRICE_PER_PROPERTY * 100
        const amountCents = additionalSlots * pricePerSlotCents
        // Create draft invoice first so the line item is attached to it (otherwise pending items can end up on subscription's next invoice → $0)
        const invoice = await stripe.invoices.create({
          customer: customerId,
          collection_method: "charge_automatically",
          metadata: {
            userId: user.id,
            subscriptionId: user.stripeSubscriptionId,
            newQuantity: String(quantity),
            plan: parsed.data.plan,
          },
        })
        await stripe.invoiceItems.create({
          customer: customerId,
          invoice: invoice.id,
          amount: amountCents,
          currency: "usd",
          description: `Additional ${additionalSlots} slot(s) — ${parsed.data.plan} (prorated)`,
        })
        const finalized = await stripe.invoices.finalizeInvoice(invoice.id)
        const payUrl =
          finalized.hosted_invoice_url ||
          finalized.invoice_pdf ||
          `${appUrl}/account?checkout=success&slots_added=1`
        return NextResponse.json({ url: payUrl })
      } catch (err) {
        console.error("Add-slots invoice error:", err)
        return NextResponse.json(
          { error: "Could not create invoice. Please try again or contact support." },
          { status: 500 }
        )
      }
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(customerIdForCheckout
        ? { customer: customerIdForCheckout }
        : { customer_email: user.email }),
      line_items: [{ price: priceId, quantity }],
      success_url: `${appUrl}/account?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
      metadata: {
        userId: user.id,
        plan: parsed.data.plan,
        propertyCount: String(quantity), // Use quantity charged (e.g. Starter capped at 2), not client request
      },
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error) {
    console.error("Checkout error:", error)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
