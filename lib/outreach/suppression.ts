// Suppression is the terminal gate on any outreach send.
// Any email in this table for the global scope (campaign_id IS NULL) OR the
// active campaign must never receive a send, regardless of other signals.

import { prisma } from "@/lib/db"
import type { OutreachSuppressionReason, OutreachSuppressionSource } from "./types"

export interface AddSuppressionArgs {
  email: string
  reason: OutreachSuppressionReason
  source: OutreachSuppressionSource
  campaignId?: string | null
  note?: string
}

interface SuppressionStore {
  create(args: {
    data: {
      email: string
      emailLowercase: string
      campaignId: string | null
      reason: OutreachSuppressionReason
      source: OutreachSuppressionSource
      note: string | null
    }
  }): Promise<unknown>
  findFirst(args: {
    where: {
      emailLowercase: string
      OR: Array<{ campaignId: string | null }>
    }
    select: { id: true }
  }): Promise<{ id: string } | null>
}

interface SendStore {
  count(args: {
    where: {
      email: string
      bounceType: string
      bouncedAt: { gte: Date }
    }
  }): Promise<number>
}

interface SuppressionDbLike {
  outreachSuppression: SuppressionStore
  outreachSend: SendStore
}

function getDb(db?: SuppressionDbLike): SuppressionDbLike {
  return (db ?? prisma) as unknown as SuppressionDbLike
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const maybeCode = "code" in error ? String(error.code) : ""
  if (maybeCode === "P2002") return true

  const maybeMessage = "message" in error ? String(error.message) : ""
  return /unique constraint|duplicate key/i.test(maybeMessage)
}

/** Normalize email consistently across preflight + suppression + matching. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Duplicate-safe suppression insert.
 *
 * Real safety comes from the DB unique index on
 * (email_lowercase, coalesce(campaign_id,'__GLOBAL__'), reason).
 * When a concurrent insert races us, we treat the uniqueness error as a benign
 * duplicate and return without failing the caller.
 */
export async function addSuppression(
  args: AddSuppressionArgs,
  db?: SuppressionDbLike,
): Promise<"inserted" | "duplicate"> {
  const emailLowercase = normalizeEmail(args.email)
  const campaignId = args.campaignId ?? null
  const client = getDb(db)

  try {
    await client.outreachSuppression.create({
      data: {
        email: args.email,
        emailLowercase,
        campaignId,
        reason: args.reason,
        source: args.source,
        note: args.note ?? null,
      },
    })
    return "inserted"
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return "duplicate"
    }
    throw error
  }
}

/**
 * Returns true if the given email is suppressed either globally (campaign_id IS NULL)
 * or specifically for the supplied campaign.
 */
export async function isSuppressed(
  email: string,
  campaignId?: string | null,
  db?: SuppressionDbLike,
): Promise<boolean> {
  const emailLowercase = normalizeEmail(email)
  const client = getDb(db)
  const row = await client.outreachSuppression.findFirst({
    where: {
      emailLowercase,
      OR: [{ campaignId: null }, ...(campaignId ? [{ campaignId }] : [])],
    },
    select: { id: true },
  })
  return row !== null
}

/** Count soft bounces for an address within a rolling window (days). */
export async function countRecentSoftBounces(
  email: string,
  windowDays: number,
  db?: SuppressionDbLike,
): Promise<number> {
  const emailLowercase = normalizeEmail(email)
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  const client = getDb(db)
  return client.outreachSend.count({
    where: {
      email: emailLowercase,
      bounceType: "soft",
      bouncedAt: { gte: since },
    },
  })
}
