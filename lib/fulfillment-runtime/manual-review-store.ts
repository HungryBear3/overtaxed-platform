import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import {
  decideEnterManualReview,
  type ManualReviewRefusalCode,
} from "@/lib/fulfillment/manual-review"
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types"

export type EnterManualReviewInput = {
  orderId: string
  actorUserId: string
  expectedStatus: OTFulfillmentStatus
  expectedStatusRevision: number
}

export type EnterManualReviewResult =
  | {
      ok: true
      outcome: "ENTERED_MANUAL_REVIEW"
      status: "MANUAL_REVIEW"
      statusRevision: number
    }
  | {
      ok: false
      code:
        | ManualReviewRefusalCode
        | "ORDER_NOT_FOUND"
        | "ORDER_NOT_T2"
        | "ORDER_NOT_PAID"
        | "STALE_STATE"
    }

type OrderRow = { id: string; status: string; tier: string }
type SummaryRow = {
  id: string
  status: string
  statusRevision: number
  attemptCount: number
  leaseOwner: string | null
  leaseToken: string | null
  leaseExpiresAt: Date | null
}

type TransactionLike = {
  $queryRaw<T>(query: unknown): Promise<T>
  oTFulfillment: {
    updateMany(input: unknown): Promise<{ count: number }>
  }
  oTDeliveryAttempt: { count(input: unknown): Promise<number> }
  oTDeliveryEvent: { count(input: unknown): Promise<number> }
  oTFulfillmentAdminEvent: { create(input: unknown): Promise<unknown> }
}

type PrismaLike = {
  $transaction<T>(work: (tx: TransactionLike) => Promise<T>): Promise<T>
}

export function createPrismaManualReviewStore(client: PrismaLike) {
  return {
    async enter(input: EnterManualReviewInput): Promise<EnterManualReviewResult> {
      return client.$transaction(async (tx) => {
        const orders = await tx.$queryRaw<OrderRow[]>(
          Prisma.sql`SELECT "id", "status", "tier" FROM "ot_order" WHERE "id" = ${input.orderId} FOR UPDATE`,
        )
        const order = orders[0]
        if (!order) return { ok: false, code: "ORDER_NOT_FOUND" }
        if (order.tier !== "T2") return { ok: false, code: "ORDER_NOT_T2" }
        if (order.status !== "PAID") return { ok: false, code: "ORDER_NOT_PAID" }

        const rows = await tx.$queryRaw<SummaryRow[]>(
          Prisma.sql`SELECT "id", "status", "status_revision" AS "statusRevision", "attempt_count" AS "attemptCount", "lease_owner" AS "leaseOwner", "lease_token" AS "leaseToken", "lease_expires_at" AS "leaseExpiresAt" FROM "ot_fulfillment" WHERE "order_id" = ${input.orderId} AND "kind" = 'T2_APPEAL_EVIDENCE' FOR UPDATE`,
        )
        const summary = rows[0]
        if (!summary) return { ok: false, code: "NO_FULFILLMENT_SUMMARY" }
        if (
          summary.status !== input.expectedStatus ||
          summary.statusRevision !== input.expectedStatusRevision
        ) return { ok: false, code: "STALE_STATE" }

        const [attemptRows, eventRows] = await Promise.all([
          tx.oTDeliveryAttempt.count({ where: { fulfillmentId: summary.id } }),
          tx.oTDeliveryEvent.count({ where: { fulfillmentId: summary.id } }),
        ])
        const decision = decideEnterManualReview({
          action: "ENTER_MANUAL_REVIEW",
          fulfillment: { ...summary, attemptRows, eventRows },
        })
        if (!decision.allowed) return { ok: false, code: decision.code }

        const changed = await tx.oTFulfillment.updateMany({
          where: {
            id: summary.id,
            orderId: input.orderId,
            kind: "T2_APPEAL_EVIDENCE",
            status: input.expectedStatus,
            statusRevision: input.expectedStatusRevision,
            attemptCount: 0,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
          data: {
            status: "MANUAL_REVIEW",
            statusRevision: { increment: 1 },
            lastReasonCode: "MANUAL_REVIEW",
          },
        })
        if (changed.count !== 1) return { ok: false, code: "STALE_STATE" }

        await tx.oTFulfillmentAdminEvent.create({
          data: {
            fulfillmentId: summary.id,
            action: decision.action,
            fromStatus: decision.fromStatus,
            toStatus: decision.targetStatus,
            fromRevision: decision.fromRevision,
            toRevision: decision.toRevision,
            reasonCode: decision.reasonCode,
            actorUserId: input.actorUserId,
          },
        })
        return {
          ok: true,
          outcome: "ENTERED_MANUAL_REVIEW",
          status: "MANUAL_REVIEW",
          statusRevision: decision.toRevision,
        }
      })
    },
  }
}

const store = createPrismaManualReviewStore(prisma as unknown as PrismaLike)

export function enterManualReview(
  input: EnterManualReviewInput,
): Promise<EnterManualReviewResult> {
  return store.enter(input)
}