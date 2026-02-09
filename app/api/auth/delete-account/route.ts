// POST /api/auth/delete-account - Soft-delete account and data (2.10 account deletion)
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import bcrypt from "bcryptjs"
import { z } from "zod"

const schema = z.object({
  password: z.string().min(1, "Password is required to confirm deletion"),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      )
    }

    const { password } = parsed.data
    const userId = session.user.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, email: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    if (!user.passwordHash) {
      return NextResponse.json(
        { error: "Account uses another sign-in method. Contact support to delete your account." },
        { status: 400 }
      )
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 400 })
    }

    // Soft-delete: set deletedAt (retention per PRD; cascade delete not used so data remains for compliance)
    await prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        email: `deleted-${userId.slice(-8)}@deleted.overtaxed.local`,
        name: null,
        passwordHash: null,
        image: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionTier: "COMPS_ONLY",
        subscriptionStatus: "CANCELLED",
        subscriptionQuantity: null,
        subscriptionStartDate: null,
        subscriptionEndDate: null,
        subscriptionAnniversaryDate: null,
      },
    })

    return NextResponse.json({
      message: "Account deleted. You have been signed out. We retain some data as required by law.",
    })
  } catch (e) {
    console.error("[delete-account]", e)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
