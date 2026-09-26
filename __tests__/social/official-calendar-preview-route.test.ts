/** @jest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
import { buildOfficialCalendarCandidates } from "@/lib/social/official-calendar-candidates";
import { CONTROLLED_COPY_TEMPLATES } from "@/lib/social/official-calendar-controlled-copy";
import { buildSnapshot, SOURCES } from "@/scripts/refresh-township-deadlines";
import { informationalSnapshotStore } from "@/lib/deadlines/informational-snapshot-store";
import { POST } from "@/app/api/internal/official-calendar-preview/route";
jest.mock("server-only", () => ({}));
jest.mock("@/lib/deadlines/informational-snapshot-store", () => ({
  informationalSnapshotStore: jest.fn(),
}));

const SHA = "bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca";
const AT = "2026-08-27T16:00:00Z";
const CAPABILITY = "opaque-preview-capability-over-32-characters";
let snapshot: OfficialDeadlineSnapshot;
const store = { read: jest.fn() };
const storeFactory = jest.mocked(informationalSnapshotStore);

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
  snapshot = built.snapshot;
});

const body = () => {
  const [candidate] = buildOfficialCalendarCandidates({
    snapshot,
    evaluatedAt: AT,
    townshipLabels: ["Calumet"],
    stages: ["assessor"],
    expectedSha256: { assessor: SHA },
  }).candidates;
  if (!candidate) throw new Error("pinned candidate unavailable");
  const template = CONTROLLED_COPY_TEMPLATES.official_dates_v1;
  return {
    townshipLabel: "Calumet",
    expectedSha256: SHA,
    templateId: "official_dates_v1",
    approval: {
      candidateId: candidate.candidateId,
      contentHash: candidate.contentHash,
      approvedStatus: candidate.status,
      approvedAt: AT,
      approvedIntents: ["plain_date"],
      templateId: "official_dates_v1",
      templateVersion: template.version,
      templateDefinitionHash: template.definitionHash,
    },
  };
};
const request = (value = body(), capability = CAPABILITY) =>
  new Request("https://preview.example/api/internal/official-calendar-preview", {
    method: "POST",
    headers: {
      authorization: `Bearer ${capability}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
const env = process.env;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(AT));
  jest.resetAllMocks();
  store.read.mockResolvedValue(snapshot);
  storeFactory.mockResolvedValue(store as never);
  process.env = {
    ...env,
    VERCEL_ENV: "preview",
    OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED: "true",
    OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY: CAPABILITY,
    OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED: "true",
  };
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  process.env = env;
});

it("proves pinned official bytes through candidate, approval, and safe draft", async () => {
  const response = await POST(request());
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(result).toMatchObject({
    verdict: "rendered",
    reason: null,
    reviewOnly: true,
    postAllowed: false,
  });
  expect(result.renderedText).toContain("Official Cook County dates");
  expect(result.binding.sourceContentSha256).toBe(SHA);
});

it("is unreachable in Production even when enabled and correctly authorized", async () => {
  process.env.VERCEL_ENV = "production";
  const response = await POST(request());
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    reviewOnly: true,
    postAllowed: false,
  });
});

it("is default-off and rejects a wrong or weak capability without rendering", async () => {
  delete process.env.OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED;
  expect((await POST(request())).status).toBe(404);
  process.env.OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED = "true";
  expect((await POST(request(body(), "wrong"))).status).toBe(401);
  process.env.OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY = "short";
  expect((await POST(request(body(), "short"))).status).toBe(401);
});

it("fails closed for changed evidence, unknown template, and malformed input", async () => {
  const changed = body();
  changed.approval.contentHash = "0".repeat(64);
  expect(await (await POST(request(changed))).json()).toMatchObject({
    verdict: "blocked",
    reason: "approval_changed",
  });
  expect(
    (await POST(request({ ...body(), templateId: "open_window_deadline_v1" }))).status,
  ).toBe(422);
  expect((await POST(request({ bad: true } as never))).status).toBe(422);
});

it("rejects a self-consistent forged caller snapshot and uses server evidence", async () => {
  const forged = structuredClone(snapshot);
  forged.townships.calumet.stages.assessor!.lastFileDate = "2026-09-30";
  forged.sources.assessor!.contentSha256 = "f".repeat(64);
  const [candidate] = buildOfficialCalendarCandidates({
    snapshot: forged,
    evaluatedAt: AT,
    townshipLabels: ["Calumet"],
    stages: ["assessor"],
    expectedSha256: { assessor: "f".repeat(64) },
  }).candidates;
  const forgedInput = {
    ...body(),
    snapshot: forged,
    expectedSha256: "f".repeat(64),
    approval: {
      ...body().approval,
      candidateId: candidate.candidateId,
      contentHash: candidate.contentHash,
      approvedStatus: candidate.status,
    },
  };
  const response = await POST(request(forgedInput));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    verdict: "blocked",
    postAllowed: false,
  });
  expect(store.read).toHaveBeenCalledTimes(1);
});

it("fails closed when canonical storage is unavailable and caps request size", async () => {
  store.read.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(503);
  expect((await POST(request("x".repeat(50_001) as never))).status).toBe(413);
});

it("re-evaluates after store I/O and refuses a crossed county day", async () => {
  store.read.mockImplementationOnce(async () => {
    jest.setSystemTime(new Date("2026-08-28T06:00:00Z"));
    return snapshot;
  });
  const result = await (await POST(request())).json();
  expect(result).toMatchObject({
    verdict: "blocked",
    reason: "source_stale",
    reviewOnly: true,
    postAllowed: false,
  });
});
