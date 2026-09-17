import { createHash } from "node:crypto"

export const NEUTRAL_CUSTOMER_ZIP_FILENAME = "overtaxed-records-report.zip"
export const NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE = "application/zip"
export const MAX_NEUTRAL_CUSTOMER_ZIP_BYTES = 50 * 1024 * 1024

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b}

/** Deterministic STORE-only ZIP. Fixed names/order/time; no manifest or evidence. */
export function createNeutralCustomerZip(input:{pdf:Buffer;csv:Buffer}):Buffer {
  if(!input.pdf.subarray(0,5).equals(Buffer.from("%PDF-"))) throw new Error("INVALID_REPORT_PDF")
  if(input.pdf.length===0||input.csv.length===0||input.pdf.length+input.csv.length>MAX_NEUTRAL_CUSTOMER_ZIP_BYTES-1024) throw new Error("INVALID_REPORT_SIZE")
  const files=[{name:"report.pdf",bytes:Buffer.from(input.pdf)},{name:"report.csv",bytes:Buffer.from(input.csv)}]
  const local:Buffer[]=[]; const central:Buffer[]=[]; let offset=0
  for(const file of files){
    const name=Buffer.from(file.name,"ascii"), crc=crc32(file.bytes), size=file.bytes.length
    const common=Buffer.concat([u16(20),u16(0x800),u16(0),u16(0),u16(33),u32(crc),u32(size),u32(size),u16(name.length),u16(0)])
    const record=Buffer.concat([u32(0x04034b50),common,name,file.bytes]); local.push(record)
    central.push(Buffer.concat([u32(0x02014b50),u16(20),common,u16(0),u16(0),u16(0),u32(0),u32(offset),name]))
    offset+=record.length
  }
  const directory=Buffer.concat(central)
  const zip=Buffer.concat([...local,directory,u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(directory.length),u32(offset),u16(0)])
  if(zip.length>MAX_NEUTRAL_CUSTOMER_ZIP_BYTES)throw new Error("INVALID_REPORT_SIZE")
  return zip
}
export function neutralCustomerZipSha256(bytes:Buffer){return createHash("sha256").update(bytes).digest("hex")}
export function neutralCustomerZipLocator(sha:string){if(!/^[0-9a-f]{64}$/.test(sha))throw new Error("INVALID_ZIP_DIGEST");return `ot-neutral-customer/sha256/${sha}.zip`}
