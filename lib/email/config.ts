/**
 * Email configuration validation.
 * Use isEmailConfigured() before sending; transport logs a warning when env is missing.
 */

export function isEmailConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  )
}

export function getEmailFrom(): string {
  return process.env.SMTP_FROM || "noreply@overtaxed.com"
}
