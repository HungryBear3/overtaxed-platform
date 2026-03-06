// Cron endpoint for proactive "township appeal window opened" notifications.
// Run daily via Vercel Cron: GET /api/cron/township-open-notifications
// When a user's township window opens and they have no appeal for that year, send email.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendEmail, townshipOpenNotificationTemplate } from "@/lib/email"
import { formatPIN } from "@/lib/cook-county"
import { TOWNSHIP_DEADLINES_2025, ASSESSOR_CALENDAR_URL } from "@/lib/appeals/township-deadlines"
import { normalizeTownshipForMatch } from "@/lib/monitoring/schedule"

export const dynamic = "force-dynamic"

const TAX_YEAR = 2025

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const today = new Date().toISOString().slice(0, 10)

  // Townships whose notice date is today (window just opened)
  const townshipsOpeningToday: string[] = []
  for (const [townshipKey, dates] of Object.entries(TOWNSHIP_DEADLINES_2025)) {
    if (dates.noticeDate === today) {
      townshipsOpeningToday.push(townshipKey)
    }
  }

  if (townshipsOpeningToday.length === 0) {
    return NextResponse.json({
      success: true,
      emailsSent: 0,
      reason: "No townships opening today",
    })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  let sent = 0

  for (const townshipKey of townshipsOpeningToday) {
    const dates = TOWNSHIP_DEADLINES_2025[townshipKey]
    if (!dates) continue

    // Find properties in this township (normalized match) with monitoring enabled
    const properties = await prisma.property.findMany({
      where: {
        monitoringEnabled: true,
        township: { not: null },
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
        appeals: {
          where: { taxYear: TAX_YEAR },
          select: { id: true },
        },
      },
    })

    for (const prop of properties) {
      const propTownshipNorm = normalizeTownshipForMatch(prop.township)
      if (!propTownshipNorm || propTownshipNorm !== townshipKey) continue

      // Skip if user already has an appeal for this property for this year
      if (prop.appeals.length > 0) continue

      const townshipDisplay = townshipKey
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")

      const template = townshipOpenNotificationTemplate({
        userName: prop.user.name,
        propertyAddress: `${prop.address}, ${prop.city}, ${prop.state}`,
        pin: formatPIN(prop.pin),
        township: townshipDisplay,
        taxYear: TAX_YEAR,
        noticeDate: dates.noticeDate,
        lastFileDate: dates.lastFileDate,
        startAppealLink: `${appUrl}/appeals/new?propertyId=${prop.id}`,
        calendarUrl: ASSESSOR_CALENDAR_URL,
      })

      const ok = await sendEmail({
        to: prop.user.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
      })
      if (ok) sent++
    }
  }

  return NextResponse.json({ success: true, emailsSent: sent })
}
