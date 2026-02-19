import { getMailer, defaultFrom } from "./transport"

export async function sendEmail({
  to,
  subject,
  text,
  html,
  from = defaultFrom,
}: {
  to: string
  subject: string
  text: string
  html: string
  from?: string
}): Promise<boolean> {
  const mailer = getMailer()
  if (!mailer) {
    console.warn("[email] Skipping send – SMTP not configured")
    return false
  }

  try {
    await mailer.sendMail({ from, to, subject, text, html })
    console.log(`[email] Sent to ${to}: "${subject}"`)
    return true
  } catch (error) {
    console.error("[email] Error sending:", error)
    return false
  }
}
