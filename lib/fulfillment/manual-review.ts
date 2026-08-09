import { canTransition } from "@/lib/fulfillment/state"
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types"

export const ALLOWED_MANUAL_REVIEW_SOURCE_STATUSES = [
  "NOT_STARTED",
  "NEEDS_RECONCILIATION",
  "INCOMPLETE_INPUT",
  "ARTIFACT_PENDING",
  "ARTIFACT_READY",
] as const satisfies readonly OTFulfillmentStatus[]

const allowedSources = new Set<unknown>(ALLOWED_MANUAL_REVIEW_SOURCE_STATUSES)

export type ManualReviewRefusalCode =
  | "NO_FULFILLMENT_SUMMARY"
  | "INVALID_ACTION"
  | "INELIGIBLE_SOURCE_STATUS"
  | "INVALID_STATUS_REVISION"
  | "LEASE_PRESENT"
  | "DOWNSTREAM_EVIDENCE_PRESENT"

export type ManualReviewDecision =
  | {
      allowed: true
      action: "ENTER_MANUAL_REVIEW"
      fromStatus: (typeof ALLOWED_MANUAL_REVIEW_SOURCE_STATUSES)[number]
      targetStatus: "MANUAL_REVIEW"
      reasonCode: "MANUAL_REVIEW"
      fromRevision: number
      toRevision: number
    }
  | { allowed: false; code: ManualReviewRefusalCode }

export function decideEnterManualReview(input: unknown): ManualReviewDecision {
  if (typeof input !== "object" || input === null)
    return { allowed: false, code: "INVALID_ACTION" }
  const candidate = input as { action?: unknown; fulfillment?: unknown }
  if (candidate.action !== "ENTER_MANUAL_REVIEW")
    return { allowed: false, code: "INVALID_ACTION" }
  if (candidate.fulfillment === null || candidate.fulfillment === undefined)
    return { allowed: false, code: "NO_FULFILLMENT_SUMMARY" }
  if (typeof candidate.fulfillment !== "object")
    return { allowed: false, code: "NO_FULFILLMENT_SUMMARY" }

  const f = candidate.fulfillment as Record<string, unknown>
  if (!allowedSources.has(f.status))
    return { allowed: false, code: "INELIGIBLE_SOURCE_STATUS" }
  const revision = f.statusRevision
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 0 ||
    revision >= 2_147_483_647
  ) return { allowed: false, code: "INVALID_STATUS_REVISION" }
  if (f.leaseOwner !== null || f.leaseToken !== null || f.leaseExpiresAt !== null)
    return { allowed: false, code: "LEASE_PRESENT" }
  if (f.attemptCount !== 0 || f.attemptRows !== 0 || f.eventRows !== 0)
    return { allowed: false, code: "DOWNSTREAM_EVIDENCE_PRESENT" }

  const status = f.status as (typeof ALLOWED_MANUAL_REVIEW_SOURCE_STATUSES)[number]
  if (!canTransition(status, "MANUAL_REVIEW"))
    return { allowed: false, code: "INELIGIBLE_SOURCE_STATUS" }
  return {
    allowed: true,
    action: "ENTER_MANUAL_REVIEW",
    fromStatus: status,
    targetStatus: "MANUAL_REVIEW",
    reasonCode: "MANUAL_REVIEW",
    fromRevision: revision,
    toRevision: revision + 1,
  }
}