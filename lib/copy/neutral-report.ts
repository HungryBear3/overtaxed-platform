/**
 * Core refund promise approved 2026-09-15; clarification and flexibility
 * terms owner-approved in direct chat on 2026-09-21.
 */
export const NEUTRAL_REPORT_NAME = "Cook County Assessment Records & Matching Property Report"
export const NEUTRAL_REPORT_PRICE = "$69"
export const NEUTRAL_REPORT_SUMMARY = "A neutral compilation of official Cook County assessment records and properties that match the report's published filters. It does not decide whether you should appeal."
export const NEUTRAL_REPORT_LIMITS = "This report is not an appraisal, legal or tax advice, an eligibility decision, a savings estimate, an outcome prediction, or a recommendation to appeal. Cook County makes every assessment and appeal decision."
export const NEUTRAL_REPORT_REFUND = "If we cannot produce the complete report described at checkout, we will refund the $69 report fee in full. A county decision or appeal outcome does not create a refund right."
export const NEUTRAL_REPORT_REFUND_COMPLETE_REPORT = "A Complete Report means the report sections, source information, and downloadable files identified at checkout, prepared using official records reasonably available to OverTaxed IL at the time of preparation. A report may contain few or no matching properties and still be complete when it includes every identified component and accurately states the published-filter results."
export const NEUTRAL_REPORT_REFUND_INTERRUPTION = "If we determine before delivery that the property is unsupported, required official records are unavailable, or information needed to prepare the report is missing or materially inconsistent, we may request clarification or offer a reasonable revised delivery date. You may accept the revised date or cancel the order and receive a full refund of the $69 report fee. We will not substitute a materially different product without your agreement."
export const NEUTRAL_REPORT_REFUND_REQUEST = "If a delivered report is missing a material component promised at checkout, please contact support@overtaxed-il.com within 30 days of delivery. Include your order reference and a description of the missing component. A later request may still be reviewed, and this request period does not limit any consumer right that cannot legally be waived."
export const NEUTRAL_REPORT_REFUND_CURE = "We may first investigate, correct, or re-deliver the report. If we cannot correct the material omission within five business days after your request, we will refund the $69 report fee in full. We may extend that correction period only with your agreement. This correction process does not replace the full-refund promise above."
export const NEUTRAL_REPORT_REFUND_EXCLUSIONS = "A refund is not created solely because the report contains few or no matching properties, does not support a particular conclusion, you have a change of mind after complete delivery, official records differ from what you expected or you disagree with them, or the report does not lead to a desired assessment, appeal, tax, or savings outcome. If official records change after the report's stated retrieval date, that later change does not make a report incomplete when it accurately reflects the identified sources as retrieved."
export const NEUTRAL_REPORT_REFUND_VOLUNTARY = "We may voluntarily provide a correction, replacement report, partial refund, account credit, or full refund in other circumstances. A voluntary accommodation does not modify this policy or require the same resolution for another order."
export const NEUTRAL_REPORT_REFUND_NONWAIVER = "This policy does not limit any consumer right that cannot legally be waived."
export const NEUTRAL_REPORT_QA = "Automated compilation plus a time-capped human quality check for completeness and source consistency. The review does not judge appeal merit or recommend what you should do."
export const NEUTRAL_REPORT_TURNAROUND = "We expect to email the completed report within one business day. During the pilot, weekly capacity is limited; checkout closes before we accept more work than we can review."

export function neutralReportCopyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED === "true"
}
