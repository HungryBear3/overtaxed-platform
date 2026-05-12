// Send-time preflight enforcement (runbook §6).
// Every send must pass `preflightBeforeSend` BEFORE any provider API call.
// This function is idempotent and cheap: it reads campaign, suppression, and
// prospect-level checks. It does not hit the provider.

import { prisma } from "@/lib/db"

import {
  OUTREACH_EMAIL_SYNTAX_REGEX,
  OUTREACH_ROLE_ADDRESS_REGEX,
  OUTREACH_THRESHOLDS,
} from "./config"
import { isSuppressed, normalizeEmail } from "./suppression"
import type { PreflightResult } from "./types"

export interface PreflightArgs {
  campaignId: string
  email: string
  /** Optional: pass if already known to avoid an extra query. */
  prospectLastContactedAt?: Date | null
  /** Optional: property-manager detection result. */
  isPropertyManager?: boolean
}

/** Returns { allowed: true } only if every gate passes. Otherwise the caller
 *  must log `reason` and skip the provider call. */
export async function preflightBeforeSend(args: PreflightArgs): Promise<PreflightResult> {
  const { campaignId, email, prospectLastContactedAt, isPropertyManager } = args

  // 1. Re-read campaign status fresh from DB (runbook rule).
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
    select: { id: true, status: true },
  })
  if (!campaign) return { allowed: false, reason: "campaign_not_found" }
  if (campaign.status !== "running") {
    return { allowed: false, reason: `campaign_status_${campaign.status}` }
  }

  // 2. Email syntax.
  if (!OUTREACH_EMAIL_SYNTAX_REGEX.test(email)) {
    return { allowed: false, reason: "invalid_email_syntax" }
  }

  const lc = normalizeEmail(email)

  // 3. Role-address rejection.
  if (OUTREACH_ROLE_ADDRESS_REGEX.test(lc)) {
    return { allowed: false, reason: "role_address" }
  }

  // 4. Property-manager heuristic (caller must supply).
  if (isPropertyManager) {
    return { allowed: false, reason: "property_manager" }
  }

  // 5. Suppression (global or campaign-scoped).
  if (await isSuppressed(lc, campaignId)) {
    return { allowed: false, reason: "suppressed" }
  }

  // 6. 30-day recontact cooldown.
  if (prospectLastContactedAt) {
    const cooldownMs =
      OUTREACH_THRESHOLDS.RECONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    if (Date.now() - prospectLastContactedAt.getTime() < cooldownMs) {
      return { allowed: false, reason: "already_contacted_30d" }
    }
  }

  return { allowed: true }
}

/** Convenience wrapper: runs preflight and records a skipped send row with the
 *  reason, so ops can audit later without scraping logs. */
export async function recordSkippedSend(args: {
  campaignId: string
  prospectId: string
  email: string
  reason: string
  customId: string
  replyToAddress: string
  listUnsubscribeUrl: string
  templateVersion: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string
  utmContent?: string | null
}): Promise<void> {
  await prisma.outreachSend.create({
    data: {
      campaignId: args.campaignId,
      prospectId: args.prospectId,
      email: normalizeEmail(args.email),
      customId: args.customId,
      status: "skipped",
      skippedReason: args.reason,
      replyToAddress: args.replyToAddress,
      listUnsubscribeUrl: args.listUnsubscribeUrl,
      templateVersion: args.templateVersion,
      utmSource: args.utmSource,
      utmMedium: args.utmMedium,
      utmCampaign: args.utmCampaign,
      utmContent: args.utmContent ?? null,
      utmTerm: args.utmTerm,
    },
  })
}
