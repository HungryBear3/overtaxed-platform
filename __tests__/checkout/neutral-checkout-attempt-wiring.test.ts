import fs from "node:fs";import path from "node:path"
test("durable intent precedes Stripe and observation precedes order finalization",()=>{
 const source=fs.readFileSync(path.join(process.cwd(),"app/api/checkout/session/route.ts"),"utf8")
 expect(source.indexOf("intendNeutralCheckout(")).toBeLessThan(source.indexOf("stripe.checkout.sessions.create("))
 expect(source.indexOf("observeNeutralCheckout(")).toBeLessThan(source.indexOf("const finalized ="))
 expect(source).toContain("markNeutralCheckoutUnknown")
})
