import fs from "node:fs"
import path from "node:path"
const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8")
describe("neutral storage allocation guards",()=>{
 it("checks original ZIP members before copying",()=>{
  const src=read("lib/fulfillment/neutral-customer-zip.ts"),copy=src.indexOf('Buffer.from(input.pdf)'),size=src.indexOf('input.pdf.length+input.csv.length')
  expect(size).toBeGreaterThan(-1);expect(copy).toBeGreaterThan(size)
 })
 it("preflights byte/base64 and bounded JSON sizes before serialization",()=>{
  const src=read("lib/fulfillment-runtime/neutral-report-storage.ts"),preflight=src.indexOf('preflight(write)'),serialize=src.indexOf('const bytes = serialize(write)')
  expect(preflight).toBeGreaterThan(-1);expect(serialize).toBeGreaterThan(preflight)
  expect(src).toContain("base64UpperBound")
  expect(src).toContain("boundedJsonEstimate")
 })
})
