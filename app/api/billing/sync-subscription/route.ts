// POST /api/billing/sync-subscription - Refresh user's tier/quantity from Stripe (e.g. if webhook missed)
import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { stripe } from "@/lib/stripe/client"
import { prisma } from "@/lib/db"
import type { SubscriptionStatus, SubscriptionTier } from "@prisma/client"

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
    select: { id: true, email: true, stripeSubscriptionId: true, stripeCustomerId: true },
  })
  if (!user?.email) {
    return NextResponse.json(
      { error: "User email not found." },
      { status: 400 }
    )
  }

  try {
    let subscriptionId = user.stripeSubscriptionId
    let customerId = user.stripeCustomerId

    if (!subscriptionId && customerId) {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 1,
      })
      subscriptionId = subs.data[0]?.id ?? null
      if (!subscriptionId) {
        const trialed = await stripe.subscriptions.list({
          customer: customerId,
          status: "trialing",
          limit: 1,
        })
        subscriptionId = trialed.data[0]?.id ?? null
      }
    }

    if (!subscriptionId && !customerId) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 })
      customerId = customers.data[0]?.id ?? null
      if (customerId) {
        const subs = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        })
        subscriptionId = subs.data[0]?.id ?? null
        if (!subscriptionId) {
          const trialed = await stripe.subscriptions.list({
            customer: customerId,
            status: "trialing",
            limit: 1,
          })
          subscriptionId = trialed.data[0]?.id ?? null
        }
      }
    }

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "No active subscription found for this email in Stripe. Complete a checkout first, or contact support if you just paid." },
        { status: 400 }
      )
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    })
    const items = subscription.items?.data ?? []
    const knownPriceIds = [
      process.env.STRIPE_PRICE_STARTER ?? "",
      process.env.STRIPE_PRICE_GROWTH_PER_PROPERTY ?? "",
      process.env.STRIPE_PRICE_PORTFOLIO_PER_PROPERTY ?? "",
    ].filter(Boolean)
    let quantity: number | null = 0
    let plan: string | null = null
    for (const item of items) {
      const priceId = typeof item.price?.id === "string" ? item.price.id : null
      if (priceId && knownPriceIds.includes(priceId)) {
        quantity = (quantity ?? 0) + (item.quantity ?? 0)
        if (!plan) plan = getPlanFromPriceId(priceId)
      }
    }
    if (quantity === 0) quantity = items[0] ? (items[0].quantity ?? null) : null
    if (!plan && items[0]) plan = getPlanFromPriceId(typeof items[0].price?.id === "string" ? items[0].price.id : null)
    const status: SubscriptionStatus =
      subscription.status === "active" ? "ACTIVE" : subscription.status === "past_due" ? "PAST_DUE" : "INACTIVE"

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(plan != null && { subscriptionTier: plan as SubscriptionTier }),
        subscriptionStatus: status,
        subscriptionQuantity: quantity != null ? quantity : undefined,
        ...(subscription.id && !user.stripeSubscriptionId && { stripeSubscriptionId: subscription.id }),
        ...(customerId && !user.stripeCustomerId && { stripeCustomerId: customerId }),
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
