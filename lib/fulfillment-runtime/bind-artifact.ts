/**
 * Production-owned OT T2 artifact binder. Activation is ambient-only and is
 * rechecked by the transactional store. Callers provide bytes and provenance;
 * the private content-addressed locator is derived here and again in the store.
 */
import "server-only"

import { t2ArtifactBindingEnabled } from "@/lib/fulfillment/flag"
import type { ArtifactBindingBlocker, ArtifactProvenanceInput } from "@/lib/fulfillment/artifact-binding"
import { computeArtifactSha256, contentAddressedT2ArtifactLocator } from "@/lib/fulfillment/artifact-digest"
import { prismaArtifactBindingStore } from "@/lib/fulfillment-runtime/artifact-binding-store"
import { readT2ArtifactBytes } from "@/lib/fulfillment-runtime/t2-artifact-storage"

export type BindT2ArtifactCommand = {
  orderId: string
  fulfillmentId: string
  bytes: Buffer
  provenance: ArtifactProvenanceInput
}

export type BindT2ArtifactResult =
  | { outcome: "DISABLED"; blocker: "FLAG_DISABLED" }
  | { outcome: "REFUSED"; blocker: ArtifactBindingBlocker | "STORAGE_READ_FAILED" | "STORED_BYTES_MISMATCH" }
  | { outcome: "BOUND"; created: boolean; artifactId: string; artifactSha256: string }

export async function bindT2Artifact(command: BindT2ArtifactCommand): Promise<BindT2ArtifactResult> {
  if (!t2ArtifactBindingEnabled(process.env)) {
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" }
  }

  const artifactSha256 = computeArtifactSha256(command.bytes)
  const storageLocator = contentAddressedT2ArtifactLocator(artifactSha256)
  let persistedBytes: Buffer
  try {
    persistedBytes = await readT2ArtifactBytes({ locator: storageLocator })
  } catch {
    return { outcome: "REFUSED", blocker: "STORAGE_READ_FAILED" }
  }
  if (
    persistedBytes.byteLength !== command.bytes.byteLength ||
    computeArtifactSha256(persistedBytes) !== artifactSha256
  ) {
    return { outcome: "REFUSED", blocker: "STORED_BYTES_MISMATCH" }
  }
  if (!t2ArtifactBindingEnabled(process.env)) {
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" }
  }

  const outcome = await prismaArtifactBindingStore.bind({
    orderId: command.orderId,
    fulfillmentId: command.fulfillmentId,
    bytes: command.bytes,
    provenance: command.provenance,
  })
  if (!outcome.ok) return { outcome: "REFUSED", blocker: outcome.blocker }
  return {
    outcome: "BOUND",
    created: outcome.created,
    artifactId: outcome.artifactId,
    artifactSha256: outcome.artifactSha256,
  }
}
