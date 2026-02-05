// POST /api/billing/checkout - Create Stripe checkout session for a subscription plan
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { stripe, PRICE_IDS } from "@/lib/stripe/client"
import {
  GROWTH_MIN_PROPERTIES,
  GROWTH_MAX_PROPERTIES,
  PORTFOLIO_MIN_PROPERTIES,
  PORTFOLIO_MAX_PROPERTIES,
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
      select: { id: true, email: true, subscriptionTier: true, subscriptionStatus: true, stripeCustomerId: true, subscriptionQuantity: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "checkout/route.ts:POST", message: "checkout incoming", data: { plan: parsed.data.plan, propertyCountFromBody: parsed.data.propertyCount, userTier: user.subscriptionTier, userSubscriptionQuantity: user.subscriptionQuantity }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H2-H5" }) }).catch(() => {})
    // #endregion

    // Get property count (from request or user's current count)
    const propertyCount = parsed.data.propertyCount ?? await prisma.property.count({ where: { userId: user.id } })

    // Require Starter before Growth; require Growth with all slots used before Portfolio
    const currentTier = user.subscriptionTier ?? "COMPS_ONLY"
    if (parsed.data.plan === "GROWTH") {
      if (currentTier !== "STARTER") {
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
      if (currentTier !== "GROWTH") {
        return NextResponse.json(
          {
            error:
              "You must be on Growth and use all 9 Growth slots before upgrading to Portfolio. Subscribe to Starter first, then Growth (1–9 properties).",
          },
          { status: 400 }
        )
      }
      if (propertyCount < GROWTH_MAX_PROPERTIES) {
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

    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "checkout/route.ts:quantity", message: "stripe quantity", data: { plan: parsed.data.plan, quantitySentToStripe: quantity, propertyCount }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H5" }) }).catch(() => {})
    // #endregion

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
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
