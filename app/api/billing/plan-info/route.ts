// GET /api/billing/plan-info - Returns user's property count and recommended plan (for pricing page)
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getPropertyLimit } from "@/lib/billing/limits"
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ propertyCount: 0, subscriptionTier: null, recommendedPlan: null })
    }

    const [propertyCount, dbUser] = await Promise.all([
      prisma.property.count({ where: { userId: session.user.id } }),
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { subscriptionTier: true },
      }),
    ])

    const tier = dbUser?.subscriptionTier ?? session.user.subscriptionTier ?? "COMPS_ONLY"
    const limit = getPropertyLimit(tier)

    // Recommend plan based on current property count (for upgrade path)
    let recommendedPlan: "STARTER" | "GROWTH" | "PORTFOLIO" | "CUSTOM" | null = null
    const targetCount = propertyCount + 1 // properties they want to add
    if (targetCount <= 5) recommendedPlan = "STARTER"
    else if (targetCount <= 9) recommendedPlan = "GROWTH"
    else if (targetCount <= 20) recommendedPlan = "PORTFOLIO"
    else recommendedPlan = "CUSTOM"

    return NextResponse.json({
      propertyCount,
      subscriptionTier: tier,
      propertyLimit: limit,
      atLimit: propertyCount >= limit && limit < 999,
      recommendedPlan,
    })
  } catch (error) {
    console.error("Plan info error:", error)
    return NextResponse.json({ propertyCount: 0, subscriptionTier: null, recommendedPlan: null })
  }
}
