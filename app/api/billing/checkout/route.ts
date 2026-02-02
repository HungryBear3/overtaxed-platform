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

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Get property count (from request or user's current count)
    const propertyCount = parsed.data.propertyCount ?? await prisma.property.count({ where: { userId: user.id } })

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
          { error: `You have ${propertyCount} properties. Growth is for 3–9. Choose Portfolio (10–20) or contact us for 20+.` },
          { status: 400 }
        )
      }
      priceId = PRICE_IDS.GROWTH_PER_PROPERTY
      // Allow upgrade: charge for at least minimum (3), up to actual count or max (9)
      quantity = Math.max(propertyCount, GROWTH_MIN_PROPERTIES)
      quantity = Math.min(quantity, GROWTH_MAX_PROPERTIES)
    } else if (parsed.data.plan === "PORTFOLIO") {
      if (propertyCount > 20) {
        return NextResponse.json(
          { error: "Portfolio is for up to 20 properties. Contact us for custom pricing." },
          { status: 400 }
        )
      }
      priceId = PRICE_IDS.PORTFOLIO_PER_PROPERTY
      // Allow upgrade: charge for at least minimum (10), up to actual count or max (20)
      quantity = Math.max(propertyCount, PORTFOLIO_MIN_PROPERTIES)
      quantity = Math.min(quantity, PORTFOLIO_MAX_PROPERTIES)
    }

    if (!priceId) {
      return NextResponse.json({ error: "Price not configured for this plan" }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      line_items: [{ price: priceId, quantity }],
      success_url: `${appUrl}/account?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
      metadata: {
        userId: user.id,
        plan: parsed.data.plan,
        propertyCount: String(propertyCount),
      },
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error) {
    console.error("Checkout error:", error)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
