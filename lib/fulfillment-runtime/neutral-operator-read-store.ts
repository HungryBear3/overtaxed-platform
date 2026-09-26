import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { neutralPrisma } from "@/lib/fulfillment-runtime/neutral-db"
import { inNeutralTransaction, type NeutralDbExecutor } from "@/lib/fulfillment-runtime/neutral-db-executor"
import {
  decideNeutralOperatorRead,
  type NeutralOperatorReadContext,
} from "@/lib/fulfillment/neutral-operator-read"
import { neutralCustomerZipLocator } from "@/lib/fulfillment/neutral-customer-zip"
import { neutralBundleLocator, readNeutralBundle } from "@/lib/fulfillment-runtime/neutral-report-storage"
import { readNeutralCustomerZip } from "@/lib/fulfillment-runtime/neutral-customer-zip-storage"

type Db = NeutralDbExecutor
const db = () => neutralPrisma() as unknown as Db
const enabled = () => process.env.OT_NEUTRAL_OPERATOR_READ_ENABLED === "true"
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

/**
 * Everything the decision needs, read fresh in one statement.
 *
 * Commerce facts come through the `ot_neutral_runtime_*` views, which is the
 * only commerce access this role has. The latest artifact digest is derived from
 * the append-only artifact log (highest version), never from a denormalized
 * column, because no such column exists by design.
 */
const contextSql = (orderId: string) => Prisma.sql`
 SELECT r."id" AS "reservationId", r."status"::text AS "reservationStatus",
        r."bundle_sha256" AS "bundleSha256", r."manifest_sha256" AS "manifestSha256",
        r."pdf_sha256" AS "pdfSha256", r."csv_sha256" AS "csvSha256",
        r."customer_zip_sha256" AS "customerZipSha256",
        o."status" AS "orderStatus", o."stripeSessionId",
        b."payment_intent" AS "paymentIntent", x."payment_intent" AS "reversalIntent",
        q."status"::text AS "qaStatus", q."reviewer_key" AS "qaReviewerKey",
        q."artifact_sha256" AS "qaArtifactSha256",
        q."customer_artifact_sha256" AS "qaCustomerArtifactSha256",
        f."status"::text AS "fulfillmentStatus",
        (SELECT a."artifact_sha256" FROM "ot_fulfillment_artifact" a
          WHERE a."fulfillment_id"=q."fulfillment_id" ORDER BY a."version" DESC LIMIT 1) AS "latestArtifactSha256",
        (SELECT d."status"::text FROM "ot_neutral_manual_delivery" d
          WHERE d."reservation_id"=r."id" AND d."status" IN ('PREPARED','RECORDED','CONFIRMED') LIMIT 1) AS "deliveryStatus"
 FROM "ot_neutral_report_reservation" r
 JOIN "ot_neutral_runtime_order" o ON o."id"=r."order_id"
 LEFT JOIN "ot_neutral_runtime_payment_binding" b ON b."order_id"=o."id" AND b."session_id"=o."stripeSessionId"
 LEFT JOIN "ot_neutral_runtime_settlement_reversal" x ON x."payment_intent"=b."payment_intent"
 LEFT JOIN "ot_neutral_qa_review" q ON q."reservation_id"=r."id"
 LEFT JOIN "ot_fulfillment" f ON f."id"=q."fulfillment_id"
 WHERE r."order_id"=${orderId}`

type ContextRow = {
  reservationId: string; reservationStatus: string
  bundleSha256: string | null; manifestSha256: string | null
  pdfSha256: string | null; csvSha256: string | null; customerZipSha256: string | null
  orderStatus: string; stripeSessionId: string | null
  paymentIntent: string | null; reversalIntent: string | null
  qaStatus: string | null; qaReviewerKey: string | null
  qaArtifactSha256: string | null; qaCustomerArtifactSha256: string | null
  fulfillmentStatus: string | null; latestArtifactSha256: string | null
  deliveryStatus: string | null
}

function toContext(
  row: ContextRow,
  input: { actorKey: string; artifactKind: string; expectedSha256: string },
): NeutralOperatorReadContext {
  return {
    actorKey: input.actorKey,
    artifactKind: input.artifactKind,
    expectedSha256: input.expectedSha256,
    orderStatus: row.orderStatus,
    paymentAuthoritative:
      row.orderStatus === "PAID" && !!row.stripeSessionId && !!row.paymentIntent,
    settlementReversed: !!row.reversalIntent,
    reservationStatus: row.reservationStatus,
    bundleSha256: row.bundleSha256,
    manifestSha256: row.manifestSha256,
    pdfSha256: row.pdfSha256,
    csvSha256: row.csvSha256,
    customerZipSha256: row.customerZipSha256,
    qaStatus: row.qaStatus,
    qaReviewerKey: row.qaReviewerKey,
    qaArtifactSha256: row.qaArtifactSha256,
    qaCustomerArtifactSha256: row.qaCustomerArtifactSha256,
    latestArtifactSha256: row.latestArtifactSha256,
    fulfillmentStatus: row.fulfillmentStatus,
    deliveryStatus: row.deliveryStatus,
  }
}

export type NeutralOperatorReadResult =
  | {
      ok: true
      bytes: Buffer
      sha256: string
      byteSize: number
      artifactKind: string
      purpose: string
      mediaType: string
    }
  | { ok: false; blocker: string }

const MEDIA_TYPE: Record<string, string> = {
  INTERNAL_PDF: "application/pdf",
  INTERNAL_CSV: "text/csv; charset=utf-8",
  CUSTOMER_ZIP: "application/zip",
}

export type NeutralOperatorStorageReaders = {
  readBundle: typeof readNeutralBundle
  readCustomerZip: typeof readNeutralCustomerZip
}

/**
 * Serve an operator the exact verified bytes of one artifact, and audit it.
 *
 * Three properties this function exists to hold:
 *
 *  1. Bytes are never trusted from a locator. `readNeutralBundle` and
 *     `readNeutralCustomerZip` refuse on digest mismatch, and the component
 *     digest is then checked again here against the reservation's current
 *     identity. A locator that resolves is not evidence of anything.
 *  2. The audit row records the digest and byte size ACTUALLY served, and is
 *     written only after that verification succeeded. Every refusal path —
 *     authority, QA ownership, stale digest, storage mismatch — writes no audit
 *     row and mutates no state.
 *  3. Authority is re-read after the storage round trip and the decision is
 *     recomputed. A reversal that lands while the bytes were in flight refuses
 *     the serve rather than auditing it.
 *
 * It sends nothing, mints no capability, promotes nothing, and writes to exactly
 * one table.
 */
export async function readNeutralOperatorArtifact(
  input: { orderId: string; actorKey: string; artifactKind: string; expectedSha256: string },
  options: { db?: Db; storage?: Partial<NeutralOperatorStorageReaders> } = {},
): Promise<NeutralOperatorReadResult> {
  if (!enabled()) return { ok: false, blocker: "FLAG_DISABLED" }
  if (!input.orderId || input.orderId.length > 128) return { ok: false, blocker: "INVALID_INPUT" }

  const client = options.db ?? db()
  const readBundle = options.storage?.readBundle ?? readNeutralBundle
  const readCustomerZip = options.storage?.readCustomerZip ?? readNeutralCustomerZip

  // 1. Decide against fresh facts.
  const first = (await client.$queryRaw<ContextRow[]>(contextSql(input.orderId)))[0]
  if (!first) return { ok: false, blocker: "RESERVATION_NOT_FOUND" }
  const decision = decideNeutralOperatorRead(toContext(first, input))
  if (!decision.ok) return { ok: false, blocker: decision.blocker }

  // 2. Fetch through the digest-verifying helper and verify the component too.
  let bytes: Buffer
  try {
    if (decision.artifactKind === "CUSTOMER_ZIP") {
      bytes = await readCustomerZip(neutralCustomerZipLocator(decision.expectedSha256))
    } else {
      const bundle = await readBundle(
        neutralBundleLocator(decision.bundleSha256),
        decision.bundleSha256,
      )
      bytes = decision.artifactKind === "INTERNAL_PDF" ? bundle.pdf : bundle.csv
    }
  } catch {
    // The storage error message could quote a locator; only a closed code leaves.
    return { ok: false, blocker: "STORAGE_READ_FAILED" }
  }

  const servedSha256 = sha256(bytes)
  if (servedSha256 !== decision.expectedSha256 || bytes.length === 0)
    return { ok: false, blocker: "STORED_BYTES_MISMATCH" }

  // 3. Re-decide against facts read again, then audit, in one transaction.
  return inNeutralTransaction(client, options.db, async (tx) => {
    const current = (await tx.$queryRaw<ContextRow[]>(contextSql(input.orderId)))[0]
    if (!current) return { ok: false as const, blocker: "RESERVATION_NOT_FOUND" }
    const recheck = decideNeutralOperatorRead(toContext(current, input))
    if (!recheck.ok) return { ok: false as const, blocker: recheck.blocker }
    if (
      recheck.expectedSha256 !== servedSha256 ||
      recheck.bundleSha256 !== decision.bundleSha256 ||
      recheck.artifactKind !== decision.artifactKind
    )
      return { ok: false as const, blocker: "ARTIFACT_DIGEST_MISMATCH" }

    // `served_at` is deliberately absent: the runtime role holds no INSERT grant
    // on it, so the instant is always the database clock.
    const inserted = await tx.$executeRaw(
      Prisma.sql`INSERT INTO "ot_neutral_operator_artifact_read" ("id","reservation_id","order_id","actor_key","purpose","artifact_kind","sha256","reservation_bundle_sha256","byte_size") VALUES (${randomUUID()},${current.reservationId},${input.orderId},${input.actorKey},${recheck.purpose},${recheck.artifactKind},${servedSha256},${recheck.bundleSha256},${bytes.length})`,
    )
    if (inserted !== 1) return { ok: false as const, blocker: "AUDIT_WRITE_FAILED" }

    return {
      ok: true as const,
      bytes,
      sha256: servedSha256,
      byteSize: bytes.length,
      artifactKind: recheck.artifactKind,
      purpose: recheck.purpose,
      mediaType: MEDIA_TYPE[recheck.artifactKind] ?? "application/octet-stream",
    }
  })
}
