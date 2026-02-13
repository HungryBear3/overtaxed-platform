import { getMailer, defaultFrom } from "./transport"

const supportEmail = process.env.SUPPORT_EMAIL || "support@overtaxed-il.com"

export async function sendContactEmail({
  name,
  email,
  subject,
  message,
  category,
}: {
  name: string
  email: string
  subject: string
  message: string
  category?: string
}): Promise<{ supportEmail: { success: boolean }; confirmationEmail: { success: boolean } }> {
  const categoryLabel = category ? `Category: ${category}\n` : ""

  const supportResult = await sendEmail({
    to: supportEmail,
    subject: `Contact Form: ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af;">New Contact Form Submission</h2>
        <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          ${category ? `<p><strong>Category:</strong> ${category}</p>` : ""}
          <p><strong>Subject:</strong> ${subject}</p>
        </div>
        <div style="background-color: #fff; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; margin: 16px 0;">
          <h3 style="color: #374151; margin-top: 0;">Message:</h3>
          <p style="white-space: pre-wrap; color: #4b5563;">${message.replace(/\n/g, "<br>")}</p>
        </div>
        <p style="color: #64748b; font-size: 14px;">Reply directly to ${name} at ${email}.</p>
      </div>
    `,
    text: `New Contact Form\n\nName: ${name}\nEmail: ${email}\n${categoryLabel}Subject: ${subject}\n\nMessage:\n${message}`,
  })

  const confirmationResult = await sendEmail({
    to: email,
    subject: "We Received Your Message - OverTaxed",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af;">Thank You for Contacting Us</h2>
        <p>Hi ${name},</p>
        <p>We've received your message and will get back to you within 2-3 business days.</p>
        <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0;"><strong>Your message:</strong></p>
          <p style="white-space: pre-wrap; color: #4b5563; margin-top: 8px;">${message.replace(/\n/g, "<br>")}</p>
        </div>
        <p>For urgent matters, include "URGENT" in the subject when you contact us.</p>
        <p style="color: #64748b; font-size: 14px;">This is an automated confirmation. Please do not reply to this email.</p>
      </div>
    `,
    text: `Thank You for Contacting Us\n\nHi ${name},\n\nWe've received your message and will get back to you within 2-3 business days.\n\nYour message:\n${message}\n\nThis is an automated confirmation.`,
  })

  return {
    supportEmail: { success: supportResult },
    confirmationEmail: { success: confirmationResult },
  }
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
