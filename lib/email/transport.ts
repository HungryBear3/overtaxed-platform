/**
 * Email transport — migrated from nodemailer/SMTP to Resend.
 * Re-exports from resend.ts for backwards compat.
 */
export { resend, FROM_EMAIL } from "./resend"

// Legacy compat shim — callers that imported getMailer/defaultFrom
export function getMailer() {
  console.warn("[email] getMailer() is deprecated — use Resend client from lib/email/resend.ts")
  return null
}

export const defaultFrom = process.env.RESEND_FROM || "OverTaxed IL <support@overtaxed-il.com>"
