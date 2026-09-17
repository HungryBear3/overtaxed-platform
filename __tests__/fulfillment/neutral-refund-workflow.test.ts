import fs from "node:fs"
import path from "node:path"

const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8")

describe("neutral refund operator workflow",()=>{
  const store=read("lib/fulfillment-runtime/neutral-refund-store.ts")
  const route=read("app/api/admin/neutral-reports/refunds/route.ts")
  const qa=read("lib/fulfillment-runtime/neutral-qa-store.ts")

  it("is default-off, admin/same-origin gated, and never creates a Stripe refund",()=>{
    expect(store).toContain('OT_NEUTRAL_REFUND_QUEUE_ENABLED==="true"')
    expect(route).toContain('user?.role==="ADMIN"')
    expect(route).toContain("sameOrigin(request)")
    expect(route).toContain('request.headers.get("content-type")!=="application/json"')
    expect(`${store}\n${route}\n${qa}`).not.toMatch(/refunds\.create|createRefund/)
    expect(store).toContain("stripe.refunds.retrieve")
  })

  it("persists immutable queue binding before claim and formatted receipt acknowledgement",()=>{
    for(const column of ['"qa_review_id"','"order_id"','"reason_code"','"payment_binding_sha256"','"artifact_sha256"'])expect(qa).toContain(column)
    expect(store).toContain('"status"=\'REFUND_CLAIMED\'')
    expect(store).toContain('"status"=\'RECEIPT_RECORDED_PENDING_VERIFICATION\'')
    expect(store).toContain('"status"=\'REFUND_CONFIRMED\'')
    expect(store).toContain("/^re_[A-Za-z0-9]{8,64}$/")
    expect(store).toContain("stripe-refund-receipt/v1")
    expect(store).toContain("refundInitiated:false")
  })

  it("verifies exact provider facts before confirmation",async()=>{
    const {verifyProviderRefund}=await import("@/lib/fulfillment/neutral-refund-verification")
    const expected={receiptId:"re_12345678",paymentIntent:"pi_bound"}
    expect(verifyProviderRefund({id:expected.receiptId,payment_intent:"pi_bound",amount:6900,currency:"usd",status:"succeeded"},expected)).toEqual({ok:true})
    expect(verifyProviderRefund({id:expected.receiptId,payment_intent:"pi_other",amount:6900,currency:"usd",status:"succeeded"},expected)).toEqual({ok:false,reason:"PAYMENT_INTENT_MISMATCH"})
    expect(verifyProviderRefund({id:expected.receiptId,payment_intent:"pi_bound",amount:6900,currency:"usd",status:"pending"},expected)).toEqual({ok:false,reason:"PROVIDER_STATUS_NOT_SUCCEEDED"})
    expect(verifyProviderRefund({id:expected.receiptId,payment_intent:"pi_bound",amount:6900,status:"succeeded"},expected)).toEqual({ok:false,reason:"CURRENCY_MISMATCH"})
    expect(verifyProviderRefund({id:expected.receiptId,payment_intent:"pi_bound",amount:6900,currency:null,status:"succeeded"},expected)).toEqual({ok:false,reason:"CURRENCY_MISMATCH"})
    expect(verifyProviderRefund({id:expected.receiptId,payment_intent:"pi_bound",amount:6900,currency:"eur",status:"succeeded"},expected)).toEqual({ok:false,reason:"CURRENCY_MISMATCH"})
    expect(verifyProviderRefund({id:expected.receiptId,payment_intent:"pi_bound",amount:6900,currency:"USD",status:"succeeded"},expected)).toEqual({ok:true})
  })
})
