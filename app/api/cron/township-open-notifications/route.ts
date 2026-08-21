// Cron endpoint for proactive "township appeal window opened" notifications.
// Run daily via Vercel Cron: GET /api/cron/township-open-notifications
// When a user's township window opens and they have no appeal for that year, send email.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendEmail, townshipOpenNotificationTemplate } from "@/lib/email"
import { formatPIN } from "@/lib/cook-county"
import {
  ASSESSOR_CALENDAR_URL,
  OFFICIAL_DEADLINE_SNAPSHOT,
  describeTownshipCalendar,
} from "@/lib/appeals/township-deadlines"
import { normalizeTownshipForMatch } from "@/lib/monitoring/schedule"

export const dynamic = "force-dynamic"

const TAX_YEAR = 2025

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const evaluatedAt = new Date().toISOString()

  // Which townships opened today, according to the canonical state and nothing
  // else. This used to read a hard-coded 2025 map and compare its notice dates
  // to today's date — a schedule that had been over a year out of date and
  // still decided who got mail. Now a township qualifies only if its projection
  // verifies, clears deadline email, and names today as the day the window
  // opened. Every unverified or unavailable state contributes zero sends.
  const openingToday: Array<{
    townshipKey: string
    townshipName: string
    noticeDate: string
    lastFileDate: string
  }> = []

  for (const [townshipKey, row] of Object.entries(OFFICIAL_DEADLINE_SNAPSHOT.townships ?? {})) {
    const projection = describeTownshipCalendar(row.townshipName, evaluatedAt)
    if (!projection.available || !projection.allowDeadlineEmail) continue
    if (projection.status !== "open") continue
    if (projection.openDate !== evaluatedAt.slice(0, 10)) continue
    openingToday.push({
      townshipKey,
      townshipName: row.townshipName,
      noticeDate: projection.noticeDate ?? projection.openDate,
      lastFileDate: projection.lastFileDate,
    })
  }

  if (openingToday.length === 0) {
    return NextResponse.json({
      success: true,
      emailsSent: 0,
      reason: "No townships with a verified opening today",
    })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  let sent = 0

  for (const township of openingToday) {
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
      if (!propTownshipNorm || propTownshipNorm !== township.townshipKey) continue

      // Skip if user already has an appeal for this property for this year
      if (prop.appeals.length > 0) continue

      const template = townshipOpenNotificationTemplate({
        userName: prop.user.name,
        propertyAddress: `${prop.address}, ${prop.city}, ${prop.state}`,
        pin: formatPIN(prop.pin),
        township: township.townshipName,
        taxYear: TAX_YEAR,
        noticeDate: township.noticeDate,
        lastFileDate: township.lastFileDate,
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
