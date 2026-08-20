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
import { isHeldProduct } from "@/lib/products/held"

export const dynamic = "force-dynamic"

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Which invoice types belong to a withdrawn product.
 *
 * `PERFORMANCE_FEE` rows are the contingency performance invoice, held as
 * `PERFORMANCE_INVOICE`. Creation and payment were both closed; collection was
 * not. The result was a daily "Pay Invoice" demand for a product whose payment
 * control had been removed from `/account` — a customer following the button
 * arrives at a page with no way to pay, while the escalation continues to a
 * final notice. `LATE_FEE` and `COLLECTION_FEE` are charges derived from those
 * invoices and are held with them; dunning for the surcharge on a held debt is
 * the same act.
 */
const HELD_PRODUCT_BY_INVOICE_TYPE: Record<string, string> = {
  PERFORMANCE_FEE: "PERFORMANCE_INVOICE",
  LATE_FEE: "PERFORMANCE_INVOICE",
  COLLECTION_FEE: "PERFORMANCE_INVOICE",
}

/** True when this invoice belongs to a product that may not be collected on. */
function isHeldInvoiceType(invoiceType: string): boolean {
  const productId = HELD_PRODUCT_BY_INVOICE_TYPE[invoiceType]
  return productId != null && isHeldProduct(productId)
}

export async function GET(request: NextRequest) {
  // Fail closed. The previous guard skipped authorization entirely when
  // CRON_SECRET was unset, leaving a public GET that mailed customers and wrote
  // to their invoice rows.
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
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
  let heldSuppressed = 0
  const results: { invoiceId: string; notice: number; sent: boolean }[] = []

  for (const inv of overdueInvoices) {
    // Held first, before the notice is chosen, before a template is composed,
    // before Resend is touched, and before the letter counter is incremented.
    // A held invoice produces no message and no write of any kind.
    if (isHeldInvoiceType(inv.invoiceType)) {
      heldSuppressed++
      results.push({ invoiceId: inv.id, notice: 0, sent: false })
      continue
    }

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
    heldSuppressed,
    results,
  })
}
