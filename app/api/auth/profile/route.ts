// PATCH /api/auth/profile - Update name, email, or password (2.7 profile management)
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import bcrypt from "bcryptjs"
import { z } from "zod"

const profileSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters").optional(),
}).refine(
  (data) => !data.newPassword || data.currentPassword,
  { message: "Current password required to set a new password", path: ["currentPassword"] }
)

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = profileSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      )
    }

    const { name, email, currentPassword, newPassword } = parsed.data
    const userId = session.user.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true, name: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const updates: { name?: string | null; email?: string; passwordHash?: string; emailVerified?: Date | null } = {}

    if (name !== undefined) {
      updates.name = name.trim() || null
    }

    if (email !== undefined) {
      const normalized = email.trim().toLowerCase()
      if (normalized !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email: normalized } })
        if (existing) {
          return NextResponse.json({ error: "That email is already in use" }, { status: 400 })
        }
        updates.email = normalized
        updates.emailVerified = null
      }
    }

    if (newPassword) {
      if (!user.passwordHash) {
        return NextResponse.json({ error: "Account uses another sign-in method; cannot set password here." }, { status: 400 })
      }
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password is required to change password" }, { status: 400 })
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!valid) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 })
      }
      updates.passwordHash = await bcrypt.hash(newPassword, 12)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: "No changes" })
    }

    await prisma.user.update({
      where: { id: userId },
      data: updates,
    })

    return NextResponse.json({ message: "Profile updated" })
  } catch (e) {
    console.error("[profile PATCH]", e)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
