import {NextRequest,NextResponse} from "next/server"
import {stripe} from "@/lib/stripe/client"
import {reconcileNeutralCheckoutLeases} from "@/lib/fulfillment-runtime/neutral-checkout-reconciliation"
export const dynamic="force-dynamic"
export async function GET(request:NextRequest){
 const secret=process.env.CRON_SECRET
 if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401})
 const stripeClient=stripe
 if(process.env.OT_NEUTRAL_CHECKOUT_RECONCILIATION_ENABLED!=="1"||!stripeClient)return NextResponse.json({error:"Disabled"},{status:503})
 const result=await reconcileNeutralCheckoutLeases({retrieve:id=>stripeClient.checkout.sessions.retrieve(id) as any})
 return NextResponse.json({ok:true,...result})
}
