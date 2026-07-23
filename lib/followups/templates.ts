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
  const copy: Record<string, { subject: string; body: string[]; cta: string }> = {
    RESULT: {
      subject: `Your ${township} property check is ready`,
      body: [
        `Your free property check${args.address ? ` for ${args.address}` : ""} is ready.`,
        "It is based on public Cook County assessment records. Review the result, the source information, and your available next steps in one place.",
        "Any estimated savings are informational, not guaranteed.",
      ],
      cta: "Review my result",
    },
    DAY_1: {
      subject: deadlineLabel ? `${township} filing deadline: ${deadlineLabel}` : "Check your Cook County filing window",
      body: deadlineLabel
        ? [
            `The Cook County Assessor currently lists ${deadlineLabel} as the last-file date for ${township}.`,
            "You can file directly with the Assessor at no charge. If you want help reviewing the public assessment data and preparing your filing materials, your result page explains the available options.",
            "OverTaxed IL is not a law firm, does not provide legal advice, and cannot guarantee a reduction.",
          ]
        : [
            "Cook County filing windows vary by township.",
            "Check the official Assessor calendar and your result page before deciding whether to file.",
          ],
      cta: "Review my options",
    },
    DAY_3: {
      subject: "What to review before you file",
      body: [
        "A useful assessment review starts with your property's public record, relevant comparable properties, and a clear explanation of the comparison.",
        "Before choosing any paid option, review the evidence, the filing window, the service scope, and the price.",
      ],
      cta: "See what goes into the review",
    },
    FINAL: {
      subject: deadlineLabel ? `Reminder: ${township} closes ${deadlineLabel}` : "Reminder: review your filing window",
      body: deadlineLabel
        ? [
            `This is the final planned reminder for the current ${township} Assessor filing window. The Assessor currently lists ${deadlineLabel} as the last-file date.`,
            "You may file directly with the Cook County Assessor at no charge. Confirm the date on the official calendar before filing.",
          ]
        : ["Check the official Cook County Assessor calendar before filing."],
      cta: "Review my result",
    },
  };
  const selected = copy[args.step];
  if (!selected) return null;
  const text = `${selected.body.join("\n\n")}\n\n${selected.cta}: ${args.resultUrl}\n\nYou're receiving this because you asked OverTaxed IL for a free property check and opted in to email follow-up.\nUnsubscribe: ${args.unsubscribeUrl}`;
  const paragraphs = selected.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937;line-height:1.55">${paragraphs}<p><a href="${esc(args.resultUrl)}" style="display:inline-block;background:#153b5b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">${esc(selected.cta)}</a></p><hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0 16px"/><p style="font-size:12px;color:#6b7280">You're receiving this because you asked OverTaxed IL for a free property check and opted in to email follow-up.</p><p style="font-size:12px;color:#6b7280">OverTaxed IL · 1028 W Leland Ave, Chicago IL 60640 · <a href="${esc(args.unsubscribeUrl)}">Unsubscribe</a></p></div>`;
  return { subject: selected.subject, text, html };
}

export function buildFollowupSms(args: { township?: string | null; resultUrl: string }): string | null {
  const deadline = getOfficial2026Deadline(args.township ?? null);
  if (!deadline) return null;
  return `OverTaxed IL reminder: The Assessor currently lists ${dateLabel(deadline.lastFileDate)} as the ${args.township} filing deadline. Review your result: ${args.resultUrl} Reply STOP to opt out.`;
}
