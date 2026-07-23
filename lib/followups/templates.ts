import { getOfficial2026Deadline } from "@/lib/appeals/township-deadlines";

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function dateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export function buildFollowupEmail(args: {
  step: string;
  township?: string | null;
  address?: string | null;
  resultUrl: string;
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } | null {
  const township = args.township?.trim() || "your township";
  const deadline = getOfficial2026Deadline(args.township ?? null);
  const deadlineLabel = deadline ? dateLabel(deadline.lastFileDate) : null;
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

export function buildFollowupSms(args: { township?: string | null; resultUrl: string }): string | null {
  const deadline = getOfficial2026Deadline(args.township ?? null);
  if (!deadline) return null;
  return `OverTaxed IL: ${args.township} Assessor deadline is ${dateLabel(deadline.lastFileDate)}. Review your free check: ${args.resultUrl} Reply STOP to opt out.`;
}
