import "server-only"
import { createHash,randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { neutralPrisma } from "@/lib/fulfillment-runtime/neutral-db"
import { verifyProviderRefund,type ProviderRefund } from "@/lib/fulfillment/neutral-refund-verification"
import { inNeutralTransaction,type NeutralDbExecutor } from "@/lib/fulfillment-runtime/neutral-db-executor"

type Db=NeutralDbExecutor
const db=()=>neutralPrisma() as unknown as Db
const ACTOR=/^admin:[A-Za-z0-9_-]{1,128}$/
const RECEIPT=/^re_[A-Za-z0-9]{8,64}$/
const enabled=()=>process.env.OT_NEUTRAL_REFUND_QUEUE_ENABLED==="true"
const verifyEnabled=()=>process.env.OT_NEUTRAL_REFUND_VERIFICATION_ENABLED==="true"
export type RefundRetriever=(id:string)=>Promise<ProviderRefund>
export {verifyProviderRefund}

export async function listNeutralRefundWork(options:{db?:Db}={}){
  if(!enabled())return {ok:false as const,blocker:"FLAG_DISABLED"}
  const rows=await (options.db??db()).$queryRaw<Array<{id:string;orderId:string;status:string;reasonCode:string;claimedAt:Date|null;confirmedAt:Date|null}>>(Prisma.sql`SELECT "id","order_id" "orderId","status"::text "status","reason_code" "reasonCode","claimed_at" "claimedAt","confirmed_at" "confirmedAt" FROM "ot_neutral_refund_work" WHERE "status"<>'REFUND_CONFIRMED' ORDER BY "created_at","id" LIMIT 100`)
  return {ok:true as const,items:rows}
}

export async function claimNeutralRefund(input:{id:string;actor:string},options:{db?:Db}={}){
  if(!enabled())return {ok:false as const,blocker:"FLAG_DISABLED"}
  if(!ACTOR.test(input.actor)||!input.id||input.id.length>128)return {ok:false as const,blocker:"INVALID_INPUT"}
  return inNeutralTransaction(options.db??db(),options.db,async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-refund:${input.id}`}))::text AS "locked"`)
    const attemptKey=randomUUID()
    const changed=await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_refund_work" SET "status"='REFUND_CLAIMED',"claimed_by"=${input.actor},"claimed_at"=clock_timestamp(),"provider_attempt_key"=${attemptKey},"updated_at"=clock_timestamp() WHERE "id"=${input.id} AND "status"='REFUND_REQUIRED'`)
    if(changed===1)return {ok:true as const,status:"REFUND_CLAIMED",refundInitiated:false,attemptKey}
    const row=(await tx.$queryRaw<Array<{status:string;claimedBy:string|null;attemptKey:string|null}>>(Prisma.sql`SELECT "status"::text "status","claimed_by" "claimedBy","provider_attempt_key" "attemptKey" FROM "ot_neutral_refund_work" WHERE "id"=${input.id}`))[0]
    return row?.status==="REFUND_CLAIMED"&&row.claimedBy===input.actor&&row.attemptKey?{ok:true as const,status:"REFUND_CLAIMED",refundInitiated:false,attemptKey:row.attemptKey}:{ok:false as const,blocker:"CLAIM_CONFLICT"}
  })
}

export async function recordNeutralRefundReceipt(input:{id:string;actor:string;providerReceiptId:string},options:{db?:Db}={}){
  if(!enabled())return {ok:false as const,blocker:"FLAG_DISABLED"}
  if(!ACTOR.test(input.actor)||!input.id||input.id.length>128||!RECEIPT.test(input.providerReceiptId))return {ok:false as const,blocker:"INVALID_INPUT"}
  const receiptSha256=createHash("sha256").update(`stripe-refund-receipt/v1\0${input.providerReceiptId}`).digest("hex")
  return inNeutralTransaction(options.db??db(),options.db,async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-refund:${input.id}`}))::text AS "locked"`)
    const changed=await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_refund_work" SET "status"='RECEIPT_RECORDED_PENDING_VERIFICATION',"provider_receipt_id"=${input.providerReceiptId},"provider_receipt_sha256"=${receiptSha256},"updated_at"=clock_timestamp() WHERE "id"=${input.id} AND "status"='REFUND_CLAIMED' AND "claimed_by"=${input.actor}`)
    if(changed===1)return {ok:true as const,status:"RECEIPT_RECORDED_PENDING_VERIFICATION",refundInitiated:false,receiptSha256}
    const row=(await tx.$queryRaw<Array<{status:string;claimedBy:string|null;providerReceiptSha256:string|null}>>(Prisma.sql`SELECT "status"::text "status","claimed_by" "claimedBy","provider_receipt_sha256" "providerReceiptSha256" FROM "ot_neutral_refund_work" WHERE "id"=${input.id}`))[0]
    return row?.status==="RECEIPT_RECORDED_PENDING_VERIFICATION"&&row.claimedBy===input.actor&&row.providerReceiptSha256===receiptSha256?{ok:true as const,status:row.status,refundInitiated:false,receiptSha256}:{ok:false as const,blocker:"RECEIPT_CONFLICT"}
  })
}

async function stripeRetrieve(id:string):Promise<ProviderRefund>{
  const {getStripe}=await import("@/lib/stripe/client");const stripe=getStripe()
  if(!stripe)throw new Error("STRIPE_UNAVAILABLE")
  return await stripe.refunds.retrieve(id) as ProviderRefund
}

export async function verifyNeutralRefundReceipt(input:{id:string;actor:string;retrieve?:RefundRetriever},options:{db?:Db}={}){
  if(!enabled()||!verifyEnabled())return {ok:false as const,blocker:"FLAG_DISABLED"}
  if(!ACTOR.test(input.actor)||!input.id||input.id.length>128)return {ok:false as const,blocker:"INVALID_INPUT"}
  const executor=options.db??db()
  const row=(await executor.$queryRaw<Array<{status:string;orderId:string;receiptId:string;bindingSha:string;sessionId:string|null;paymentIntent:string|null}>>(Prisma.sql`SELECT w."status"::text "status",w."order_id" "orderId",w."provider_receipt_id" "receiptId",w."payment_binding_sha256" "bindingSha",o."stripeSessionId" "sessionId",b."payment_intent" "paymentIntent" FROM "ot_neutral_refund_work" w JOIN "ot_neutral_runtime_order" o ON o."id"=w."order_id" LEFT JOIN "ot_neutral_runtime_payment_binding" b ON b."order_id"=o."id" AND b."session_id"=o."stripeSessionId" WHERE w."id"=${input.id}`))[0]
  if(!row||row.status!=="RECEIPT_RECORDED_PENDING_VERIFICATION"||!row.receiptId||!row.sessionId||!row.paymentIntent)return {ok:false as const,blocker:"NOT_PENDING_VERIFICATION"}
  const binding=createHash("sha256").update(`neutral-payment/v1\0${row.orderId}\0${row.sessionId}\0${row.paymentIntent}`).digest("hex")
  if(binding!==row.bindingSha)return {ok:false as const,blocker:"PAYMENT_BINDING_DRIFT"}
  let check:{ok:true}|{ok:false;reason:string}
  try{check=verifyProviderRefund(await (input.retrieve??stripeRetrieve)(row.receiptId),{receiptId:row.receiptId,paymentIntent:row.paymentIntent})}catch{
    // A provider outage is not evidence that the receipt is invalid. Preserve
    // the pending state so the same recorded receipt can be safely reverified.
    await executor.$executeRaw(Prisma.sql`UPDATE "ot_neutral_refund_work" SET "provider_lookup_attempts"="provider_lookup_attempts"+1,"last_provider_lookup_at"=clock_timestamp(),"last_provider_lookup_result"='RETRYABLE_PROVIDER_FAILURE',"updated_at"=clock_timestamp() WHERE "id"=${input.id} AND "status"='RECEIPT_RECORDED_PENDING_VERIFICATION'`)
    return {ok:false as const,blocker:"PROVIDER_LOOKUP_UNKNOWN",status:"RECEIPT_RECORDED_PENDING_VERIFICATION",retryable:true,refundInitiated:false}
  }
  return inNeutralTransaction(executor,options.db,async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-refund:${input.id}`}))::text AS "locked"`)
    if(!check.ok){await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_refund_work" SET "status"='RECEIPT_VERIFICATION_HELD',"verification_reason"=${check.reason},"verified_at"=clock_timestamp(),"provider_lookup_attempts"="provider_lookup_attempts"+1,"last_provider_lookup_at"=clock_timestamp(),"last_provider_lookup_result"='PROVIDER_RESPONSE_RECEIVED',"updated_at"=clock_timestamp() WHERE "id"=${input.id} AND "status"='RECEIPT_RECORDED_PENDING_VERIFICATION'`);return {ok:false as const,blocker:check.reason,status:"RECEIPT_VERIFICATION_HELD"}}
    const changed=await tx.$executeRaw(Prisma.sql`UPDATE "ot_neutral_refund_work" SET "status"='REFUND_CONFIRMED',"verification_reason"=NULL,"verified_at"=clock_timestamp(),"provider_lookup_attempts"="provider_lookup_attempts"+1,"last_provider_lookup_at"=clock_timestamp(),"last_provider_lookup_result"='PROVIDER_RESPONSE_RECEIVED',"confirmed_by"=${input.actor},"confirmed_at"=clock_timestamp(),"updated_at"=clock_timestamp() WHERE "id"=${input.id} AND "status"='RECEIPT_RECORDED_PENDING_VERIFICATION'`)
    return changed===1?{ok:true as const,status:"REFUND_CONFIRMED",refundInitiated:false}:{ok:false as const,blocker:"VERIFY_CONFLICT"}
  })
}
