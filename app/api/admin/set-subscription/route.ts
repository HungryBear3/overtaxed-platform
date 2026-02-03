// POST /api/admin/set-subscription - Manually set user subscription tier (for testing)
// IMPORTANT: This endpoint is for testing purposes only.
// In production, use a secure admin authentication mechanism.
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { z } from "zod"

const schema = z.object({
  email: z.string().email().optional(),
  userId: z.string().optional(),
  subscriptionTier: z.enum(["COMPS_ONLY", "STARTER", "GROWTH", "PORTFOLIO", "PERFORMANCE"]),
  subscriptionStatus: z.enum(["INACTIVE", "ACTIVE", "PAST_DUE", "CANCELLED"]).default("ACTIVE"),
  /** Optional: cap slots by quantity paid. When set, effective limit = this value; when null, limit = tier default. */
  subscriptionQuantity: z.number().int().min(0).nullable().optional(),
})

export async function POST(request: NextRequest) {
  try {
    // Check if admin secret is configured and provided
    const adminSecret = process.env.ADMIN_SECRET
    const providedSecret = request.headers.get("x-admin-secret")
    
    // In development, also allow if user is logged in as ADMIN role
    const session = await getSession(request)
    const isAdmin = session?.user?.role === "ADMIN"
    
    // Verify authorization
    if (!adminSecret && !isAdmin) {
      return NextResponse.json(
        { error: "Admin endpoint not configured. Set ADMIN_SECRET in Vercel (Settings → Environment Variables) for this environment." },
        { status: 503 }
      )
    }

    const isAuthorized = (adminSecret && providedSecret === adminSecret) || isAdmin
    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Unauthorized. Provide valid x-admin-secret header (must match ADMIN_SECRET in Vercel) or be logged in as ADMIN." },
        { status: 401 }
      )
    }

    const body = await request.json()
    const parsed = schema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { email, userId, subscriptionTier, subscriptionStatus, subscriptionQuantity } = parsed.data

    if (!email && !userId) {
      return NextResponse.json(
        { error: "Provide either email or userId" },
        { status: 400 }
      )
    }

    // Find user (build where so Prisma gets string, not string | undefined)
    const where = email ? { email } : userId ? { id: userId } : undefined
    if (!where) {
      return NextResponse.json(
        { error: "Provide either email or userId" },
        { status: 400 }
      )
    }
    const user = await prisma.user.findFirst({
      where,
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      )
    }

    // Update subscription (subscriptionQuantity caps slots when set; null = use tier default)
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionTier,
        subscriptionStatus,
        subscriptionStartDate: subscriptionStatus === "ACTIVE" ? new Date() : user.subscriptionStartDate,
        ...(subscriptionQuantity !== undefined && { subscriptionQuantity }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionStartDate: true,
        subscriptionQuantity: true,
      },
    })

    console.log(
      `[admin] Set subscription for user ${user.email}: ${subscriptionTier} (${subscriptionStatus})${subscriptionQuantity != null ? ` quantity=${subscriptionQuantity}` : ""}`
    )

    return NextResponse.json({
      success: true,
      message: `Updated subscription for ${user.email}`,
      user: updatedUser,
    })
  } catch (error) {
    console.error("Admin set-subscription error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json(
      { error: "Internal server error", details: process.env.NODE_ENV === "development" ? message : undefined },
      { status: 500 }
    )
  }
}

// GET /api/admin/set-subscription - Get current subscription info
export async function GET(request: NextRequest) {
  try {
    const adminSecret = process.env.ADMIN_SECRET
    const providedSecret = request.headers.get("x-admin-secret")
    
    const session = await getSession(request)
    const isAdmin = session?.user?.role === "ADMIN"
    
    const isAuthorized = (adminSecret && providedSecret === adminSecret) || isAdmin
    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const email = searchParams.get("email")
    const userId = searchParams.get("userId")

    if (!email && !userId) {
      // Return all users with subscription info
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          subscriptionTier: true,
          subscriptionStatus: true,
          subscriptionStartDate: true,
          _count: { select: { properties: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
      return NextResponse.json({ users })
    }

    const where = email ? { email } : userId ? { id: userId } : undefined
    if (!where) {
      return NextResponse.json({ error: "Provide either email or userId" }, { status: 400 })
    }
    const user = await prisma.user.findFirst({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionStartDate: true,
        subscriptionQuantity: true,
        _count: { select: { properties: true } },
      },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({ user })
  } catch (error) {
    console.error("Admin get-subscription error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
