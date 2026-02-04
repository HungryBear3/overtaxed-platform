// POST /api/admin/reset-subscription - Clear subscription and Stripe link (for testing from scratch)
// Same auth as set-subscription: x-admin-secret header or logged-in ADMIN.
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { z } from "zod"

const schema = z.object({
  email: z.string().email().optional(),
  userId: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const adminSecret = process.env.ADMIN_SECRET
    const providedSecret = request.headers.get("x-admin-secret")
    const session = await getSession(request)
    const isAdmin = session?.user?.role === "ADMIN"

    if (!adminSecret && !isAdmin) {
      return NextResponse.json(
        {
          error:
            "Admin endpoint not configured. Set ADMIN_SECRET in Vercel or be logged in as ADMIN.",
        },
        { status: 503 }
      )
    }

    const isAuthorized = (adminSecret && providedSecret === adminSecret) || isAdmin
    if (!isAuthorized) {
      return NextResponse.json(
        {
          error:
            "Unauthorized. Provide x-admin-secret header (match ADMIN_SECRET) or be logged in as ADMIN.",
        },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Provide either email or userId", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { email, userId } = parsed.data
    if (!email && !userId) {
      return NextResponse.json({ error: "Provide either email or userId" }, { status: 400 })
    }

    const where = email ? { email } : { id: userId }
    const user = await prisma.user.findFirst({ where })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionTier: "COMPS_ONLY",
        subscriptionStatus: "INACTIVE",
        subscriptionQuantity: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      },
    })

    console.log(`[admin] Reset subscription for user ${user.email} (id=${user.id})`)

    return NextResponse.json({
      success: true,
      message: `Subscription reset for ${user.email}. You can test checkout from scratch.`,
      user: { id: user.id, email: user.email },
    })
  } catch (error) {
    console.error("Admin reset-subscription error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json(
      {
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    )
  }
}
