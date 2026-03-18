// Cron endpoint: send township deadline alerts to free subscribers.
// Run daily at 08:30 UTC via Vercel Cron: GET /api/cron/township-alerts
// Vercel cron.json entry:
//   { "path": "/api/cron/township-alerts", "schedule": "30 8 * * *" }

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { sendEmail } from "@/lib/email/send"

export const dynamic = "force-dynamic"

// Township window data — mirrors the /townships page.
// openDate / closeDate as ISO dates (YYYY-MM-DD) for comparison logic.
// Update each year after CCAO publishes the new assessment calendar.
const TOWNSHIP_WINDOWS: Record<
  string,
  { openDate: string; closeDate: string; status: "OPEN" | "UPCOMING" | "CLOSED" | "FUTURE" }
> = {
  Bloom: { openDate: "2026-01-15", closeDate: "2026-03-15", status: "OPEN" },
  Bremen: { openDate: "2026-01-15", closeDate: "2026-03-15", status: "OPEN" },
  Calumet: { openDate: "2026-02-01", closeDate: "2026-04-01", status: "OPEN" },
  Rich: { openDate: "2026-02-01", closeDate: "2026-04-01", status: "OPEN" },
  Thornton: { openDate: "2026-02-01", closeDate: "2026-04-01", status: "OPEN" },
  Worth: { openDate: "2026-01-15", closeDate: "2026-03-15", status: "OPEN" },
  Lemont: { openDate: "2026-03-01", closeDate: "2026-05-01", status: "UPCOMING" },
  Lyons: { openDate: "2026-03-01", closeDate: "2026-05-01", status: "UPCOMING" },
  Orland: { openDate: "2026-03-01", closeDate: "2026-05-01", status: "UPCOMING" },
  Palos: { openDate: "2026-03-01", closeDate: "2026-05-01", status: "UPCOMING" },
  Stickney: { openDate: "2026-04-01", closeDate: "2026-06-01", status: "UPCOMING" },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

function buildOpenEmail(township: string, closeDate: string, unsubToken: string) {
  const closeFmt = formatDate(closeDate)
  return {
    subject: `Your ${township} Township appeal window is now open`,
    text: [
      `Good news — the ${township} Township appeal window is now open.`,
      ``,
      `Deadline to file: ${closeFmt}`,
      ``,
      `How to start your appeal:`,
      `1. Add your property at https://www.overtaxed-il.com`,
      `2. We pull your assessment and comparable properties automatically.`,
      `3. Download your evidence packet and file with the Cook County Assessor — or let us file for you.`,
      ``,
      `DIY: $69 one-time · Full automation: $149/property/year`,
      ``,
      `A win in 2026 locks in your reduced assessment through 2029.`,
      `$500–$1,500/year × 3 years = $1,500–$4,500 in potential savings.`,
      ``,
      `Start now: https://www.overtaxed-il.com/auth/signup`,
      ``,
      `— The OverTaxed IL Team`,
      ``,
      `Unsubscribe: https://www.overtaxed-il.com/api/township-alert?token=${unsubToken}`,
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1f2937;">
        <div style="background:#1e3a8a;color:white;border-radius:12px 12px 0 0;padding:24px 28px;">
          <p style="margin:0;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#93c5fd;">Appeal Window Open</p>
          <h1 style="margin:8px 0 0;font-size:22px;">${township} Township</h1>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
          <p>Your <strong>${township} Township</strong> appeal window is now open.</p>
          <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin:16px 0;">
            <p style="margin:0;font-weight:600;color:#92400e;">Deadline to file: ${closeFmt}</p>
          </div>
          <p>A successful appeal in 2026 locks in your reduced assessment through 2029.</p>
          <p style="font-weight:600;">$500–$1,500/year × 3 years = $1,500–$4,500 from one filing.</p>
          <div style="margin:20px 0;">
            <a href="https://www.overtaxed-il.com/auth/signup"
               style="display:inline-block;background:#2563eb;color:white;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">
              Start my appeal →
            </a>
          </div>
          <p style="font-size:13px;color:#6b7280;">
            DIY from $69 · Full automation from $149/property · No attorney needed
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
          <p style="font-size:11px;color:#9ca3af;">
            OverTaxed IL · 1028 W Leland Ave, Chicago IL 60640<br/>
            <a href="https://www.overtaxed-il.com/api/township-alert?token=${unsubToken}" style="color:#9ca3af;">Unsubscribe</a>
          </p>
        </div>
      </div>
    `,
  }
}

function buildClosingEmail(township: string, closeDate: string, unsubToken: string) {
  const closeFmt = formatDate(closeDate)
  return {
    subject: `7 days left: ${township} Township appeal deadline is ${closeFmt}`,
    text: [
      `Heads up — your ${township} Township appeal window closes on ${closeFmt}.`,
      `That's 7 days from now.`,
      ``,
      `After this deadline, you'll wait until the 2029 reassessment cycle.`,
      `At $500–$1,500/year in potential savings, waiting costs $1,500–$4,500.`,
      ``,
      `File in the next 7 days: https://www.overtaxed-il.com/auth/signup`,
      ``,
      `DIY: $69 one-time · Full automation: $149/property/year`,
      ``,
      `— The OverTaxed IL Team`,
      ``,
      `Unsubscribe: https://www.overtaxed-il.com/api/township-alert?token=${unsubToken}`,
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1f2937;">
        <div style="background:#dc2626;color:white;border-radius:12px 12px 0 0;padding:24px 28px;">
          <p style="margin:0;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#fca5a5;">Deadline in 7 days</p>
          <h1 style="margin:8px 0 0;font-size:22px;">${township} Township closes ${closeFmt}</h1>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
          <p>Your <strong>${township} Township</strong> appeal window closes on <strong>${closeFmt}</strong>.</p>
          <p>After this date, you wait until the 2029 reassessment cycle — potentially $1,500–$4,500 in unclaimed savings.</p>
          <div style="margin:20px 0;">
            <a href="https://www.overtaxed-il.com/auth/signup"
               style="display:inline-block;background:#dc2626;color:white;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">
              File before the deadline →
            </a>
          </div>
          <p style="font-size:13px;color:#6b7280;">
            DIY from $69 · Full automation from $149/property · No attorney needed
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
          <p style="font-size:11px;color:#9ca3af;">
            OverTaxed IL · 1028 W Leland Ave, Chicago IL 60640<br/>
            <a href="https://www.overtaxed-il.com/api/township-alert?token=${unsubToken}" style="color:#9ca3af;">Unsubscribe</a>
          </p>
        </div>
      </div>
    `,
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  let openSent = 0
  let closeSent = 0
  let errors = 0

  // Fetch all active (non-unsubscribed) alerts for townships we have window data for
  const alerts = await prisma.townshipAlert.findMany({
    where: { unsubscribedAt: null },
  })

  for (const alert of alerts) {
    const window = TOWNSHIP_WINDOWS[alert.township]
    if (!window) continue

    const openDate = new Date(window.openDate)
    const closeDate = new Date(window.closeDate)

    // Send "window open" email — once, on or after openDate, if not already sent
    if (!alert.notifiedOpen && now >= openDate && now < closeDate) {
      try {
        const { subject, text, html } = buildOpenEmail(alert.township, window.closeDate, alert.unsubscribeToken)
        await sendEmail({ to: alert.email, subject, text, html })
        await prisma.townshipAlert.update({
          where: { id: alert.id },
          data: { notifiedOpen: true },
        })
        openSent++
      } catch (e) {
        console.error(`[township-alerts] open email error for ${alert.email}:`, e)
        errors++
      }
    }

    // Send "7-day closing" email — once, when within 7 days of closeDate and window is open
    if (
      !alert.notifiedClose &&
      alert.notifiedOpen && // Only send closing reminder after they've been told it's open
      now >= openDate &&
      now < closeDate &&
      closeDate <= sevenDaysFromNow
    ) {
      try {
        const { subject, text, html } = buildClosingEmail(alert.township, window.closeDate, alert.unsubscribeToken)
        await sendEmail({ to: alert.email, subject, text, html })
        await prisma.townshipAlert.update({
          where: { id: alert.id },
          data: { notifiedClose: true },
        })
        closeSent++
      } catch (e) {
        console.error(`[township-alerts] close email error for ${alert.email}:`, e)
        errors++
      }
    }
  }

  console.log(`[township-alerts] Done. openSent=${openSent} closeSent=${closeSent} errors=${errors}`)
  return NextResponse.json({ ok: true, openSent, closeSent, errors })
}
