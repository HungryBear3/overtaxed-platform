/** @jest-environment node */
jest.mock("server-only",()=>({}),{virtual:true})
import {classifyNeutralStripeSession,reconcileNeutralCheckoutLeases} from "@/lib/fulfillment-runtime/neutral-checkout-reconciliation"

const row={orderId:"ord_1",sessionId:"cs_1"}
const session=(patch:Record<string,unknown>={})=>({id:"cs_1",status:"expired",payment_status:"unpaid",payment_intent:null,metadata:{orderId:"ord_1"},...patch}) as any
test("only exact provider-confirmed expired unpaid session releases",()=>{
  expect(classifyNeutralStripeSession(row,session())).toBe("RELEASE")
  expect(classifyNeutralStripeSession(row,session({status:"open"}))).toBe("HOLD")
  expect(classifyNeutralStripeSession(row,session({status:"complete",payment_status:"paid",payment_intent:"pi_1"}))).toBe("HOLD")
  expect(classifyNeutralStripeSession(row,session({id:"cs_other"}))).toBe("UNKNOWN")
  expect(classifyNeutralStripeSession(row,session({metadata:{orderId:"ord_other"}}))).toBe("UNKNOWN")
  expect(classifyNeutralStripeSession({...row,sessionId:null},session())).toBe("UNKNOWN")
})
test("worker is inert by default and does not call Stripe",async()=>{
  const retrieve=jest.fn()
  await expect(reconcileNeutralCheckoutLeases({retrieve},{})).resolves.toEqual({reviewed:0,released:0,held:0})
  expect(retrieve).not.toHaveBeenCalled()
})
test("worker caps ten and repeated released rows are store-idempotent",async()=>{
 const rows=Array.from({length:12},(_,i)=>({reservationId:`r${i}`,orderId:`o${i}`,sessionIds:[`cs${i}`],trustedPaid:false,unresolvedAttempts:0}))
 const retrieve=jest.fn(async(id:string)=>session({id,metadata:{orderId:`o${id.slice(2)}`}})),mark=jest.fn(async()=>{})
 await expect(reconcileNeutralCheckoutLeases({retrieve},{OT_NEUTRAL_CHECKOUT_RECONCILIATION_ENABLED:"1"},{candidates:async()=>rows,mark})).resolves.toEqual({reviewed:10,released:10,held:0})
 expect(retrieve).toHaveBeenCalledTimes(10);expect(mark).toHaveBeenCalledTimes(10)
})
test("an earlier paid attempt blocks release when latest is expired",async()=>{
 const row={reservationId:"r",orderId:"o",sessionIds:["cs_paid","cs_expired"],trustedPaid:false,unresolvedAttempts:0}
 const retrieve=jest.fn(async(id:string)=>id==="cs_paid"?session({id,status:"complete",payment_status:"paid",payment_intent:"pi_1",metadata:{orderId:"o"}}):session({id,metadata:{orderId:"o"}}));const mark=jest.fn()
 await expect(reconcileNeutralCheckoutLeases({retrieve},{OT_NEUTRAL_CHECKOUT_RECONCILIATION_ENABLED:"1"},{candidates:async()=>[row],mark})).resolves.toEqual({reviewed:1,released:0,held:1});expect(mark).not.toHaveBeenCalled()
})
test("older expired session cannot release when a newer intent is unresolved",async()=>{
 const row={reservationId:"r",orderId:"o",sessionIds:["cs_old"],trustedPaid:false,unresolvedAttempts:1},retrieve=jest.fn(),mark=jest.fn(async()=>{})
 await expect(reconcileNeutralCheckoutLeases({retrieve},{OT_NEUTRAL_CHECKOUT_RECONCILIATION_ENABLED:"1"},{candidates:async()=>[row],mark})).resolves.toEqual({reviewed:1,released:0,held:1})
 expect(retrieve).not.toHaveBeenCalled();expect(mark).toHaveBeenCalledWith("r","RECONCILIATION_REQUIRED","STRIPE_ATTEMPT_UNRESOLVED")
})
