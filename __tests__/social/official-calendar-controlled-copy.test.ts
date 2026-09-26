/** @jest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  DeadlineStage,
  OfficialDeadlineSnapshot as Snapshot,
} from "@/lib/deadlines/official-source-state";
import type { TownshipResolution } from "@/lib/deadlines/township-resolution";
import { buildOfficialCalendarCandidates } from "@/lib/social/official-calendar-candidates";
import {
  CONTROLLED_COPY_TEMPLATES,
  renderOfficialCalendarCopy as render,
  templateDefinitionHash,
  type ControlledCopyApproval,
  type ControlledCopyInput,
  type ControlledCopyTemplateId,
} from "@/lib/social/official-calendar-controlled-copy";
import { buildSnapshot, SOURCES } from "@/scripts/refresh-township-deadlines";

const SHA = "bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca";
const B_SHA =
  "04eaa4db1b0be4bc00dd3ec5834cd67bc16ab0cba4bb0380e676461a16b7925b";
const OPEN = "2026-08-27T16:00Z";
let SNAP: Snapshot;

beforeAll(async () => {
  const dir = join(process.cwd(), "__tests__/fixtures/deadlines");
  const files: Record<string, string> = {
    [SOURCES.assessor.url]: "assessor-calendar-20260827.html",
    [SOURCES.bor.url]: "bor-township-open-close-20260827.pdf",
  };
  const built = await buildSnapshot({
    fetchSource: async (url) => ({
      status: 200,
      finalUrl: url,
      body: new Uint8Array(readFileSync(join(dir, files[url]))),
    }),
    now: "2026-08-27T15:00:00.000Z",
    synthetic: false,
    expectedSha256: { assessor: SHA },
  });
  if (!built.ok) throw new Error("pinned fixtures no longer build");
  SNAP = built.snapshot;
});

const fetchedAt = (at: string): Snapshot => {
  const retrievedAt = new Date(Date.parse(at) - 3_600_000).toISOString();
  const assessor = { ...SNAP.sources.assessor!, retrievedAt };
  return { ...SNAP, sources: { ...SNAP.sources, assessor } };
};
const candidateAt = (
  at: string,
  label = "Calumet",
  stage: DeadlineStage = "assessor",
) => {
  const [candidate] = buildOfficialCalendarCandidates({
    snapshot: fetchedAt(at),
    evaluatedAt: at,
    townshipLabels: [label],
    stages: [stage],
    expectedSha256: { assessor: SHA, bor: B_SHA },
  }).candidates;
  if (!candidate) throw new Error("candidate unavailable");
  return candidate;
};
const identity = (townshipKey: string): TownshipResolution => ({
  inputKind: "pin",
  normalizedPin: "16011230040000",
  normalizedAddress: null,
  townshipKey,
  townshipName: townshipKey,
  resolutionSource: "official_property_record",
  resolvedAt: OPEN,
});
const approval = (
  candidate: ReturnType<typeof candidateAt>,
  approvedAt: string,
  templateId: ControlledCopyTemplateId = "official_dates_v1",
): ControlledCopyApproval => ({
  candidateId: candidate.candidateId,
  contentHash: candidate.contentHash,
  approvedStatus: candidate.status,
  approvedAt,
  approvedIntents: ["plain_date", "urgency", "cta"],
  templateId,
  templateVersion: CONTROLLED_COPY_TEMPLATES[templateId].version,
  templateDefinitionHash: CONTROLLED_COPY_TEMPLATES[templateId].definitionHash,
});
const inputAt = (
  at = OPEN,
  label = "Calumet",
  stage: DeadlineStage = "assessor",
): ControlledCopyInput => {
  const candidate = candidateAt(at, label, stage);
  return {
    candidate,
    approval: approval(candidate, at),
    snapshot: fetchedAt(at),
    draftedAt: at,
    identity: identity(candidate.snapshotKey),
    templateId: "official_dates_v1",
  };
};
const approvalReason = (input: ControlledCopyInput, patch: object) =>
  render({
    ...input,
    approval: { ...input.approval!, ...patch },
  } as ControlledCopyInput).reason;

it("binds approval to template, version and exact definition", () => {
  const input = inputAt();
  for (const approvalPatch of [
    { templateId: "open_window_deadline_v1" },
    { templateVersion: 2 },
    { templateDefinitionHash: "0".repeat(64) },
  ])
    expect(approvalReason(input, approvalPatch)).toBe(
      "template_approval_mismatch",
    );
});

it("renders CTA and hashes every declarative change", () => {
  const input = inputAt();
  input.templateId = "open_window_deadline_v1";
  input.approval = approval(input.candidate, OPEN, "open_window_deadline_v1");
  expect(render(input).renderedText).toContain("Review your filing options");
  const { definitionHash: _, ...definition } =
    CONTROLLED_COPY_TEMPLATES.official_dates_v1;
  expect(
    templateDefinitionHash({ ...definition, claimKinds: ["last_file_date"] }),
  ).not.toBe(_);
  expect(
    templateDefinitionHash({ ...definition, rendererVersion: 2 }),
  ).not.toBe(_);
});

it("renders Assessor and BOR claims while required claims fail closed", () => {
  const assessorCopy = render(inputAt());
  expect(assessorCopy.renderedText).toContain("Notice date:");
  expect(assessorCopy.binding?.templateDefinitionHash).toBe(
    CONTROLLED_COPY_TEMPLATES.official_dates_v1.definitionHash,
  );
  const bor = render(inputAt(OPEN, "Rogers Park", "bor"));
  expect(bor.renderedText).not.toContain("Notice date:");
  expect(bor.renderedText).toContain("Last day to file: 2026-09-01.");
  const input = inputAt();
  const snapshot = structuredClone(input.snapshot);
  snapshot.townships.calumet.stages.assessor!.lastFileDate = undefined as never;
  expect(render({ ...input, snapshot }).verdict).toBe("blocked");
});

it("rejects cross-candidate, arbitrary and cross-status approvals", () => {
  const input = inputAt();
  for (const patch of [
    { candidateId: "occ_other" },
    { contentHash: "0".repeat(64) },
    { approvedStatus: "upcoming" as const },
  ])
    expect(approvalReason(input, patch)).toBe("approval_changed");
});

it("freezes definitions and rejects unknown templates and malformed intents", () => {
  const template = CONTROLLED_COPY_TEMPLATES.official_dates_v1;
  expect(Object.isFrozen(template.claimKinds)).toBe(true);
  expect(render({ ...inputAt(), templateId: "unknown" }).reason).toBe(
    "template_unknown",
  );
  expect(approvalReason(inputAt(), { approvedIntents: null })).toBe(
    "input_invalid",
  );
});
