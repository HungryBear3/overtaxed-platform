import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendEmail } from "@/lib/email/send"
import { createPasswordResetToken } from "@/lib/auth/reset-token"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    })

    // Always return success to avoid email enumeration
    if (!user || !user.passwordHash) {
      return NextResponse.json({ message: "If an account exists with this email, you will receive a reset link." })
    }

    const token = createPasswordResetToken(user.email)
    const resetUrl = `${APP_URL}/auth/reset-password?token=${encodeURIComponent(token)}`

    const sent = await sendEmail({
      to: user.email,
      subject: "Reset your Overtaxed password",
      text: `You requested a password reset. Open this link to set a new password (valid for 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
      html: `<p>You requested a password reset. <a href="${resetUrl}">Click here to set a new password</a> (link valid for 1 hour).</p><p>If you didn't request this, you can ignore this email.</p>`,
    })

    if (!sent) {
      console.error("[forgot-password] Failed to send email to", user.email)
      return NextResponse.json(
        { error: "Failed to send reset email. Please try again or contact support." },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: "If an account exists with this email, you will receive a reset link." })
  } catch (e) {
    console.error("[forgot-password]", e)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
