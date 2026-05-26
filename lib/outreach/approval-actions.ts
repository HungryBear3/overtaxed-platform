import type { OutreachApprovalStatus } from "@/lib/outreach/approval-queue"

export type OutreachReviewAction = "approve_no_send" | "request_edit" | "hold" | "decline_no_send"

export const ACTION_STATUS: Record<OutreachReviewAction, OutreachApprovalStatus> = {
  approve_no_send: "approved_no_send",
  request_edit: "needs_edit",
  hold: "blocked",
  decline_no_send: "blocked",
}

export function canApproveNoSend(status: OutreachApprovalStatus): boolean {
  return status === "needs_review" || status === "needs_edit"
}

export function nextStatusForAction(action: OutreachReviewAction): OutreachApprovalStatus {
  return ACTION_STATUS[action]
}

export function isReviewAction(action: string): action is OutreachReviewAction {
  return action in ACTION_STATUS
}
