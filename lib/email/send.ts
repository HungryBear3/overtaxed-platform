import { resend, FROM_EMAIL } from "./resend"

const SUPPORT_EMAIL = "support@overtaxed-il.com"
const OPS_EMAIL = "alexyopenclaw@gmail.com"

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

  const confirmSubject = "We received your message – OverTaxed IL"
  const confirmText = `Hi ${name},\n\nWe received your message and will get back to you within 2-3 business days.\n\n— The OverTaxed IL Team`
  const confirmHtml = `<p>Hi ${name},</p><p>We received your message and will get back to you within 2-3 business days.</p><p>— The OverTaxed IL Team</p>`

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
  from = FROM_EMAIL,
  attachments,
}: {
  to: string
  subject: string
  text: string
  html: string
  from?: string
  attachments?: Array<{ filename: string; content: Buffer }>
}): Promise<boolean> {
  if (!resend) {
    console.warn("[email] Skipping send – RESEND_API_KEY not configured")
    return false
  }

  try {
    const payload: Parameters<typeof resend.emails.send>[0] = { from, to, subject, html, text }
    if (attachments && attachments.length > 0) {
      ;(payload as unknown as { attachments: unknown[] }).attachments = attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      }))
    }
    const { error } = await resend.emails.send(payload)
    if (error) {
      console.error(`[email] Resend error sending to ${to}:`, error)
      return false
    }
    console.log(`[email] Sent to ${to}: "${subject}"`)
    return true
  } catch (error) {
    console.error("[email] Exception sending:", error)
    return false
  }
}

// ── Appeal-packet emails (shared across T1/T2/T3/T4 packet fulfillment) ────────

export async function sendPacketReadyEmail(
  to: string,
  args: { downloadUrl: string; invoiceId: string; pdfBytes: Buffer | null; filename: string },
): Promise<boolean> {
  const { downloadUrl, invoiceId, pdfBytes, filename } = args
  const subject = "Your OverTaxed appeal packet is ready"
  const text = [
    `Your appeal packet is ready to download.`,
    ``,
    `View & download: ${downloadUrl}`,
    ``,
    `If you did not request this packet, reply to this email.`,
    `Order reference: ${invoiceId}`,
  ].join("\n")
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1f2937;line-height:1.5;">
      <h1 style="font-size:24px;color:#1d4ed8;">Your appeal packet is ready 📄</h1>
      <p>We just finished generating your personalized appeal packet.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(downloadUrl)}"
           style="background:#1d4ed8;color:#fff;font-weight:bold;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;">
          View & Download Packet
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If the button doesn't work, copy this link: ${escapeHtml(downloadUrl)}</p>
      <p style="color:#6b7280;font-size:13px;">Reference: ${escapeHtml(invoiceId)}</p>
      <p style="color:#6b7280;font-size:13px;">— OverTaxed IL</p>
    </div>
  `
  return sendEmail({
    to,
    subject,
    text,
    html,
    ...(pdfBytes ? { attachments: [{ filename, content: pdfBytes }] } : {}),
  })
}

export async function sendPacketManualReviewAlert(
  userEmail: string | null,
  invoiceId: string,
  reason: string,
): Promise<boolean> {
  const subject = `[MANUAL REVIEW] Appeal packet ${invoiceId} needs attention`
  const text = [
    `Appeal packet generation could not complete automatically.`,
    ``,
    `Invoice ID: ${invoiceId}`,
    `Customer: ${userEmail ?? "(unknown)"}`,
    `Reason: ${reason}`,
    ``,
    `Action required: resolve the data issue and trigger regeneration.`,
  ].join("\n")
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#b45309;">Packet needs manual review</h2>
      <p><strong>Invoice:</strong> ${escapeHtml(invoiceId)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(userEmail ?? "(unknown)")}</p>
      <p><strong>Reason:</strong></p>
      <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap;">${escapeHtml(reason)}</pre>
      <p>Resolve the data issue and trigger regeneration.</p>
    </div>
  `
  return sendEmail({ to: SUPPORT_EMAIL, subject, text, html })
}

export async function sendPacketFailureAlert(
  userEmail: string | null,
  invoiceId: string,
  error: string,
): Promise<boolean> {
  const subject = `[FAILED] Appeal packet ${invoiceId} generation error`
  const text = [
    `Appeal packet generation threw an error after payment completed.`,
    ``,
    `Invoice ID: ${invoiceId}`,
    `Customer: ${userEmail ?? "(unknown)"}`,
    `Error: ${error}`,
    ``,
    `Action required: investigate, fix root cause, and regenerate.`,
  ].join("\n")
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#b91c1c;">Packet generation FAILED</h2>
      <p><strong>Invoice:</strong> ${escapeHtml(invoiceId)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(userEmail ?? "(unknown)")}</p>
      <pre style="background:#fef2f2;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap;">${escapeHtml(error)}</pre>
    </div>
  `
  return sendEmail({ to: SUPPORT_EMAIL, subject, text, html })
}

export async function sendNewOrderAlert(args: {
  tier: string
  customerEmail: string
  customerName?: string
  propertyPin?: string
  amountPaid: number
  sessionId: string
}): Promise<boolean> {
  const { tier, customerEmail, customerName, propertyPin, amountPaid, sessionId } = args
  const tierLabels: Record<string, string> = {
    T1: "DIY Starter ($37)",
    T2: "DIY Pro ($69)",
    T3: "Done-For-You ($97)",
  }
  const label = tierLabels[tier] ?? tier
  const subject = `[NEW ORDER] ${label} — ${customerEmail}`
  const text = [
    `New Overtaxed IL order received.`,
    ``,
    `Tier: ${label}`,
    `Customer: ${customerName ?? "(no name)"} <${customerEmail}>`,
    `Property PIN: ${propertyPin || "(not provided)"}`,
    `Amount paid: $${amountPaid.toFixed(2)}`,
    `Stripe session: ${sessionId}`,
    ``,
    `Action required for T2/T3: respond to customer within 24 hours.`,
  ].join("\n")
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d4ed8;">New OT Order — ${escapeHtml(label)}</h2>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:6px 12px;font-weight:bold;">Tier</td><td style="padding:6px 12px;">${escapeHtml(label)}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:6px 12px;font-weight:bold;">Customer</td><td style="padding:6px 12px;">${escapeHtml(customerName ?? "(no name)")} &lt;${escapeHtml(customerEmail)}&gt;</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;">Property PIN</td><td style="padding:6px 12px;">${escapeHtml(propertyPin || "(not provided)")}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:6px 12px;font-weight:bold;">Amount</td><td style="padding:6px 12px;">$${amountPaid.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;">Session ID</td><td style="padding:6px 12px;font-size:12px;">${escapeHtml(sessionId)}</td></tr>
      </table>
      ${tier !== "T1" ? `<p style="margin-top:16px;color:#b45309;font-weight:bold;">⚡ Action required: respond to customer within 24 hours.</p>` : ""}
    </div>
  `
  return sendEmail({ to: OPS_EMAIL, subject, text, html })
}

export async function sendOrderConfirmation(args: {
  tier: string
  customerEmail: string
  customerName?: string
  address?: string
  amountPaid: number
}): Promise<boolean> {
  const { tier, customerEmail, customerName, address, amountPaid } = args
  const tierLabels: Record<string, string> = {
    T1: "DIY Starter",
    T2: "DIY Appeal Packet",
    T3: "Done-For-You",
  }
  const label = tierLabels[tier] ?? tier
  const isT3 = tier === "T3"
  const subject = `Your OverTaxed IL order — ${label}`
  const nextStep = isT3
    ? "We'll email you within 24 hours with an authorization form to sign before we file."
    : "We'll email you within 24 hours with your completed appeal packet."
  const text = [
    `Hi ${customerName || "there"},`,
    ``,
    `We received your payment for the ${label} ($${amountPaid.toFixed(2)}).`,
    ...(address ? [`Property: ${address}`] : []),
    ``,
    nextStep,
    ``,
    `Questions? Reply to this email or contact support@overtaxed-il.com.`,
    ``,
    `— OverTaxed IL`,
  ].join("\n")
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d4ed8;">Your OverTaxed IL Order</h2>
      <p>Hi ${escapeHtml(customerName || "there")},</p>
      <p>We received your payment for the <strong>${escapeHtml(label)}</strong> ($${amountPaid.toFixed(2)}).</p>
      ${address ? `<p><strong>Property:</strong> ${escapeHtml(address)}</p>` : ""}
      <p style="background:#eff6ff;padding:12px;border-radius:6px;border-left:4px solid #1d4ed8;">${escapeHtml(nextStep)}</p>
      <p>Questions? Reply to this email or reach us at <a href="mailto:support@overtaxed-il.com">support@overtaxed-il.com</a>.</p>
      <p style="color:#6b7280;font-size:13px;">— OverTaxed IL</p>
    </div>
  `
  return sendEmail({ to: customerEmail, subject, text, html })
}

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
