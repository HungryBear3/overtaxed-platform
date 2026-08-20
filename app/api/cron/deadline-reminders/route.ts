// Cron endpoint for sending appeal deadline reminders.
// Run daily via Vercel Cron or external scheduler: GET /api/cron/deadline-reminders
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendEmail, deadlineReminderTemplate } from "@/lib/email"
import { formatPIN } from "@/lib/cook-county"
import { describeTownshipCalendar } from "@/lib/appeals/township-deadlines"
import {
  decideDeadlineReminder,
  type DeadlineReminderRefusal,
} from "@/lib/followups/schedule"

export const dynamic = "force-dynamic"

/**
 * The candidate window this cron will even look at.
 *
 * Deliberately wider than the send rule. Narrowing the query by the persisted
 * date is a convenience for the database, not a decision — the decision is made
 * per row against the canonical state below, and a row inside this window is
 * still overwhelmingly likely to produce nothing.
 */
const CANDIDATE_HORIZON_DAYS = 14

export async function GET(request: NextRequest) {
  // Fail closed. The previous guard was `if (expectedKey && ...)`, which skips
  // authorization entirely when CRON_SECRET is unset — so an unconfigured
  // deploy exposed a public GET that sent customer email.
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const evaluatedAt = now.toISOString()
  const horizon = new Date(now.getTime() + CANDIDATE_HORIZON_DAYS * 24 * 60 * 60 * 1000)

  const appeals = await prisma.appeal.findMany({
    where: {
      status: { in: ["DRAFT", "PENDING_FILING"] },
      filingDeadline: { lte: horizon, gte: now },
    },
    include: {
      user: { select: { email: true, name: true } },
      property: { select: { pin: true, address: true, city: true, state: true, township: true } },
    },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  let sent = 0
  // Counted, not listed. An operator needs to know that a morning produced no
  // mail because nothing verified, rather than because the job did not run.
  const suppressed: Partial<Record<DeadlineReminderRefusal, number>> = {}
  const refuse = (reason: DeadlineReminderRefusal) => {
    suppressed[reason] = (suppressed[reason] ?? 0) + 1
  }

  for (const appeal of appeals) {
    // The canonical evaluated state, re-derived at send time. A window verified
    // when the appeal was created can be stale, closed, or unverifiable now.
    const projection = describeTownshipCalendar(appeal.property.township, evaluatedAt)

    const decision = decideDeadlineReminder({
      projection,
      persistedDeadline: appeal.filingDeadline,
    })

    if (!decision.send) {
      refuse(decision.reason)
      continue
    }

    // Every date-bearing value below comes from `decision`, which carries only
    // projection-derived fields. `appeal.filingDeadline` is not passed on; its
    // whole remaining role was to agree with the canonical date, and it did.
    const template = deadlineReminderTemplate({
      userName: appeal.user.name,
      propertyAddress: `${appeal.property.address}, ${appeal.property.city}, ${appeal.property.state}`,
      pin: formatPIN(appeal.property.pin),
      township: decision.townshipName,
      taxYear: appeal.taxYear,
      lastFileDate: decision.lastFileDate,
      daysRemaining: decision.daysRemaining,
      officialSourceUrl: decision.officialSourceUrl,
      retrievedAt: decision.retrievedAt,
      appealLink: `${appUrl}/appeals/${appeal.id}`,
    })

    const ok = await sendEmail({
      to: appeal.user.email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    })
    if (ok) sent++
  }

  return NextResponse.json({
    success: true,
    emailsSent: sent,
    candidatesConsidered: appeals.length,
    suppressed,
  })
}
