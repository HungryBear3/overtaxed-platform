import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { verifyPasswordResetToken } from "@/lib/auth/reset-token"
import { z } from "zod"

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      )
    }

    const { token, newPassword } = parsed.data
    const payload = verifyPasswordResetToken(token)
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired reset link. Please request a new one." },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: payload.email },
      select: { id: true, email: true },
    })
    if (!user) {
      return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    })

    return NextResponse.json({ message: "Password updated. You can sign in with your new password." })
  } catch (e) {
    console.error("[reset-password]", e)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
