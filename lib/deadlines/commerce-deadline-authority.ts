import "server-only"

import { commerceSnapshotStore } from "./commerce-snapshot-store"
import { evaluateOfficialDeadlineState, projectDeadline, type DeadlineProjection } from "./official-source-state"
import type { TownshipResolution } from "./township-resolution"

/** Commerce projection: only a PIN-derived official-property identity may enter. */
export async function projectCommerceDeadline(input: {
  township: TownshipResolution
  at: Date
}): Promise<DeadlineProjection> {
  const store = await commerceSnapshotStore()
  const snapshot = await store?.read(input.at)
  if (!snapshot) {
    return projectDeadline(
      evaluateOfficialDeadlineState({ snapshot: null, township: input.township, stage: "assessor", evaluatedAt: input.at.toISOString() }),
      input.at.toISOString(),
    )
  }
  const at = input.at.toISOString()
  return projectDeadline(
    evaluateOfficialDeadlineState({ snapshot, township: input.township, stage: "assessor", evaluatedAt: at }),
    at,
  )
}
