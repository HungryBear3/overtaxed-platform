import { createHash } from "node:crypto"
import { createNeutralCustomerZip,crc32,MAX_NEUTRAL_CUSTOMER_ZIP_BYTES,NEUTRAL_CUSTOMER_ZIP_FILENAME,NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE } from "@/lib/fulfillment/neutral-customer-zip"

function entries(zip:Buffer){
  const out:Array<{name:string;bytes:Buffer;crc:number}>=[];let at=0
  while(zip.readUInt32LE(at)===0x04034b50){
    const crc=zip.readUInt32LE(at+14),size=zip.readUInt32LE(at+18),names=zip.readUInt16LE(at+26),extra=zip.readUInt16LE(at+28)
    const start=at+30+names+extra;out.push({name:zip.subarray(at+30,at+30+names).toString(),bytes:zip.subarray(start,start+size),crc});at=start+size
  }
  return out
}
describe("neutral customer ZIP",()=>{
  const pdf=Buffer.from("%PDF-1.7\nneutral\n%%EOF"),csv=Buffer.from("field,value\nfoo,bar\n")
  it("is deterministic and contains only the two customer files",()=>{
    const a=createNeutralCustomerZip({pdf,csv}),b=createNeutralCustomerZip({pdf:Buffer.from(pdf),csv:Buffer.from(csv)})
    expect(a.equals(b)).toBe(true);expect(entries(a).map(x=>x.name)).toEqual(["report.pdf","report.csv"])
    expect(entries(a).map(x=>x.bytes)).toEqual([pdf,csv]);expect(a.includes(Buffer.from("manifest"))).toBe(false)
    expect(createHash("sha256").update(a).digest("hex")).toHaveLength(64)
  })
  it("writes correct CRCs and central directory",()=>{
    const zip=createNeutralCustomerZip({pdf,csv}),found=entries(zip)
    expect(found.map(x=>x.crc)).toEqual([crc32(pdf),crc32(csv)])
    expect(zip.includes(Buffer.from([0x50,0x4b,0x01,0x02]))).toBe(true)
    expect(zip.subarray(-22,-18).equals(Buffer.from([0x50,0x4b,0x05,0x06]))).toBe(true)
  })
  it("uses fixed safe transport metadata",()=>{expect(NEUTRAL_CUSTOMER_ZIP_FILENAME).toBe("overtaxed-records-report.zip");expect(NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE).toBe("application/zip")})
  it("rejects a non-PDF first member",()=>{expect(()=>createNeutralCustomerZip({pdf:Buffer.from("no"),csv})).toThrow("INVALID_REPORT_PDF")})
  it("rejects empty and oversized customer members",()=>{
    expect(()=>createNeutralCustomerZip({pdf,csv:Buffer.alloc(0)})).toThrow("INVALID_REPORT_SIZE")
    expect(()=>createNeutralCustomerZip({pdf:Buffer.concat([Buffer.from("%PDF-"),Buffer.alloc(MAX_NEUTRAL_CUSTOMER_ZIP_BYTES)]),csv})).toThrow("INVALID_REPORT_SIZE")
  })
})
