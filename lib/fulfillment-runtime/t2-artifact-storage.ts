import "server-only"
import { get, put } from "@vercel/blob"
import { computeArtifactSha256, contentAddressedT2ArtifactLocator } from "@/lib/fulfillment/artifact-digest"
import { isValidByteSize } from "@/lib/fulfillment/validation"

export type T2ArtifactUpload = { locator: string; created: boolean }

class T2ArtifactStorageUnavailableError extends Error {
  constructor() {
    super("T2_ARTIFACT_STORAGE_UNAVAILABLE")
    this.name = "T2ArtifactStorageUnavailableError"
  }
}

/** Immutable private put. Unknown write outcomes must enter workflow reconciliation. */
export async function uploadT2Artifact(input: { locator: string; bytes: Buffer }): Promise<T2ArtifactUpload> {
  const locator = input.locator
  try {
    verifyBytes(locator, input.bytes)
    // Freeze mutable caller bytes before the first async boundary.
    const bytes = Buffer.from(input.bytes)
    const existing = await readExisting(locator)
    requireStorage(locator)
    if (existing !== null) {
      if (!existing.equals(bytes)) throw new T2ArtifactStorageUnavailableError()
      return { locator, created: false }
    }
    const result = await put(locator, bytes, {
      access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/pdf",
    })
    if (result.pathname !== locator || result.contentType !== "application/pdf")
      throw new T2ArtifactStorageUnavailableError()
    return { locator, created: true }
  } catch {
    // A timeout/race may have committed. Never delete, retry inline or guess success.
    throw new T2ArtifactStorageUnavailableError()
  }
}

function requireStorage(locator: string): void {
  const digest = /^t2-artifacts\/sha256\/([0-9a-f]{64})\.pdf$/.exec(locator)?.[1]
  if (process.env.OT_T2_PRIVATE_STORAGE_ENABLED !== "true" || !digest ||
      locator !== contentAddressedT2ArtifactLocator(digest)) throw new T2ArtifactStorageUnavailableError()
}

function verifyBytes(locator: string, bytes: Buffer): void {
  requireStorage(locator)
  if (!Buffer.isBuffer(bytes) || !isValidByteSize(bytes.byteLength) ||
      !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
      contentAddressedT2ArtifactLocator(computeArtifactSha256(bytes)) !== locator)
    throw new T2ArtifactStorageUnavailableError()
}

/** Only an explicit SDK null is absence; every ambiguous failure refuses. */
async function readExisting(locator: string): Promise<Buffer | null> {
  try {
    requireStorage(locator)
    const result = await get(locator, { access: "private", useCache: false })
    if (result === null) return null
    if (result.statusCode !== 200 || !result.stream) throw new T2ArtifactStorageUnavailableError()
    const reader = result.stream.getReader()
    let complete = false
    try {
      if (result.blob.pathname !== locator || result.blob.contentType !== "application/pdf" ||
          !isValidByteSize(result.blob.size)) throw new T2ArtifactStorageUnavailableError()
      const bytes = Buffer.alloc(result.blob.size)
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!(value instanceof Uint8Array) || size + value.byteLength > result.blob.size)
          throw new T2ArtifactStorageUnavailableError()
        bytes.set(value, size)
        size += value.byteLength
      }
      if (size !== result.blob.size) throw new T2ArtifactStorageUnavailableError()
      verifyBytes(locator, bytes)
      complete = true
      return bytes
    } finally {
      if (!complete) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } catch {
    throw new T2ArtifactStorageUnavailableError()
  }
}

/** Server-only authenticated private read; no URL, cache or public fallback. */
export async function readT2ArtifactBytes(input: { locator: string }): Promise<Buffer> {
  const bytes = await readExisting(input.locator)
  if (bytes === null) throw new T2ArtifactStorageUnavailableError()
  return bytes
}

/**
 * Deletion is not implemented here, and must not be.
 *
 * An unbound object is recorded, never removed: the content address may already
 * be bound by a different fulfillment, so an inline delete could destroy
 * immutable evidence that belongs to someone else. Quarantine recording lives in
 * lib/fulfillment-runtime/t2-artifact-orphan.ts, which has no provider reach,
 * exactly so this module cannot grow a cleanup branch.
 *
 * Any future garbage collector must coordinate atomically with the immutable
 * binding registry, re-check every reference at deletion time, and preserve the
 * object on ambiguity.
 */
