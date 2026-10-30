import "server-only"
import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { neutralPrisma } from "@/lib/fulfillment-runtime/neutral-db"
import { normalizePIN } from "@/lib/cook-county"
import { NEUTRAL_REPORT_COMMERCE_POLICY, neutralOrderReservationKey } from "@/lib/commerce/neutral-report-policy"
import { neutralReportDigest, type NeutralReportReceipt, type NeutralReportRepository, type NeutralReportWrite } from "@/lib/fulfillment/neutral-report-content"
import { prepareNeutralBundle, readNeutralBundle, writePreparedNeutralBundle } from "@/lib/fulfillment-runtime/neutral-report-storage"
import { inNeutralTransaction,type NeutralDbExecutor } from "@/lib/fulfillment-runtime/neutral-db-executor"

type Row = { id: string; orderId: string; reservationKey: string; propertyFingerprint: string; propertyPin?:string; status: string; bundleSha256: string | null; privateReferences: unknown; sourceContentSha256?: string; deadlineIdentitySha256?: string; admissionSha256?: string; dataEvidenceSha256?: string; deadlineEvidenceSha256?: string }
type Db = NeutralDbExecutor
const db = new Proxy({} as Db,{get(_t,key){const value=(neutralPrisma() as any)[key];return typeof value==="function"?value.bind(neutralPrisma()):value}})
const fingerprint = (pin: string) => neutralReportDigest(`ot-neutral-property/v1\0${pin}`)
const ref = (row: Row): { locator: string; receipt: NeutralReportReceipt } | null => {
  if (!row.privateReferences || typeof row.privateReferences !== "object") return null
  const value = row.privateReferences as { locator?: unknown; receipt?: unknown }
  return typeof value.locator === "string" && value.receipt && typeof value.receipt === "object" ? { locator: value.locator, receipt: value.receipt as NeutralReportReceipt } : null
}
// jsonb does not preserve key order: compare stored receipts by sorted keys, never by insertion order.
const sortedJson = (value: object) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
async function byReservation(key: string): Promise<Row | null> {
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`SELECT "id", "order_id" AS "orderId", "reservation_key" AS "reservationKey", "property_fingerprint" AS "propertyFingerprint", "status"::text AS "status", "bundle_sha256" AS "bundleSha256", "private_references" AS "privateReferences" FROM "ot_neutral_report_reservation" WHERE "reservation_key"=${key} LIMIT 1`)
  return rows[0] ?? null
}

export const prismaNeutralReportRepository: NeutralReportRepository = {
  async reserveOrder(orderId, key, propertyPin) {
    const propertyFingerprint = fingerprint(propertyPin)
    const row = await byReservation(key)
    if (!row) return { outcome: "UNKNOWN" }
    if (row.orderId !== orderId || row.propertyFingerprint !== propertyFingerprint || !["RESERVED","STAGED","PROMOTED"].includes(row.status)) return { outcome: "CONFLICT" }
    return { outcome: "CONFIRMED", value: propertyPin }
  },
  async readOrderBinding(key) { const row = await byReservation(key); if (!row) return null; const rows = await db.$queryRaw<Array<{ propertyPin: string | null }>>(Prisma.sql`SELECT "propertyPin" FROM "ot_neutral_runtime_order" WHERE "id"=${row.orderId} LIMIT 1`); const pin = normalizePIN(rows[0]?.propertyPin ?? ""); return /^\d{14}$/.test(pin) ? pin : null },
  async reserve(orderId, key) {
    const rows = await db.$queryRaw<Row[]>(Prisma.sql`SELECT r."id", r."order_id" AS "orderId", r."reservation_key" AS "reservationKey", r."property_fingerprint" AS "propertyFingerprint", o."propertyPin", r."status"::text AS "status", r."bundle_sha256" AS "bundleSha256", r."private_references" AS "privateReferences" FROM "ot_neutral_report_reservation" r JOIN "ot_neutral_runtime_order" o ON o."id"=r."order_id" WHERE r."order_id"=${orderId} LIMIT 1`)
    if (!rows[0]) return {outcome:"UNKNOWN"}
    // Same canonical (sorted-key) form the producer hashes: orderId, productPolicyVersion, propertyPin.
    const expectedKey=`neutral-order/${neutralReportDigest(JSON.stringify({orderId,productPolicyVersion:NEUTRAL_REPORT_COMMERCE_POLICY.version,propertyPin:rows[0].propertyPin}))}`
    if (key!==expectedKey || rows[0].reservationKey!==neutralOrderReservationKey(orderId) || !["RESERVED","STAGED","PROMOTED"].includes(rows[0].status)) return {outcome:"CONFLICT"}
    const value = rows[0]?.status === "PROMOTED" ? ref(rows[0]) : null
    return { outcome: "CONFIRMED", value: value?.receipt ?? null }
  },
  async stage(_key, write) {
    const prepared = prepareNeutralBundle(write), receipt = receiptFromWrite(write)
    const orderId = String((JSON.parse(write.manifestJson) as { orderId?: unknown }).orderId ?? "")
    const rowBefore = await db.$queryRaw<Row[]>(Prisma.sql`SELECT r."id",r."order_id" AS "orderId",r."reservation_key" AS "reservationKey",r."property_fingerprint" AS "propertyFingerprint",o."propertyPin",r."status"::text AS "status",r."bundle_sha256" AS "bundleSha256",r."private_references" AS "privateReferences",r."source_content_sha256" AS "sourceContentSha256",r."deadline_identity_sha256" AS "deadlineIdentitySha256",r."admission_sha256" AS "admissionSha256",r."data_evidence_sha256" AS "dataEvidenceSha256",r."deadline_evidence_sha256" AS "deadlineEvidenceSha256" FROM "ot_neutral_report_reservation" r JOIN "ot_neutral_runtime_order" o ON o."id"=r."order_id" WHERE r."order_id"=${orderId} LIMIT 1`)
    const reservation = rowBefore[0]
    if (!reservation || !["RESERVED","STAGED"].includes(reservation.status)) return { outcome:"CONFLICT" }
    const generatedSourceContent=stableSourceContentSha256(write.manifestJson)
    const generatedDeadlineIdentity=stableDeadlineIdentitySha256(write.deadline)
    // Admission digests the checkout window snapshot; generation digests a later calendar read (its own
    // retrievedAt). The two deadline evidence digests never share a formula, so the calendar is compared by
    // identity (close date, source, status, township): unchanged stages, any change fails closed below.
    const expectedAdmission=neutralReportDigest(JSON.stringify({pin:reservation.propertyPin,policy:NEUTRAL_REPORT_COMMERCE_POLICY.version,data:receipt.dataEvidenceSha256,deadline:reservation.deadlineEvidenceSha256}))
    if (reservation.sourceContentSha256!==generatedSourceContent || reservation.deadlineIdentitySha256!==generatedDeadlineIdentity || reservation.dataEvidenceSha256!==receipt.dataEvidenceSha256 || reservation.admissionSha256!==expectedAdmission) {
      await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"='SUPERSEDED',"superseded_by_sha256"=${receipt.dataEvidenceSha256},"incident_code"='GENERATION_EVIDENCE_CHANGED',"updated_at"=CURRENT_TIMESTAMP WHERE "id"=${reservation.id} AND "status"='RESERVED'`)
      return { outcome:"CONFLICT" }
    }
    const intent=await db.$transaction(async tx=>{
      const locked=await tx.$queryRaw<Row[]>(Prisma.sql`SELECT "id","order_id" AS "orderId","reservation_key" AS "reservationKey","property_fingerprint" AS "propertyFingerprint","status"::text AS "status","bundle_sha256" AS "bundleSha256","private_references" AS "privateReferences" FROM "ot_neutral_report_reservation" WHERE "id"=${reservation.id} FOR UPDATE`)
      if (locked[0]?.status!=="RESERVED") return null
      const existing=await tx.$queryRaw<Array<{id:string;status:string}>>(Prisma.sql`SELECT "id","status"::text AS "status" FROM "ot_neutral_blob_attempt" WHERE "reservation_id"=${reservation.id} AND "storage_locator"=${prepared.locator} AND "bundle_sha256"=${prepared.sha256} LIMIT 1`)
      if (existing[0]) return existing[0].status==="INTENDED" ? existing[0] : null
      const attempts=await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT COALESCE(max("attempt_number"),0)::int AS n FROM "ot_neutral_blob_attempt" WHERE "reservation_id"=${reservation.id}`)
      const rows=await tx.$queryRaw<Array<{id:string;status:string}>>(Prisma.sql`INSERT INTO "ot_neutral_blob_attempt" ("id","reservation_id","attempt_number","storage_locator","bundle_sha256","byte_size") VALUES (${randomUUID()},${reservation.id},${(attempts[0]?.n??0)+1},${prepared.locator},${prepared.sha256},${prepared.bytes.byteLength}) RETURNING "id","status"::text AS "status"`)
      return rows[0]??null
    })
    if (!intent) return {outcome:"CONFLICT"}
    const attemptId=intent.id
    let stored: {locator:string;sha256:string}
    try { stored=await writePreparedNeutralBundle(prepared) }
    catch {
      await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_blob_attempt" SET "status"='WRITE_UNKNOWN',"reason_code"='BLOB_WRITE_OUTCOME_UNKNOWN',"observed_at"=CURRENT_TIMESTAMP WHERE "id"=${attemptId} AND "status"='INTENDED'`).catch(()=>{})
      await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"='RECONCILIATION_REQUIRED',"reconciliation_code"='BLOB_WRITE_OUTCOME_UNKNOWN',"updated_at"=CURRENT_TIMESTAMP WHERE "id"=${reservation.id} AND "status"='RESERVED'`).catch(()=>{})
      return { outcome:"UNKNOWN" }
    }
    await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_blob_attempt" SET "status"='WRITE_CONFIRMED',"observed_at"=CURRENT_TIMESTAMP WHERE "id"=${attemptId} AND "status"='INTENDED'`)
    const references = JSON.stringify({ locator: stored.locator, receipt, attemptId, admission: { admissionSha256: reservation.admissionSha256, dataEvidenceSha256: reservation.dataEvidenceSha256, deadlineEvidenceSha256: reservation.deadlineEvidenceSha256 } })
    try {
      const count = await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"='STAGED', "bundle_sha256"=${stored.sha256}, "manifest_sha256"=${receipt.manifestSha256}, "pdf_sha256"=${receipt.pdfSha256}, "csv_sha256"=${receipt.csvSha256}, "private_references"=${references}::jsonb, "staged_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP WHERE "order_id"=${orderId} AND "status"='RESERVED'`)
      if (count === 1) return { outcome: "CONFIRMED", value: undefined as never }
      const row = await findByBundleKey(write.key)
      return row?.status === "STAGED" && row.bundleSha256 === stored.sha256 ? { outcome: "CONFIRMED", value: undefined as never } : { outcome: "CONFLICT" }
    } catch {
      // The storage write may have committed and the database outcome is
      // unknown. Preserve its exact content address for operator reconciliation;
      // never delete or retry the immutable object inline.
      await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"='RECONCILIATION_REQUIRED', "bundle_sha256"=${stored.sha256}, "manifest_sha256"=${receipt.manifestSha256}, "pdf_sha256"=${receipt.pdfSha256}, "csv_sha256"=${receipt.csvSha256}, "private_references"=${references}::jsonb, "reconciliation_code"='STAGE_OUTCOME_UNKNOWN', "updated_at"=CURRENT_TIMESTAMP WHERE "order_id"=${orderId} AND "status"='RESERVED'`).catch(() => {})
      return { outcome: "UNKNOWN" }
    }
  },
  async readStaged(key) { const row = await findByBundleKey(key); const reference = row && ref(row); return row?.bundleSha256 && reference && row.status === "STAGED" ? readNeutralBundle(reference.locator, row.bundleSha256) : null },
  async promote(key, receipt) {
    const row = await findByBundleKey(key), reference = row && ref(row)
    if (!row || !reference || sortedJson(reference.receipt) !== sortedJson(receipt)) return { outcome: "CONFLICT" }
    const count = await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"='PROMOTED', "promoted_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP WHERE "order_id"=${row.orderId} AND "status"='STAGED'`)
    return count === 1 || row.status === "PROMOTED" ? { outcome: "CONFIRMED", value: receipt } : { outcome: "UNKNOWN" }
  },
  async readConfirmed(key) { const row = await findByBundleKey(key), reference = row && ref(row); if (!row?.bundleSha256 || !reference || row.status !== "PROMOTED") return null; try { return { write: await readNeutralBundle(reference.locator, row.bundleSha256), receipt: reference.receipt } } catch { await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"='COMPROMISED',"incident_code"='PROMOTED_STORAGE_CORRUPTION',"reconciliation_code"='OPERATOR_INCIDENT_REQUIRED',"updated_at"=CURRENT_TIMESTAMP WHERE "id"=${row.id} AND "status"='PROMOTED'`).catch(()=>{}); return null } },
  async quarantine(key) { const row = await findByBundleKey(key); if (row) await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"='QUARANTINED', "reconciliation_code"='CONTENT_OR_BINDING_AMBIGUOUS', "updated_at"=CURRENT_TIMESTAMP WHERE "order_id"=${row.orderId} AND "status" <> 'PROMOTED'`) },
}
class AdmissionRollback extends Error {
  constructor(readonly blocker: string) { super(blocker) }
}

/** Binding refusal must escape the local transaction, including a joined/revived row.
 * An unacknowledged COMMIT is unknown: never compensate or dispatch this request. */
export async function prepareNeutralCheckoutAdmissionOrder(
  input: Parameters<typeof reserveNeutralCheckoutOrder>[0],
  bind: () => Promise<{ ok: true } | { ok: false; blocker: string }>,
) {
  // This is a request deadline, not cancellation of the immutable binder.
  // Expire before the 10s server idle limit / 15s Prisma timer so the callback
  // rejects and Prisma can roll back normally, rather than timing out detached.
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(new AdmissionRollback('NEUTRAL_RESERVATION_UNKNOWN'))
    }, 8000)
  })
  const checkDeadline = () => {
    if (expired) throw new AdmissionRollback('NEUTRAL_RESERVATION_UNKNOWN')
  }
  try {
    const transaction = db.$transaction(tx => Promise.race([(async () => {
      checkDeadline()
      await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '2s'`)
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '3s'`)
      await tx.$executeRaw(Prisma.sql`SET LOCAL idle_in_transaction_session_timeout = '10s'`)
      const reserved = await reserveNeutralCheckoutOrder(input, { db: tx })
      checkDeadline()
      if (!reserved.ok) throw new AdmissionRollback(reserved.blocker)
      const bound = await bind()
      checkDeadline()
      if (!bound.ok) throw new AdmissionRollback(bound.blocker)
      return reserved
    })(), deadline]), { timeout: 15000, maxWait: 5000 })
    // Observe late transaction/rollback rejection without delaying the response.
    // The inner race also settles the callback; racing only the transaction
    // would leave it pending. Neither race deletes or compensates a late bind.
    return await Promise.race([transaction, deadline])
  } catch (error) {
    return { ok: false as const, blocker: error instanceof AdmissionRollback ? error.blocker : 'NEUTRAL_RESERVATION_UNKNOWN' }
  } finally {
    clearTimeout(timer)
  }
}

export async function reserveNeutralCheckoutOrder(input: { orderId: string; propertyPin: string; dataEvidenceSha256: string; sourceContentSha256: string; officialRetrievedAt: string; officialOldestRetrievedAt:string; deadlineEvidenceSha256: string; deadlineIdentitySha256: string; deadlineRetrievedAt: string; admissionSha256: string },options:{db?:Db}={}) {
  if (process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED !== "true") return { ok: false as const, blocker: "NEUTRAL_CHECKOUT_DISABLED" }
  const key = neutralOrderReservationKey(input.orderId)
  const digests = [input.dataEvidenceSha256,input.sourceContentSha256,input.deadlineEvidenceSha256,input.deadlineIdentitySha256,input.admissionSha256]
  const officialAt = strictInstant(input.officialRetrievedAt), oldestAt=strictInstant(input.officialOldestRetrievedAt), deadlineAt = strictInstant(input.deadlineRetrievedAt)
  if (!/^\d{14}$/.test(input.propertyPin) || digests.some(v => !/^[0-9a-f]{64}$/.test(v)) || !officialAt || !oldestAt || !deadlineAt || oldestAt>officialAt) return { ok: false as const, blocker: "NEUTRAL_ADMISSION_INVALID" }
  const now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000
  if (oldestAt.getTime()>now || officialAt.getTime() > now || deadlineAt.getTime() > now || now-oldestAt.getTime()>maxAgeMs || now - officialAt.getTime() > maxAgeMs || now - deadlineAt.getTime() > maxAgeMs) return { ok: false as const, blocker: "NEUTRAL_ADMISSION_STALE" }
  const derivedMaxAgeSeconds=Math.floor((now-oldestAt.getTime())/1000)
  const id = randomUUID(), propertyFingerprint = fingerprint(input.propertyPin)
  const reservedAt = new Date()
  const leaseExpiresAt=new Date(reservedAt.getTime()+30*60*1000)
  try {
    return await inNeutralTransaction(db,options.db,async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(684921337)::text AS "locked"`)
      // An order's admitted evidence identity is immutable once written (any status, including
      // ABANDONED): a different evidence pair is refused here, atomically, whichever request won.
      const prior = (await tx.$queryRaw<Array<{ data: string; source: string }>>(Prisma.sql`SELECT "data_evidence_sha256" AS "data","source_content_sha256" AS "source" FROM "ot_neutral_report_reservation" WHERE "order_id"=${input.orderId} FOR UPDATE`))[0]
      if (prior && (prior.data !== input.dataEvidenceSha256 || prior.source !== input.sourceContentSha256)) return { ok:false as const, blocker:"NEUTRAL_EVIDENCE_CONFLICT" }
      const revived = await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" r SET "status"='RESERVED',"reviewer_key"='pilot-primary',"reviewer_week_start"=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date - ((extract(isodow from CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::int)-1),"cohort_position"=(SELECT slot FROM generate_series(1,10) slot WHERE NOT EXISTS(SELECT 1 FROM "ot_neutral_report_reservation" x WHERE x."cohort_position"=slot AND x."status"<>'ABANDONED') ORDER BY slot LIMIT 1),"precheckout_lease_expires_at"=${leaseExpiresAt},"admission_sha256"=${input.admissionSha256},"data_evidence_sha256"=${input.dataEvidenceSha256},"deadline_evidence_sha256"=${input.deadlineEvidenceSha256},"source_content_sha256"=${input.sourceContentSha256},"deadline_identity_sha256"=${input.deadlineIdentitySha256},"official_retrieved_at"=${officialAt},"official_oldest_retrieved_at"=${oldestAt},"official_max_age_seconds"=${derivedMaxAgeSeconds},"deadline_retrieved_at"=${deadlineAt},"reconciliation_code"=NULL,"updated_at"=${reservedAt} FROM "ot_neutral_runtime_order" o WHERE r."order_id"=o."id" AND r."order_id"=${input.orderId} AND r."status"='ABANDONED' AND r."reservation_key"=${key} AND r."property_fingerprint"=${propertyFingerprint} AND o."propertyPin"=${input.propertyPin} AND o."status" IN ('CHECKOUT_PENDING','CHECKOUT_FAILED') AND o."stripeSessionId" IS NULL AND o."amountPaid"=0
          AND o."tier"='T2' AND o."checkoutAmountCents"=6900 AND lower(o."checkoutCurrency")='usd' AND o."checkoutPriceId" IS NOT NULL AND o."checkoutProductId" IS NOT NULL
          AND o."eligibilitySnapshot"->>'policyVersion'=${NEUTRAL_REPORT_COMMERCE_POLICY.version}
          AND (SELECT count(*) FROM "ot_neutral_report_reservation" WHERE "status"<>'ABANDONED') < 10
          AND (SELECT count(*) FROM "ot_neutral_report_reservation" WHERE "reviewer_key"='pilot-primary' AND "reviewer_week_start"=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date - ((extract(isodow from CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::int)-1) AND "status"<>'ABANDONED') < 25`)
      const inserted = await tx.$queryRaw<Row[]>(Prisma.sql`
        INSERT INTO "ot_neutral_report_reservation" ("id","order_id","policy_version","property_fingerprint","reservation_key","checkout_price_id","checkout_product_id","admission_sha256","data_evidence_sha256","deadline_evidence_sha256","source_content_sha256","deadline_identity_sha256","official_retrieved_at","official_oldest_retrieved_at","official_max_age_seconds","deadline_retrieved_at","cohort_position","precheckout_lease_expires_at","reviewer_key","reviewer_week_start","created_at","updated_at")
        SELECT ${id},o."id",${NEUTRAL_REPORT_COMMERCE_POLICY.version},${propertyFingerprint},${key},o."checkoutPriceId",o."checkoutProductId",${input.admissionSha256},${input.dataEvidenceSha256},${input.deadlineEvidenceSha256},${input.sourceContentSha256},${input.deadlineIdentitySha256},${officialAt},${oldestAt},${derivedMaxAgeSeconds},${deadlineAt},
               (SELECT slot FROM generate_series(1,10) slot WHERE NOT EXISTS (SELECT 1 FROM "ot_neutral_report_reservation" r WHERE r."cohort_position"=slot AND r."status"<>'ABANDONED') ORDER BY slot LIMIT 1),${leaseExpiresAt},
               'pilot-primary',(CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date - ((extract(isodow from CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::int)-1),${reservedAt},${reservedAt}
        FROM "ot_neutral_runtime_order" o WHERE o."id"=${input.orderId} AND o."tier"='T2' AND o."propertyPin"=${input.propertyPin}
          AND o."status" IN ('CHECKOUT_PENDING','CHECKOUT_FAILED') AND o."stripeSessionId" IS NULL
          AND o."checkoutAmountCents"=6900 AND lower(o."checkoutCurrency")='usd' AND o."checkoutPriceId" IS NOT NULL AND o."checkoutProductId" IS NOT NULL
          AND o."eligibilitySnapshot"->>'policyVersion'=${NEUTRAL_REPORT_COMMERCE_POLICY.version}
          AND (SELECT count(*) FROM "ot_neutral_report_reservation" WHERE "status"<>'ABANDONED') < 10
          AND (SELECT count(*) FROM "ot_neutral_report_reservation" WHERE "reviewer_key"='pilot-primary' AND "reviewer_week_start"=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date - ((extract(isodow from CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::int)-1) AND "status"<>'ABANDONED') < 25
        ON CONFLICT ("order_id") DO NOTHING RETURNING "id","order_id" AS "orderId","reservation_key" AS "reservationKey","property_fingerprint" AS "propertyFingerprint","status"::text AS "status","bundle_sha256" AS "bundleSha256","private_references" AS "privateReferences"`)
      const row = inserted[0] ?? (await tx.$queryRaw<Row[]>(Prisma.sql`SELECT "id","order_id" AS "orderId","reservation_key" AS "reservationKey","property_fingerprint" AS "propertyFingerprint","status"::text AS "status","bundle_sha256" AS "bundleSha256","private_references" AS "privateReferences" FROM "ot_neutral_report_reservation" WHERE "order_id"=${input.orderId} FOR UPDATE`))[0]
      if (!row || row.reservationKey!==key || row.propertyFingerprint!==propertyFingerprint || row.status!=="RESERVED") return { ok:false as const, blocker:"NEUTRAL_RESERVATION_CONFLICT" }
      // `created`: this call inserted or revived the row (it did not join another request's live row).
      return { ok:true as const, created: Boolean(inserted[0]) || revived === 1 }
    })
  } catch (error) {
    if (process.env.OT_NEUTRAL_TEST_RUNTIME_URL) throw error
    return { ok:false as const, blocker:"NEUTRAL_RESERVATION_UNKNOWN" }
  }
}
function receiptFromWrite(write: NeutralReportWrite): NeutralReportReceipt { const manifest = JSON.parse(write.manifestJson) as { dataEvidenceSha256: string; deadlineEvidenceSha256: string }; return { key: write.key, manifestSha256: neutralReportDigest(write.manifestJson), pdfSha256: neutralReportDigest(write.pdf), csvSha256: neutralReportDigest(write.csv), dataEvidenceSha256: manifest.dataEvidenceSha256, deadlineEvidenceSha256: manifest.deadlineEvidenceSha256 } }
function strictInstant(value: string): Date | null { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null; const ms=Date.parse(value); return Number.isFinite(ms) ? new Date(ms) : null }
function stableSourceContentSha256(manifestJson:string):string { try { const m=JSON.parse(manifestJson) as {sources:Array<{datasetId:string;url:string;contentSha256:string}>}; return neutralReportDigest(JSON.stringify(m.sources.map(s=>({datasetId:s.datasetId,url:s.url,contentSha256:s.contentSha256})).sort((a,b)=>a.url.localeCompare(b.url)))) } catch { return "" } }
function stableDeadlineIdentitySha256(value:unknown):string { const d=value as Record<string,unknown>; return neutralReportDigest(JSON.stringify({closeDate:d?.closeDate,openDate:d?.openDate,sourceUrl:d?.sourceUrl,status:d?.status,townshipKey:d?.townshipKey})) }
async function findByBundleKey(key: string): Promise<Row | null> { const rows = await db.$queryRaw<Row[]>(Prisma.sql`SELECT "id", "order_id" AS "orderId", "reservation_key" AS "reservationKey", "property_fingerprint" AS "propertyFingerprint", "status"::text AS "status", "bundle_sha256" AS "bundleSha256", "private_references" AS "privateReferences" FROM "ot_neutral_report_reservation" WHERE "private_references"->'receipt'->>'key'=${key} LIMIT 1`); return rows[0] ?? null }

export async function abandonNeutralCheckoutReservation(orderId: string,options:{db?:Db}={}): Promise<boolean> {
  const count = await (options.db??db).$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" r SET "status"='ABANDONED',"reconciliation_code"='CHECKOUT_NEVER_CREATED',"updated_at"=CURRENT_TIMESTAMP FROM "ot_neutral_runtime_order" o WHERE r."order_id"=o."id" AND o."id"=${orderId} AND o."status"='CHECKOUT_FAILED' AND o."stripeSessionId" IS NULL AND o."amountPaid"=0 AND r."status"='RESERVED'`)
  return count===1
}

export async function markNeutralCheckoutOutcomeUnknown(orderId:string,options:{db?:Db}={}):Promise<boolean>{
  const count=await (options.db??db).$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"='RECONCILIATION_REQUIRED',"reconciliation_code"='STRIPE_CHECKOUT_OUTCOME_UNKNOWN',"updated_at"=CURRENT_TIMESTAMP WHERE "order_id"=${orderId} AND "status"='RESERVED'`)
  return count===1
}
export async function intendNeutralStripeCheckout(input:{orderId:string;checkoutKey:string;idempotencyKey:string;contractSha256:string}):Promise<string|null>{
  if(!/^[0-9a-f]{64}$/.test(input.contractSha256))return null
  const id=randomUUID()
  const rows=await db.$queryRaw<Array<{id:string}>>(Prisma.sql`INSERT INTO "ot_neutral_checkout_attempt" ("id","reservation_id","order_id","checkout_key","idempotency_key","contract_sha256") SELECT ${id},r."id",r."order_id",${input.checkoutKey},${input.idempotencyKey},${input.contractSha256} FROM "ot_neutral_report_reservation" r WHERE r."order_id"=${input.orderId} AND r."status"='RESERVED' ON CONFLICT ("idempotency_key") DO UPDATE SET "idempotency_key"=EXCLUDED."idempotency_key" WHERE "ot_neutral_checkout_attempt"."order_id"=EXCLUDED."order_id" AND "ot_neutral_checkout_attempt"."reservation_id"=EXCLUDED."reservation_id" AND "ot_neutral_checkout_attempt"."checkout_key"=EXCLUDED."checkout_key" AND "ot_neutral_checkout_attempt"."contract_sha256"=EXCLUDED."contract_sha256" RETURNING "id"`)
  return rows[0]?.id??null
}
export async function observeNeutralStripeCheckout(attemptId:string,session:{id:string;status:string|null}):Promise<boolean>{
 const count=await db.$executeRaw(Prisma.sql`UPDATE "ot_neutral_checkout_attempt" SET "status"='SESSION_OBSERVED',"stripe_session_id"=${session.id},"stripe_status"=${session.status},"observed_at"=CURRENT_TIMESTAMP WHERE "id"=${attemptId} AND "status"='INTENDED'`);return count===1
}
