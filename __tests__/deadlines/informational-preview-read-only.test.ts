/** @jest-environment node */
/**
 * Preview-only read-only informational mode.
 *
 * OT_INFORMATIONAL_DEADLINE_PREVIEW_READ_ENABLED=true together with
 * VERCEL_ENV=preview may READ the published informational snapshot through
 * the same decoder and digest-ready barrier as production. It never permits
 * refresh, collection, publication, barrier writes or commerce — even if the
 * refresh flag is accidentally also true (read-only wins). Outside Preview the
 * new flag is ignored. All database access is a fake, SELECT-only client.
 */
import { createHash } from "node:crypto";
import { TOWNSHIPS } from "@/lib/townships";
import { decodeInformationalSnapshot, INFORMATIONAL_SOURCE_URL as SOURCE } from "@/lib/deadlines/informational-snapshot";
import {
  informationalPreviewReadOnly, informationalReadEnabled, informationalRefreshEnabled,
} from "@/lib/deadlines/informational-flags";
import {
  createInformationalSnapshotStore, informationalSnapshotReader, informationalSnapshotStore,
  INFORMATIONAL_SNAPSHOT_KEY, type InformationalSnapshotClient,
} from "@/lib/deadlines/informational-snapshot-store";
import { createInformationalRefreshBarrier } from "@/lib/deadlines/informational-refresh-barrier";
import { collectInformationalSnapshot } from "@/lib/deadlines/collect-informational-snapshot";
import { readInformationalSnapshot } from "@/lib/deadlines/read-informational-snapshot";
import { GET as readRoute } from "@/app/api/deadlines/informational/route";
import { GET as refreshRoute } from "@/app/api/cron/informational-deadlines/route";
import { commerceSnapshotStore } from "@/lib/deadlines/commerce-snapshot-store";

jest.mock("server-only", () => ({}));
jest.mock("@/lib/deadlines/commerce-snapshot-store", () => ({ commerceSnapshotStore: jest.fn() }));
// Fake database: SELECT responses come from `rows`; write capabilities are spies that must stay untouched.
const mockDb = {
  loads: 0,
  rows: new Map<string, string>(),
  onQuery: null as null | (() => void),
  query: jest.fn(),
  transaction: jest.fn(),
  execute: jest.fn(),
};
jest.mock("@/lib/db", () => {
  mockDb.loads++;
  return { prisma: {
    $queryRaw: (sql: { text: string; values: unknown[] }) => mockDb.query(sql),
    $transaction: (...args: unknown[]) => mockDb.transaction(...args),
    $executeRaw: (...args: unknown[]) => mockDb.execute(...args),
  } };
});

const REFRESH = "OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED";
const PREVIEW_READ = "OT_INFORMATIONAL_DEADLINE_PREVIEW_READ_ENABLED";
const KEYS = [REFRESH, PREVIEW_READ, "VERCEL_ENV", "CRON_SECRET", "OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED"] as const;
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
const AT = new Date("2026-10-06T03:00:00Z");
const RETRIEVED = "2026-10-06T01:00:00.000Z";
const SECRET = "synthetic-preview-cron-" + "x".repeat(32);

/** Test-local env fixture; restored after every test. */
function env(values: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const k of KEYS) if (k !== "CRON_SECRET") delete process.env[k];
  for (const [k, v] of Object.entries(values)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
}
const previewReadOnly = () => env({ [PREVIEW_READ]: "true", VERCEL_ENV: "preview" });

type Row = { noticeDate: string; openDate: string; lastFileDate: string } | null;
function snapshot(retrievedAt = RETRIEVED, row: Row = { noticeDate: "2026-09-21", openDate: "2026-09-21", lastFileDate: "2026-11-12" }) {
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: "cook_county_assessor", sourceUrl: SOURCE, finalUrl: SOURCE, httpStatus: 200, retrievedAt, sourceUpdatedAt: null,
    contentSha256: "a".repeat(64), parseStatus: "ok", parserVersion: "ccao-dom/1.0.0",
  } }, townships: Object.fromEntries(TOWNSHIPS.map(t => [t.slug, { townshipName: t.name, stages: { assessor: row } }])) };
}
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
const MARKER_ID = "11111111-2222-4333-8444-555555555555";
/** Publishes `raw` and a marker into the fake DB; `ready` binds the digest of the canonical decode. */
function seed(raw: string, marker: "ready" | "pending" | "mismatch" | "none" = "ready") {
  mockDb.rows.set(INFORMATIONAL_SNAPSHOT_KEY, raw);
  const decoded = decodeInformationalSnapshot(raw, AT);
  const canonical = decoded ? JSON.stringify(decoded) : raw;
  const value = marker === "ready" ? { id: MARKER_ID, state: "ready", digest: sha(canonical) }
    : marker === "pending" ? { id: MARKER_ID, state: "pending", digest: null }
      : marker === "mismatch" ? { id: MARKER_ID, state: "ready", digest: "b".repeat(64) } : null;
  if (value) mockDb.rows.set(`${INFORMATIONAL_SNAPSHOT_KEY}:attempt`, JSON.stringify(value));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] }).setSystemTime(AT);
  mockDb.rows.clear(); mockDb.onQuery = null;
  mockDb.query.mockReset().mockImplementation(async (sql: { text: string; values: unknown[] }) => {
    mockDb.onQuery?.();
    if (/pg_advisory|clock_timestamp/.test(sql.text)) throw new Error("read-only path must not lock or clock");
    const key = sql.values.find(v => typeof v === "string") as string;
    return mockDb.rows.has(key) ? [{ value: mockDb.rows.get(key) }] : [];
  });
  mockDb.transaction.mockReset(); mockDb.execute.mockReset();
  jest.mocked(commerceSnapshotStore).mockReset();
  process.env.CRON_SECRET = SECRET;
});
afterEach(() => {
  jest.useRealTimers();
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});
const noWrites = () => {
  expect(mockDb.transaction).not.toHaveBeenCalled();
  expect(mockDb.execute).not.toHaveBeenCalled();
  for (const [sql] of mockDb.query.mock.calls) expect(sql.text.trimStart()).toMatch(/^SELECT left\("value"/);
};

describe("flag predicates (pure, explicit env fixtures)", () => {
  const table: Array<[string, Record<string, string>, { read: boolean; refresh: boolean; previewReadOnly: boolean }]> = [
    ["nothing set", {}, { read: false, refresh: false, previewReadOnly: false }],
    ["preview + preview-read", { [PREVIEW_READ]: "true", VERCEL_ENV: "preview" }, { read: true, refresh: false, previewReadOnly: true }],
    ["preview + preview-read + refresh (read-only wins)", { [PREVIEW_READ]: "true", VERCEL_ENV: "preview", [REFRESH]: "true" }, { read: true, refresh: false, previewReadOnly: true }],
    ["preview + refresh only (unchanged)", { VERCEL_ENV: "preview", [REFRESH]: "true" }, { read: true, refresh: true, previewReadOnly: false }],
    ["production + preview-read ignored", { [PREVIEW_READ]: "true", VERCEL_ENV: "production" }, { read: false, refresh: false, previewReadOnly: false }],
    ["production + refresh (unchanged)", { [PREVIEW_READ]: "true", VERCEL_ENV: "production", [REFRESH]: "true" }, { read: true, refresh: true, previewReadOnly: false }],
    ["development + preview-read ignored", { [PREVIEW_READ]: "true", VERCEL_ENV: "development" }, { read: false, refresh: false, previewReadOnly: false }],
    ["missing VERCEL_ENV + preview-read ignored", { [PREVIEW_READ]: "true" }, { read: false, refresh: false, previewReadOnly: false }],
    ["preview + non-exact preview-read", { [PREVIEW_READ]: "TRUE", VERCEL_ENV: "preview" }, { read: false, refresh: false, previewReadOnly: false }],
    ["non-exact VERCEL_ENV", { [PREVIEW_READ]: "true", VERCEL_ENV: "Preview" }, { read: false, refresh: false, previewReadOnly: false }],
    ["preview-read '1'", { [PREVIEW_READ]: "1", VERCEL_ENV: "preview" }, { read: false, refresh: false, previewReadOnly: false }],
  ];
  it.each(table)("%s", (_label, values, expected) => {
    const e = values as NodeJS.ProcessEnv;
    expect({ read: informationalReadEnabled(e), refresh: informationalRefreshEnabled(e), previewReadOnly: informationalPreviewReadOnly(e) })
      .toEqual(expected);
  });
});

describe("Preview read-only: GET API and detail reader serve barrier-validated data", () => {
  it("serves a fresh, ready snapshot through SELECT only, identically from API and reader", async () => {
    previewReadOnly(); seed(JSON.stringify(snapshot()));
    const api = await (await readRoute()).json();
    const reader = await readInformationalSnapshot(new Date());
    expect(api).toEqual(decodeInformationalSnapshot(JSON.stringify(snapshot()), AT));
    expect(reader).toEqual(api);
    noWrites();
  });
  const minus = (ms: number) => new Date(AT.getTime() - ms).toISOString();
  const refused: Array<[string, () => void]> = [
    ["missing row", () => undefined],
    ["expired source", () => seed(JSON.stringify(snapshot(minus(24 * 60 * 60 * 1000 + 1000))))],
    ["future source", () => seed(JSON.stringify(snapshot(minus(-60_000))))],
    ["wrong-year rows", () => seed(JSON.stringify(snapshot(RETRIEVED, { noticeDate: "2025-09-21", openDate: "2025-09-21", lastFileDate: "2025-11-12" })))],
    ["malformed JSON", () => seed("{not json")],
    ["pending barrier", () => seed(JSON.stringify(snapshot()), "pending")],
    ["digest mismatch barrier", () => seed(JSON.stringify(snapshot()), "mismatch")],
    ["absent barrier marker", () => seed(JSON.stringify(snapshot()), "none")],
  ];
  it.each(refused)("%s → null from both API and reader, no writes", async (_label, arrange) => {
    previewReadOnly(); arrange();
    expect(await (await readRoute()).json()).toBeNull();
    expect(await readInformationalSnapshot(new Date())).toBeNull();
    noWrites();
  });
  it.each([
    ["VERCEL_ENV flips to production", () => { process.env.VERCEL_ENV = "production"; }],
    ["preview-read flag removed", () => { delete process.env[PREVIEW_READ]; }],
    ["VERCEL_ENV removed", () => { delete process.env.VERCEL_ENV; }],
  ])("late flip during storage read (%s) fails closed", async (_label, flip) => {
    previewReadOnly(); seed(JSON.stringify(snapshot()));
    mockDb.onQuery = flip;
    expect(await readInformationalSnapshot(new Date())).toBeNull();
    previewReadOnly(); mockDb.onQuery = flip;
    expect(await (await readRoute()).json()).toBeNull();
    noWrites();
  });
  it.each([
    ["production", { [PREVIEW_READ]: "true", VERCEL_ENV: "production" }],
    ["development", { [PREVIEW_READ]: "true", VERCEL_ENV: "development" }],
    ["missing VERCEL_ENV", { [PREVIEW_READ]: "true" }],
  ])("preview-read flag is ignored in %s: no database load or query", async (_label, values) => {
    env(values); seed(JSON.stringify(snapshot()));
    const loads = mockDb.loads;
    expect(await readInformationalSnapshot(new Date())).toBeNull();
    expect(await (await readRoute()).json()).toBeNull();
    expect(mockDb.query).not.toHaveBeenCalled(); expect(mockDb.loads).toBe(loads);
  });
});

describe("Preview read-only: every write path refuses, even with the refresh flag true", () => {
  const both = () => env({ [PREVIEW_READ]: "true", VERCEL_ENV: "preview", [REFRESH]: "true" });
  const fullClient = () => ({ $queryRaw: mockDb.query, $transaction: mockDb.transaction }) as unknown as InformationalSnapshotClient;

  it("write factory is unavailable", async () => {
    both(); expect(await informationalSnapshotStore()).toBeNull(); noWrites();
  });
  it("store.publish refuses with no transaction", async () => {
    both(); expect(await createInformationalSnapshotStore(fullClient()).publish(JSON.stringify(snapshot()))).toBe("REFUSED"); noWrites();
  });
  it("barrier begin/complete refuse with no transaction or lock", async () => {
    both(); const barrier = createInformationalRefreshBarrier(fullClient(), INFORMATIONAL_SNAPSHOT_KEY);
    expect(await barrier.begin()).toBeNull();
    expect(await barrier.complete(MARKER_ID, JSON.stringify(snapshot()))).toBe(false);
    noWrites();
  });
  it("collection refuses before any network fetch", async () => {
    both(); const fetchSource = jest.fn();
    expect(await collectInformationalSnapshot({ fetchSource, parseHtml: jest.fn(), now: () => new Date() })).toBeNull();
    expect(fetchSource).not.toHaveBeenCalled();
  });
  it("authorized cron refresh is disabled before storage, collection, network or commerce", async () => {
    both(); const fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
    const loads = mockDb.loads;
    const response = await refreshRoute(new Request("https://example.test/api/cron/informational-deadlines", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(await response.json()).toEqual({ status: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
    expect(commerceSnapshotStore).not.toHaveBeenCalled();
    expect(mockDb.query).not.toHaveBeenCalled(); expect(mockDb.loads).toBe(loads);
    noWrites();
  });
  it("preview-read alone (with commerce flag) cannot reach commerce through refresh", async () => {
    env({ [PREVIEW_READ]: "true", VERCEL_ENV: "preview", OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED: "true" });
    const response = await refreshRoute(new Request("https://example.test/x", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(await response.json()).toEqual({ status: "disabled" });
    expect(commerceSnapshotStore).not.toHaveBeenCalled();
  });
  it("late flip into read-only during a write transaction refuses before INSERT", async () => {
    env({ VERCEL_ENV: "preview", [REFRESH]: "true" });
    const execute = jest.fn();
    const query = jest.fn(async (sql: { text: string }) => {
      if (sql.text.includes("pg_advisory")) { process.env[PREVIEW_READ] = "true"; return []; }
      return sql.text.includes("clock_timestamp") ? [{ now: String(AT.getTime()) }] : [];
    });
    const client = { $queryRaw: query, $transaction: async (work: Function) => work({ $queryRaw: query, $executeRaw: execute }) } as unknown as InformationalSnapshotClient;
    expect(await createInformationalSnapshotStore(client).publish(JSON.stringify(snapshot()))).toBe("REFUSED");
    delete process.env[PREVIEW_READ];
    const barrier = createInformationalRefreshBarrier(client, INFORMATIONAL_SNAPSHOT_KEY);
    expect(await barrier.begin()).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
  it("read-only factory exposes only read, over a SELECT-only client", async () => {
    both(); seed(JSON.stringify(snapshot()));
    const reader = await informationalSnapshotReader();
    expect(reader && Object.keys(reader).sort()).toEqual(["read"]);
    expect(await reader!.read(AT)).toEqual(decodeInformationalSnapshot(JSON.stringify(snapshot()), AT));
    noWrites();
  });
});

describe("existing production behavior is unchanged", () => {
  it("production refresh flag still reads through the barrier", async () => {
    env({ VERCEL_ENV: "production", [REFRESH]: "true" }); seed(JSON.stringify(snapshot()));
    expect(await readInformationalSnapshot(new Date())).toEqual(decodeInformationalSnapshot(JSON.stringify(snapshot()), AT));
    seed(JSON.stringify(snapshot()), "pending");
    expect(await readInformationalSnapshot(new Date())).toBeNull();
  });
  it("production write factory still exposes write capabilities", async () => {
    env({ VERCEL_ENV: "production", [REFRESH]: "true", [PREVIEW_READ]: "true" });
    const store = await informationalSnapshotStore();
    expect(store && Object.keys(store).sort()).toEqual(["begin", "complete", "publish", "read"]);
  });
});
