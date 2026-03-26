import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { sendEmail } from "@/lib/email/send"

type EmailContent = { subject: string; html: string; text: string }

function getEmailContent(step: number): EmailContent | null {
  const cta = `<p><a href="https://overtaxed-il.com" style="color:#2563eb;">Visit OverTaxed IL →</a></p>`

  switch (step) {
    case 1:
      return {
        subject: "You're on the list — here's what happens next",
        text: `You're signed up for township appeal window alerts. When your township's appeal window opens, we'll email you right away. In the meantime, run your free property tax check at overtaxed-il.com`,
        html: `<p>You're on the list.</p><p>When your township's Cook County property tax appeal window opens, we'll send you an email right away — so you don't miss your chance to appeal.</p><p>In the meantime, run your free property tax check to see if you're overpaying.</p>${cta}`,
      }
    case 2:
      return {
        subject: "Most Cook County homeowners overpay by $1,200/year — are you one of them?",
        text: `Studies show the majority of Cook County property tax assessments are inaccurate — and most homeowners never appeal. The average successful appeal saves $1,200/year. Run your free check at overtaxed-il.com to see if you're overpaying.`,
        html: `<p><strong>The majority of Cook County property tax assessments are inaccurate.</strong></p><p>Most homeowners never appeal — and pay thousands more than they should. The average successful appeal saves over $1,200/year.</p><p>Run your free property tax check to see if you're one of them.</p>${cta}`,
      }
    case 3:
      return {
        subject: "Property tax appeal: what it actually costs (and what you keep)",
        text: `Attorneys charge 33-40% of your first year's savings. On a $1,200 win, that's $400-480 gone. OverTaxed IL charges a flat fee — you keep more of what you save. See our pricing at overtaxed-il.com`,
        html: `<p><strong>The real cost of a property tax appeal:</strong></p><ul><li>Attorney: 33–40% of first year's savings (on a $1,200 win = $400–480 to them)</li><li>OverTaxed IL: flat fee — you keep more of what you save</li></ul><p>We handle the comparable sales analysis, filing, and follow-up. You just sign.</p>${cta}`,
      }
    case 4:
      return {
        subject: "Your township's appeal window is coming — don't miss it",
        text: `Cook County township appeal windows are 30-90 days and only come once a year. Miss it and you wait another year — paying the same inflated tax bill. Make sure your free check is already done at overtaxed-il.com so you're ready when the window opens.`,
        html: `<p>Township appeal windows in Cook County are <strong>30–90 days</strong> — and they only come once a year.</p><p>Miss it, and you're stuck paying the same inflated bill for another 12 months.</p><p>Make sure your free property tax check is done now, so you're ready to file the moment your window opens.</p>${cta}`,
      }
    case 5:
      return {
        subject: "Last reminder before your appeal window closes",
        text: `This is your final reminder. If your township's appeal window is open or opening soon, now is the time to act. File your appeal or let us handle it — but don't wait another year. overtaxed-il.com`,
        html: `<p>This is your last reminder.</p><p>If your township's appeal window is open or about to open — <strong>now is the time</strong>.</p><p>File on your own, or let OverTaxed IL handle it for you. Either way, don't let another year pass without appealing your assessment.</p>${cta}`,
      }
    default:
      return null
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const due = await prisma.dripEmail.findMany({
    where: {
      scheduledFor: { lte: now },
      sentAt: null,
    },
    take: 50,
    orderBy: { scheduledFor: "asc" },
  })

  let sent = 0
  let failed = 0

  for (const record of due) {
    const content = getEmailContent(record.step)
    if (!content) {
      await prisma.dripEmail.update({
        where: { id: record.id },
        data: { sentAt: now },
      })
      continue
    }

    try {
      const success = await sendEmail({
        to: record.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
      })

      if (success) {
        await prisma.dripEmail.update({
          where: { id: record.id },
          data: { sentAt: now },
        })
        sent++
      } else {
        console.error(`[drip] Failed to send step ${record.step} to ${record.email}`)
        failed++
      }
    } catch (err) {
      console.error(`[drip] Exception sending step ${record.step} to ${record.email}:`, err)
      failed++
    }
  }

  return NextResponse.json({ sent, failed, total: due.length })
}
