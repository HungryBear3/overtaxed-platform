import { NextRequest,NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/auth/session"
import { openNeutralQaReview,decideNeutralQaReview } from "@/lib/fulfillment-runtime/neutral-qa-store"

const OrderId=z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const Body=z.discriminatedUnion("action",[
  z.object({action:z.literal("OPEN")}).strict(),
  z.object({action:z.literal("DECIDE"),decision:z.enum(["approve","reject","unavailable","hold"]),reasonCode:z.enum(["QA_PASSED","REPORT_INCOMPLETE","SOURCE_EVIDENCE_UNAVAILABLE","ARTIFACT_DEFECT","HARD_STOP_EXCEEDED","PAYMENT_REVERSED","SUPERSEDED","DISPUTED","OPERATOR_HOLD"])}).strict(),
])
const json=(body:object,status:number)=>NextResponse.json(body,{status})

/** Authenticated operator boundary only. It never sends email or calls Stripe. */
export async function POST(request:NextRequest,context:{params:Promise<{orderId:string}>}){
  const session=await getSession(request),user=session?.user as {id?:unknown;role?:unknown}|undefined
  if(user?.role!=="ADMIN"||typeof user.id!=="string"||user.id.length<1||user.id.length>128)return json({ok:false,code:"UNAUTHORIZED"},401)
  try{if(request.headers.get("origin")!==new URL(request.url).origin)return json({ok:false,code:"INVALID_ORIGIN"},403)}catch{return json({ok:false,code:"INVALID_ORIGIN"},403)}
  if(request.headers.get("content-type")!=="application/json")return json({ok:false,code:"INVALID_CONTENT_TYPE"},400)
  const {orderId}=await context.params;if(!OrderId.safeParse(orderId).success)return json({ok:false,code:"INVALID_ORDER_ID"},400)
  const parsed=Body.safeParse(await request.json().catch(()=>undefined));if(!parsed.success)return json({ok:false,code:"INVALID_BODY"},400)
  try{
    const result=parsed.data.action==="OPEN"?await openNeutralQaReview({orderId,reviewerKey:`admin:${user.id}`}):await decideNeutralQaReview({orderId,reviewerKey:`admin:${user.id}`,decision:parsed.data.decision,reasonCode:parsed.data.reasonCode,minutesSpent:0})
    return json(result,result.ok?200:409)
  }catch{return json({ok:false,code:"INTERNAL_ERROR"},500)}
}
