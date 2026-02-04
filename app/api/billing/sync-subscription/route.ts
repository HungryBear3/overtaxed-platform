// POST /api/billing/sync-subscription - Refresh user's tier/quantity from Stripe (e.g. if webhook missed)
import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { stripe } from "@/lib/stripe/client"
import { prisma } from "@/lib/db"

function getPlanFromPriceId(priceId: string | null): string | null {
  if (!priceId) return null
  const m: Record<string, string> = {
    [process.env.STRIPE_PRICE_STARTER ?? ""]: "STARTER",
    [process.env.STRIPE_PRICE_GROWTH_PER_PROPERTY ?? ""]: "GROWTH",
    [process.env.STRIPE_PRICE_PORTFOLIO_PER_PROPERTY ?? ""]: "PORTFOLIO",
  }
  return m[priceId] ?? null
}

export async function POST(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token",
  })
  if (!token?.sub) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  if (!stripe) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 500 })
  }

  const user = await prisma.user.findUnique({
    where: { id: token.sub },
    select: { id: true, stripeSubscriptionId: true, stripeCustomerId: true },
  })
  if (!user?.stripeSubscriptionId) {
    return NextResponse.json(
      { error: "No subscription linked. Complete a checkout first, or contact support if you just paid." },
      { status: 400 }
    )
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
      expand: ["items.data.price"],
    })
    const firstItem = subscription.items?.data?.[0]
    const quantity = firstItem?.quantity ?? null
    const priceId = typeof firstItem?.price?.id === "string" ? firstItem.price.id : null
    const plan = getPlanFromPriceId(priceId)
    const status = subscription.status === "active" ? "ACTIVE" : subscription.status === "past_due" ? "PAST_DUE" : "INACTIVE"

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(plan != null && { subscriptionTier: plan }),
        subscriptionStatus: status,
        subscriptionQuantity: quantity != null ? quantity : undefined,
      },
    })

    return NextResponse.json({
      ok: true,
      subscriptionQuantity: quantity,
      subscriptionTier: plan,
      subscriptionStatus: status,
    })
  } catch (err) {
    console.error("[sync-subscription] Error:", err)
    return NextResponse.json({ error: "Could not sync subscription from Stripe" }, { status: 500 })
  }
}
