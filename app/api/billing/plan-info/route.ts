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
        select: { subscriptionTier: true, subscriptionQuantity: true },
      }),
    ])

    const tier = dbUser?.subscriptionTier ?? session.user.subscriptionTier ?? "COMPS_ONLY"
    const limit = getPropertyLimit(tier, dbUser?.subscriptionQuantity)

    // Recommend plan based on current property count (for upgrade path)
    let recommendedPlan: "STARTER" | "GROWTH" | "PORTFOLIO" | "CUSTOM" | null = null
    const targetCount = propertyCount + 1 // properties they want to add
    if (targetCount <= 2) recommendedPlan = "STARTER"
    else if (targetCount <= 9) recommendedPlan = "GROWTH"
    else if (targetCount <= 20) recommendedPlan = "PORTFOLIO"
    else recommendedPlan = "CUSTOM"

    const payload = {
      propertyCount,
      subscriptionTier: tier,
      subscriptionQuantity: dbUser?.subscriptionQuantity ?? null,
      propertyLimit: limit,
      atLimit: propertyCount >= limit && limit < 999,
      recommendedPlan,
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/48622b90-a5ef-4d61-bef0-d727777ab56e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'355d64'},body:JSON.stringify({sessionId:'355d64',location:'plan-info/route.ts:32',message:'plan-info response',data:{propertyCount,subscriptionTier:tier,subscriptionQuantity:dbUser?.subscriptionQuantity,dbTier:dbUser?.subscriptionTier,sessionTier:session?.user?.subscriptionTier},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return NextResponse.json(payload)
  } catch (error) {
    console.error("Plan info error:", error)
    return NextResponse.json({ propertyCount: 0, subscriptionTier: null, recommendedPlan: null })
  }
}
