// Cron endpoint for sending appeal deadline reminders.
// Run daily via Vercel Cron or external scheduler: GET /api/cron/deadline-reminders
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendEmail, deadlineReminderTemplate } from "@/lib/email"
import { formatPIN } from "@/lib/cook-county"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  // Simple API key auth for cron
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  // 7 days and 3 days thresholds
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // Find appeals with deadlines in next 7 days and still DRAFT or PENDING_FILING
  const appeals = await prisma.appeal.findMany({
    where: {
      status: { in: ["DRAFT", "PENDING_FILING"] },
      filingDeadline: { lte: sevenDays, gte: now },
    },
    include: {
      user: { select: { email: true, name: true } },
      property: { select: { pin: true, address: true, city: true, state: true } },
    },
  })

  let sent = 0
  for (const appeal of appeals) {
    const diff = appeal.filingDeadline.getTime() - now.getTime()
    const daysRemaining = Math.ceil(diff / (24 * 60 * 60 * 1000))

    // Send if 7 days or 3 days (not every day to avoid spam)
    if (daysRemaining !== 7 && daysRemaining !== 3 && daysRemaining !== 1) continue

    const link = `${process.env.NEXT_PUBLIC_APP_URL}/appeals/${appeal.id}`
    const template = deadlineReminderTemplate({
      userEmail: appeal.user.email,
      userName: appeal.user.name,
      propertyAddress: `${appeal.property.address}, ${appeal.property.city}, ${appeal.property.state}`,
      pin: formatPIN(appeal.property.pin),
      taxYear: appeal.taxYear,
      deadline: appeal.filingDeadline,
      daysRemaining,
      appealLink: link,
    })

    const ok = await sendEmail({
      to: appeal.user.email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    })
    if (ok) sent++
  }

  return NextResponse.json({ success: true, emailsSent: sent })
}
