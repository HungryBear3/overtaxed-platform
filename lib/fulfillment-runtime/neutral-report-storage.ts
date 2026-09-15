import "server-only"
import { get, put } from "@vercel/blob"
import { neutralReportDigest, type NeutralReportWrite } from "@/lib/fulfillment/neutral-report-content"

type Serialized = {
  key: string; pdf: string; csv: string; manifestJson: string
  dataPages: Array<{ receipt: unknown; bytes: string }>; calendarBytes: string; deadline: unknown
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
  const bytes = serialize(write), sha256 = neutralReportDigest(bytes), locator = neutralBundleLocator(sha256)
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
  try { for (;;) { const part = await reader.read(); if (part.done) break; chunks.push(Buffer.from(part.value)) } }
  finally { reader.releaseLock() }
  const bytes = Buffer.concat(chunks)
  if (neutralReportDigest(bytes) !== expectedSha256) throw new Error("NEUTRAL_STORAGE_MISMATCH")
  return deserialize(bytes)
}
