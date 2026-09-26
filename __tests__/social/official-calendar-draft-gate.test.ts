/** @jest-environment node */
// Slice A3. Pinned 2026-08-27 captures, built in memory as in A2; no fetch.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { OfficialDeadlineSnapshot as Snapshot } from "@/lib/deadlines/official-source-state";
import type { TownshipResolution } from "@/lib/deadlines/township-resolution";
import { buildOfficialCalendarCandidates } from "@/lib/social/official-calendar-candidates";
import {
  DRAFT_INTENTS as ALL,
  gateOfficialCalendarDraft as gate,
  type CandidateApproval,
  type DraftGateInput as Input,
} from "@/lib/social/official-calendar-draft-gate";
import { buildSnapshot, SOURCES } from "@/scripts/refresh-township-deadlines";

const A_SHA =
  "bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca";
const T0 = "2026-08-27T16:00Z";
const FILES: Record<string, string> = {
  [SOURCES.assessor.url]: "assessor-calendar-20260827.html",
  [SOURCES.bor.url]: "bor-township-open-close-20260827.pdf",
};
let SNAP: Snapshot;

beforeAll(async () => {
  const dir = join(process.cwd(), "__tests__/fixtures/deadlines");
  const built = await buildSnapshot({
    fetchSource: async (url) => ({
      status: 200,
      finalUrl: url,
      body: new Uint8Array(readFileSync(join(dir, FILES[url]))),
    }),
    now: "2026-08-27T15:00:00.000Z",
    synthetic: false,
    expectedSha256: { assessor: A_SHA },
  });
  if (!built.ok) throw new Error("pinned fixtures no longer build");
  SNAP = built.snapshot;
});

/** The same bytes, re-retrieved an hour before `at`. */
const fetchedAt = (at: string, snap = SNAP): Snapshot => {
  const retrievedAt = new Date(Date.parse(at) - 3_600_000).toISOString();
  const assessor = { ...snap.sources.assessor!, retrievedAt };
  return { ...snap, sources: { ...snap.sources, assessor } };
};
/** SNAP with Calumet's Assessor window replaced field by field. */
const calumet = (w: object): Snapshot => {
  const assessor = { ...SNAP.townships.calumet.stages.assessor!, ...w };
  const calumet = { townshipName: "Calumet", stages: { assessor } };
  return { ...SNAP, townships: { ...SNAP.townships, calumet } };
};
const candidateOf = (label: string, at = T0, snap = SNAP) => {
  const [c] = buildOfficialCalendarCandidates({
    snapshot: fetchedAt(at, snap),
    evaluatedAt: at,
    townshipLabels: [label],
    stages: ["assessor"],
    expectedSha256: { assessor: A_SHA },
  }).candidates;
  if (!c) throw new Error(`no candidate for ${label} at ${at}`);
  return c;
};
const record = (townshipKey: string): TownshipResolution => ({
  inputKind: "pin",
  normalizedPin: "16011230040000",
  normalizedAddress: null,
  townshipKey,
  townshipName: townshipKey,
  resolutionSource: "official_property_record",
  resolvedAt: T0,
});
const approve = (
  c: Input["candidate"],
  approvedAt: string,
  intents = [...ALL],
) => ({ ...c, approvedAt, approvedIntents: intents });

/** "seen ok at": reviewed, approved for everything, drafted (2026, UTC). */
const timeline = (label: string, times: string, snap = SNAP): Input => {
  const [seen, ok, at] = times.split(" ").map((x) => `2026-${x}Z`);
  const candidate = candidateOf(label, seen, snap);
  return {
    candidate,
    approval: approve(candidate, ok),
    snapshot: fetchedAt(at, snap),
    draftedAt: at,
    requestedIntents: ALL,
    identity: record(candidate.snapshotKey),
  };
};
const DAY = "08-27T16:00 08-27T16:10 08-27T16:30";
const run = (over: Partial<Input> = {}) =>
  gate({ ...timeline("Calumet", DAY), ...over });
const why = (over: Partial<Input> = {}) =>
  run(over).decisions.map((d) => `${d.intent}:${d.reason ?? "ok"}`);
const expectAllBlocked = (over: Partial<Input>, reason: string) => {
  const r = run(over);
  expect(r.verdict).toBe("blocked");
  expect(r.dateEvidence).toEqual([]);
  expect(new Set(r.decisions.map((d) => d.reason))).toEqual(new Set([reason]));
};
const dateOnly = (reason: string) =>
  ["plain_date:ok"].concat(ALL.slice(1).map((k) => `${k}:${reason}`));

it("permits reminder, urgency and CTA for a fresh, approved, eligible open window", () => {
  const r = run();
  expect(r).toMatchObject({ verdict: "permitted", postAllowed: false });
  expect(r.dateEvidence).toEqual(candidateOf("Calumet").claims);
  expect(why().filter((l) => !l.endsWith(":ok"))).toEqual([
    "deadline_near:deadline_not_near", // closes in 36 days
  ]);
  // Lemont closes 2026-09-29; nine days out, deadline-near wording is allowed.
  const near = timeline("Lemont", "09-20T15:00 09-20T15:45 09-20T16:00");
  expect(why(near)).toEqual(ALL.map((k) => `${k}:ok`));
});

it("keeps plain dates but nothing more for a page-slug township", () => {
  const slug = { identity: undefined };
  expect(run(slug).verdict).toBe("date_only");
  expect(run(slug).dateEvidence).toEqual(candidateOf("Calumet").claims);
  expect(why(slug)).toEqual(dateOnly("identity_not_eligible"));
});

it("invalidates missing, stale, future, changed and out-of-scope approvals", () => {
  const c = candidateOf("Calumet");
  const cases: [CandidateApproval | null, string][] = [
    [null, "approval_missing"],
    [approve(c, "2026-08-26T20:00Z"), "approval_stale"], // prior county day
    [approve(c, "2026-08-27T17:00Z"), "approval_stale"], // after the draft
    [approve(c, "not a time"), "approval_stale"],
    [approve({ ...c, contentHash: "0".repeat(64) }, T0), "approval_changed"],
    [approve({ ...c, candidateId: "occ_other" }, T0), "approval_changed"],
    [approve(c, T0, ["plain_date"]), "approval_scope"],
  ];
  const requestedIntents = ["cta", "plain_date"] as const;
  for (const [approval, reason] of cases) {
    const got = why({ approval, requestedIntents });
    expect(got).toEqual(["plain_date:ok", `cta:${reason}`]);
  }
  // Reviewed while upcoming, approved and drafted the day Calumet opened:
  // same hash, same day, but not the status the reviewer read.
  const t = timeline("Calumet", "08-19T16:00 08-20T15:00 08-20T16:00");
  expect(t.candidate.status).toBe("upcoming");
  const cta = why({ ...t, requestedIntents: ["cta"] });
  expect(cta).toEqual(["cta:approval_changed"]);
});

it("blocks everything when canonical state no longer matches the review", () => {
  const moved = fetchedAt(T0, calumet({ lastFileDate: "2026-10-09" }));
  expectAllBlocked({ snapshot: moved }, "canonical_changed");
  const { currentContentHash } = run({ snapshot: moved });
  expect(currentContentHash).not.toBe(candidateOf("Calumet").contentHash);
});

it("keeps a closed window as evidence while its old approval authorizes nothing", () => {
  const t = timeline("Lemont", "09-29T16:00 09-30T14:00 09-30T16:00");
  expect(why(t)).toEqual(dateOnly("window_closed"));
  expect(t.candidate.status).toBe("open"); // the record is untouched evidence

  const later = calumet({ openDate: "2026-10-05", lastFileDate: "2026-11-05" });
  expect(why(timeline("Calumet", DAY, later)).join(" ")).toBe(
    "plain_date:ok countdown:ok deadline_near:window_not_open reminder:ok urgency:window_not_open cta:window_not_open",
  );
});

const at = (draftedAt: string) => ({ draftedAt, snapshot: SNAP });
const src = (o: object | null) => {
  const { sources, ...s } = fetchedAt(T0);
  const assessor = o && { ...sources.assessor!, ...o };
  return { snapshot: { ...s, sources: { ...sources, assessor } } };
};
const lakeview = () => ({
  candidate: { ...candidateOf("Calumet"), snapshotKey: "lakeview" },
});
it.each<[string, () => Partial<Input>]>([
  ["source_stale", () => at("2026-08-29T16:00Z")],
  ["source_stale", () => at("2026-08-28T12:00Z")], // prior-day fetch, open window
  ["date_invalid", () => at("not a time")],
  ["synthetic_source", () => ({ snapshot: { ...SNAP, synthetic: true } })],
  ["source_unavailable", () => src(null)],
  ["source_unofficial", () => src({ finalUrl: "https://api.realie.ai/x" })],
  ["source_hash_changed", () => src({ contentSha256: "a".repeat(64) })],
  ["parse_failed", () => src({ parseStatus: "parse_error" })],
  ["township_alias_ambiguous", lakeview],
  ["identity_mismatch", () => ({ identity: record("lemont") })],
  ["intent_unknown", () => ({ requestedIntents: ["cta", "hype"] as never })],
])("fails closed with %s", (reason, over) => {
  expectAllBlocked(over(), reason);
});

it("is deterministic, order-insensitive and does not mutate its inputs", () => {
  const base = timeline("Calumet", DAY);
  const frozen = JSON.stringify(base);
  const requestedIntents = [...ALL].reverse().concat(ALL);
  expect(gate({ ...base, requestedIntents })).toEqual(gate(base));
  expect(JSON.stringify(gate(base))).toBe(JSON.stringify(run()));
  expect(JSON.stringify(base)).toBe(frozen);
});
