// Outreach type aliases. Strings not Prisma enums because the runbook defines
// status values as extensible strings; adding one shouldn't require a migration.

export type OutreachCampaignStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "halted"

export type OutreachSendStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "suppressed"
  | "skipped"

export type OutreachRowStatus = "ok" | "needs_review" | "rejected"

export type OutreachSuppressionReason =
  | "HARD_BOUNCED"
  | "SOFT_BOUNCED_REPEATED"
  | "COMPLAINED"
  | "MANUAL_OPT_OUT"
  | "ONE_CLICK_UNSUB"
  | "LEGAL_HOLD"
  | "ALREADY_CONTACTED_30D"
  | "ROLE_ADDRESS"
  | "INVALID_SYNTAX"
  | "PROPERTY_MANAGER"

export type OutreachSuppressionSource =
  | "webhook"
  | "manual"
  | "unsubscribe"
  | "preflight"

export type OutreachReplyType =
  | "opt_out"
  | "neutral"
  | "interested"
  | "legal"
  | "other"

export type OutreachLeadSource =
  | "outreach_email"
  | "reply"
  | "appeal_bulk"
  | "manual"

export type OutreachWebhookEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained"

export interface PreflightResult {
  allowed: boolean
  reason?: string
}
