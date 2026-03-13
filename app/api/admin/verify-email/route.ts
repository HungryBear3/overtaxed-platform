// POST /api/admin/verify-email - Manually verify a user's email (for testing when SMTP not configured)
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const adminSecret = process.env.ADMIN_SECRET
    const providedSecret = request.headers.get("x-admin-secret")
    const session = await getSession(request)
    const isAdmin = session?.user?.role === "ADMIN"

    if (!adminSecret && !isAdmin) {
      return NextResponse.json(
        { error: "Admin endpoint not configured. Set ADMIN_SECRET or sign in as ADMIN." },
        { status: 503 }
      )
    }

    const isAuthorized = (adminSecret && providedSecret === adminSecret) || isAdmin
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const user = await prisma.user.updateMany({
      where: { email },
      data: { emailVerified: new Date() },
    })

    if (user.count === 0) {
      return NextResponse.json({ error: "No user found with this email" }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: `Email verified for ${email}` })
  } catch (error) {
    console.error("[admin/verify-email]", error)
    return NextResponse.json({ error: "Failed to verify email" }, { status: 500 })
  }
}
