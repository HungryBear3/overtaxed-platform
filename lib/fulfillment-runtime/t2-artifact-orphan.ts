/**
 * Server-only seam for durable orphan quarantine.
 *
 * Kept separate from `t2-artifact-storage` on purpose: storage talks to a blob
 * provider, quarantine talks to the database, and the one behaviour that must
 * never appear in either is deletion. Splitting them means the storage module
 * has no database reach and the quarantine module has no provider reach, so
 * "record an orphan" can never grow a cleanup branch by accident.
 */
import "server-only";

import {
  prismaArtifactOrphanStore,
  type RecordArtifactOrphanCommand,
  type RecordArtifactOrphanOutcome,
} from "@/lib/fulfillment-runtime/artifact-orphan-store";

export type {
  RecordArtifactOrphanCommand,
  RecordArtifactOrphanOutcome,
} from "@/lib/fulfillment-runtime/artifact-orphan-store";

/**
 * Durably record that content may exist in private storage with no binding.
 *
 * Idempotent per (fulfillment, locator, expected digest). Never deletes,
 * overwrites, or reads the storage object.
 */
export function recordUnboundT2Artifact(
  command: RecordArtifactOrphanCommand,
): Promise<RecordArtifactOrphanOutcome> {
  return prismaArtifactOrphanStore.record(command);
}
