import "server-only"

import type { ArtifactProvenanceInput } from "@/lib/fulfillment/artifact-binding"

export type GeneratedT2Artifact =
  | { ok: true; bytes: Buffer; provenance: ArtifactProvenanceInput }
  | { ok: false; blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE" }

/**
 * HOLD boundary: this repository has no genuine OT T2 artifact producer.
 * COMPS_ONLY invoice generation is intentionally not adapted or reused here.
 */
export async function generateT2Artifact(_input: {
  orderId: string
  fulfillmentId: string
}): Promise<GeneratedT2Artifact> {
  return { ok: false, blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE" }
}
