import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * GET: Returns total and today's visitor count
 * POST: Increments visitor count for today (call once per session from client)
 */
export async function GET() {
  if (!process.env.DATABASE_URL?.includes("postgres")) {
    return NextResponse.json({ total: 0, today: 0 })
  }

  try {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const todayRecord = await prisma.visitorCount.findUnique({
      where: { date: today },
    })
    const allRecords = await prisma.visitorCount.findMany({
      select: { count: true },
    })

    const total = allRecords.reduce((sum, r) => sum + r.count, 0)
    const todayCount = todayRecord?.count ?? 0

    return NextResponse.json({ total, today: todayCount })
  } catch (error) {
    console.error("[visitors] GET error:", error)
    return NextResponse.json({ total: 0, today: 0 })
  }
}

export async function POST() {
  if (!process.env.DATABASE_URL?.includes("postgres")) {
    return NextResponse.json({ success: true, total: 0, today: 0 }, { status: 200 })
  }

  try {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const updated = await prisma.visitorCount.upsert({
      where: { date: today },
      update: { count: { increment: 1 } },
      create: { date: today, count: 1 },
    })

    const allRecords = await prisma.visitorCount.findMany({
      select: { count: true },
    })
    const total = allRecords.reduce((sum, r) => sum + r.count, 0)

    return NextResponse.json({
      success: true,
      total,
      today: updated.count,
    }, { status: 200 })
  } catch (error) {
    console.error("[visitors] POST error:", error)
    return NextResponse.json({ success: true, total: 0, today: 0 }, { status: 200 })
  }
}
