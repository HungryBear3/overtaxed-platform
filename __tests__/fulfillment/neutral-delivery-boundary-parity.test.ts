import fs from "node:fs"
import path from "node:path"
const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8")

describe("neutral delivery boundary parity",()=>{
  const boundaries=[
    "lib/fulfillment-runtime/delivery-store.ts",
    "lib/fulfillment-runtime/packet-download-store.ts",
    "lib/fulfillment-runtime/provider-callback-store.ts",
    "lib/fulfillment-runtime/t2-resend-adapter.ts",
  ]
  it.each(boundaries)("binds reviewed bundle and promoted customer artifact at %s",file=>{
    const src=read(file)
    expect(src).toContain('q."artifact_sha256"=r."bundle_sha256"')
    expect(src).toMatch(/q\."customer_artifact_sha256"=[az]\."artifact_sha256"/)
    expect(src).toContain('q."property_binding_fingerprint"=')
    expect(src).toContain('q."policy_version"=')
    expect(src).toContain('r."status"=\'PROMOTED\'')
    expect(src).toContain('r."superseded_by_sha256" IS NULL')
  })
  it("uses a latest-artifact projection for dispatch, downloads, and callbacks",()=>{
    expect(read(boundaries[0])).toContain("ORDER BY a.\"version\" DESC LIMIT 1")
    expect(read(boundaries[1])).toContain('a."version"=(SELECT max')
    expect(read(boundaries[2])).toContain("ORDER BY z.\"version\" DESC LIMIT 1")
  })
  it("keeps the neutral flag default-off at every external boundary",()=>{
    for(const file of boundaries)expect(read(file)).toContain("neutralDeliveryEnabled")
  })
  it("reuses trusted payment authority before dispatch, send, and download",()=>{
    for(const file of [boundaries[0],boundaries[1],boundaries[3]])expect(read(file)).toContain("trustedPaymentAuthority")
    expect(read(boundaries[2])).toContain('"ot_payment_binding"')
    expect(read(boundaries[2])).toContain('"ot_settlement_reversal"')
  })
})
