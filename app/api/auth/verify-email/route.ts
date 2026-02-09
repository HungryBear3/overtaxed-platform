// GET /api/auth/verify-email?token=... — Set emailVerified for user (2.5)
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { verifyEmailVerificationToken } from "@/lib/auth/reset-token"

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token")
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 })
    }

    const payload = verifyEmailVerificationToken(token)
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired verification link. You can request a new one from Account settings." },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: payload.email },
      select: { id: true, emailVerified: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    })

    return NextResponse.json({ message: "Email verified. You can sign in." })
  } catch (e) {
    console.error("[verify-email]", e)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
