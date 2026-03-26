import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()
    if (!code || typeof code !== "string") {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    await prisma.referral.upsert({
      where: { code },
      update: { visits: { increment: 1 } },
      create: { code, visits: 1 },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
