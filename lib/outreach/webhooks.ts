// Resend webhook event ingestion for OT outreach.
//
// Contract:
//   1. Raw event is written to outreach_webhook_events inside the same DB
//      transaction as all downstream state changes.
//   2. Duplicate provider_event_id returns a safe no-op.
//   3. The matching outreach_sends row (resolved by message_id or custom_id)
//      is updated to reflect the event.
//   4. Complaint → suppress recipient + halt campaign immediately.
//   5. Hard bounce → suppress immediately.
//   6. Repeated soft bounce (≥3 in rolling window) → suppress.

import crypto from "node:crypto"
import { Webhook as SvixWebhook } from "svix"
import { prisma } from "@/lib/db"

import { OUTREACH_THRESHOLDS, getOutreachWebhookSecret } from "./config"
import { addSuppression, countRecentSoftBounces } from "./suppression"
import type { OutreachSendStatus, OutreachWebhookEventType } from "./types"

export interface ResendEventEnvelope {
  type: string
  created_at?: string
  data: {
    email_id?: string
    id?: string
    to?: string | string[]
    from?: string
    subject?: string
    tags?: Array<{ name: string; value: string }>
    bounce?: { type?: string; message?: string } | string
    bounce_type?: string
    complaint?: { type?: string; message?: string }
    click?: { link?: string }
    [k: string]: unknown
  }
}

interface TransactionClientLike {
  outreachWebhookEvent: {
    create(args: {
      data: {
        provider: string
        providerEventId: string
        messageId: string | null
        eventType: string
        payload: object
      }
    }): Promise<unknown>
    updateMany(args: {
      where: { provider: string; providerEventId: string }
      data: { processedAt: Date }
    }): Promise<unknown>
  }
  outreachSend: {
    findUnique(args: { where: { customId: string } }): Promise<any>
    findFirst(args: { where: { messageId: string } }): Promise<any>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>
    count(args: {
      where: {
        email: string
        bounceType: string
        bouncedAt: { gte: Date }
      }
    }): Promise<number>
  }
  outreachCampaign: {
    update(args: {
      where: { id: string }
      data: { status: string; haltedAt: Date; haltReason: string }
    }): Promise<unknown>
  }
  outreachSuppression: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
    findFirst(args: {
      where: {
        emailLowercase: string
        OR: Array<{ campaignId: string | null }>
      }
      select: { id: true }
    }): Promise<{ id: string } | null>
  }
}

export interface ResendWebhookHeaders {
  "resend-signature"?: string | null
  "svix-id"?: string | null
  "svix-signature"?: string | null
  "svix-timestamp"?: string | null
  "webhook-id"?: string | null
  "webhook-signature"?: string | null
  "webhook-timestamp"?: string | null
}

/** Optional signature check for non-production environments only.
 * Production-like environments must require the webhook secret before the route
 * calls this verifier. */
export function verifyResendSignature(
  rawBody: string,
  headers: ResendWebhookHeaders,
  secret: string | null,
): boolean {
  if (!secret) return true

  const svixHeaders = {
    "svix-id": headers["svix-id"] ?? headers["webhook-id"] ?? "",
    "svix-signature": headers["svix-signature"] ?? headers["webhook-signature"] ?? "",
    "svix-timestamp": headers["svix-timestamp"] ?? headers["webhook-timestamp"] ?? "",
  }

  if (svixHeaders["svix-id"] && svixHeaders["svix-signature"] && svixHeaders["svix-timestamp"]) {
    try {
      new SvixWebhook(secret).verify(rawBody, svixHeaders)
      return true
    } catch {
      return false
    }
  }

  const resendSignature = headers["resend-signature"]
  if (!resendSignature) return false

  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(resendSignature))
  } catch {
    return false
  }
}

export function shouldRequireOutreachWebhookSecret(): boolean {
  return process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test"
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const maybeCode = "code" in error ? String(error.code) : ""
  if (maybeCode === "P2002") return true
  const maybeMessage = "message" in error ? String(error.message) : ""
  return /unique constraint|duplicate key/i.test(maybeMessage)
}

function mapEventToSendStatus(eventType: string): OutreachSendStatus | null {
  switch (eventType) {
    case "email.sent":
      return "sent"
    case "email.delivered":
      return "delivered"
    case "email.delivery_delayed":
      return "delivery_delayed"
    case "email.opened":
      return "opened"
    case "email.clicked":
      return "clicked"
    case "email.bounced":
      return "bounced"
    case "email.complained":
      return "complained"
    default:
      return null
  }
}

const SEND_STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivery_delayed: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  bounced: 6,
  complained: 7,
  suppressed: 8,
  skipped: 8,
}

function shouldAdvanceSendStatus(currentStatus: unknown, nextStatus: OutreachSendStatus): boolean {
  const currentRank = SEND_STATUS_RANK[String(currentStatus ?? "queued")] ?? 0
  const nextRank = SEND_STATUS_RANK[nextStatus] ?? 0
  return nextRank >= currentRank
}

function getTagValue(
  tags: Array<{ name: string; value: string }> | undefined,
  name: string,
): string | undefined {
  return tags?.find((t) => t.name === name)?.value
}

function extractRecipient(data: ResendEventEnvelope["data"]): string | null {
  if (Array.isArray(data.to)) return data.to[0] ?? null
  if (typeof data.to === "string") return data.to
  return null
}

function extractBounceType(data: ResendEventEnvelope["data"]): "hard" | "soft" | null {
  const raw =
    (typeof data.bounce === "object" && data.bounce?.type) ||
    (typeof data.bounce === "string" ? data.bounce : undefined) ||
    data.bounce_type ||
    null
  if (!raw) return null
  const v = String(raw).toLowerCase()
  if (v.includes("hard") || v === "permanent") return "hard"
  if (v.includes("soft") || v === "transient") return "soft"
  return null
}

export interface IngestArgs {
  providerEventId: string
  event: ResendEventEnvelope
}

export interface IngestResult {
  duplicate: boolean
  suppressed: boolean
  campaignHalted: boolean
}

export async function ingestResendEvent(args: IngestArgs): Promise<IngestResult> {
  const { providerEventId, event } = args
  const eventType = event.type
  const messageId = event.data.email_id ?? event.data.id ?? null
  const customId = getTagValue(event.data.tags, "custom_id") ?? null
  const recipient = extractRecipient(event.data)

  return prisma.$transaction(
    async (tx) => {
      const client = tx as unknown as TransactionClientLike

      try {
        await client.outreachWebhookEvent.create({
          data: {
            provider: "resend",
            providerEventId,
            messageId,
            eventType,
            payload: event as unknown as object,
          },
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return { duplicate: true, suppressed: false, campaignHalted: false }
        }
        throw error
      }

      const send = await (async () => {
        if (customId) {
          const byCustom = await client.outreachSend.findUnique({ where: { customId } })
          if (byCustom) return byCustom
        }
        if (messageId) {
          return client.outreachSend.findFirst({ where: { messageId } })
        }
        return null
      })()

      let suppressed = false
      let campaignHalted = false

      const sendStatus = mapEventToSendStatus(eventType)
      if (send && sendStatus) {
        const now = new Date()
        const updateData: Record<string, unknown> = {}
        if (shouldAdvanceSendStatus(send.status, sendStatus)) {
          updateData.status = sendStatus
        }
        if (sendStatus === "sent") updateData.sentAt = now
        if (sendStatus === "delivered") updateData.deliveredAt = now
        if (sendStatus === "opened") updateData.openedAt = now
        if (sendStatus === "clicked") updateData.clickedAt = now
        if (sendStatus === "bounced") {
          updateData.bouncedAt = now
          const bt = extractBounceType(event.data)
          if (bt) updateData.bounceType = bt
          const reason =
            (typeof event.data.bounce === "object" && event.data.bounce?.message) ||
            null
          if (reason) updateData.bounceReason = reason
        }
        if (sendStatus === "complained") updateData.complainedAt = now

        await client.outreachSend.update({ where: { id: send.id }, data: updateData })
      }

      if (eventType === "email.complained") {
        const emailForSuppression = recipient ?? send?.email
        if (emailForSuppression) {
          const result = await addSuppression(
            {
              email: emailForSuppression,
              reason: "COMPLAINED",
              source: "webhook",
              campaignId: null,
              note: `Resend complaint event ${providerEventId}`,
            },
            client,
          )
          suppressed = result === "inserted" || result === "duplicate"
        }
        if (send?.campaignId) {
          await client.outreachCampaign.update({
            where: { id: send.campaignId },
            data: {
              status: "halted",
              haltedAt: new Date(),
              haltReason: `Complaint received (send ${send.id})`,
            },
          })
          campaignHalted = true
        }
      }

      if (eventType === "email.bounced") {
        const bounceType = extractBounceType(event.data)
        const emailForSuppression = recipient ?? send?.email
        if (emailForSuppression && bounceType === "hard") {
          const result = await addSuppression(
            {
              email: emailForSuppression,
              reason: "HARD_BOUNCED",
              source: "webhook",
              campaignId: null,
              note: `Resend hard bounce ${providerEventId}`,
            },
            client,
          )
          suppressed = result === "inserted" || result === "duplicate"
        } else if (emailForSuppression && bounceType === "soft") {
          const recentSoft = await countRecentSoftBounces(
            emailForSuppression,
            OUTREACH_THRESHOLDS.SOFT_BOUNCE_WINDOW_DAYS,
            client,
          )
          if (recentSoft >= OUTREACH_THRESHOLDS.SOFT_BOUNCE_MAX_IN_WINDOW) {
            const result = await addSuppression(
              {
                email: emailForSuppression,
                reason: "SOFT_BOUNCED_REPEATED",
                source: "webhook",
                campaignId: null,
                note: `${recentSoft} soft bounces in rolling window`,
              },
              client,
            )
            suppressed = result === "inserted" || result === "duplicate"
          }
        }
      }

      await client.outreachWebhookEvent.updateMany({
        where: { provider: "resend", providerEventId },
        data: { processedAt: new Date() },
      })

      return { duplicate: false, suppressed, campaignHalted }
    },
    { isolationLevel: "Serializable" },
  )
}

/** Best-effort extractor for the provider event ID from a parsed envelope.
 * Resend includes an `id` at the top level of some event shapes; when absent,
 * we fall back to a hash of the stable parts of the payload so we still get
 * idempotency even without a provider-supplied ID. */
export function extractProviderEventId(
  event: ResendEventEnvelope,
  rawBody: string,
): string {
  const maybeId =
    (event as unknown as { id?: string }).id ??
    (event as unknown as { event_id?: string }).event_id ??
    null
  if (maybeId) return maybeId
  return crypto.createHash("sha256").update(rawBody).digest("hex")
}

export function isOutreachWebhookEventType(t: string): t is OutreachWebhookEventType {
  return [
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.opened",
    "email.clicked",
    "email.bounced",
    "email.complained",
  ].includes(t)
}

export { getOutreachWebhookSecret }
