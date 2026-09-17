import fs from "node:fs"
import path from "node:path"
const src=fs.readFileSync(path.join(process.cwd(),"app/api/admin/neutral-reports/[orderId]/qa/route.ts"),"utf8")
describe("neutral QA operator route wiring",()=>{
 it("requires admin auth, same origin and strict JSON",()=>{expect(src).toContain('user?.role!=="ADMIN"');expect(src).toContain('request.headers.get("origin")');expect(src).toContain('content-type');expect(src).toContain('.strict()')})
 it("exposes separate open, decide and promote actions without send/refund calls",()=>{for(const action of ['"OPEN"','"DECIDE"','"PROMOTE"'])expect(src).toContain(action);expect(src).not.toMatch(/sendEmail|resend\.emails|stripe\.refunds|createRefund/)})
 it("derives reviewer identity from the authenticated admin",()=>expect(src).toContain('reviewerKey:`admin:${user.id}`'))
})
