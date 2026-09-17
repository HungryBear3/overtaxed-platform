/**
 * Owner-approved authority for the neutral $69 records report.
 *
 * This policy is intentionally separate from `resolveEligibilityPolicy`.
 * It authorizes compilation and disclosure of official records; it does not
 * authorize an eligibility, merits, savings, valuation, or filing conclusion.
 */
export const NEUTRAL_REPORT_COMMERCE_POLICY = Object.freeze({
  version: "ot-neutral-records-report/2026-09-15",
  ownerDecisions: Object.freeze(["O-1", "O-2", "O-3", "O-4", "O-5"]),
  approvedAt: "2026-09-14",
  productName: "Cook County Assessment Records & Matching Property Report",
  priceUsd: 69,
  strictQualificationAuthorized: false,
  humanQaTargetMinutes: 12,
  humanQaHardStopMinutes: 20,
  pilotOrderLimit: 10,
  weeklyReviewerLimit: 25,
  refundWhenCompleteReportUnavailable: true,
} as const)

export type NeutralReportCommercePolicy = typeof NEUTRAL_REPORT_COMMERCE_POLICY

export function resolveNeutralReportCommercePolicy(): NeutralReportCommercePolicy {
  return NEUTRAL_REPORT_COMMERCE_POLICY
}

export function neutralOrderReservationKey(orderId: string): string {
  // Kept deliberately simple and shared by checkout and producer; callers may
  // not invent a second reservation namespace or bind a request PIN into it.
  const value = `orderId:${orderId.length}:${orderId}|policy:${NEUTRAL_REPORT_COMMERCE_POLICY.version}`
  return `neutral-order-binding/${createHash("sha256").update(value).digest("hex")}`
}
import { createHash } from "node:crypto"
