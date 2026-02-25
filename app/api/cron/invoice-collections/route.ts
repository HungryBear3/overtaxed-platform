// Cron: send collection notices for overdue invoices.
// Run daily via Vercel Cron: GET /api/cron/invoice-collections
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendEmail } from "@/lib/email"
import { isEmailConfigured } from "@/lib/email/config"
import {
  invoiceOverdueReminderTemplate,
  invoiceOverdueSecondNoticeTemplate,
  invoiceOverdueThirdNoticeTemplate,
  invoiceOverdueFinalNoticeTemplate,
} from "@/lib/email/templates"

export const dynamic = "force-dynamic"

const MS_PER_DAY = 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const accountLink = `${appUrl}/account`
  const termsLink = `${appUrl}/terms`

  const now = new Date()
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: "PENDING",
      dueDate: { lt: now },
    },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  })

  let sent = 0
  const results: { invoiceId: string; notice: number; sent: boolean }[] = []

  for (const inv of overdueInvoices) {
    const daysOverdue = Math.floor(
      (now.getTime() - inv.dueDate.getTime()) / MS_PER_DAY
    )
    const lettersSent = inv.collectionLettersSent

    // Notice 1: 7+ days, 0 sent
    // Notice 2: 14+ days, 1 sent
    // Notice 3: 30+ days, 2 sent
    // Notice 4: 45+ days, 3 sent
    let noticeToSend: 1 | 2 | 3 | 4 | null = null
    if (daysOverdue >= 7 && lettersSent === 0) noticeToSend = 1
    else if (daysOverdue >= 14 && lettersSent === 1) noticeToSend = 2
    else if (daysOverdue >= 30 && lettersSent === 2) noticeToSend = 3
    else if (daysOverdue >= 45 && lettersSent === 3) noticeToSend = 4

    if (!noticeToSend || !inv.user?.email || !isEmailConfigured()) {
      results.push({
        invoiceId: inv.id,
        notice: noticeToSend ?? 0,
        sent: false,
      })
      continue
    }

    const amount = Number(inv.amount)
    const baseArgs = {
      userName: inv.user.name,
      invoiceNumber: inv.invoiceNumber,
      amount,
      dueDate: inv.dueDate,
      daysOverdue,
      accountLink,
    }

    let template: { subject: string; text: string; html: string }
    switch (noticeToSend) {
      case 1:
        template = invoiceOverdueReminderTemplate(baseArgs)
        break
      case 2:
        template = invoiceOverdueSecondNoticeTemplate(baseArgs)
        break
      case 3:
        template = invoiceOverdueThirdNoticeTemplate(baseArgs)
        break
      case 4:
        template = invoiceOverdueFinalNoticeTemplate({
          ...baseArgs,
          termsLink,
        })
        break
    }

    const ok = await sendEmail({
      to: inv.user.email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    })

    if (ok) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          collectionLettersSent: { increment: 1 },
          lastCollectionLetterSentAt: now,
        },
      })
      sent++
    }

    results.push({ invoiceId: inv.id, notice: noticeToSend, sent: ok })
  }

  return NextResponse.json({
    success: true,
    overdueCount: overdueInvoices.length,
    noticesSent: sent,
    results,
  })
}
