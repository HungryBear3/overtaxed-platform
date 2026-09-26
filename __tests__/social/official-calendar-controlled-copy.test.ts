/** @jest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { OfficialDeadlineSnapshot as Snapshot } from "@/lib/deadlines/official-source-state";
import type { TownshipResolution } from "@/lib/deadlines/township-resolution";
import { buildOfficialCalendarCandidates } from "@/lib/social/official-calendar-candidates";
import type { CandidateApproval } from "@/lib/social/official-calendar-draft-gate";
import {
  CONTROLLED_COPY_TEMPLATES,
  renderOfficialCalendarCopy as render,
  type ControlledCopyInput,
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
): CandidateApproval => ({
  candidateId: candidate.candidateId,
  contentHash: candidate.contentHash,
  approvedStatus: candidate.status,
  approvedAt,
  approvedIntents: ["plain_date", "urgency", "cta"],
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

it("renders only allowlisted copy and binds every authority input", () => {
  const input = inputAt();
  const result = render(input);
  expect(result).toMatchObject({
    verdict: "rendered",
    reason: null,
    reviewOnly: true,
    postAllowed: false,
    binding: {
      candidateId: input.candidate.candidateId,
      candidateContentHash: input.candidate.contentHash,
      sourceContentSha256: SHA,
      templateId: "official_dates_v1",
      templateVersion: 1,
      countyDay: "2026-08-27",
    },
  });
});

it("cannot disguise caller-authored urgency or CTA copy as plain dates", () => {
  const input = inputAt() as ControlledCopyInput & {
    text?: string;
    intent?: string;
  };
  input.text = "ACT NOW! Click here before time runs out!";
  input.intent = "plain_date";
  const result = render(input);
  expect(result.verdict).toBe("rendered");
  expect(result.renderedText).not.toMatch(/act now|click here|time runs out/i);
  expect(render({ ...input, templateId: "plain_date" })).toMatchObject({
    verdict: "blocked",
    reason: "template_unknown",
  });
});

it("keeps the exported policy deeply immutable at runtime", () => {
  const policy = CONTROLLED_COPY_TEMPLATES as unknown as {
    open_window_deadline_v1: { intents: string[] };
  };
  expect(Object.isFrozen(policy)).toBe(true);
  expect(() => {
    policy.open_window_deadline_v1.intents = ["plain_date"];
  }).toThrow();
  const input = inputAt();
  input.approval = { ...input.approval!, approvedIntents: ["plain_date"] };
  expect(
    render({ ...input, templateId: "open_window_deadline_v1" }),
  ).toMatchObject({ verdict: "blocked", reason: "template_not_approved" });
});

it("normalizes approval evidence and rejects non-intent members", () => {
  const input = inputAt();
  const cyclic = input.approval as CandidateApproval & { extra?: unknown };
  cyclic.extra = cyclic;
  expect(() => render(input)).not.toThrow();
  const approvedIntents = [
    "plain_date",
    "cta",
    (globalThis as any).BigInt(1),
  ] as never;
  const malformed = { ...input, approval: { ...cyclic, approvedIntents } };
  expect(() => render(malformed)).not.toThrow();
  expect(render(malformed)).toMatchObject({ reason: "input_invalid" });
});

it("renders the fixed CTA only when its exact intents were approved", () => {
  const input = { ...inputAt(), templateId: "open_window_deadline_v1" };
  expect(render(input).verdict).toBe("rendered");
  const approvedIntents = ["plain_date", "cta"] as const;
  expect(
    render({ ...input, approval: { ...input.approval!, approvedIntents } }),
  ).toMatchObject({ verdict: "blocked", reason: "template_not_approved" });
});

it("does not reuse open-window approval after the window closes", () => {
  const reviewed = inputAt("2026-10-02T16:00Z");
  const closedAt = "2026-10-03T16:00Z";
  const result = render({
    ...reviewed,
    snapshot: fetchedAt(closedAt),
    draftedAt: closedAt,
  });
  expect(result).toMatchObject({
    verdict: "blocked",
    reason: "window_closed",
    renderedText: null,
    binding: null,
  });
});

it.each([
  ["unknown template", { templateId: "custom_promo_v1" }, "template_unknown"],
  ["zone-less time", { draftedAt: "2026-08-27T16:00" }, "date_invalid"],
  ["rolled date", { draftedAt: "2026-02-30T16:00Z" }, "date_invalid"],
  [
    "malformed intents",
    { approval: { approvedIntents: null } },
    "input_invalid",
  ],
  ["malformed candidate", { candidate: null }, "input_invalid"],
] as const)("fails closed for %s", (_, patch, reason) => {
  const malformed = { ...inputAt(), ...patch } as ControlledCopyInput;
  expect(() => render(malformed)).not.toThrow();
  expect(render(malformed)).toMatchObject({
    verdict: "blocked",
    reason,
    binding: null,
  });
});

it("treats Cook County midnight as an approval boundary", () => {
  const before = inputAt("2026-08-28T04:59Z"); // 11:59 PM CDT
  const after = "2026-08-28T05:01Z"; // 12:01 AM CDT
  const nextDay = fetchedAt(after);
  nextDay.sources.assessor!.retrievedAt = "2026-08-28T05:00:30Z";
  expect(render(before).binding?.countyDay).toBe("2026-08-27");
  expect(
    render({ ...before, snapshot: nextDay, draftedAt: after }),
  ).toMatchObject({ verdict: "blocked", reason: "approval_stale" });
});
