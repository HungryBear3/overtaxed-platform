import "server-only"
import { get, put } from "@vercel/blob"
import { neutralReportDigest, type NeutralReportWrite } from "@/lib/fulfillment/neutral-report-content"

type Serialized = {
  key: string; pdf: string; csv: string; manifestJson: string
  dataPages: Array<{ receipt: unknown; bytes: string }>; calendarBytes: string; deadline: unknown
}
const MAX_STORED_NEUTRAL_BUNDLE_BYTES = 64 * 1024 * 1024
const MAX_NEUTRAL_COMPONENT_BYTES = 50 * 1024 * 1024

function boundedJsonEstimate(value:unknown,seen=new WeakSet<object>(),depth=0):number {
  if(depth>12)return MAX_STORED_NEUTRAL_BUNDLE_BYTES+1
  if(value===null||typeof value==="boolean"||typeof value==="number")return 32
  if(typeof value==="string")return value.length*6+2
  if(typeof value!=="object")return MAX_STORED_NEUTRAL_BUNDLE_BYTES+1
  if(seen.has(value))return MAX_STORED_NEUTRAL_BUNDLE_BYTES+1
  seen.add(value)
  let size=2
  const entries=Array.isArray(value)?value.map((v,i)=>[String(i),v] as const):Object.entries(value as Record<string,unknown>)
  if(entries.length>2048)return MAX_STORED_NEUTRAL_BUNDLE_BYTES+1
  for(const [key,item] of entries){size+=key.length*6+boundedJsonEstimate(item,seen,depth+1)+4;if(size>MAX_STORED_NEUTRAL_BUNDLE_BYTES)return size}
  return size
}
function base64UpperBound(bytes:number){return 4*Math.ceil(bytes/3)}
function preflight(write:NeutralReportWrite){
  const buffers=[write.pdf,write.csv,write.calendarBytes,...write.dataPages.map(page=>page.bytes)]
  if(write.dataPages.length>128||buffers.some(bytes=>bytes.length===0||bytes.length>MAX_NEUTRAL_COMPONENT_BYTES))throw new Error("NEUTRAL_STORAGE_MISMATCH")
  let projected=1024*1024+write.key.length*6+write.manifestJson.length*6+boundedJsonEstimate(write.deadline)
  for(const page of write.dataPages)projected+=boundedJsonEstimate(page.receipt)
  for(const bytes of buffers)projected+=base64UpperBound(bytes.length)
  if(projected>MAX_STORED_NEUTRAL_BUNDLE_BYTES)throw new Error("NEUTRAL_STORAGE_MISMATCH")
}

function serialize(write: NeutralReportWrite): Buffer {
  return Buffer.from(JSON.stringify({ key: write.key, pdf: write.pdf.toString("base64"), csv: write.csv.toString("base64"), manifestJson: write.manifestJson, dataPages: write.dataPages.map(p => ({ receipt: p.receipt, bytes: p.bytes.toString("base64") })), calendarBytes: write.calendarBytes.toString("base64"), deadline: write.deadline } satisfies Serialized))
}
function deserialize(bytes: Buffer): NeutralReportWrite {
  const value = JSON.parse(bytes.toString("utf8")) as Serialized
  return { key: value.key, pdf: Buffer.from(value.pdf, "base64"), csv: Buffer.from(value.csv, "base64"), manifestJson: value.manifestJson, dataPages: value.dataPages.map(p => ({ receipt: p.receipt, bytes: Buffer.from(p.bytes, "base64") })), calendarBytes: Buffer.from(value.calendarBytes, "base64"), deadline: value.deadline }
}
export function neutralBundleLocator(sha256: string) { return `ot-neutral-reports/sha256/${sha256}.json` }
function enabled() { return process.env.OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED === "true" }

export function prepareNeutralBundle(write: NeutralReportWrite): { locator: string; sha256: string; bytes: Buffer } {
  preflight(write)
  const bytes = serialize(write), sha256 = neutralReportDigest(bytes), locator = neutralBundleLocator(sha256)
  if(bytes.length===0||bytes.length>MAX_STORED_NEUTRAL_BUNDLE_BYTES)throw new Error("NEUTRAL_STORAGE_MISMATCH")
  return { locator, sha256, bytes }
}
export async function writePreparedNeutralBundle(prepared: { locator: string; sha256: string; bytes: Buffer }): Promise<{ locator: string; sha256: string }> {
  if (!enabled()) throw new Error("NEUTRAL_STORAGE_DISABLED")
  if (prepared.locator !== neutralBundleLocator(prepared.sha256) || neutralReportDigest(prepared.bytes)!==prepared.sha256) throw new Error("NEUTRAL_STORAGE_MISMATCH")
  const existing = await readNeutralBundle(prepared.locator, prepared.sha256).catch(() => null)
  if (existing) return { locator: prepared.locator, sha256: prepared.sha256 }
  const result = await put(prepared.locator, prepared.bytes, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" })
  if (result.pathname !== prepared.locator) throw new Error("NEUTRAL_STORAGE_UNKNOWN")
  return { locator: prepared.locator, sha256: prepared.sha256 }
}
export async function readNeutralBundle(locator: string, expectedSha256: string): Promise<NeutralReportWrite> {
  if (!enabled() || locator !== neutralBundleLocator(expectedSha256)) throw new Error("NEUTRAL_STORAGE_DISABLED")
  const result = await get(locator, { access: "private", useCache: false })
  if (!result?.stream || result.statusCode !== 200 || result.blob.pathname !== locator) throw new Error("NEUTRAL_STORAGE_UNAVAILABLE")
  const reader = result.stream.getReader(), chunks: Buffer[] = []
  let size=0
  try { for (;;) { const part = await reader.read(); if (part.done) break; const chunk=Buffer.from(part.value);size+=chunk.length;if(size>MAX_STORED_NEUTRAL_BUNDLE_BYTES){await reader.cancel("neutral bundle too large").catch(()=>{});throw new Error("NEUTRAL_STORAGE_MISMATCH")}chunks.push(chunk) } }
  finally { reader.releaseLock() }
  const bytes = Buffer.concat(chunks)
  if (neutralReportDigest(bytes) !== expectedSha256) throw new Error("NEUTRAL_STORAGE_MISMATCH")
  return deserialize(bytes)
}
