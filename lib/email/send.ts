import { getMailer, defaultFrom } from "./transport"

const SUPPORT_EMAIL = "support@overtaxed-il.com"

export async function sendContactEmail(args: {
  name: string
  email: string
  subject: string
  message: string
  category?: string
}): Promise<{ supportEmail: { success: boolean }; confirmationEmail: { success: boolean } }> {
  const { name, email, subject, message, category } = args
  const supportSubject = `[Contact] ${subject}${category ? ` [${category}]` : ""}`
  const supportText = `From: ${name} <${email}>\n\n${message}`
  const supportHtml = `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p><pre>${message.replace(/</g, "&lt;")}</pre>`

  const supportEmail = await sendEmail({
    to: SUPPORT_EMAIL,
    subject: supportSubject,
    text: supportText,
    html: supportHtml,
  })

  const confirmSubject = "We received your message – OverTaxed"
  const confirmText = `Hi ${name},\n\nWe received your message and will get back to you within 2-3 business days.\n\n— The OverTaxed Team`
  const confirmHtml = `<p>Hi ${name},</p><p>We received your message and will get back to you within 2-3 business days.</p><p>— The OverTaxed Team</p>`

  const confirmationEmail = await sendEmail({
    to: email,
    subject: confirmSubject,
    text: confirmText,
    html: confirmHtml,
  })

  return { supportEmail: { success: supportEmail }, confirmationEmail: { success: confirmationEmail } }
}

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
