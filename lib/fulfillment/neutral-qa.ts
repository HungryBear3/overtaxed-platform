import { NEUTRAL_REPORT_COMMERCE_POLICY } from "@/lib/commerce/neutral-report-policy"

export const NEUTRAL_QA_REASON_CODES = new Set([
  "QA_PASSED",
  "REPORT_INCOMPLETE",
  "SOURCE_EVIDENCE_UNAVAILABLE",
  "ARTIFACT_DEFECT",
  "HARD_STOP_EXCEEDED",
  "PAYMENT_REVERSED",
  "SUPERSEDED",
  "DISPUTED",
  "OPERATOR_HOLD",
] as const)

export type NeutralQaDecision = "approve" | "reject" | "unavailable" | "hold"

export function decideNeutralQa(input: {
  decision: NeutralQaDecision
  minutesSpent: number
  reasonCode: string
  reservationStatus: string
  currentStatus: string
  weeklyDecisions: number
}) {
  if (input.reservationStatus !== "PROMOTED") return { ok: false as const, blocker: "ARTIFACT_NOT_PROMOTED" }
  if (!['PENDING','IN_REVIEW'].includes(input.currentStatus)) return { ok: false as const, blocker: "QA_ALREADY_DECIDED" }
  if (!Number.isInteger(input.minutesSpent) || input.minutesSpent < 1 || input.minutesSpent > NEUTRAL_REPORT_COMMERCE_POLICY.humanQaHardStopMinutes)
    return { ok: false as const, blocker: "QA_HARD_STOP" }
  if (!NEUTRAL_QA_REASON_CODES.has(input.reasonCode as never)) return { ok: false as const, blocker: "INVALID_REASON" }
  const allowedReasons: Record<NeutralQaDecision, ReadonlySet<string>> = {
    approve: new Set(["QA_PASSED"]),
    reject: new Set(["ARTIFACT_DEFECT"]),
    unavailable: new Set(["REPORT_INCOMPLETE", "SOURCE_EVIDENCE_UNAVAILABLE", "HARD_STOP_EXCEEDED"]),
    hold: new Set(["PAYMENT_REVERSED", "SUPERSEDED", "DISPUTED", "OPERATOR_HOLD"]),
  }
  if (!allowedReasons[input.decision].has(input.reasonCode))
    return { ok: false as const, blocker: "REASON_DECISION_MISMATCH" }
  if (input.decision === "approve" && input.weeklyDecisions >= NEUTRAL_REPORT_COMMERCE_POLICY.weeklyReviewerLimit)
    return { ok: false as const, blocker: "WEEKLY_REVIEW_LIMIT" }
  return { ok: true as const, status: input.decision === "approve" ? "APPROVED" : input.decision === "unavailable" ? "REFUND_REQUIRED" : input.decision === "hold" ? "HELD" : "REJECTED" }
}
