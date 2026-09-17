/** Approved 2026-09-15 neutral-report customer contract. */
export const NEUTRAL_REPORT_NAME = "Cook County Assessment Records & Matching Property Report"
export const NEUTRAL_REPORT_PRICE = "$69"
export const NEUTRAL_REPORT_SUMMARY = "A neutral compilation of official Cook County assessment records and properties that match the report's published filters. It does not decide whether you should appeal."
export const NEUTRAL_REPORT_LIMITS = "This report is not an appraisal, legal or tax advice, an eligibility decision, a savings estimate, an outcome prediction, or a recommendation to appeal. Cook County makes every assessment and appeal decision."
export const NEUTRAL_REPORT_REFUND = "If we cannot produce the complete report described at checkout, we will refund the $69 report fee in full. A county decision or appeal outcome does not create a refund right."
export const NEUTRAL_REPORT_QA = "Automated compilation plus a time-capped human quality check for completeness and source consistency. The review does not judge appeal merit or recommend what you should do."
export const NEUTRAL_REPORT_TURNAROUND = "We expect to email the completed report within one business day. During the pilot, weekly capacity is limited; checkout closes before we accept more work than we can review."

export function neutralReportCopyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED === "true"
}
