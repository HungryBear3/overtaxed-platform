// Email templates – return { subject, text, html }

export function deadlineReminderTemplate(args: {
  userEmail: string
  userName?: string | null
  propertyAddress: string
  pin: string
  taxYear: number
  deadline: Date
  daysRemaining: number
  appealLink: string
}): { subject: string; text: string; html: string } {
  const { userName, propertyAddress, pin, taxYear, deadline, daysRemaining, appealLink } = args
  const formattedDeadline = deadline.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })

  const subject = `[Action Required] ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} left to file your ${taxYear} appeal`

  const text = `Hi${userName ? ` ${userName}` : ""},

Your ${taxYear} property tax appeal deadline is approaching.

Property: ${propertyAddress} (PIN ${pin})
Deadline: ${formattedDeadline} (${daysRemaining} days remaining)

Log in to complete and file your appeal:
${appealLink}

– The Overtaxed Team
`

  const html = `<p>Hi${userName ? ` ${userName}` : ""},</p>
<p>Your <strong>${taxYear} property tax appeal</strong> deadline is approaching.</p>
<table cellpadding="4" style="margin:16px 0">
<tr><td style="color:#6b7280">Property:</td><td><strong>${propertyAddress}</strong> (PIN ${pin})</td></tr>
<tr><td style="color:#6b7280">Deadline:</td><td><strong>${formattedDeadline}</strong> (${daysRemaining} days remaining)</td></tr>
</table>
<p><a href="${appealLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">View Your Appeal</a></p>
<p>— The Overtaxed Team</p>`

  return { subject, text, html }
}

export function appealFiledTemplate(args: {
  userName?: string | null
  propertyAddress: string
  taxYear: number
  appealLink: string
}): { subject: string; text: string; html: string } {
  const { userName, propertyAddress, taxYear, appealLink } = args

  const subject = `Your ${taxYear} appeal for ${propertyAddress} has been filed`

  const text = `Hi${userName ? ` ${userName}` : ""},

Great news! Your ${taxYear} property tax appeal for ${propertyAddress} has been filed.

We'll notify you when there's an update on your appeal status.

View your appeal:
${appealLink}

– The Overtaxed Team
`

  const html = `<p>Hi${userName ? ` ${userName}` : ""},</p>
<p>Great news! Your <strong>${taxYear} property tax appeal</strong> for <strong>${propertyAddress}</strong> has been filed.</p>
<p>We'll notify you when there's an update on your appeal status.</p>
<p><a href="${appealLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">View Your Appeal</a></p>
<p>— The Overtaxed Team</p>`

  return { subject, text, html }
}

export function appealDecisionTemplate(args: {
  userName?: string | null
  propertyAddress: string
  taxYear: number
  outcome: string
  reductionAmount: number | null
  taxSavings: number | null
  appealLink: string
}): { subject: string; text: string; html: string } {
  const { userName, propertyAddress, taxYear, outcome, reductionAmount, taxSavings, appealLink } = args
  const currency = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)

  const subject = `Your ${taxYear} appeal result: ${outcome === "WON" || outcome === "PARTIALLY_WON" ? "Approved!" : outcome}`

  const text = `Hi${userName ? ` ${userName}` : ""},

We have an update on your ${taxYear} property tax appeal for ${propertyAddress}.

Outcome: ${outcome}
${reductionAmount != null ? `Assessment reduction: ${currency(reductionAmount)}` : ""}
${taxSavings != null ? `Estimated annual tax savings: ${currency(taxSavings)}` : ""}

View full details:
${appealLink}

– The Overtaxed Team
`

  const html = `<p>Hi${userName ? ` ${userName}` : ""},</p>
<p>We have an update on your <strong>${taxYear} property tax appeal</strong> for <strong>${propertyAddress}</strong>.</p>
<table cellpadding="4" style="margin:16px 0">
<tr><td style="color:#6b7280">Outcome:</td><td><strong>${outcome}</strong></td></tr>
${reductionAmount != null ? `<tr><td style="color:#6b7280">Assessment reduction:</td><td><strong>${currency(reductionAmount)}</strong></td></tr>` : ""}
${taxSavings != null ? `<tr><td style="color:#6b7280">Annual tax savings:</td><td style="color:#16a34a;font-weight:bold">${currency(taxSavings)}</td></tr>` : ""}
</table>
<p><a href="${appealLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">View Full Details</a></p>
<p>— The Overtaxed Team</p>`

  return { subject, text, html }
}

export function assessmentIncreaseTemplate(args: {
  userEmail: string
  userName?: string | null
  propertyAddress: string
  pin: string
  taxYear: number
  previousValue: number
  newValue: number
  propertyLink: string
}): { subject: string; text: string; html: string } {
  const { userName, propertyAddress, pin, taxYear, previousValue, newValue, propertyLink } = args
  const currency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
  const pct = previousValue > 0 ? (((newValue - previousValue) / previousValue) * 100).toFixed(1) : "—"

  const subject = `Assessment increase detected for ${propertyAddress} (${taxYear})`

  const text = `Hi${userName ? ` ${userName}` : ""},

We detected an assessment increase for your property.

Property: ${propertyAddress} (PIN ${pin})
Tax year: ${taxYear}
Previous: ${currency(previousValue)} → New: ${currency(newValue)}${pct !== "—" ? ` (${pct}% increase)` : ""}

You may be able to appeal. View your property:
${propertyLink}

– The Overtaxed Team
`

  const html = `<p>Hi${userName ? ` ${userName}` : ""},</p>
<p>We detected an <strong>assessment increase</strong> for your property.</p>
<table cellpadding="4" style="margin:16px 0">
<tr><td style="color:#6b7280">Property:</td><td><strong>${propertyAddress}</strong> (PIN ${pin})</td></tr>
<tr><td style="color:#6b7280">Tax year:</td><td><strong>${taxYear}</strong></td></tr>
<tr><td style="color:#6b7280">Previous:</td><td>${currency(previousValue)}</td></tr>
<tr><td style="color:#6b7280">New:</td><td><strong>${currency(newValue)}</strong>${pct !== "—" ? ` (${pct}% increase)` : ""}</td></tr>
</table>
<p><a href="${propertyLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">View Property</a></p>
<p>— The Overtaxed Team</p>`

  return { subject, text, html }
}

// Invoice collection notice templates (escalating sequence for overdue invoices)
export function invoiceOverdueReminderTemplate(args: {
  userName?: string | null
  invoiceNumber: string
  amount: number
  dueDate: Date
  daysOverdue: number
  accountLink: string
}) {
  const { userName, invoiceNumber, amount, dueDate, daysOverdue, accountLink } = args
  const currency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
  const subject = `[OverTaxed] Invoice ${invoiceNumber} is past due`
  const text = `Hi${userName ? ` ${userName}` : ""},

Your invoice ${invoiceNumber} (${currency(amount)}) was due on ${dueDate.toLocaleDateString("en-US")} and is now ${daysOverdue} days past due.

Please pay to avoid late fees. Log in to pay:
${accountLink}

– The OverTaxed Team`
  const html = `<p>Hi${userName ? ` ${userName}` : ""},</p>
<p>Your invoice <strong>${invoiceNumber}</strong> (${currency(amount)}) was due on ${dueDate.toLocaleDateString("en-US")} and is now <strong>${daysOverdue} days past due</strong>.</p>
<p>Please pay to avoid late fees.</p>
<p><a href="${accountLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Pay Invoice</a></p>
<p>— The OverTaxed Team</p>`
  return { subject, text, html }
}

export function invoiceOverdueSecondNoticeTemplate(args: {
  userName?: string | null
  invoiceNumber: string
  amount: number
  dueDate: Date
  daysOverdue: number
  accountLink: string
}) {
  const { userName, invoiceNumber, amount, dueDate, daysOverdue, accountLink } = args
  const currency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
  const subject = `[OverTaxed] Second notice: Invoice ${invoiceNumber} remains unpaid`
  const text = `Hi${userName ? ` ${userName}` : ""},

This is our second notice. Invoice ${invoiceNumber} (${currency(amount)}) was due on ${dueDate.toLocaleDateString("en-US")} and is ${daysOverdue} days past due.

A 1.5% monthly finance charge may apply per our Terms of Service. Please pay promptly:
${accountLink}

– The OverTaxed Team`
  const html = `<p>Hi${userName ? ` ${userName}` : ""},</p>
<p><strong>Second notice:</strong> Invoice ${invoiceNumber} (${currency(amount)}) was due on ${dueDate.toLocaleDateString("en-US")} and is ${daysOverdue} days past due.</p>
<p>A 1.5% monthly finance charge may apply per our Terms of Service.</p>
<p><a href="${accountLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Pay Invoice</a></p>
<p>— The OverTaxed Team</p>`
  return { subject, text, html }
}

export function invoiceOverdueThirdNoticeTemplate(args: {
  userName?: string | null
  invoiceNumber: string
  amount: number
  dueDate: Date
  daysOverdue: number
  accountLink: string
}) {
  const { userName, invoiceNumber, amount, dueDate, daysOverdue, accountLink } = args
  const currency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
  const subject = `[OverTaxed] Final notice before collections: Invoice ${invoiceNumber}`
  const text = `Hi${userName ? ` ${userName}` : ""},

This is our final notice before referring your account for collection. Invoice ${invoiceNumber} (${currency(amount)}) was due on ${dueDate.toLocaleDateString("en-US")} and is ${daysOverdue} days past due.

Pay now to avoid referral to collections or further action:
${accountLink}

– The OverTaxed Team`
  const html = `<p>Hi${userName ? ` ${userName}` : ""},</p>
<p><strong>Final notice before collections:</strong> Invoice ${invoiceNumber} (${currency(amount)}) was due on ${dueDate.toLocaleDateString("en-US")} and is ${daysOverdue} days past due.</p>
<p>Pay now to avoid referral to collections or further action.</p>
<p><a href="${accountLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Pay Invoice</a></p>
<p>— The OverTaxed Team</p>`
  return { subject, text, html }
}

export function invoiceOverdueFinalNoticeTemplate(args: {
  userName?: string | null
  invoiceNumber: string
  amount: number
  dueDate: Date
  daysOverdue: number
  accountLink: string
  termsLink: string
}) {
  const { userName, invoiceNumber, amount, dueDate, daysOverdue, accountLink, termsLink } = args
  const currency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
  const subject = `[OverTaxed] URGENT: Pay now or account sent to collections/legal action`
  const text = `Hi${userName ? ` ${userName}` : ""},

FINAL NOTICE – Your account will be sent to collections and/or legal action if payment is not received immediately.

Invoice ${invoiceNumber} (${currency(amount)}) was due on ${dueDate.toLocaleDateString("en-US")} and is ${daysOverdue} days past due.

Per Section 4 of our User Agreement (${termsLink}): If you do not pay, we may refer your account to a collections agency or pursue legal action including filing suit in the Circuit Court of Cook County or Small Claims/Claims Court. You will be responsible for the full balance plus interest, late fees, court costs, filing fees, and reasonable attorney's fees.

Pay immediately to avoid collections and legal action:
${accountLink}

– The OverTaxed Team`
  const html = `<p>Hi${userName ? ` ${userName}` : ""},</p>
<p><strong style="color:#b91c1c">FINAL NOTICE</strong> – Your account will be sent to collections and/or legal action if payment is not received immediately.</p>
<table cellpadding="4" style="margin:16px 0">
<tr><td style="color:#6b7280">Invoice:</td><td><strong>${invoiceNumber}</strong> (${currency(amount)})</td></tr>
<tr><td style="color:#6b7280">Due date:</td><td>${dueDate.toLocaleDateString("en-US")}</td></tr>
<tr><td style="color:#6b7280">Days overdue:</td><td><strong>${daysOverdue}</strong></td></tr>
</table>
<p>Per <strong>Section 4 of our User Agreement</strong> (<a href="${termsLink}">Terms</a>): If you do not pay, we may refer your account to a collections agency or pursue legal action including filing suit in the Circuit Court of Cook County or Small Claims/Claims Court. You will be responsible for the full balance plus interest, late fees, court costs, filing fees, and reasonable attorney's fees.</p>
<p><a href="${accountLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Pay Invoice Now</a></p>
<p>— The OverTaxed Team</p>`
  return { subject, text, html }
}
