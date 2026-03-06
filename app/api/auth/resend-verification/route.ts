// POST /api/auth/resend-verification - Resend verification email for unverified users
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendEmail } from "@/lib/email"
import { createEmailVerificationToken } from "@/lib/auth/reset-token"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true },
    })

    if (!user) {
      return NextResponse.json({ error: "No account found with this email" }, { status: 404 })
    }

    if (user.emailVerified) {
      return NextResponse.json({ error: "Email is already verified. You can sign in." }, { status: 400 })
    }

    const verifyToken = createEmailVerificationToken(email)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    const verifyUrl = `${appUrl}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`

    await sendEmail({
      to: email,
      subject: "Verify your OverTaxed IL email",
      text: `Please verify your email by opening this link (valid 24 hours):\n\n${verifyUrl}\n\nIf you didn't request this, you can ignore this email.`,
      html: `<p>Please <a href="${verifyUrl}">click here to verify your email</a> (link valid 24 hours).</p><p>If you didn't request this, you can ignore this email.</p>`,
    })

    return NextResponse.json({ success: true, message: "Verification email sent" })
  } catch (error) {
    console.error("[resend-verification]", error)
    return NextResponse.json({ error: "Failed to send verification email" }, { status: 500 })
  }
}
