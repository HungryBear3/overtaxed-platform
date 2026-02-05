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
  RETAIL_PRICE_PER_PROPERTY,
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
        const customer = await stripe.customers.retrieve(user.stripeCustomerId)
        const isDeleted = customer && typeof customer === "object" && "deleted" in customer && (customer as { deleted?: boolean }).deleted
        if (isDeleted) throw new Error("Customer deleted")
      } catch {
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: null, stripeSubscriptionId: null, subscriptionQuantity: null },
        })
        customerIdForCheckout = null
      }
    }

    // When adding slots to existing Starter, Growth, or Portfolio subscription, create invoice for additional only; subscription is updated in webhook on invoice.paid
    const isAddingStarterSlots =
      parsed.data.plan === "STARTER" &&
      currentTier === "STARTER" &&
      quantity > currentQty &&
      currentQty > 0 &&
      user.stripeSubscriptionId
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

    // Add-slots: use Checkout (one-time payment) so we get success_url/cancel_url and return to site after payment
    if ((isAddingStarterSlots || isAddingSlots || isAddingPortfolioSlots) && user.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId)
        const customerId = sub.customer as string
        const additionalSlots = quantity - currentQty
        const pricePerSlotCents =
          parsed.data.plan === "STARTER"
            ? RETAIL_PRICE_PER_PROPERTY * 100
            : parsed.data.plan === "GROWTH"
              ? GROWTH_PRICE_PER_PROPERTY * 100
              : PORTFOLIO_PRICE_PER_PROPERTY * 100
        const amountCents = additionalSlots * pricePerSlotCents
        const addSlotsSession = await stripe.checkout.sessions.create({
          mode: "payment",
          customer: customerId,
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: pricePerSlotCents,
                product_data: {
                  name: `Additional ${additionalSlots} slot(s) — ${parsed.data.plan}`,
                  description: "Prorated add-on to your current plan",
                },
              },
              quantity: additionalSlots,
            },
          ],
          success_url: `${appUrl}/account?checkout=success&slots_added=1`,
          cancel_url: `${appUrl}/pricing?checkout=cancelled`,
          metadata: {
            userId: user.id,
            plan: parsed.data.plan,
            addSlots: "true",
            subscriptionId: user.stripeSubscriptionId,
            newQuantity: String(quantity),
          },
        })
        return NextResponse.json({ url: addSlotsSession.url })
      } catch (err) {
        console.error("Add-slots checkout error:", err)
        return NextResponse.json(
          { error: "Could not create checkout. Please try again or contact support." },
          { status: 500 }
        )
      }
    }

    let checkoutSession
    try {
      checkoutSession = await stripe.checkout.sessions.create({
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
    } catch (createErr: unknown) {
      const createMsg = (createErr as { message?: string })?.message ?? ""
      if (createMsg.includes("No such customer") && user.stripeCustomerId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: null, stripeSubscriptionId: null, subscriptionQuantity: null },
        })
        return NextResponse.json(
          {
            error:
              "Your previous billing account was deleted in Stripe. We've cleared it. Please try checkout again — a new account will be created.",
          },
          { status: 400 }
        )
      }
      throw createErr
    }

    return NextResponse.json({ url: checkoutSession!.url })
  } catch (error: unknown) {
    console.error("Checkout error:", error)
    const err = error as { type?: string; message?: string; code?: string }
    const message =
      err?.message && typeof err.message === "string"
        ? err.message
        : "Failed to create checkout session. If this continues, ensure Stripe price IDs are set in your environment."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
