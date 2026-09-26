import { createHash } from "node:crypto";

import { countyCalendarDay } from "@/lib/deadlines/official-source-state";
import {
  DRAFT_INTENTS,
  gateOfficialCalendarDraft,
  type DraftBlockReason,
  type DraftGateInput,
  type DraftIntent,
} from "@/lib/social/official-calendar-draft-gate";

const TEMPLATES = Object.freeze({
  official_dates_v1: Object.freeze({
    version: 1,
    intents: Object.freeze(["plain_date", "cta"] as const),
  }),
  open_window_deadline_v1: Object.freeze({
    version: 1,
    intents: Object.freeze(["plain_date", "urgency", "cta"] as const),
  }),
});
export const CONTROLLED_COPY_TEMPLATES = TEMPLATES;

export type ControlledCopyTemplateId = keyof typeof CONTROLLED_COPY_TEMPLATES;

export type ControlledCopyInput = Omit<DraftGateInput, "requestedIntents"> & {
  templateId: ControlledCopyTemplateId | (string & {});
};

export type ControlledCopyBlockReason =
  | DraftBlockReason
  | "template_unknown"
  | "approval_missing"
  | "template_not_approved"
  | "input_invalid"
  | "render_evidence_missing";

export type ControlledCopyResult = {
  verdict: "blocked" | "rendered";
  reason: ControlledCopyBlockReason | null;
  renderedText: string | null;
  binding: {
    candidateId: string;
    candidateContentHash: string;
    approvalHash: string;
    sourceContentSha256: string;
    templateId: ControlledCopyTemplateId;
    templateVersion: number;
    countyDay: string;
    renderedSha256: string;
  } | null;
  reviewOnly: true;
  postAllowed: false;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
};

const labels = {
  notice_date: "Notice date",
  window_opens: "Filing window opens",
  last_file_date: "Last day to file",
} as const;

function render(
  templateId: ControlledCopyTemplateId,
  claims: { kind: keyof typeof labels; date: string }[],
): string | null {
  if (!claims.length) return null;
  const dates = claims.map(({ kind, date }) => `${labels[kind]}: ${date}`);
  if (templateId === "official_dates_v1") {
    return `Official Cook County dates. ${dates.join(". ")}.`;
  }
  const deadline = claims.find((claim) => claim.kind === "last_file_date");
  if (!deadline) return null;
  return `The official filing window is open. Last day to file: ${deadline.date}. Review your filing options before the deadline.`;
}

const blocked = (reason: ControlledCopyBlockReason): ControlledCopyResult => ({
  verdict: "blocked",
  reason,
  renderedText: null,
  binding: null,
  reviewOnly: true,
  postAllowed: false,
});

export function renderOfficialCalendarCopy(
  input: ControlledCopyInput,
): ControlledCopyResult {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.templateId !== "string" ||
    !Object.hasOwn(TEMPLATES, input.templateId)
  ) {
    return blocked("template_unknown");
  }
  const templateId = input.templateId as ControlledCopyTemplateId;
  const template = TEMPLATES[templateId];
  if (!input.approval) return blocked("approval_missing");
  if (
    !Array.isArray(input.approval.approvedIntents) ||
    !input.approval.approvedIntents.every(
      (intent) =>
        typeof intent === "string" &&
        DRAFT_INTENTS.includes(intent as DraftIntent),
    ) ||
    !input.candidate ||
    typeof input.candidate !== "object" ||
    !input.candidate.receipt ||
    typeof input.candidate.receipt.contentSha256 !== "string"
  ) {
    return blocked("input_invalid");
  }
  const required = template.intents as readonly DraftIntent[];
  if (
    !required.every((intent) =>
      input.approval!.approvedIntents.includes(intent),
    )
  ) {
    return blocked("template_not_approved");
  }

  let gated: ReturnType<typeof gateOfficialCalendarDraft>;
  try {
    gated = gateOfficialCalendarDraft({ ...input, requestedIntents: required });
  } catch {
    return blocked("input_invalid");
  }
  const denied = gated.decisions.find((decision) => !decision.allowed);
  if (denied) return blocked(denied.reason ?? "approval_scope");
  if (
    !gated.candidateId ||
    !gated.currentContentHash ||
    gated.dateEvidence.length === 0 ||
    !SHA256_HEX.test(input.candidate.receipt.contentSha256)
  ) {
    return blocked("render_evidence_missing");
  }
  const renderedText = render(templateId, [...gated.dateEvidence]);
  if (!renderedText) return blocked("render_evidence_missing");

  const approved = input.approval;
  const approvalHash = hash(
    canonical({
      approvedAt: approved.approvedAt,
      approvedIntents: [...approved.approvedIntents],
      approvedStatus: approved.approvedStatus,
      candidateId: approved.candidateId,
      contentHash: approved.contentHash,
    }),
  );
  const countyDay = countyCalendarDay(Date.parse(input.draftedAt));
  const renderedSha256 = hash(
    canonical({
      approvalHash,
      candidateId: gated.candidateId,
      candidateContentHash: gated.currentContentHash,
      countyDay,
      renderedText,
      sourceContentSha256: input.candidate.receipt.contentSha256,
      templateId,
      templateVersion: template.version,
    }),
  );
  return {
    verdict: "rendered",
    reason: null,
    renderedText,
    binding: {
      candidateId: gated.candidateId,
      candidateContentHash: gated.currentContentHash,
      approvalHash,
      sourceContentSha256: input.candidate.receipt.contentSha256,
      templateId,
      templateVersion: template.version,
      countyDay,
      renderedSha256,
    },
    reviewOnly: true,
    postAllowed: false,
  };
}
