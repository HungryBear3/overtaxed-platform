/**
 * Email configuration validation.
 * Migrated from SMTP/nodemailer to Resend.
 */

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

export function getEmailFrom(): string {
  return process.env.RESEND_FROM || "OverTaxed IL <support@overtaxed-il.com>"
}
