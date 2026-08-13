import "server-only"

export type T2ArtifactUpload = { locator: string; created: boolean }

class T2ArtifactStorageUnavailableError extends Error {
  constructor() {
    super("T2 artifact storage is unavailable until a genuine producer/storage integration is reviewed")
    this.name = "T2ArtifactStorageUnavailableError"
  }
}

/** Contract only. No real T2 private content-addressed store exists in this repo. */
export async function uploadT2Artifact(_input: { locator: string; bytes: Buffer }): Promise<T2ArtifactUpload> {
  throw new T2ArtifactStorageUnavailableError()
}

export async function readT2ArtifactBytes(_input: { locator: string }): Promise<Buffer> {
  throw new T2ArtifactStorageUnavailableError()
}

/**
 * Contract only. Inline workflow reconciliation MUST NOT delete the content
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
