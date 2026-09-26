import { createHash } from "node:crypto";

import { countyCalendarDay } from "@/lib/deadlines/official-source-state";
import {
  DRAFT_INTENTS,
  gateOfficialCalendarDraft,
  zonedInstantMs,
  type DraftGateInput,
  type DraftIntent,
} from "@/lib/social/official-calendar-draft-gate";

export type ControlledCopyTemplateId =
  | "official_dates_v1"
  | "open_window_deadline_v1";

export type ControlledCopyApproval = NonNullable<DraftGateInput["approval"]> & {
  templateId: ControlledCopyTemplateId;
  templateVersion: number;
  templateDefinitionHash: string;
};

export type ControlledCopyInput = Omit<
  DraftGateInput,
  "approval" | "requestedIntents"
> & {
  approval: ControlledCopyApproval | null;
  templateId: ControlledCopyTemplateId | (string & {});
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
const RENDER_SCHEMA = Object.freeze({
  version: 1,
  labels: Object.freeze({
    notice_date: "Notice date",
    window_opens: "Filing window opens",
    last_file_date: "Last day to file",
  }),
  labelValueSeparator: ": ",
  claimSeparator: ". ",
  tokenSeparator: " ",
  final: ".",
});
export const templateDefinitionHash = (definition: unknown) =>
  hash(canonical({ definition, renderSchema: RENDER_SCHEMA }));

function template<
  const I extends readonly DraftIntent[],
  const C extends readonly string[],
>(version: number, intents: I, copy: C) {
  const definition = { version, intents, copy };
  return Object.freeze({
    ...definition,
    intents: Object.freeze(intents),
    copy: Object.freeze(copy),
    definitionHash: templateDefinitionHash(definition),
  });
}
const TEMPLATES = Object.freeze({
  official_dates_v1: template(
    1,
    ["plain_date"],
    ["Official Cook County dates.", "claims"],
  ),
  open_window_deadline_v1: template(
    1,
    ["plain_date", "urgency", "cta"],
    [
      "The official filing window is open. Last day to file:",
      "Review your filing options before the deadline.",
    ],
  ),
});
export const CONTROLLED_COPY_TEMPLATES = TEMPLATES;

function render(
  templateId: ControlledCopyTemplateId,
  claims: { kind: keyof typeof RENDER_SCHEMA.labels; date: string }[],
): string | null {
  if (!claims.length) return null;
  const dates = claims.map(
    ({ kind, date }) =>
      `${RENDER_SCHEMA.labels[kind]}${RENDER_SCHEMA.labelValueSeparator}${date}`,
  );
  if (templateId === "official_dates_v1") {
    return `${TEMPLATES[templateId].copy[0]}${RENDER_SCHEMA.tokenSeparator}${dates.join(RENDER_SCHEMA.claimSeparator)}${RENDER_SCHEMA.final}`;
  }
  const deadline = claims.find((claim) => claim.kind === "last_file_date");
  if (!deadline) return null;
  const [before, after] = TEMPLATES[templateId].copy;
  const { tokenSeparator: s, final } = RENDER_SCHEMA;
  return `${before}${s}${deadline.date}${final}${s}${after}`;
}

const blocked = (reason: string) => ({
  verdict: "blocked" as const,
  reason,
  renderedText: null,
  binding: null,
  reviewOnly: true,
  postAllowed: false,
});

function renderSafe(input: ControlledCopyInput) {
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
    input.approval.templateId !== templateId ||
    input.approval.templateVersion !== template.version ||
    input.approval.templateDefinitionHash !== template.definitionHash
  ) {
    return blocked("template_approval_mismatch");
  }
  const approvedMs = zonedInstantMs(input.approval.approvedAt);
  const draftedMs = zonedInstantMs(input.draftedAt);
  if (
    !(approvedMs <= draftedMs) ||
    countyCalendarDay(approvedMs) !== countyCalendarDay(draftedMs)
  )
    return blocked("approval_stale");
  if (
    !required.every((intent) =>
      input.approval!.approvedIntents.includes(intent),
    )
  ) {
    return blocked("template_not_approved");
  }

  const gated = gateOfficialCalendarDraft({
    ...input,
    requestedIntents: required,
  });
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
      approvedIntents: [...approved.approvedIntents].sort(),
      approvedStatus: approved.approvedStatus,
      candidateId: approved.candidateId,
      contentHash: approved.contentHash,
      templateDefinitionHash: approved.templateDefinitionHash,
      templateId: approved.templateId,
      templateVersion: approved.templateVersion,
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

export function renderOfficialCalendarCopy(input: ControlledCopyInput) {
  try {
    return renderSafe(input);
  } catch {
    return blocked("input_invalid");
  }
}
