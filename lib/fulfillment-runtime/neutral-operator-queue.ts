import "server-only"

import { Prisma } from "@prisma/client"
import { neutralPrisma } from "@/lib/fulfillment-runtime/neutral-db"
import type { NeutralDbExecutor } from "@/lib/fulfillment-runtime/neutral-db-executor"
import {
  NEUTRAL_OPERATOR_QUEUE_MAX_ITEMS,
  toNeutralOperatorQueueItem,
  type NeutralOperatorQueueItem,
} from "@/lib/fulfillment/neutral-operator-queue"

type Db = NeutralDbExecutor
const db = () => neutralPrisma() as unknown as Db
const enabled = () => process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED === "true"

/**
 * Bounded, non-PII operator read model.
 *
 * Every selected column is either an opaque id, a status, a closed code, a
 * digest, or an instant. The order's email, address, and PIN are not selected —
 * not redacted afterwards, not selected — and the projection in
 * [[toNeutralOperatorQueueItem]] is an allowlist, so a column added to this
 * query later still cannot reach a response by default.
 *
 * Nothing here writes, sends, promotes, or mints anything.
 */
const queueSql = Prisma.sql`
 SELECT r."order_id" AS "orderId", r."id" AS "reservationId",
        o."status" AS "orderStatus", o."stripeSessionId",
        b."payment_intent" AS "paymentIntent", x."payment_intent" AS "reversalIntent",
        w."status"::text AS "generationStatus",
        r."status"::text AS "reservationStatus",
        r."bundle_sha256" AS "bundleSha256", r."manifest_sha256" AS "manifestSha256",
        r."customer_zip_sha256" AS "customerZipSha256",
        r."promoted_at" AS "promotedAt",
        q."status"::text AS "qaStatus", q."reason_code" AS "qaReasonCode",
        q."customer_artifact_sha256" AS "qaCustomerArtifactSha256",
        q."started_at" AS "qaStartedAt",
        n."status"::text AS "refundStatus",
        f."status"::text AS "fulfillmentStatus",
        (SELECT a."artifact_sha256" FROM "ot_fulfillment_artifact" a
          WHERE a."fulfillment_id"=q."fulfillment_id" ORDER BY a."version" DESC LIMIT 1) AS "latestArtifactSha256",
        d."status"::text AS "deliveryStatus", d."status_revision" AS "deliveryStatusRevision",
        c."class" AS "classification",
        r."updated_at" AS "updatedAt"
 FROM "ot_neutral_report_reservation" r
 JOIN "ot_neutral_runtime_order" o ON o."id"=r."order_id"
 LEFT JOIN "ot_neutral_runtime_payment_binding" b ON b."order_id"=o."id" AND b."session_id"=o."stripeSessionId"
 LEFT JOIN "ot_neutral_runtime_settlement_reversal" x ON x."payment_intent"=b."payment_intent"
 LEFT JOIN "ot_neutral_generation_work" w ON w."reservation_id"=r."id"
 LEFT JOIN "ot_neutral_qa_review" q ON q."reservation_id"=r."id"
 LEFT JOIN "ot_neutral_refund_work" n ON n."qa_review_id"=q."id"
 LEFT JOIN "ot_fulfillment" f ON f."id"=q."fulfillment_id"
 LEFT JOIN "ot_neutral_manual_delivery" d ON d."reservation_id"=r."id" AND d."status" IN ('PREPARED','RECORDED','CONFIRMED')
 LEFT JOIN "ot_neutral_order_classification" c ON c."order_id"=r."order_id"
 ORDER BY r."updated_at" DESC, r."id"
 LIMIT ${NEUTRAL_OPERATOR_QUEUE_MAX_ITEMS}`

type QueueRow = {
  orderId: string; reservationId: string
  orderStatus: string; stripeSessionId: string | null
  paymentIntent: string | null; reversalIntent: string | null
  generationStatus: string | null; reservationStatus: string
  bundleSha256: string | null; manifestSha256: string | null
  customerZipSha256: string | null; promotedAt: Date | null
  qaStatus: string | null; qaReasonCode: string | null
  qaCustomerArtifactSha256: string | null; qaStartedAt: Date | null
  refundStatus: string | null; fulfillmentStatus: string | null
  latestArtifactSha256: string | null
  deliveryStatus: string | null; deliveryStatusRevision: number | null
  classification: string | null; updatedAt: Date
}

export async function listNeutralOperatorQueue(
  options: { db?: Db } = {},
): Promise<{ ok: true; items: NeutralOperatorQueueItem[] } | { ok: false; blocker: string }> {
  if (!enabled()) return { ok: false, blocker: "FLAG_DISABLED" }
  const rows = await (options.db ?? db()).$queryRaw<QueueRow[]>(queueSql)
  return {
    ok: true,
    items: rows.map((row) =>
      toNeutralOperatorQueueItem({
        ...row,
        paymentAuthoritative:
          row.orderStatus === "PAID" && !!row.stripeSessionId && !!row.paymentIntent,
        settlementReversed: !!row.reversalIntent,
      }),
    ),
  }
}
