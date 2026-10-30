import "server-only"
import { Prisma, type PrismaClient } from "@prisma/client"
import { neutralPrisma } from "@/lib/fulfillment-runtime/neutral-db"
import { normalizePIN } from "@/lib/cook-county"
import { NEUTRAL_REPORT_COMMERCE_POLICY, neutralOrderReservationKey } from "@/lib/commerce/neutral-report-policy"
import { neutralSettledAmountAuthority, trustedPaymentAuthority } from "@/lib/fulfillment-runtime/payment-authority"

export type NeutralOrderAuthority = { orderId: string; propertyPin: string; reservationId: string; admissionSha256: string; dataEvidenceSha256: string; deadlineEvidenceSha256: string }

export type NeutralOrderAuthorityDb = Pick<PrismaClient, "$transaction">

// Trusted server code only: the caller supplies the client; nothing here reads
// the environment. The exported default below stays bound to neutralPrisma().
export function createNeutralOrderAuthorityResolver({ db }: { db: NeutralOrderAuthorityDb }): (orderId: string) => Promise<NeutralOrderAuthority | null> {
  return async orderId => {
  if (!orderId || orderId.length > 128) return null
  const rows = await db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(684921338)::text AS "locked"`)
    return tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    WITH slot AS (SELECT s FROM generate_series(1,10) s WHERE NOT EXISTS (SELECT 1 FROM "ot_neutral_report_reservation" x WHERE x."paid_cohort_position"=s) ORDER BY s LIMIT 1),
    admitted AS (UPDATE "ot_neutral_report_reservation" r SET "paid_cohort_position"=COALESCE(r."paid_cohort_position",(SELECT s FROM slot)),"paid_admitted_at"=COALESCE(r."paid_admitted_at",CURRENT_TIMESTAMP),"updated_at"=CURRENT_TIMESTAMP FROM "ot_neutral_runtime_order" o
    WHERE r."order_id"=o."id" AND o."id"=${orderId} AND (r."paid_cohort_position" IS NOT NULL OR EXISTS(SELECT 1 FROM slot))
      AND o."tier"='T2' AND o."status"='PAID' AND ${neutralSettledAmountAuthority("o")}
      AND o."checkoutPriceId" IS NOT NULL AND o."checkoutProductId" IS NOT NULL AND r."checkout_price_id"=o."checkoutPriceId" AND r."checkout_product_id"=o."checkoutProductId"
      AND ${trustedPaymentAuthority("o", true)} AND r."policy_version"=${NEUTRAL_REPORT_COMMERCE_POLICY.version} AND r."status" IN ('RESERVED','STAGED','PROMOTED')
    RETURNING r.*)
    SELECT o."id" AS "orderId", o."propertyPin", r."id" AS "reservationId", r."reservation_key" AS "reservationKey",
           r."policy_version" AS "policyVersion", r."admission_sha256" AS "admissionSha256",
           r."data_evidence_sha256" AS "dataEvidenceSha256", r."deadline_evidence_sha256" AS "deadlineEvidenceSha256"
    FROM "ot_neutral_runtime_order" o JOIN admitted r ON r."order_id"=o."id" LIMIT 1`)
  })
  const row = rows[0], pin = normalizePIN(String(row?.propertyPin ?? ""))
  if (!row || !/^\d{14}$/.test(pin) || row.reservationKey !== neutralOrderReservationKey(orderId)) return null
  for (const key of ["admissionSha256","dataEvidenceSha256","deadlineEvidenceSha256"] as const) if (!/^[0-9a-f]{64}$/.test(String(row[key] ?? ""))) return null
  return { orderId, propertyPin: pin, reservationId: String(row.reservationId), admissionSha256: String(row.admissionSha256), dataEvidenceSha256: String(row.dataEvidenceSha256), deadlineEvidenceSha256: String(row.deadlineEvidenceSha256) }
  }
}

export async function resolveNeutralOrderAuthority(orderId: string): Promise<NeutralOrderAuthority | null> {
  // Same guard first, so an invalid id never constructs the default client.
  if (!orderId || orderId.length > 128) return null
  return createNeutralOrderAuthorityResolver({ db: neutralPrisma() })(orderId)
}
