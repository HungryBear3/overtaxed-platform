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
    subject: "Your {{township_name}} property check is ready",
    body: "Your free property check for {{property_address}} is ready. It is based on public Cook County assessment records. Review the result, source information, and available next steps in one place. Any estimated savings are informational, not guaranteed.",
    cta: "Review my result",
    suppressWhen: ["unsubscribed", "paid", "deadline_closed"],
  },
  {
    id: "deadline-explainer",
    channel: "email",
    timing: "One day later, only while the official Assessor window is open",
    subject: "{{township_name}} filing deadline: {{deadline_date}}",
    body: "The Cook County Assessor currently lists {{deadline_date}} as the last-file date for {{township_name}}. You can file directly with the Assessor at no charge. Your result page explains the available options. OverTaxed IL is not a law firm, does not provide legal advice, and cannot guarantee a reduction.",
    cta: "Review my options",
    suppressWhen: ["unsubscribed", "paid", "deadline_closed"],
  },
  {
    id: "process",
    channel: "email",
    timing: "Two days after the deadline explainer",
    subject: "What to review before you file",
    body: "A useful assessment review starts with your property's public record, relevant comparable properties, and a clear explanation of the comparison. Before choosing any paid option, review the evidence, filing window, service scope, and price.",
    cta: "See what goes into the review",
    suppressWhen: ["unsubscribed", "paid", "deadline_closed"],
  },
  {
    id: "consented-reminder",
    channel: "sms",
    timing: "Optional reminder inside a separately approved send window",
    body: "OverTaxed IL reminder: The Assessor currently lists {{deadline_date}} as the {{township_name}} filing deadline. Review your result: {{short_link}} Reply STOP to opt out.",
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
    subject: "Reminder: {{township_name}} closes {{deadline_date}}",
    body: "This is the final planned reminder for the current {{township_name}} Assessor filing window. You may file directly with the Cook County Assessor at no charge. Confirm the date on the official calendar before filing.",
    cta: "Review my result",
    suppressWhen: ["unsubscribed", "paid", "deadline_closed"],
  },
];
