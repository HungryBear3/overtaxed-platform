import "server-only"
import { get } from "@vercel/blob"
import { computeArtifactSha256, contentAddressedT2ArtifactLocator } from "@/lib/fulfillment/artifact-digest"
import { isValidByteSize } from "@/lib/fulfillment/validation"

export type T2ArtifactUpload = { locator: string; created: boolean }

class T2ArtifactStorageUnavailableError extends Error {
  constructor() {
    super("T2_ARTIFACT_STORAGE_UNAVAILABLE")
    this.name = "T2ArtifactStorageUnavailableError"
  }
}

/** Contract only. No real T2 private content-addressed store exists in this repo. */
export async function uploadT2Artifact(_input: { locator: string; bytes: Buffer }): Promise<T2ArtifactUpload> {
  throw new T2ArtifactStorageUnavailableError()
}

function requireStorage(locator: string): void {
  const digest = /^t2-artifacts\/sha256\/([0-9a-f]{64})\.pdf$/.exec(locator)?.[1]
  if (process.env.OT_T2_PRIVATE_STORAGE_ENABLED !== "true" || !digest ||
      locator !== contentAddressedT2ArtifactLocator(digest)) throw new T2ArtifactStorageUnavailableError()
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
      if (contentAddressedT2ArtifactLocator(computeArtifactSha256(bytes)) !== locator)
        throw new T2ArtifactStorageUnavailableError()
      requireStorage(locator)
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
 * HOLD: orphan reconciliation is not implemented. Inline workflow reconciliation MUST NOT delete the content
 * object: another fulfillment may bind the same content address concurrently.
 * A future implementation may idempotently record/quarantine an orphan
 * candidate. Any later garbage collector must coordinate atomically with the
 * immutable binding registry, re-check all references at deletion time, and
 * preserve the object on ambiguity. Activation remains HOLD until that behavior
 * has a real storage implementation and race test.
 */
export async function reconcileUnboundT2Artifact(_input: { locator: string; sha256: string }): Promise<void> {
  throw new T2ArtifactStorageUnavailableError()
}
