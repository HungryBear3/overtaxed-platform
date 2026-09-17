import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { neutralPrisma } from "@/lib/fulfillment-runtime/neutral-db"
import { NEUTRAL_REPORT_COMMERCE_POLICY } from "@/lib/commerce/neutral-report-policy"
import { decideNeutralQa, type NeutralQaDecision } from "@/lib/fulfillment/neutral-qa"
import { inNeutralTransaction, type NeutralDbExecutor } from "@/lib/fulfillment-runtime/neutral-db-executor"

type Db = NeutralDbExecutor
const db = new Proxy({} as Db,{get(_t,key){const value=(neutralPrisma() as any)[key];return typeof value==="function"?value.bind(neutralPrisma()):value}})
const digest = (value:string) => createHash("sha256").update(value).digest("hex")
const REVIEWER = /^[a-z0-9][a-z0-9:_-]{2,63}$/

type Context = {
  reservationId:string; orderId:string; reservationStatus:string; policyVersion:string;
  propertyFingerprint:string; bundleSha256:string|null; dataEvidenceSha256:string;
  deadlineEvidenceSha256:string; manifestSha256:string|null; privateReferences:unknown;
  orderStatus:string; stripeSessionId:string|null; paymentIntent:string|null;
  reversalIntent:string|null; reviewId:string|null; reviewStatus:string|null;
  reviewReviewerKey:string|null; reviewArtifactSha256:string|null; reviewEvidenceSha256:string|null;
  reviewPaymentSha256:string|null; reviewPropertyFingerprint:string|null;
  reviewPolicyVersion:string|null; reviewWeekStart:Date|null; reviewStartedAt:Date|null;
}

const contextSql = (orderId:string) => Prisma.sql`
 SELECT r."id" AS "reservationId",r."order_id" AS "orderId",r."status"::text AS "reservationStatus",
 r."policy_version" AS "policyVersion",r."property_fingerprint" AS "propertyFingerprint",
 r."bundle_sha256" AS "bundleSha256",r."data_evidence_sha256" AS "dataEvidenceSha256",
 r."deadline_evidence_sha256" AS "deadlineEvidenceSha256",r."manifest_sha256" AS "manifestSha256",
 r."private_references" AS "privateReferences",o."status" AS "orderStatus",o."stripeSessionId",
 b."payment_intent" AS "paymentIntent",x."payment_intent" AS "reversalIntent",
 q."id" AS "reviewId",q."status"::text AS "reviewStatus",q."reviewer_key" AS "reviewReviewerKey",
 q."artifact_sha256" AS "reviewArtifactSha256",q."evidence_digest_sha256" AS "reviewEvidenceSha256",
 q."payment_binding_sha256" AS "reviewPaymentSha256",q."property_binding_fingerprint" AS "reviewPropertyFingerprint",
 q."policy_version" AS "reviewPolicyVersion"
 ,q."reviewer_week_start" AS "reviewWeekStart",q."started_at" AS "reviewStartedAt"
 FROM "ot_neutral_report_reservation" r JOIN "ot_neutral_runtime_order" o ON o."id"=r."order_id"
 LEFT JOIN "ot_neutral_runtime_payment_binding" b ON b."order_id"=o."id" AND b."session_id"=o."stripeSessionId"
 LEFT JOIN "ot_neutral_runtime_settlement_reversal" x ON x."payment_intent"=b."payment_intent"
 LEFT JOIN "ot_neutral_qa_review" q ON q."reservation_id"=r."id"
 WHERE r."order_id"=${orderId}`

async function lockReservation(tx:Db,orderId:string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ot_neutral_report_reservation" WHERE "order_id"=${orderId} FOR UPDATE`)
}

async function lockReview(tx:Db,orderId:string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ot_neutral_qa_review" WHERE "order_id"=${orderId} FOR UPDATE`)
}

function locator(value:unknown):string|null {
  if (!value || typeof value!=="object") return null
  const v=value as {locator?:unknown}; return typeof v.locator==="string" && v.locator.length<=1024 ? v.locator : null
}
async function enqueueRefund(tx:Db,row:Context,reasonCode:string){
  if(!row.reviewId||!row.reviewPaymentSha256||!row.reviewArtifactSha256)return false
  const inserted=await tx.$executeRaw(Prisma.sql`INSERT INTO "ot_neutral_refund_work" ("id","qa_review_id","order_id","status","reason_code","payment_binding_sha256","artifact_sha256","updated_at") VALUES (${randomUUID()},${row.reviewId},${row.orderId},'REFUND_REQUIRED',${reasonCode},${row.reviewPaymentSha256},${row.reviewArtifactSha256},clock_timestamp()) ON CONFLICT ("qa_review_id") DO NOTHING`)
  if(inserted===1)return true
  const existing=(await tx.$queryRaw<Array<{status:string;reasonCode:string;paymentBindingSha256:string;artifactSha256:string}>>(Prisma.sql`SELECT "status"::text "status","reason_code" "reasonCode","payment_binding_sha256" "paymentBindingSha256","artifact_sha256" "artifactSha256" FROM "ot_neutral_refund_work" WHERE "qa_review_id"=${row.reviewId}`))[0]
  return !!existing&&existing.reasonCode===reasonCode&&existing.paymentBindingSha256===row.reviewPaymentSha256&&existing.artifactSha256===row.reviewArtifactSha256
}

/** Creates/returns the durable pending ledger entry. It authorizes no delivery. */
export async function openNeutralQaReview(input:{orderId:string;reviewerKey:string}, options:{db?:Db}={}) {
  if (process.env.OT_NEUTRAL_QA_ENABLED!=="true") return {ok:false as const,blocker:"FLAG_DISABLED"}
  if (!REVIEWER.test(input.reviewerKey)) return {ok:false as const,blocker:"INVALID_REVIEWER"}
  return inNeutralTransaction(db,options.db,async tx=>{
    // The weekly pilot limit applies when work is accepted, not only when it is
    // approved. Serialize every open for this reviewer/week so two different
    // orders cannot both become the twenty-sixth review.
    const week=(await tx.$queryRaw<Array<{week:Date}>>(Prisma.sql`SELECT ((clock_timestamp() AT TIME ZONE 'America/Chicago')::date - (extract(isodow from clock_timestamp() AT TIME ZONE 'America/Chicago')::int-1))::date AS "week"`))[0]?.week
    if (!week) return {ok:false as const,blocker:"UNTRUSTED_CLOCK"}
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-qa-week:${input.reviewerKey}:${week.toISOString().slice(0,10)}`}))::text AS "locked"`)
    const opened=await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int AS n FROM "ot_neutral_qa_review" WHERE "reviewer_key"=${input.reviewerKey} AND "reviewer_week_start"=${week} AND "order_id"<>${input.orderId}`)
    if ((opened[0]?.n??0)>=NEUTRAL_REPORT_COMMERCE_POLICY.weeklyReviewerLimit) return {ok:false as const,blocker:"WEEKLY_REVIEW_LIMIT"}
    await lockReservation(tx,input.orderId)
    const row=(await tx.$queryRaw<Context[]>(contextSql(input.orderId)))[0]
    if (!row || row.reservationStatus!=="PROMOTED" || !row.bundleSha256 || !row.manifestSha256) return {ok:false as const,blocker:"ARTIFACT_NOT_PROMOTED"}
    if (row.orderStatus!=="PAID" || !row.stripeSessionId || !row.paymentIntent || row.reversalIntent) return {ok:false as const,blocker:"PAYMENT_NOT_AUTHORITATIVE"}
    const evidence=digest(`neutral-evidence/v1\0${row.dataEvidenceSha256}\0${row.deadlineEvidenceSha256}\0${row.manifestSha256}`)
    const payment=digest(`neutral-payment/v1\0${row.orderId}\0${row.stripeSessionId}\0${row.paymentIntent}`)
    const proposedId=randomUUID()
    await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`INSERT INTO "ot_neutral_qa_review" ("id","reservation_id","order_id","status","reviewer_key","reviewer_week_start","started_at","policy_version","artifact_sha256","evidence_digest_sha256","payment_binding_sha256","property_binding_fingerprint","updated_at") VALUES (${proposedId},${row.reservationId},${row.orderId},'IN_REVIEW',${input.reviewerKey},${week},clock_timestamp(),${row.policyVersion},${row.bundleSha256},${evidence},${payment},${row.propertyFingerprint},clock_timestamp()) ON CONFLICT ("reservation_id") DO NOTHING RETURNING "id"`)
    await lockReview(tx,input.orderId)
    const actual=(await tx.$queryRaw<Context[]>(contextSql(input.orderId)))[0]
    if(!actual?.reviewId || actual.reviewReviewerKey!==input.reviewerKey || actual.reviewArtifactSha256!==row.bundleSha256 || actual.reviewEvidenceSha256!==evidence || actual.reviewPaymentSha256!==payment || actual.reviewPropertyFingerprint!==row.propertyFingerprint || actual.reviewPolicyVersion!==row.policyVersion)
      return {ok:false as const,blocker:"QA_OPEN_CONFLICT"}
    return {ok:true as const,reviewId:actual.reviewId,targetMinutes:NEUTRAL_REPORT_COMMERCE_POLICY.humanQaTargetMinutes,hardStopMinutes:NEUTRAL_REPORT_COMMERCE_POLICY.humanQaHardStopMinutes}
  })
}

/** Records approval or a durable refund-required disposition. Never calls Stripe. */
export async function decideNeutralQaReview(input:{orderId:string;reviewerKey:string;decision:NeutralQaDecision;minutesSpent:number;reasonCode:string}, options:{db?:Db}={}) {
  if (process.env.OT_NEUTRAL_QA_ENABLED!=="true") return {ok:false as const,blocker:"FLAG_DISABLED"}
  if (!REVIEWER.test(input.reviewerKey)) return {ok:false as const,blocker:"INVALID_REVIEWER"}
  return inNeutralTransaction(db,options.db,async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-qa:${input.orderId}`}))::text AS "locked"`)
    await lockReservation(tx,input.orderId)
    await lockReview(tx,input.orderId)
    const row=(await tx.$queryRaw<Context[]>(contextSql(input.orderId)))[0]
    if (!row?.reviewId || !row.reviewStatus) return {ok:false as const,blocker:"QA_NOT_OPEN"}
    if (!row.bundleSha256 || !row.manifestSha256 || row.reservationStatus!=="PROMOTED") return {ok:false as const,blocker:"ARTIFACT_NOT_PROMOTED"}
    if (row.orderStatus!=="PAID" || !row.paymentIntent || row.reversalIntent) return {ok:false as const,blocker:"PAYMENT_NOT_AUTHORITATIVE"}
    const currentEvidence=digest(`neutral-evidence/v1\0${row.dataEvidenceSha256}\0${row.deadlineEvidenceSha256}\0${row.manifestSha256}`)
    const currentPayment=digest(`neutral-payment/v1\0${row.orderId}\0${row.stripeSessionId}\0${row.paymentIntent}`)
    if (row.reviewReviewerKey!==input.reviewerKey || row.reviewArtifactSha256!==row.bundleSha256 || row.reviewEvidenceSha256!==currentEvidence || row.reviewPaymentSha256!==currentPayment || row.reviewPropertyFingerprint!==row.propertyFingerprint)
      return {ok:false as const,blocker:"QA_BINDING_DRIFT"}
    if (!row.reviewWeekStart || !row.reviewStartedAt) return {ok:false as const,blocker:"QA_BINDING_DRIFT"}
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-qa-week:${input.reviewerKey}:${row.reviewWeekStart.toISOString().slice(0,10)}`}))::text AS "locked"`)
    const counts=await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`SELECT count(*)::int AS n FROM "ot_neutral_qa_review" WHERE "reviewer_key"=${input.reviewerKey} AND "reviewer_week_start"=(SELECT "reviewer_week_start" FROM "ot_neutral_qa_review" WHERE "id"=${row.reviewId}) AND "id"<>${row.reviewId}`)
    const timing=(await tx.$queryRaw<Array<{minutes:number}>>(Prisma.sql`SELECT greatest(1,ceil(extract(epoch FROM (clock_timestamp()-${row.reviewStartedAt}))/60)::int) AS "minutes"`))[0]
    if (!timing || !Number.isInteger(timing.minutes)) return {ok:false as const,blocker:"UNTRUSTED_CLOCK"}
    if (timing.minutes > NEUTRAL_REPORT_COMMERCE_POLICY.humanQaHardStopMinutes) {
      const stopped=await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_qa_review" SET "status"='REFUND_REQUIRED',"minutes_spent"=${NEUTRAL_REPORT_COMMERCE_POLICY.humanQaHardStopMinutes},"reason_code"='HARD_STOP_EXCEEDED',"decided_at"=clock_timestamp(),"updated_at"=clock_timestamp() WHERE "id"=${row.reviewId} AND "reviewer_key"=${input.reviewerKey} AND "status" IN ('PENDING','IN_REVIEW')`)
      return stopped===1 && await enqueueRefund(tx,row,"HARD_STOP_EXCEEDED") ? {ok:true as const,status:"REFUND_REQUIRED",refundInitiated:false,customerArtifactPending:false} : {ok:false as const,blocker:"QA_CONFLICT"}
    }
    const decision=decideNeutralQa({decision:input.decision,minutesSpent:timing.minutes,reasonCode:input.reasonCode,reservationStatus:row.reservationStatus,currentStatus:row.reviewStatus,weeklyDecisions:counts[0]?.n??0})
    if (!decision.ok) return decision
    const changed=decision.status==="APPROVED"
      ? await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_qa_review" q SET "status"='APPROVED',"minutes_spent"=${timing.minutes},"reason_code"=${input.reasonCode},"decided_at"=clock_timestamp(),"updated_at"=clock_timestamp() WHERE q."id"=${row.reviewId} AND q."reviewer_key"=${input.reviewerKey} AND q."status" IN ('PENDING','IN_REVIEW') AND EXISTS (SELECT 1 FROM "ot_neutral_runtime_order" o JOIN "ot_neutral_runtime_payment_binding" b ON b."order_id"=o."id" AND b."session_id"=o."stripeSessionId" WHERE o."id"=q."order_id" AND o."status"='PAID' AND o."tier"='T2' AND NOT EXISTS (SELECT 1 FROM "ot_neutral_runtime_settlement_reversal" x WHERE x."payment_intent"=b."payment_intent"))`)
      : await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_qa_review" SET "status"=${decision.status}::"OTNeutralQaStatus","minutes_spent"=${timing.minutes},"reason_code"=${input.reasonCode},"decided_at"=clock_timestamp(),"updated_at"=clock_timestamp() WHERE "id"=${row.reviewId} AND "reviewer_key"=${input.reviewerKey} AND "status" IN ('PENDING','IN_REVIEW')`)
    if(changed!==1 && decision.status==="APPROVED") {
      const held=await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_qa_review" q SET "status"='HELD',"minutes_spent"=${timing.minutes},"reason_code"='PAYMENT_REVERSED',"decided_at"=clock_timestamp(),"updated_at"=clock_timestamp() WHERE q."id"=${row.reviewId} AND q."status" IN ('PENDING','IN_REVIEW') AND EXISTS (SELECT 1 FROM "ot_neutral_runtime_order" o JOIN "ot_neutral_runtime_payment_binding" b ON b."order_id"=o."id" AND b."session_id"=o."stripeSessionId" JOIN "ot_neutral_runtime_settlement_reversal" x ON x."payment_intent"=b."payment_intent" WHERE o."id"=q."order_id")`)
      if(held===1)return {ok:false as const,blocker:"PAYMENT_NOT_AUTHORITATIVE"}
    }
    if(changed!==1) return {ok:false as const,blocker:"QA_CONFLICT"}
    if(decision.status==="REFUND_REQUIRED" && !await enqueueRefund(tx,row,input.reasonCode))return {ok:false as const,blocker:"REFUND_QUEUE_CONFLICT"}
    // Approval binds the reviewed internal bundle, but deliberately does not
    // masquerade that JSON evidence bundle as a customer-download artifact.
    // A separate promotion transaction must persist the exact customer package
    // hash/size/private locator before fulfillment can become ARTIFACT_READY.
    return {ok:true as const,status:decision.status,refundInitiated:false,customerArtifactPending:decision.status==="APPROVED"}
  })
}
