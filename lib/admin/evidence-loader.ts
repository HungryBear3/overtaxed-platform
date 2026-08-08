/**
 * OT T2 delivery-evidence — Phase 2 admin console server loader.
 *
 * Orchestrates admin auth, the default-off feature flag, and a read-only database
 * read into the pure `deriveAdminEvidenceView` projection. Boundaries:
 *   - returns `unauthorized` before touching the flag or the database;
 *   - returns `disabled` WITHOUT any Phase 1 database query when the flag is off
 *     (so ordinary production paths gain no Phase 1 runtime/DB dependency by default);
 *   - fetches only the minimal, non-private columns needed for the derivation —
 *     it never selects the storage locator, lease token, or idempotency key.
 * This slice is strictly read-only: no writes, provider calls, or mutations.
 */
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { t2FulfillmentEvidenceWritesEnabled } from "@/lib/fulfillment/flag"
import {
  deriveAdminEvidenceView,
  type AdminEvidenceView,
  type EvidenceFulfillmentInput,
} from "@/lib/fulfillment/admin-read-model"

export type AdminEvidenceLoadResult =
  | { kind: "unauthorized" }
  | { kind: "disabled" }
  | { kind: "not_found" }
  | { kind: "ok"; view: AdminEvidenceView }

const iso = (d: Date | string | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : String(d)

export async function loadAdminEvidenceView(
  orderId: string,
  opts?: { now?: string },
): Promise<AdminEvidenceLoadResult> {
  const session = await getSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  if (role !== "ADMIN") return { kind: "unauthorized" }

  // Default-off: no Phase 1 database query happens unless explicitly enabled.
  if (!t2FulfillmentEvidenceWritesEnabled()) return { kind: "disabled" }

  const now = opts?.now ?? new Date().toISOString()

  const order = await prisma.oTOrder.findUnique({
    where: { id: orderId },
    select: { id: true, tier: true, status: true, amountPaid: true, createdAt: true },
  })
  if (!order) return { kind: "not_found" }

  const fulfillment = await prisma.oTFulfillment.findFirst({
    where: { orderId },
    select: {
      id: true,
      kind: true,
      status: true,
      statusRevision: true,
      attemptCount: true,
      leaseOwner: true,
      leaseExpiresAt: true,
      lastReasonCode: true,
      createdAt: true,
      updatedAt: true,
      // NOTE: leaseToken, artifact.storageLocator, and attempt.idempotencyKey are
      // deliberately NOT selected — they never leave the database.
      artifacts: {
        select: {
          version: true,
          artifactSha256: true,
          byteSize: true,
          generatorVersion: true,
          templateVersion: true,
          createdAt: true,
        },
      },
      attempts: {
        select: {
          attemptNumber: true,
          artifactVersion: true,
          provider: true,
          providerMessageId: true,
          requestedAt: true,
          providerAcceptedAt: true,
          deliveredAt: true,
          delayedAt: true,
          failedAt: true,
          reasonCode: true,
          createdAt: true,
        },
      },
      events: {
        select: {
          provider: true,
          providerEventId: true,
          eventType: true,
          sequence: true,
          occurredAt: true,
          reasonCode: true,
          attemptNumber: true,
          receivedAt: true,
        },
      },
    },
  })

  const view = deriveAdminEvidenceView({
    order: {
      id: order.id,
      tier: String(order.tier),
      status: String(order.status),
      amountPaid: Number(order.amountPaid),
      createdAt: iso(order.createdAt) ?? "",
    },
    fulfillment: fulfillment ? mapFulfillment(fulfillment) : null,
    now,
  })

  return { kind: "ok", view }
}

type PrismaFulfillment = {
  id: string
  kind: string
  status: string
  statusRevision: number
  attemptCount: number
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  lastReasonCode: string | null
  createdAt: Date
  updatedAt: Date
  artifacts: Array<{
    version: number
    artifactSha256: string
    byteSize: number
    generatorVersion: string
    templateVersion: string | null
    createdAt: Date
  }>
  attempts: Array<{
    attemptNumber: number
    artifactVersion: number
    provider: string
    providerMessageId: string | null
    requestedAt: Date
    providerAcceptedAt: Date | null
    deliveredAt: Date | null
    delayedAt: Date | null
    failedAt: Date | null
    reasonCode: string | null
    createdAt: Date
  }>
  events: Array<{
    provider: string
    providerEventId: string
    eventType: string
    sequence: number
    occurredAt: Date
    reasonCode: string | null
    attemptNumber: number
    receivedAt: Date
  }>
}

function mapFulfillment(f: PrismaFulfillment): EvidenceFulfillmentInput {
  return {
    id: f.id,
    kind: String(f.kind),
    status: String(f.status),
    statusRevision: f.statusRevision,
    attemptCount: f.attemptCount,
    leaseOwner: f.leaseOwner,
    leaseExpiresAt: iso(f.leaseExpiresAt),
    lastReasonCode: f.lastReasonCode,
    createdAt: iso(f.createdAt) ?? "",
    updatedAt: iso(f.updatedAt) ?? "",
    artifacts: f.artifacts.map((a) => ({
      version: a.version,
      artifactSha256: a.artifactSha256,
      byteSize: a.byteSize,
      generatorVersion: a.generatorVersion,
      templateVersion: a.templateVersion,
      createdAt: iso(a.createdAt) ?? "",
    })),
    attempts: f.attempts.map((a) => ({
      attemptNumber: a.attemptNumber,
      artifactVersion: a.artifactVersion,
      provider: a.provider,
      providerMessageId: a.providerMessageId,
      requestedAt: iso(a.requestedAt) ?? "",
      providerAcceptedAt: iso(a.providerAcceptedAt),
      deliveredAt: iso(a.deliveredAt),
      delayedAt: iso(a.delayedAt),
      failedAt: iso(a.failedAt),
      reasonCode: a.reasonCode,
      createdAt: iso(a.createdAt) ?? "",
    })),
    events: f.events.map((e) => ({
      provider: e.provider,
      providerEventId: e.providerEventId,
      eventType: String(e.eventType),
      sequence: e.sequence,
      occurredAt: iso(e.occurredAt) ?? "",
      reasonCode: e.reasonCode,
      attemptNumber: e.attemptNumber,
      receivedAt: iso(e.receivedAt) ?? "",
    })),
  }
}
