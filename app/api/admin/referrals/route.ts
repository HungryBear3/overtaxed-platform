// GET /api/admin/referrals - List all referral codes with stats
// POST /api/admin/referrals - Create a new referral code
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { normalizeReferralCode } from "@/lib/referrals/code"

async function requireAdmin(request: NextRequest) {
  const session = await getSession(request)
  const isAdmin = (session?.user as { role?: string })?.role === "ADMIN"
  if (!isAdmin) throw new Error("Unauthorized")
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    const referrals = await prisma.referral.findMany({
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ referrals })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error"
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
    const { code: rawCode, name } = await request.json()
    // Same canonical validator every public referral ingress applies, so an
    // admin cannot issue a code those paths would reject. No trimming.
    const code = normalizeReferralCode(rawCode)
    if (!code) {
      return NextResponse.json(
        { error: "code must be 2-32 ASCII letters or digits, optionally joined by single hyphens" },
        { status: 400 },
      )
    }
    const referral = await prisma.referral.create({
      data: { code, name },
    })
    return NextResponse.json({ referral })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error"
    if (msg.includes("Unique")) {
      return NextResponse.json({ error: "Code already exists" }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 500 })
  }
}
