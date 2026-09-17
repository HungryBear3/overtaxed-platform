import "server-only"
import {Prisma} from "@prisma/client"
import {neutralPrisma} from "@/lib/fulfillment-runtime/neutral-db"

type Candidate={reservationId:string;orderId:string;sessionIds:string[];trustedPaid:boolean;unresolvedAttempts:number}
type Session={id:string;status:string|null;payment_status:string;payment_intent:unknown;metadata?:Record<string,string>}
export type NeutralStripeReader={retrieve(id:string):Promise<Session>}
export function classifyNeutralStripeSession(row:{orderId:string;sessionId:string|null},session:Session):"RELEASE"|"HOLD"|"UNKNOWN"{
  if(!row.sessionId || session.id!==row.sessionId || session.metadata?.orderId!==row.orderId)return "UNKNOWN"
  return session.status==="expired"&&session.payment_status==="unpaid"&&!session.payment_intent?"RELEASE":"HOLD"
}

async function candidates():Promise<Candidate[]>{
  return (neutralPrisma() as any).$queryRaw(Prisma.sql`SELECT r."id" AS "reservationId",o."id" AS "orderId",COALESCE((SELECT jsonb_agg(DISTINCT x.sid) FROM (SELECT a."stripe_session_id" sid FROM "ot_neutral_checkout_attempt" a WHERE a."reservation_id"=r."id" AND a."stripe_session_id" IS NOT NULL UNION SELECT o."stripeSessionId" WHERE o."stripeSessionId" IS NOT NULL)x),'[]'::jsonb) AS "sessionIds",(SELECT count(*)::int FROM "ot_neutral_checkout_attempt" a WHERE a."reservation_id"=r."id" AND (a."stripe_session_id" IS NULL OR a."status"<>'SESSION_OBSERVED')) AS "unresolvedAttempts",(o."status"='PAID' OR EXISTS(SELECT 1 FROM "ot_neutral_runtime_payment_binding" b WHERE b.order_id=o."id" AND b.session_id=o."stripeSessionId" AND NOT EXISTS(SELECT 1 FROM "ot_neutral_runtime_settlement_reversal" v WHERE v.payment_intent=b.payment_intent))) AS "trustedPaid" FROM "ot_neutral_report_reservation" r JOIN "ot_neutral_runtime_order" o ON o."id"=r."order_id" WHERE (r."status"='RESERVED' AND r."precheckout_lease_expires_at"<=CURRENT_TIMESTAMP) OR (r."status"='RECONCILIATION_REQUIRED' AND r."reconciliation_code" LIKE 'STRIPE_%') ORDER BY r."precheckout_lease_expires_at",r."id" LIMIT 10`)
}
async function mark(id:string,status:"ABANDONED"|"RECONCILIATION_REQUIRED",code:string):Promise<void>{
  await (neutralPrisma() as any).$executeRaw(Prisma.sql`UPDATE "ot_neutral_report_reservation" SET "status"=${status}::"OTNeutralReservationStatus","reconciliation_code"=${code},"updated_at"=CURRENT_TIMESTAMP WHERE "id"=${id} AND "status" IN ('RESERVED','RECONCILIATION_REQUIRED')`)
}

/** Cron-compatible, default-off. The caller supplies the existing Stripe client's
 * checkout.sessions adapter; tests supply only a fake. */
export async function reconcileNeutralCheckoutLeases(reader:NeutralStripeReader,env:Readonly<Record<string,string|undefined>>=process.env,deps:{candidates:()=>Promise<Candidate[]>;mark:(id:string,status:"ABANDONED"|"RECONCILIATION_REQUIRED",code:string)=>Promise<void>}={candidates,mark}):Promise<{reviewed:number;released:number;held:number}>{
  if(env.OT_NEUTRAL_CHECKOUT_RECONCILIATION_ENABLED!=="1") return {reviewed:0,released:0,held:0}
  let reviewed=0,released=0,held=0
  for(const row of (await deps.candidates()).slice(0,10)){
    reviewed++
    if(row.trustedPaid){held++;continue}
    if(row.unresolvedAttempts>0){await deps.mark(row.reservationId,"RECONCILIATION_REQUIRED","STRIPE_ATTEMPT_UNRESOLVED");held++;continue}
    if(!row.sessionIds.length){await deps.mark(row.reservationId,"RECONCILIATION_REQUIRED","STRIPE_SESSION_MISSING");held++;continue}
    try{
      const decisions=[] as string[]
      for(const sessionId of row.sessionIds)decisions.push(classifyNeutralStripeSession({orderId:row.orderId,sessionId},await reader.retrieve(sessionId)))
      if(decisions.includes("UNKNOWN")){await deps.mark(row.reservationId,"RECONCILIATION_REQUIRED","STRIPE_SESSION_IDENTITY_MISMATCH");held++;continue}
      if(decisions.every(x=>x==="RELEASE")){await deps.mark(row.reservationId,"ABANDONED","STRIPE_CONFIRMED_ALL_ATTEMPTS_EXPIRED_UNPAID");released++;continue}
      held++
    }catch{await deps.mark(row.reservationId,"RECONCILIATION_REQUIRED","STRIPE_RETRIEVAL_UNKNOWN");held++}
  }
  return {reviewed,released,held}
}
