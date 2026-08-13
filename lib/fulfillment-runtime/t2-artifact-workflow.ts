import "server-only"

import { t2ArtifactBindingEnabled } from "@/lib/fulfillment/flag"
import { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types"
import { computeArtifactSha256, contentAddressedT2ArtifactLocator } from "@/lib/fulfillment/artifact-digest"
import { bindT2Artifact, type BindT2ArtifactResult } from "@/lib/fulfillment-runtime/bind-artifact"
import { generateT2Artifact } from "@/lib/fulfillment-runtime/t2-artifact-producer"
import {
  readT2ArtifactBytes,
  reconcileUnboundT2Artifact,
  uploadT2Artifact,
} from "@/lib/fulfillment-runtime/t2-artifact-storage"

type BindRefusalBlocker = Extract<BindT2ArtifactResult, { outcome: "REFUSED" }>["blocker"]
type T2ArtifactWorkflowRefusalBlocker =
  | BindRefusalBlocker
  | "EMPTY_ARTIFACT"
  | "ARTIFACT_TOO_LARGE"
  | "STORAGE_LOCATOR_MISMATCH"

export type T2ArtifactWorkflowResult =
  | { outcome: "DISABLED"; blocker: "FLAG_DISABLED" }
  | { outcome: "UNAVAILABLE"; blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE" }
  | { outcome: "REFUSED"; blocker: T2ArtifactWorkflowRefusalBlocker }
  | { outcome: "RECONCILIATION_REQUIRED"; blocker: "UNBOUND_ARTIFACT_RECONCILIATION_REQUIRED" }
  | Extract<BindT2ArtifactResult, { outcome: "BOUND" }>

/**
 * Server-only ordering boundary. Delivery/email are intentionally outside this
 * workflow and may only be introduced after immutable bind succeeds.
 */
export async function runT2ArtifactBindingWorkflow(input: {
  orderId: string
  fulfillmentId: string
}): Promise<T2ArtifactWorkflowResult> {
  if (!t2ArtifactBindingEnabled(process.env)) {
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" }
  }

  let generated: Awaited<ReturnType<typeof generateT2Artifact>>
  try {
    generated = await generateT2Artifact(input)
  } catch {
    return { outcome: "UNAVAILABLE", blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE" }
  }
  if (!generated.ok) return { outcome: "UNAVAILABLE", blocker: generated.blocker }
  if (!t2ArtifactBindingEnabled(process.env)) {
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" }
  }
  if (generated.bytes.byteLength === 0)
    return { outcome: "REFUSED", blocker: "EMPTY_ARTIFACT" }
  if (generated.bytes.byteLength > MAX_ARTIFACT_BYTES)
    return { outcome: "REFUSED", blocker: "ARTIFACT_TOO_LARGE" }

  const sha256 = computeArtifactSha256(generated.bytes)
  const expectedLocator = contentAddressedT2ArtifactLocator(sha256)
  const reconciliationRequired = {
    outcome: "RECONCILIATION_REQUIRED" as const,
    blocker: "UNBOUND_ARTIFACT_RECONCILIATION_REQUIRED" as const,
  }
  let uploaded: Awaited<ReturnType<typeof uploadT2Artifact>>
  try {
    uploaded = await uploadT2Artifact({ locator: expectedLocator, bytes: generated.bytes })
  } catch {
    // The provider may have committed the object before losing its response.
    // Without a trustworthy `created` result, never attempt inline deletion.
    return reconciliationRequired
  }

  const reconcileNewUpload = async (): Promise<boolean> => {
    if (!uploaded.created) return true
    try {
      await reconcileUnboundT2Artifact({ locator: uploaded.locator, sha256 })
      return true
    } catch {
      return false
    }
  }

  if (!t2ArtifactBindingEnabled(process.env)) {
    if (!(await reconcileNewUpload())) return reconciliationRequired
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" }
  }

  if (uploaded.locator !== expectedLocator) {
    if (!(await reconcileNewUpload())) return reconciliationRequired
    return { outcome: "REFUSED", blocker: "STORAGE_LOCATOR_MISMATCH" }
  }

  let persistedBytes: Buffer
  try {
    persistedBytes = await readT2ArtifactBytes({ locator: uploaded.locator })
  } catch {
    if (!(await reconcileNewUpload())) return reconciliationRequired
    return { outcome: "REFUSED", blocker: "STORAGE_READ_FAILED" }
  }
  if (!t2ArtifactBindingEnabled(process.env)) {
    if (!(await reconcileNewUpload())) return reconciliationRequired
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" }
  }
  if (
    persistedBytes.byteLength !== generated.bytes.byteLength ||
    computeArtifactSha256(persistedBytes) !== sha256
  ) {
    if (!(await reconcileNewUpload())) return reconciliationRequired
    return { outcome: "REFUSED", blocker: "STORED_BYTES_MISMATCH" }
  }

  let bound: BindT2ArtifactResult
  try {
    bound = await bindT2Artifact({ ...input, bytes: generated.bytes, provenance: generated.provenance })
  } catch {
    // Transaction outcome is unknown. Preserve storage: deleting here could
    // destroy immutable evidence that committed before the error surfaced.
    return reconciliationRequired
  }
  if (bound.outcome !== "BOUND") {
    if (!(await reconcileNewUpload())) return reconciliationRequired
    return { outcome: "REFUSED", blocker: bound.blocker }
  }
  return bound
}
