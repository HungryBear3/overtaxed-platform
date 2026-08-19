import type { DeadlineProjection } from "@/lib/deadlines/official-source-state";

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function dateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/**
 * The date this copy may name, or null.
 *
 * A projection that is unavailable, or that is available but not cleared for
 * deadline email, yields null and every template below falls through to its
 * dateless variant. Both conditions are checked because they fail differently:
 * unavailable means we could not verify the window, while `allowDeadlineEmail`
 * false means we verified it and it is closed or the reader's township was
 * never established by a property record.
 */
function labelFor(deadline: DeadlineProjection | null | undefined): string | null {
  if (!deadline?.available) return null;
  if (!deadline.allowDeadlineEmail || !deadline.showDates) return null;
  return dateLabel(deadline.lastFileDate);
}

/**
 * Build one follow-up email.
 *
 * The caller passes a projection rather than a township name: this module does
 * no lookup, so there is no path by which it can name a date the canonical
 * state did not verify.
 */
export function buildFollowupEmail(args: {
  step: string;
  township?: string | null;
  address?: string | null;
  resultUrl: string;
  unsubscribeUrl: string;
  deadline?: DeadlineProjection | null;
}): { subject: string; text: string; html: string } | null {
  const township = args.township?.trim() || "your township";
  const deadlineLabel = labelFor(args.deadline);
  const copy: Record<string, { subject: string; body: string; cta: string }> = {
    RESULT: {
      subject: `Your ${township} property check`,
      body: `Your free check${args.address ? ` for ${args.address}` : ""} is ready. It uses public Cook County records and any estimated savings are not guaranteed.`,
      cta: "Review my free check",
    },
    DAY_1: {
      subject: deadlineLabel ? `What the ${deadlineLabel} deadline means` : "Understanding the Cook County review process",
      body: deadlineLabel
        ? `The Cook County Assessor currently lists ${deadlineLabel} as the last-file date for ${township}. Filing directly with the Assessor is free. OverTaxed IL is not a law firm, and no reduction is guaranteed.`
        : "Cook County appeal dates vary by township. Check the official calendar before deciding whether to file.",
      cta: "See my options",
    },
    DAY_3: {
      subject: "What goes into an assessment review",
      body: "A useful review starts with the property's public assessment record, relevant comparable properties, and a clear explanation of the comparison. Review the evidence and pricing before choosing a paid option.",
      cta: "Review the process",
    },
    FINAL: {
      subject: deadlineLabel ? `${township} Assessor window closes ${deadlineLabel}` : "Review your filing window",
      body: deadlineLabel
        ? `This is the final planned reminder for the current ${township} Assessor window. You may file directly with the Cook County Assessor at no charge. Check the official calendar before filing.`
        : "Check the official Cook County Assessor calendar before filing.",
      cta: "Review my free check",
    },
  };
  const selected = copy[args.step];
  if (!selected) return null;
  const text = `${selected.body}\n\n${selected.cta}: ${args.resultUrl}\n\nUnsubscribe: ${args.unsubscribeUrl}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><p>${esc(selected.body)}</p><p><a href="${esc(args.resultUrl)}">${esc(selected.cta)}</a></p><hr/><p style="font-size:12px;color:#6b7280">OverTaxed IL · 1028 W Leland Ave, Chicago IL 60640 · <a href="${esc(args.unsubscribeUrl)}">Unsubscribe</a></p></div>`;
  return { subject: selected.subject, text, html };
}

/**
 * The SMS reminder, which exists only to carry a date.
 *
 * With nothing verifiable to say there is no message worth sending, so an
 * unavailable projection returns null rather than a dateless SMS.
 */
export function buildFollowupSms(args: {
  township?: string | null;
  resultUrl: string;
  deadline?: DeadlineProjection | null;
}): string | null {
  const deadlineLabel = labelFor(args.deadline);
  if (!deadlineLabel) return null;
  return `OverTaxed IL: ${args.township} Assessor deadline is ${deadlineLabel}. Review your free check: ${args.resultUrl} Reply STOP to opt out.`;
}
