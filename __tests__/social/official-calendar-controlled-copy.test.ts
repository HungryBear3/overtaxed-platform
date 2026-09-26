/** @jest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { OfficialDeadlineSnapshot as Snapshot } from "@/lib/deadlines/official-source-state";
import type { TownshipResolution } from "@/lib/deadlines/township-resolution";
import { buildOfficialCalendarCandidates } from "@/lib/social/official-calendar-candidates";
import {
  CONTROLLED_COPY_TEMPLATES,
  renderOfficialCalendarCopy as render,
  type ControlledCopyApproval,
  type ControlledCopyInput,
  type ControlledCopyTemplateId,
} from "@/lib/social/official-calendar-controlled-copy";
import { buildSnapshot, SOURCES } from "@/scripts/refresh-township-deadlines";

const SHA = "bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca";
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
const candidateAt = (at: string) => {
  const [candidate] = buildOfficialCalendarCandidates({
    snapshot: fetchedAt(at),
    evaluatedAt: at,
    townshipLabels: ["Calumet"],
    stages: ["assessor"],
    expectedSha256: { assessor: SHA },
  }).candidates;
  if (!candidate) throw new Error("candidate unavailable");
  return candidate;
};
const identity = (): TownshipResolution => ({
  inputKind: "pin",
  normalizedPin: "16011230040000",
  normalizedAddress: null,
  townshipKey: "calumet",
  townshipName: "Calumet",
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
const inputAt = (at = OPEN): ControlledCopyInput => {
  const candidate = candidateAt(at);
  return {
    candidate,
    approval: approval(candidate, at),
    snapshot: fetchedAt(at),
    draftedAt: at,
    identity: identity(),
    templateId: "official_dates_v1",
  };
};

it("cannot disguise caller-authored urgency or CTA copy as plain dates", () => {
  const input = {
    ...inputAt(),
    text: "ACT NOW! Click here before time runs out!",
    intent: "plain_date",
  } as ControlledCopyInput;
  const result = render(input);
  expect(result.renderedText).not.toMatch(/act now|click here|time runs out/i);
  expect(result.renderedText).toContain("Last day to file: 2026-10-02.");
  expect(CONTROLLED_COPY_TEMPLATES.official_dates_v1.definitionHash).toBe(
    "d15ff56307e160e03a66cb919195d55595b67a5feaec6d36ed607336a51640c0",
  );
});

it("binds approval to template, version and exact definition", () => {
  const input = inputAt();
  for (const approvalPatch of [
    { templateId: "open_window_deadline_v1" },
    { templateVersion: 2 },
    { templateDefinitionHash: "0".repeat(64) },
  ]) {
    const changed = { ...input.approval!, ...approvalPatch };
    const result = render({
      ...input,
      approval: changed,
    } as ControlledCopyInput);
    expect(result.reason).toBe("template_approval_mismatch");
  }
});

it("does not reuse open-window approval after the window closes", () => {
  const reviewed = inputAt("2026-10-02T16:00Z");
  reviewed.templateId = "open_window_deadline_v1";
  reviewed.approval = approval(
    reviewed.candidate,
    reviewed.draftedAt,
    "open_window_deadline_v1",
  );
  const closedAt = "2026-10-03T16:00Z";
  const result = render({
    ...reviewed,
    snapshot: fetchedAt(closedAt),
    draftedAt: closedAt,
  });
  expect(result.reason).toBe("approval_stale");
});

it("contains malformed objects and hostile getters", () => {
  expect(render({ ...inputAt(), candidate: null } as never).reason).toBe(
    "input_invalid",
  );
  const hostile = new Proxy(inputAt(), {
    get: () => {
      throw Error("hostile");
    },
  });
  expect(render(hostile).reason).toBe("input_invalid");
});

it("treats Cook County midnight as an approval boundary", () => {
  const before = inputAt("2026-08-28T04:59Z"); // 11:59 PM CDT
  const after = "2026-08-28T05:01Z"; // 12:01 AM CDT
  const nextDay = fetchedAt(after);
  nextDay.sources.assessor!.retrievedAt = "2026-08-28T05:00:30Z";
  expect(
    render({ ...before, snapshot: nextDay, draftedAt: after }),
  ).toMatchObject({ verdict: "blocked", reason: "approval_stale" });
});
