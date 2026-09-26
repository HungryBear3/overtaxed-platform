import { createHash } from "node:crypto";
import { countyCalendarDay } from "@/lib/deadlines/official-source-state";
import {
  DRAFT_INTENTS,
  gateOfficialCalendarDraft,
  zonedInstantMs,
  type DraftGateInput,
  type DraftIntent,
} from "@/lib/social/official-calendar-draft-gate";
import type { CandidateClaimKind } from "@/lib/social/official-calendar-candidates";
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
export const templateDefinitionHash = (definition: unknown) =>
  hash(canonical(definition));
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
type Definition = {
  rendererVersion: number;
  version: number;
  intents: readonly DraftIntent[];
  claimKinds: readonly CandidateClaimKind[];
  requiredClaimKinds: readonly CandidateClaimKind[];
  labels: Partial<Record<CandidateClaimKind, string>>;
  prefix: string;
  item: readonly ("$label" | "$date" | string)[];
  separator: string;
  suffix: string;
};
const make = <T extends Definition>(definition: T) =>
  deepFreeze({
    ...definition,
    definitionHash: templateDefinitionHash(definition),
  });
const TEMPLATES = deepFreeze({
  official_dates_v1: make({
    rendererVersion: 1,
    version: 1,
    intents: ["plain_date"],
    claimKinds: ["notice_date", "window_opens", "last_file_date"],
    requiredClaimKinds: ["window_opens", "last_file_date"],
    labels: {
      notice_date: "Notice date",
      window_opens: "Filing window opens",
      last_file_date: "Last day to file",
    },
    prefix: "Official Cook County dates. ",
    item: ["$label", ": ", "$date"],
    separator: ". ",
    suffix: ".",
  }),
  open_window_deadline_v1: make({
    rendererVersion: 1,
    version: 1,
    intents: ["plain_date", "urgency", "cta"],
    claimKinds: ["last_file_date"],
    requiredClaimKinds: ["last_file_date"],
    labels: {},
    prefix: "The official filing window is open. Last day to file: ",
    item: ["$date"],
    separator: "",
    suffix: ". Review your filing options before the deadline.",
  }),
});
export const CONTROLLED_COPY_TEMPLATES = TEMPLATES;
function render(
  definition: Definition,
  claims: readonly { kind: CandidateClaimKind; date: string }[],
) {
  const byKind = new Map(claims.map((claim) => [claim.kind, claim]));
  const selected = definition.claimKinds.flatMap(
    (kind) => byKind.get(kind) ?? [],
  );
  if (definition.requiredClaimKinds.some((kind) => !byKind.has(kind)))
    return null;
  const items = selected.map((claim) =>
    definition.item
      .map((token) =>
        token === "$label"
          ? definition.labels[claim.kind]
          : token === "$date"
            ? claim.date
            : token,
      )
      .join(""),
  );
  return `${definition.prefix}${items.join(definition.separator)}${definition.suffix}`;
}
const blocked = (reason: string) => ({
  verdict: "blocked" as const,
  reason,
  renderedText: null,
  binding: null,
  reviewOnly: true as const,
  postAllowed: false as const,
});
const renderEvidence = (
  definition: Definition,
  claims: readonly { kind: CandidateClaimKind; date: string }[],
) => {
  const renderedText = render(definition, claims);
  return renderedText ? { renderedText } : blocked("render_evidence_missing");
};
function renderSafe(input: ControlledCopyInput) {
  if (
    typeof input.templateId !== "string" ||
    !Object.hasOwn(TEMPLATES, input.templateId)
  )
    return blocked("template_unknown");
  const templateId = input.templateId as ControlledCopyTemplateId;
  const template = TEMPLATES[templateId];
  const approval = input.approval;
  if (!approval) return blocked("approval_missing");
  if (
    !Array.isArray(approval.approvedIntents) ||
    !approval.approvedIntents.every(
      (intent) =>
        typeof intent === "string" &&
        DRAFT_INTENTS.includes(intent as DraftIntent),
    )
  )
    return blocked("input_invalid");
  if (
    approval.templateId !== templateId ||
    approval.templateVersion !== template.version ||
    approval.templateDefinitionHash !== template.definitionHash
  )
    return blocked("template_approval_mismatch");
  if (
    !template.intents.every((intent) =>
      approval.approvedIntents.includes(intent),
    )
  )
    return blocked("template_not_approved");
  const gated = gateOfficialCalendarDraft({
    ...input,
    requestedIntents: template.intents,
  });
  const denied = gated.decisions.find((decision) => !decision.allowed);
  if (denied) return blocked(denied.reason ?? "approval_scope");
  if (
    !gated.candidateId ||
    !gated.currentContentHash ||
    !gated.currentStatus ||
    approval.candidateId !== gated.candidateId ||
    approval.contentHash !== gated.currentContentHash ||
    approval.approvedStatus !== gated.currentStatus
  )
    return blocked("approval_changed");
  const approvedMs = zonedInstantMs(approval.approvedAt);
  const draftedMs = zonedInstantMs(input.draftedAt);
  if (
    !(approvedMs <= draftedMs) ||
    countyCalendarDay(approvedMs) !== countyCalendarDay(draftedMs)
  )
    return blocked("approval_stale");
  const evidence = renderEvidence(template, gated.dateEvidence);
  if ("verdict" in evidence) return evidence;
  const { renderedText } = evidence;
  const approvalHash = hash(
    canonical({
      approvedAt: approval.approvedAt,
      approvedIntents: [...approval.approvedIntents].sort(),
      approvedStatus: approval.approvedStatus,
      candidateId: approval.candidateId,
      contentHash: approval.contentHash,
      templateDefinitionHash: approval.templateDefinitionHash,
      templateId: approval.templateId,
      templateVersion: approval.templateVersion,
    }),
  );
  const countyDay = countyCalendarDay(draftedMs);
  const binding = {
    candidateId: gated.candidateId,
    candidateContentHash: gated.currentContentHash,
    approvalHash,
    sourceContentSha256: input.candidate.receipt.contentSha256,
    templateId,
    templateVersion: template.version,
    templateDefinitionHash: template.definitionHash,
    countyDay,
  };
  return {
    verdict: "rendered" as const,
    reason: null,
    renderedText,
    binding: {
      ...binding,
      renderedSha256: hash(canonical({ ...binding, renderedText })),
    },
    reviewOnly: true as const,
    postAllowed: false as const,
  };
}
export function renderOfficialCalendarCopy(input: ControlledCopyInput) {
  try {
    return renderSafe(input);
  } catch {
    return blocked("input_invalid");
  }
}
