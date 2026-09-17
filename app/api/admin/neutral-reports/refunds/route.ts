import { NextRequest,NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/auth/session"
import { claimNeutralRefund,listNeutralRefundWork,recordNeutralRefundReceipt,verifyNeutralRefundReceipt } from "@/lib/fulfillment-runtime/neutral-refund-store"

const Body=z.discriminatedUnion("action",[
  z.object({action:z.literal("CLAIM"),id:z.string().min(1).max(128)}).strict(),
  z.object({action:z.literal("RECORD_RECEIPT"),id:z.string().min(1).max(128),providerReceiptId:z.string().regex(/^re_[A-Za-z0-9]{8,64}$/)}).strict(),
  z.object({action:z.literal("VERIFY"),id:z.string().min(1).max(128)}).strict(),
])
const json=(body:object,status=200)=>NextResponse.json(body,{status})
async function actor(request:NextRequest){const session=await getSession(request),user=session?.user as {id?:unknown;role?:unknown}|undefined;return user?.role==="ADMIN"&&typeof user.id==="string"&&user.id.length>=1&&user.id.length<=128?`admin:${user.id}`:null}
function sameOrigin(request:NextRequest){try{return request.headers.get("origin")===new URL(request.url).origin}catch{return false}}

export async function GET(request:NextRequest){const who=await actor(request);if(!who)return json({ok:false,code:"UNAUTHORIZED"},401);try{return json(await listNeutralRefundWork())}catch{return json({ok:false,code:"INTERNAL_ERROR"},500)}}
export async function POST(request:NextRequest){const who=await actor(request);if(!who)return json({ok:false,code:"UNAUTHORIZED"},401);if(!sameOrigin(request))return json({ok:false,code:"INVALID_ORIGIN"},403);if(request.headers.get("content-type")!=="application/json")return json({ok:false,code:"INVALID_CONTENT_TYPE"},400);const parsed=Body.safeParse(await request.json().catch(()=>undefined));if(!parsed.success)return json({ok:false,code:"INVALID_BODY"},400);try{const result=parsed.data.action==="CLAIM"?await claimNeutralRefund({id:parsed.data.id,actor:who}):parsed.data.action==="RECORD_RECEIPT"?await recordNeutralRefundReceipt({id:parsed.data.id,actor:who,providerReceiptId:parsed.data.providerReceiptId}):await verifyNeutralRefundReceipt({id:parsed.data.id,actor:who});return json(result,result.ok?200:409)}catch{return json({ok:false,code:"INTERNAL_ERROR"},500)}}
