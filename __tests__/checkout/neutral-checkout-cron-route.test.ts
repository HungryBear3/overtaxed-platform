/** @jest-environment node */
jest.mock("@/lib/stripe/client",()=>({stripe:null}))
jest.mock("@/lib/fulfillment-runtime/neutral-checkout-reconciliation",()=>({reconcileNeutralCheckoutLeases:jest.fn()}))
import {GET} from "@/app/api/cron/neutral-checkout-reconciliation/route"
test("cron requires auth and remains disabled",async()=>{
 process.env.CRON_SECRET="secret";delete process.env.OT_NEUTRAL_CHECKOUT_RECONCILIATION_ENABLED
 expect((await GET(new Request("http://x") as any)).status).toBe(401)
 expect((await GET(new Request("http://x",{headers:{authorization:"Bearer secret"}}) as any)).status).toBe(503)
})
