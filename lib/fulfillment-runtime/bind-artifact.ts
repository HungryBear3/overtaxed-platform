/**
 * OT T2 delivery-evidence Phase 2 Slice 2 — production orchestration seam for
 * artifact provenance binding.
 *
 * This is the boundary that OWNS activation. It mirrors the Phase 1 pattern in
 * `lib/fulfillment-runtime/kickoff.ts`: the environment gate is evaluated here,
 * before any store call and therefore before any transaction, and callers cannot
 * assert their way past it — `BindT2ArtifactCommand` has no flag field at all.
 *
 * The gate is `OT_T2_ARTIFACT_BINDING_ENABLED`, which is deliberately NOT the
 * Phase 1 evidence flag. `OT_T2_FULFILLMENT_EVIDENCE_ENABLED` is already exactly
 * "true" in Production, so reusing it would have activated this slice the moment
 * it deployed. Schema, code, and activation stay three separately reviewed steps.
 *
 * Nothing in production imports this function yet. Wiring a route, worker, or
 * generator to it is a later slice.
 */
import { t2ArtifactBindingEnabled } from "@/lib/fulfillment/flag";
export { t2ArtifactBindingEnabled } from "@/lib/fulfillment/flag";
import type { ArtifactBindingBlocker } from "@/lib/fulfillment/artifact-binding";
import {
  prismaArtifactBindingStore,
  type ArtifactBindingOutcome,
  type BindArtifactCommand,
} from "@/lib/fulfillment-runtime/artifact-binding-store";

export type BindT2ArtifactCommand = BindArtifactCommand;

export interface T2ArtifactBindingStore {
  bind(command: BindArtifactCommand): Promise<ArtifactBindingOutcome>;
}

export type BindT2ArtifactResult =
  | { outcome: "DISABLED"; blocker: Extract<ArtifactBindingBlocker, "FLAG_DISABLED"> }
  | { outcome: "REFUSED"; blocker: ArtifactBindingBlocker }
  | {
      outcome: "BOUND";
      created: boolean;
      artifactId: string;
      artifactSha256: string;
    };

/**
 * Bind exact packet bytes to an existing eligible T2 fulfillment.
 *
 * Inert unless the strict Slice 2 flag is exactly "true". It never generates an
 * artifact, never sends anything, never touches settlement, and never creates a
 * fulfillment summary — an absent summary is a refusal, not a backfill.
 */
export async function bindT2Artifact(
  command: BindT2ArtifactCommand,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    store?: T2ArtifactBindingStore;
  } = {},
): Promise<BindT2ArtifactResult> {
  // Evaluated BEFORE the store is even resolved, so a disabled deployment makes
  // no store call and opens no transaction.
  if (!t2ArtifactBindingEnabled(options.env ?? process.env)) {
    return { outcome: "DISABLED", blocker: "FLAG_DISABLED" };
  }

  const outcome = await (options.store ?? prismaArtifactBindingStore).bind(
    command,
  );

  if (!outcome.ok) return { outcome: "REFUSED", blocker: outcome.blocker };

  return {
    outcome: "BOUND",
    created: outcome.created,
    artifactId: outcome.artifactId,
    artifactSha256: outcome.artifactSha256,
  };
}
