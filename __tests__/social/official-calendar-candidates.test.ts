/** @jest-environment node */

/**
 * Slice A2. The snapshot is built in memory from the pinned official captures
 * (`__tests__/fixtures/deadlines/SOURCES.md`) by the committed builder, through
 * an injected local fetcher. Nothing here fetches.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildOfficialCalendarCandidates as build,
  type BuildCandidatesInput as Input,
  type OfficialCalendarCandidate as Candidate,
} from "@/lib/social/official-calendar-candidates";
import type { OfficialDeadlineSnapshot as Snapshot } from "@/lib/deadlines/official-source-state";
import { buildSnapshot, SOURCES } from "@/scripts/refresh-township-deadlines";

const A_SHA =
  "bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca";
const B_SHA =
  "04eaa4db1b0be4bc00dd3ec5834cd67bc16ab0cba4bb0380e676461a16b7925b";
const RETRIEVED = "2026-08-27T15:00:00.000Z";
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
    now: RETRIEVED,
    synthetic: false,
    expectedSha256: { assessor: A_SHA, bor: B_SHA },
  });
  if (!built.ok) throw new Error("pinned fixtures no longer build");
  SNAP = built.snapshot;
});

const run = (over: Partial<Input> = {}) =>
  build({
    snapshot: SNAP,
    evaluatedAt: "2026-08-27T16:00:00.000Z",
    townshipLabels: ["Calumet", "Lemont"],
    stages: ["assessor"],
    expectedSha256: { assessor: A_SHA, bor: B_SHA },
    ...over,
  });
const line = (c: Candidate) =>
  [c.governedSlug, c.stage, c.status]
    .concat(c.claims.map((x) => `${x.kind}=${x.date}`))
    .join(" ");
const why = (over: Partial<Input>) => {
  const r = run(over);
  return r.candidates.map(line).concat(r.rejections.map((x) => x.reason));
};
const ids = (over: Partial<Input> = {}) =>
  run(over).candidates.map((c) => c.candidateId);
const src = (over: object | null): Snapshot => {
  const assessor = over && { ...SNAP.sources.assessor!, ...over };
  return { ...SNAP, sources: { ...SNAP.sources, assessor } };
};
const row = (key: string, townshipName: string, stages: object): Snapshot => ({
  ...SNAP,
  townships: { ...SNAP.townships, [key]: { townshipName, stages } },
});
const calumet = (noticeDate: string | null) =>
  row("calumet", "Calumet", {
    assessor: {
      noticeDate,
      openDate: "2026-08-20",
      lastFileDate: "2026-10-02",
    },
  });

it("emits the Calumet and Lemont Assessor windows exactly as published", () => {
  const { candidates, rejections } = run();
  expect(rejections).toEqual([]);
  expect(candidates.map(line)).toEqual([
    "calumet assessor open notice_date=2026-08-20 window_opens=2026-08-20 last_file_date=2026-10-02",
    "lemont assessor open notice_date=2026-08-17 window_opens=2026-08-17 last_file_date=2026-09-29",
  ]);
  expect(candidates[0].receipt).toEqual({
    stage: "assessor",
    authority: "cook_county_assessor",
    sourceUrl: SOURCES.assessor.url,
    finalUrl: SOURCES.assessor.url,
    retrievedAt: RETRIEVED,
    sourceUpdatedAt: null,
    contentSha256: A_SHA,
    parserVersion: "2.0.0",
    locator: `cook_county_assessor/townships/calumet/stages/assessor@${A_SHA}`,
  });
  // Golden: any change to what is hashed, or how it is serialised, moves this.
  const golden =
    "1f1e11140c8281fc0b8d5e203d2c6bb07a4c8f0499c2ee5d7cb3283501e17320";
  expect(candidates[0].contentHash).toBe(golden);
  expect(candidates[0].candidateId).toBe(`occ_${golden.slice(0, 24)}`);
});

it("keeps Assessor and Board of Review as separate candidates", () => {
  const stages: Input["stages"] = ["assessor", "bor"];
  expect(why({ townshipLabels: ["Rogers Park"], stages })).toEqual([
    "rogers-park assessor closed notice_date=2026-04-17 window_opens=2026-04-17 last_file_date=2026-06-01",
    "rogers-park bor open window_opens=2026-08-03 last_file_date=2026-09-01",
  ]);
  expect(why({ stages: ["bor"] })).toEqual(["stage_missing", "stage_missing"]);
});

const at = (evaluatedAt: string) => () => ({ evaluatedAt });
const bad = (over: object | null) => () => ({ snapshot: src(over) });
const hash = (assessor?: string) => () => ({ expectedSha256: { assessor } });
const named =
  (...townshipLabels: string[]) =>
  () => ({ townshipLabels });

it.each<[string, () => Partial<Input>]>([
  ["source_stale", at("2026-08-29T16:00:00.000Z")],
  ["source_stale", at("2026-08-28T12:00:00.000Z")], // prior-day, open window
  ["date_invalid", at("not a time")],
  ["synthetic_source", () => ({ snapshot: { ...SNAP, synthetic: true } })],
  ["source_unavailable", bad(null)],
  ["source_unofficial", bad({ finalUrl: "https://api.realie.ai/x" })],
  ["source_unofficial", bad({ authority: "cook_county_board_of_review" })],
  ["source_unofficial", bad({ sourceUrl: SOURCES.bor.url })],
  ["source_hash_changed", bad({ contentSha256: "a".repeat(64) })],
  ["source_hash_changed", hash(B_SHA)],
  ["expected_hash_missing", hash(undefined)],
  ["expected_hash_missing", () => ({ expectedSha256: { bor: B_SHA } })],
  ["expected_hash_missing", hash("")],
  ["expected_hash_missing", hash(A_SHA.toUpperCase())],
  ["township_alias_ambiguous", named("Lake", "Lake View", "Lakeview Township")],
  ["township_missing_from_snapshot", named("__proto__", "Springfield", "Oz")],
  ["township_missing_from_roster", named("constructor")],
  ["stage_unknown", () => ({ stages: ["constructor", "__proto__"] as never })],
])("fails closed with %s", (reason, over) => {
  expect(new Set(why(over()))).toEqual(new Set([reason]));
});

it("never narrates an absent or uncontracted notice date", () => {
  expect(why({ snapshot: calumet(null), townshipLabels: ["Calumet"] })).toEqual(
    ["calumet assessor open window_opens=2026-08-20 last_file_date=2026-10-02"],
  );
  const bor = row("rogers-park", "Rogers Park", {
    bor: {
      noticeDate: "2026-08-01",
      openDate: "2026-08-03",
      lastFileDate: "2026-09-01",
    },
  });
  const townshipLabels = ["Rogers Park"];
  expect(why({ snapshot: bor, townshipLabels, stages: ["bor"] })).toEqual([
    "rogers-park bor open window_opens=2026-08-03 last_file_date=2026-09-01",
  ]);
});

it("collapses duplicate labels and stages to one candidate", () => {
  const townshipLabels = [
    "Calumet",
    "calumet",
    "Calumet Township",
    " CALUMET ",
  ];
  const stages: Input["stages"] = ["assessor", "assessor"];
  expect(ids({ townshipLabels, stages })).toHaveLength(1);
});

it("derives ids from content, not insertion order or the clock", () => {
  const flip = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).reverse()) as T;
  const snapshot: Snapshot = {
    townships: flip(SNAP.townships),
    sources: { bor: SNAP.sources.bor, assessor: flip(SNAP.sources.assessor!) },
    synthetic: false,
    schemaVersion: SNAP.schemaVersion,
  };
  const later = "2026-08-27T20:00:00.000Z";
  const townshipLabels = ["Lemont", "Calumet"];
  expect(ids({ snapshot, evaluatedAt: later, townshipLabels })).toEqual(ids());
  expect(new Set(ids()).size).toBe(2);
  expect(ids({ snapshot: calumet("2026-08-19") })[0]).not.toBe(ids()[0]);
});

it("preserves sourceUpdatedAt exactly, null included", () => {
  const stamp = (snapshot: Snapshot) =>
    run({ snapshot }).candidates.map((c) => c.receipt.sourceUpdatedAt);
  expect(stamp(SNAP)).toEqual([null, null]);
  const printed = "2026-08-03T11:37:44.000Z";
  expect(stamp(src({ sourceUpdatedAt: printed }))).toEqual([printed, printed]);
});
