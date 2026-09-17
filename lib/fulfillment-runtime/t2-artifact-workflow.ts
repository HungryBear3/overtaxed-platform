import "server-only"

import { t2ArtifactBindingEnabled } from "@/lib/fulfillment/flag"
import { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types"
import { computeArtifactSha256, contentAddressedT2ArtifactLocator } from "@/lib/fulfillment/artifact-digest"
import { bindT2Artifact, type BindT2ArtifactResult } from "@/lib/fulfillment-runtime/bind-artifact"
import {
  generateT2Artifact,
  type T2ArtifactProducerBlocker,
} from "@/lib/fulfillment-runtime/t2-artifact-producer"
import {
  readT2ArtifactBytes,
  uploadT2Artifact,
} from "@/lib/fulfillment-runtime/t2-artifact-storage"
import { recordUnboundT2Artifact } from "@/lib/fulfillment-runtime/t2-artifact-orphan"
import type { ArtifactOrphanReasonCode } from "@/lib/fulfillment/artifact-orphan"

type BindRefusalBlocker = Extract<BindT2ArtifactResult, { outcome: "REFUSED" }>["blocker"]
type T2ArtifactWorkflowRefusalBlocker =
  | BindRefusalBlocker
  | "EMPTY_ARTIFACT"
  | "ARTIFACT_TOO_LARGE"
  | "STORAGE_LOCATOR_MISMATCH"

export type T2ArtifactWorkflowResult =
  | { outcome: "DISABLED"; blocker: "FLAG_DISABLED" }
  /**
   * The producer refused. `blocker` names which gate closed — an unsigned
   * eligibility policy, an untrusted deadline authority, a property the packet
   * is not defined for, or evidence too thin to describe. A refusal produces no
   * bytes, so nothing is uploaded, bound, or delivered.
   */
  | { outcome: "UNAVAILABLE"; blocker: T2ArtifactProducerBlocker }
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
  /**
   * Durably write down that content may be unbound. Never deletes, never reads
   * storage, and never changes the outcome it is called from: a quarantine write
   * that itself fails leaves the caller exactly as unreconciled as it already was.
   */
  const recordOrphan = async (observation: {
    storageLocator: string
    uploadOutcome: "CONFIRMED" | "UNKNOWN"
    reasonCode: ArtifactOrphanReasonCode
  }): Promise<boolean> => {
    try {
      const recorded = await recordUnboundT2Artifact({
        fulfillmentId: input.fulfillmentId,
        sourceOrderId: input.orderId,
        storageLocator: observation.storageLocator,
        artifactSha256: sha256,
        uploadOutcome: observation.uploadOutcome,
        reasonCode: observation.reasonCode,
      })
      return recorded.ok
    } catch {
      return false
    }
  }

  let uploaded: Awaited<ReturnType<typeof uploadT2Artifact>>
  try {
    uploaded = await uploadT2Artifact({ locator: expectedLocator, bytes: generated.bytes })
  } catch {
    // The provider may have committed the object before losing its response, so
    // never delete and never retry inline. What we CAN do is write down the
    // expected content address and digest, which is what makes the object
    // recoverable later. The upload outcome is recorded as UNKNOWN because that
    // is precisely what it is.
    await recordOrphan({
      storageLocator: expectedLocator,
      uploadOutcome: "UNKNOWN",
      reasonCode: "UPLOAD_OUTCOME_UNKNOWN",
    })
    return reconciliationRequired
  }

  /**
   * Quarantine an object this workflow newly created. A pre-existing object is
   * left alone: it was not produced by this attempt, and another fulfillment may
   * legitimately own that content address.
   *
   * `uploadT2Artifact` only returns at all once the object is known to be
   * present — either it was just written, or it was read back byte-identical —
   * so a recorded upload outcome here is CONFIRMED.
   */
  const quarantineNewUpload = async (
    reasonCode: ArtifactOrphanReasonCode,
  ): Promise<boolean> => {
    if (!uploaded.created) return true
    return recordOrphan({
      storageLocator: uploaded.locator,
      uploadOutcome: "CONFIRMED",
      reasonCode,
    })
  }

  if (!t2ArtifactBindingEnabled(process.env)) {
    if (!(await quarantineNewUpload("ACTIVATION_WITHDRAWN"))) return reconciliationRequired
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" }
  }

  if (uploaded.locator !== expectedLocator) {
    if (!(await quarantineNewUpload("STORAGE_LOCATOR_MISMATCH"))) return reconciliationRequired
    return { outcome: "REFUSED", blocker: "STORAGE_LOCATOR_MISMATCH" }
  }

  let persistedBytes: Buffer
  try {
    persistedBytes = await readT2ArtifactBytes({ locator: uploaded.locator })
  } catch {
    if (!(await quarantineNewUpload("STORAGE_READ_FAILED"))) return reconciliationRequired
    return { outcome: "REFUSED", blocker: "STORAGE_READ_FAILED" }
  }
  if (!t2ArtifactBindingEnabled(process.env)) {
    if (!(await quarantineNewUpload("ACTIVATION_WITHDRAWN"))) return reconciliationRequired
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" }
  }
  if (
    persistedBytes.byteLength !== generated.bytes.byteLength ||
    computeArtifactSha256(persistedBytes) !== sha256
  ) {
    if (!(await quarantineNewUpload("STORED_BYTES_MISMATCH"))) return reconciliationRequired
    return { outcome: "REFUSED", blocker: "STORED_BYTES_MISMATCH" }
  }

  let bound: BindT2ArtifactResult
  try {
    bound = await bindT2Artifact({ ...input, bytes: generated.bytes, provenance: generated.provenance })
  } catch {
    // Transaction outcome is unknown. Preserve storage: deleting here could
    // destroy immutable evidence that committed before the error surfaced. The
    // ambiguity is durably recorded even for a pre-existing object, because what
    // is unknown here is the BINDING, not whether the bytes are present.
    await recordOrphan({
      storageLocator: uploaded.locator,
      uploadOutcome: "CONFIRMED",
      reasonCode: "BIND_OUTCOME_UNKNOWN",
    })
    return reconciliationRequired
  }
  if (bound.outcome !== "BOUND") {
    if (!(await quarantineNewUpload("BIND_REFUSED"))) return reconciliationRequired
    return { outcome: "REFUSED", blocker: bound.blocker }
  }
  return bound
}
