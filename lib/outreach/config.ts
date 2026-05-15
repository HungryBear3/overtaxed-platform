// OT outreach-specific configuration. Isolated from the transactional sender.
// Do NOT use these addresses for order/support mail and vice versa.

export const OUTREACH_SUBDOMAIN = "outreach.overtaxed-il.com"
export const OUTREACH_FROM =
  process.env.OUTREACH_FROM_EMAIL ?? `Alexy Kaplun <alexy@${OUTREACH_SUBDOMAIN}>`
export const OUTREACH_REPLY_TO =
  process.env.OUTREACH_REPLY_TO_EMAIL ?? `appeals@${OUTREACH_SUBDOMAIN}`
export const OUTREACH_UNSUB_MAILTO = `unsub@${OUTREACH_SUBDOMAIN}`

// Auto-pause thresholds (runbook §8). These are read by the webhook handler
// when deciding whether to flip campaign.status → 'halted'.
export const OUTREACH_THRESHOLDS = {
  HARD_BOUNCE_RATE: 0.05, // 5%
  COMPLAINT_RATE: 0.001, // 0.1%
  PILOT_COMPLAINT_ABSOLUTE: 1, // any single complaint halts the 50-send pilot
  SOFT_BOUNCE_WINDOW_DAYS: 30,
  SOFT_BOUNCE_MAX_IN_WINDOW: 3,
  RECONTACT_COOLDOWN_DAYS: 30,
} as const

// Role-address patterns rejected at preflight and never loaded into send_ready.
export const OUTREACH_ROLE_ADDRESS_LOCAL_PARTS = [
  "info",
  "admin",
  "contact",
  "board",
  "help",
  "support",
  "postmaster",
  "noreply",
  "no-reply",
] as const

export const OUTREACH_ROLE_ADDRESS_REGEX = new RegExp(
  `^(${OUTREACH_ROLE_ADDRESS_LOCAL_PARTS.join("|")})@`,
  "i",
)

// Minimum valid email shape — not a full RFC check, just a preflight guard.
export const OUTREACH_EMAIL_SYNTAX_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Dedicated Resend API key for outreach. Falls back to RESEND_API_KEY only if
// the outreach-specific key is not configured — but prod must set the dedicated one.
export function getOutreachResendApiKey(): string | null {
  return process.env.OUTREACH_RESEND_API_KEY ?? process.env.RESEND_API_KEY ?? null
}

export function getOutreachWebhookSecret(): string | null {
  return process.env.OUTREACH_RESEND_WEBHOOK_SECRET ?? null
}

export function getOutreachPublicUrl(): string {
  const base = process.env.OUTREACH_PUBLIC_URL ?? `https://${OUTREACH_SUBDOMAIN}`
  return base.replace(/\/$/, "")
}

export function getOutreachUnsubscribeUrl(token: string): string {
  return `${getOutreachPublicUrl()}/u/${encodeURIComponent(token)}`
}

export function getOutreachListUnsubscribeHeader(token: string): string {
  return `<mailto:${OUTREACH_UNSUB_MAILTO}>, <${getOutreachUnsubscribeUrl(token)}>`
}

export const OUTREACH_LIST_UNSUBSCRIBE_POST_HEADER =
  "List-Unsubscribe=One-Click"
