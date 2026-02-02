/**
 * Appeal status helpers for gaming prevention.
 * Once an appeal is "submitted" (filed with the county), the property (PIN) is locked.
 * Only DRAFT and PENDING_FILING appeals can have their property changed.
 */

export const APPEAL_STATUS_SUBMITTED = [
  "FILED",
  "UNDER_REVIEW",
  "HEARING_SCHEDULED",
  "DECISION_PENDING",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "DENIED",
  "WITHDRAWN",
] as const

export function isAppealSubmitted(status: string): boolean {
  return (APPEAL_STATUS_SUBMITTED as readonly string[]).includes(status)
}

export function canChangePropertyOnAppeal(status: string): boolean {
  return status === "DRAFT" || status === "PENDING_FILING"
}
