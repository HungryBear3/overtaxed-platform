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
    let customerId = user.stripeCustomerId

    if (!customerId) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 })
      customerId = customers.data[0]?.id ?? null
    }

    if (!customerId) {
      return NextResponse.json(
        { error: "No Stripe customer found for this email. Complete a checkout first." },
        { status: 400 }
      )
    }

    const knownPriceIds = [
      process.env.STRIPE_PRICE_STARTER ?? "",
      process.env.STRIPE_PRICE_GROWTH_PER_PROPERTY ?? "",
      process.env.STRIPE_PRICE_PORTFOLIO_PER_PROPERTY ?? "",
    ].filter(Boolean)
    const tierRank: Record<string, number> = { STARTER: 1, GROWTH: 2, PORTFOLIO: 3 }

    const [activeSubs, trialedSubs, pastDueSubs] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, status: "active", limit: 100 }),
      stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 100 }),
      stripe.subscriptions.list({ customer: customerId, status: "past_due", limit: 100 }),
    ])
    const allSubs = [...activeSubs.data, ...trialedSubs.data, ...pastDueSubs.data]

    if (allSubs.length === 0) {
      return NextResponse.json(
        { error: "No active subscription found for this email in Stripe. Complete a checkout first, or contact support if you just paid." },
        { status: 400 }
      )
    }

    let totalQuantity = 0
    let bestPlan: string | null = null
    let bestStatus: SubscriptionStatus = "INACTIVE"
    let primarySubscriptionId: string | null = user.stripeSubscriptionId ?? allSubs[0]?.id ?? null

    for (const sub of allSubs) {
      const expanded = await stripe.subscriptions.retrieve(sub.id, { expand: ["items.data.price"] })
      const items = expanded.items?.data ?? []
      for (const item of items) {
        const priceId = typeof item.price?.id === "string" ? item.price.id : null
        const qty = item.quantity ?? 0
        totalQuantity += qty
        if (priceId && knownPriceIds.includes(priceId)) {
          const plan = getPlanFromPriceId(priceId)
          if (plan && (bestPlan == null || (tierRank[plan] ?? 0) > (tierRank[bestPlan] ?? 0))) {
            bestPlan = plan
          }
        } else if (!bestPlan && qty > 0) {
          bestPlan = getPlanFromPriceId(priceId) ?? "STARTER"
        }
      }
      if (expanded.status === "active" && bestStatus !== "ACTIVE") bestStatus = "ACTIVE"
      else if (expanded.status === "past_due" && bestStatus !== "ACTIVE") bestStatus = "PAST_DUE"
    }

    if (!bestPlan && allSubs[0]) {
      const fallback = await stripe.subscriptions.retrieve(allSubs[0].id, { expand: ["items.data.price"] })
      const firstItem = fallback.items?.data?.[0]
      if (firstItem) bestPlan = getPlanFromPriceId(typeof firstItem.price?.id === "string" ? firstItem.price.id : null) ?? "STARTER"
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(bestPlan != null && { subscriptionTier: bestPlan as SubscriptionTier }),
        subscriptionStatus: bestStatus,
        subscriptionQuantity: totalQuantity,
        ...(primarySubscriptionId && !user.stripeSubscriptionId && { stripeSubscriptionId: primarySubscriptionId }),
        ...(customerId && !user.stripeCustomerId && { stripeCustomerId: customerId }),
      },
    })

    return NextResponse.json({
      ok: true,
      subscriptionQuantity: totalQuantity,
      subscriptionTier: bestPlan,
      subscriptionStatus: bestStatus,
      subscriptionCount: allSubs.length,
    })
  } catch (err) {
    console.error("[sync-subscription] Error:", err)
    return NextResponse.json({ error: "Could not sync subscription from Stripe" }, { status: 500 })
  }
}
