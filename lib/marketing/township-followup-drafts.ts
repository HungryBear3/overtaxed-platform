export const TOWNSHIP_FOLLOWUP_STATUS = "DRAFT_NOT_ACTIVATED" as const;

export interface TownshipFollowupDraft {
  id: string;
  channel: "email" | "sms";
  timing: string;
  subject?: string;
  body: string;
  cta: string;
  suppressWhen: string[];
}

/**
 * Copy draft only. No route, cron, sender, provider, or database enrollment
 * imports this module. Activation requires separate consent/compliance review
 * and Alexy's explicit approval.
 */
export const TOWNSHIP_FOLLOWUP_DRAFTS: TownshipFollowupDraft[] = [
  {
    id: "result",
    channel: "email",
    timing: "Immediately after a homeowner voluntarily requests the result",
    subject: "Your {{township_name}} property check",
    body: "Your free check for {{property_address}} is ready. It uses public Cook County property records to compare the assessment with relevant properties. Any savings shown are an estimate, not a guarantee.",
    cta: "Review my free check",
    suppressWhen: ["unsubscribed", "paid", "deadline_closed"],
  },
  {
    id: "deadline-explainer",
    channel: "email",
    timing: "One day later, only while the official Assessor window is open",
    subject: "What the {{deadline_date}} deadline means",
    body: "The Cook County Assessor currently lists {{deadline_date}} as the last-file date for {{township_name}}. Filing directly with the Assessor is free. OverTaxed IL is not a law firm, and no reduction is guaranteed.",
    cta: "See my options",
    suppressWhen: ["unsubscribed", "paid", "deadline_closed"],
  },
  {
    id: "process",
    channel: "email",
    timing: "Two days after the deadline explainer",
    subject: "What goes into a Cook County assessment review",
    body: "A useful review starts with the subject property's public assessment record, relevant comparable properties, and a clear explanation of the comparison. Review the evidence and pricing before choosing a paid option.",
    cta: "Review the process",
    suppressWhen: ["unsubscribed", "paid", "deadline_closed"],
  },
  {
    id: "consented-reminder",
    channel: "sms",
    timing: "Optional reminder inside a separately approved send window",
    body: "OverTaxed IL draft: {{township_name}}'s Assessor deadline is {{deadline_date}}. Review your free check: {{short_link}}. Reply STOP to opt out.",
    cta: "Review free check",
    suppressWhen: [
      "no_express_sms_consent",
      "opted_out",
      "paid",
      "deadline_closed",
    ],
  },
  {
    id: "final-reminder",
    channel: "email",
    timing:
      "Final approved reminder before close; do not offer done-for-you inside its 48-hour cutoff",
    subject: "{{township_name}} Assessor window closes {{deadline_date}}",
    body: "This is the final planned reminder for the current {{township_name}} Assessor window. You may file directly with the Cook County Assessor at no charge. Check the official calendar before filing.",
    cta: "Review my free check",
    suppressWhen: ["unsubscribed", "paid", "deadline_closed"],
  },
];
