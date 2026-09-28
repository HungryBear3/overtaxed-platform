/** @jest-environment node */
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { parseInformationalAssessorHtml } from "@/lib/deadlines/assessor-calendar-parser";
import { collectOfficialDeadlineCapture } from "@/lib/deadlines/collect-informational-snapshot";
import { INFORMATIONAL_SOURCE_URL } from "@/lib/deadlines/informational-snapshot";
import {
  INFORMATIONAL_SNAPSHOT_KEY,
  informationalSnapshotStore,
} from "@/lib/deadlines/informational-snapshot-store";
import { OT_PRODUCTION_PROJECT_REF } from "@/lib/fulfillment/neutral-production-database-marker";
import { POST } from "@/app/api/internal/official-calendar-preview/route";
import {
  assertIsolatedPreviewMarker,
  assertNoSecrets,
  ATTEMPT_KEY,
  createQualificationHarness,
  createRunId,
  FEATURE_ENV,
  fixtureFetch,
  PINNED,
  QualificationRefusal,
  resolveQualificationTarget,
  sha256,
  SNAPSHOT_KEY,
  snapshotContentDigest,
  type HarnessPorts,
  type Journal,
  type JournalStore,
  type PublicTarget,
  type QualificationDb,
  type SchemaFacts,
  type TargetMode,
} from "@/lib/social/official-calendar-qualification";
import {
  fileJournal,
  parseQualificationArgs,
  runQualificationCli,
  verifyReceipt,
} from "@/lib/social/official-calendar-qualification-cli";

jest.mock("server-only", () => ({}));
jest.mock("@/lib/db", () => ({
  get prisma() {
    return mockDb.client;
  },
}));

// ---------------------------------------------------------------------------
// An in-memory SystemConfig serving the exact SQL the real store and barrier
// issue, plus the harness's own read/delete port over the same rows.
// ---------------------------------------------------------------------------

type Row = { id: string; key: string; value: string; createdAtMs: number };
const GOOD_SCHEMA: SchemaFacts = {
  columns: [
    { name: "id", dataType: "text", nullable: false },
    { name: "key", dataType: "text", nullable: false },
    { name: "value", dataType: "text", nullable: false },
    {
      name: "createdAt",
      dataType: "timestamp without time zone",
      nullable: false,
    },
    {
      name: "updatedAt",
      dataType: "timestamp without time zone",
      nullable: false,
    },
  ],
  uniqueKeyIndex: true,
  privileges: { select: true, insert: true, update: true, delete: true },
};

class FakeDatabase {
  rows = new Map<string, Row>();
  databaseName = "postgres";
  marker: string | null = null;
  schema: SchemaFacts = GOOD_SCHEMA;
  opens = 0;
  mutations = 0;
  killed = false;
  /** A non-UTC server zone: nominal row/clock times differ from true epoch. */
  zoneOffsetMs = -5 * 60 * 60 * 1000;
  onPublish: (() => void) | null = null;
  deleteHook: ((deleted: number) => void) | null = null;

  reset(markerInstanceId: string) {
    this.rows.clear();
    this.databaseName = "postgres";
    this.marker = JSON.stringify({
      schema: "ot.database-environment.v1",
      purpose: "ot-neutral-report",
      environment: "preview",
      isolated: true,
      production: false,
      instanceId: markerInstanceId,
    });
    this.schema = GOOD_SCHEMA;
    this.opens = 0;
    this.mutations = 0;
    this.killed = false;
    this.onPublish = null;
    this.deleteHook = null;
  }
  private alive() {
    if (this.killed) throw new Error("process killed");
  }
  private upsert(id: string, key: string, value: string) {
    this.mutations++;
    const existing = this.rows.get(key);
    if (existing) existing.value = value;
    else
      this.rows.set(key, {
        id,
        key,
        value,
        createdAtMs: Date.now() + this.zoneOffsetMs,
      });
  }
  private query(sql: Prisma.Sql): unknown[] {
    this.alive();
    const text = sql.sql.replace(/\s+/g, " ");
    const v = sql.values as unknown[];
    if (text.includes("pg_advisory_xact_lock")) return [{ locked: "" }];
    if (text.includes("clock_timestamp()"))
      return [{ now: String(Date.now()) }];
    const read =
      /^SELECT left\("value", (\?|\d+)\) AS value FROM "SystemConfig" WHERE "key" = \? LIMIT 1$/.exec(
        text,
      );
    if (read) {
      const [limit, key] =
        read[1] === "?"
          ? [v[0] as number, v[1] as string]
          : [Number(read[1]), v[0] as string];
      const row = this.rows.get(key);
      return row ? [{ value: row.value.slice(0, limit) }] : [];
    }
    throw new Error(`unexpected query: ${text}`);
  }
  private execute(sql: Prisma.Sql): number {
    this.alive();
    const text = sql.sql.replace(/\s+/g, " ");
    const v = sql.values as string[];
    if (text.startsWith('INSERT INTO "SystemConfig"')) {
      if (v[1] === SNAPSHOT_KEY) this.onPublish?.();
      this.alive();
      this.upsert(v[0], v[1], v[2]);
      return 1;
    }
    if (text.startsWith('UPDATE "SystemConfig" SET "value" = ?')) {
      const row = this.rows.get(v[1]);
      if (!row) return 0;
      this.mutations++;
      row.value = v[0];
      return 1;
    }
    throw new Error(`unexpected statement: ${text}`);
  }
  client = {
    $queryRaw: async (sql: Prisma.Sql) => this.query(sql),
    $executeRaw: async (sql: Prisma.Sql) => this.execute(sql),
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => {
      const saved = new Map([...this.rows].map(([k, r]) => [k, { ...r }]));
      try {
        return await work(this.client);
      } catch (error) {
        this.rows = saved;
        throw error;
      }
    },
  };
  port = async (): Promise<QualificationDb> => {
    this.alive();
    this.opens++;
    return {
      identity: async () => (
        this.alive(),
        { databaseName: this.databaseName, marker: this.marker }
      ),
      schema: async () => (this.alive(), structuredClone(this.schema)),
      clockMs: async () => (this.alive(), Date.now() + this.zoneOffsetMs),
      epochMs: async () => (this.alive(), Date.now()),
      rows: async (keys) => (
        this.alive(),
        [...this.rows.values()]
          .filter((r) => keys.includes(r.key))
          .map((r) => ({ ...r }))
      ),
      deleteOwned: async (owned, sinceMs) => {
        this.alive();
        let deleted = 0;
        for (const { id, key } of owned) {
          const row = this.rows.get(key);
          if (
            row &&
            row.id === id &&
            (key === SNAPSHOT_KEY || key === ATTEMPT_KEY) &&
            row.createdAtMs >= sinceMs
          ) {
            this.rows.delete(key);
            this.mutations++;
            deleted++;
            this.deleteHook?.(deleted);
          }
        }
        return deleted;
      },
      close: async () => undefined,
    };
  };
}
const mockDb = new FakeDatabase();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AT = "2026-09-27T17:00:00.000Z";
const PASSWORD = "isolated-preview-db-password-9f3c";
const REF = "abcdefghijklmnopqrst";
const MARKER_ID = "0b6f7c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f";
const CA =
  "-----BEGIN CERTIFICATE-----\nMIIBsyntheticCA\n-----END CERTIFICATE-----";
const FIXTURE = readFileSync(join(process.cwd(), PINNED.fixturePath));
const hostedEnv = (overrides: Record<string, string | undefined> = {}) => ({
  OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres:${PASSWORD}@db.${REF}.supabase.co:5432/postgres`,
  OT_CALENDAR_PREVIEW_PROJECT_REF: REF,
  OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID: MARKER_ID,
  SUPABASE_CA_PEM: CA,
  ...overrides,
});
const poolerEnv = (overrides: Record<string, string | undefined> = {}) => ({
  ...hostedEnv(),
  OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres.${REF}:${PASSWORD}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
  ...overrides,
});
const rehearsalEnv = (overrides: Record<string, string | undefined> = {}) => ({
  OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://ot_rehearsal:${PASSWORD}@127.0.0.1:55432/ot_calendar_rehearsal_a`,
  OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID: MARKER_ID,
  ...overrides,
});
const refusal = (work: () => unknown): QualificationRefusal => {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(QualificationRefusal);
    expect(String((error as Error).message)).not.toContain(PASSWORD);
    return error as QualificationRefusal;
  }
  throw new Error("expected a refusal");
};
const target = (): PublicTarget =>
  resolveQualificationTarget(hostedEnv(), "isolated-preview").target;

function memoryJournal(): JournalStore & {
  journal: Journal | null;
  receipt: string | null;
  writes: string[];
} {
  const store = {
    journal: null as Journal | null,
    receipt: null as string | null,
    writes: [] as string[],
    async read() {
      return store.journal
        ? (JSON.parse(JSON.stringify(store.journal)) as Journal)
        : null;
    },
    async write(journal: Journal) {
      if (mockDb.killed) throw new Error("process killed");
      const text = JSON.stringify(journal);
      store.writes.push(text);
      store.journal = JSON.parse(text);
    },
    async writeReceipt(receipt: string) {
      store.receipt = receipt;
      store.writes.push(receipt);
    },
    async removeTemporary() {
      return 0;
    },
  };
  return store;
}

type Captured = { authorization: string | null; body: string };
function ports(journal: JournalStore, overrides: Partial<HarnessPorts> = {}) {
  const captured: Captured[] = [];
  const secretsSeen = new Set<string>();
  const base: HarnessPorts = {
    env: process.env,
    openDb: mockDb.port,
    store: informationalSnapshotStore,
    capture: (bytes, now) =>
      collectOfficialDeadlineCapture({
        fetchSource: fixtureFetch(bytes, INFORMATIONAL_SOURCE_URL),
        parseHtml: parseInformationalAssessorHtml,
        now: () => now,
      }),
    route: async (request) => {
      if (mockDb.killed) throw new Error("process killed");
      captured.push({
        authorization: request.headers.get("authorization"),
        body: await request.clone().text(),
      });
      for (const name of [
        "OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY",
        "OT_OFFICIAL_CALENDAR_PREVIEW_APPROVAL_SECRET",
      ])
        if (process.env[name]) secretsSeen.add(process.env[name]!);
      return POST(request);
    },
    fixture: async () => new Uint8Array(FIXTURE),
    journal,
    now: () => new Date(),
    log: () => undefined,
  };
  return { ports: { ...base, ...overrides }, captured, secretsSeen };
}
const harness = (
  p: HarnessPorts,
  options: {
    runId?: string;
    target?: PublicTarget;
    clean?: boolean;
    commit?: string;
    secrets?: string[];
  } = {},
) =>
  createQualificationHarness(p, {
    runId: options.runId ?? RUN,
    target: options.target ?? target(),
    secrets: options.secrets ?? [
      hostedEnv().OT_CALENDAR_PREVIEW_DATABASE_URL,
      PASSWORD,
    ],
    source: {
      commit: options.commit ?? "c".repeat(40),
      tree: "t".repeat(40),
      clean: options.clean ?? true,
    },
    requireCleanSource: true,
  });

let RUN: string;
const saved = { ...process.env };
beforeEach(() => {
  jest
    .useFakeTimers({
      doNotFake: ["nextTick", "setImmediate", "queueMicrotask"],
    })
    .setSystemTime(new Date(AT));
  for (const name of [...FEATURE_ENV, "DATABASE_URL"]) delete process.env[name];
  mockDb.reset(MARKER_ID);
  RUN = createRunId();
});
afterEach(() => {
  jest.useRealTimers();
  process.env = { ...saved };
});
const flagsOff = () =>
  FEATURE_ENV.every((name) => process.env[name] === undefined);

// ---------------------------------------------------------------------------
// Target refusal: before any socket exists
// ---------------------------------------------------------------------------

describe("Production and ambiguous targets are refused before connecting", () => {
  const encodedRef = [...OT_PRODUCTION_PROJECT_REF]
    .map((c) => `%${c.charCodeAt(0).toString(16)}`)
    .join("");
  test.each([
    [
      "declared Production project",
      hostedEnv({ OT_CALENDAR_PREVIEW_PROJECT_REF: OT_PRODUCTION_PROJECT_REF }),
    ],
    [
      "Production direct host",
      hostedEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres:${PASSWORD}@db.${OT_PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
      }),
    ],
    [
      "Production pooler identity",
      hostedEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres.${OT_PRODUCTION_PROJECT_REF}:${PASSWORD}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
      }),
    ],
    [
      "Production ref hidden in the password",
      hostedEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres:x${OT_PRODUCTION_PROJECT_REF}@db.${REF}.supabase.co:5432/postgres`,
      }),
    ],
    [
      "Production ref percent-encoded in the database name",
      hostedEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres:${PASSWORD}@db.${REF}.supabase.co:5432/${encodedRef}`,
      }),
    ],
  ])("%s", (_name, env) => {
    expect(
      refusal(() => resolveQualificationTarget(env, "isolated-preview")).code,
    ).toBe("production_target");
    expect(
      refusal(() => resolveQualificationTarget(env, "local-rehearsal")).code,
    ).toMatch(/production_target|rehearsal_target_invalid/);
  });

  test.each([
    ...FEATURE_ENV,
    "DATABASE_URL",
    "DIRECT_URL",
    "POSTGRES_PRISMA_URL",
    "DATABASE_INSECURE_TLS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "DATABASE_SSL",
    "VERCEL",
  ])("ambient %s makes the target ambiguous", (name) => {
    const env = {
      ...hostedEnv(),
      [name]: name === "VERCEL_ENV" ? "production" : "x",
    };
    const error = refusal(() =>
      resolveQualificationTarget(env, "isolated-preview"),
    );
    expect(error.code).toBe("ambient_env");
    expect(error.message).toContain(name);
  });

  test.each<[string, Record<string, string | undefined>, TargetMode, string]>([
    [
      "URL unset",
      hostedEnv({ OT_CALENDAR_PREVIEW_DATABASE_URL: undefined }),
      "isolated-preview",
      "credentials_missing",
    ],
    [
      "URL blank",
      hostedEnv({ OT_CALENDAR_PREVIEW_DATABASE_URL: "  " }),
      "isolated-preview",
      "credentials_missing",
    ],
    [
      "password missing",
      hostedEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres@db.${REF}.supabase.co:5432/postgres`,
      }),
      "isolated-preview",
      "credentials_partial",
    ],
    [
      "user missing",
      hostedEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://:${PASSWORD}@db.${REF}.supabase.co:5432/postgres`,
      }),
      "isolated-preview",
      "credentials_partial",
    ],
    [
      "unparseable",
      hostedEnv({ OT_CALENDAR_PREVIEW_DATABASE_URL: `postgres ${PASSWORD}` }),
      "isolated-preview",
      "target_invalid",
    ],
    [
      "routing/TLS override option",
      hostedEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres:${PASSWORD}@db.${REF}.supabase.co:5432/postgres?sslmode=disable`,
      }),
      "isolated-preview",
      "target_invalid",
    ],
    [
      "marker ID missing",
      hostedEnv({ OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID: undefined }),
      "isolated-preview",
      "marker_expected_missing",
    ],
    [
      "project ref missing",
      hostedEnv({ OT_CALENDAR_PREVIEW_PROJECT_REF: undefined }),
      "isolated-preview",
      "target_not_isolated_preview",
    ],
    [
      "CA missing",
      hostedEnv({ SUPABASE_CA_PEM: undefined }),
      "isolated-preview",
      "tls_ca_missing",
    ],
    [
      "host of another project",
      hostedEnv({ OT_CALENDAR_PREVIEW_PROJECT_REF: "zyxwvutsrqponmlkjihg" }),
      "isolated-preview",
      "target_not_isolated_preview",
    ],
    [
      "transaction pooler port",
      poolerEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres.${REF}:${PASSWORD}@aws-0-us-east-2.pooler.supabase.com:6543/postgres`,
      }),
      "isolated-preview",
      "target_not_isolated_preview",
    ],
    [
      "pooler from another region",
      poolerEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres.${REF}:${PASSWORD}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`,
      }),
      "isolated-preview",
      "target_not_isolated_preview",
    ],
    [
      "pooler identity missing project ref",
      poolerEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres:${PASSWORD}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
      }),
      "isolated-preview",
      "target_not_isolated_preview",
    ],
    [
      "loopback in hosted mode",
      rehearsalEnv({
        OT_CALENDAR_PREVIEW_PROJECT_REF: REF,
        SUPABASE_CA_PEM: CA,
      }),
      "isolated-preview",
      "target_not_isolated_preview",
    ],
    [
      "hosted target in rehearsal mode",
      hostedEnv({ OT_CALENDAR_PREVIEW_PROJECT_REF: undefined }),
      "local-rehearsal",
      "rehearsal_target_invalid",
    ],
    [
      "rehearsal database without prefix",
      rehearsalEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://u:${PASSWORD}@127.0.0.1:55432/postgres`,
      }),
      "local-rehearsal",
      "rehearsal_target_invalid",
    ],
    [
      "rehearsal declaring a project",
      rehearsalEnv({ OT_CALENDAR_PREVIEW_PROJECT_REF: REF }),
      "local-rehearsal",
      "rehearsal_target_invalid",
    ],
  ])("%s", (_name, env, mode, code) => {
    expect(refusal(() => resolveQualificationTarget(env, mode)).code).toBe(
      code,
    );
  });

  test("the public target and fingerprint carry no credential", () => {
    const a = resolveQualificationTarget(hostedEnv(), "isolated-preview");
    const b = resolveQualificationTarget(
      hostedEnv({
        OT_CALENDAR_PREVIEW_DATABASE_URL: `postgresql://postgres:other-password-123@db.${REF}.supabase.co:5432/postgres`,
      }),
      "isolated-preview",
    );
    expect(a.target.fingerprint).toBe(b.target.fingerprint);
    expect(JSON.stringify(a.target)).not.toContain(PASSWORD);
    expect(
      resolveQualificationTarget(rehearsalEnv(), "local-rehearsal").target
        .fingerprint,
    ).not.toBe(a.target.fingerprint);
  });

  test("the approved Free-tier session pooler is accepted and bound to the project ref", () => {
    const resolved = resolveQualificationTarget(poolerEnv(), "isolated-preview");
    expect(resolved.target).toMatchObject({
      host: "aws-0-us-east-2.pooler.supabase.com",
      port: 5432,
      database: "postgres",
      user: `postgres.${REF}`,
      projectRef: REF,
    });
    expect(resolved.caPem).toBe(CA);
  });
});

describe("durable isolated marker", () => {
  const base = {
    schema: "ot.database-environment.v1",
    purpose: "ot-neutral-report",
    environment: "preview",
    isolated: true,
    production: false,
    instanceId: MARKER_ID,
  };
  test("accepts the isolated Preview marker for the expected instance", () => {
    expect(() =>
      assertIsolatedPreviewMarker(JSON.stringify(base), target()),
    ).not.toThrow();
    expect(() =>
      assertIsolatedPreviewMarker(
        JSON.stringify({ ...base, purpose: "ot-official-calendar-preview" }),
        target(),
      ),
    ).not.toThrow();
  });
  test.each([
    ["absent", null],
    ["malformed", "{"],
    [
      "Production marker",
      JSON.stringify({
        ...base,
        environment: "production",
        production: true,
        projectRef: OT_PRODUCTION_PROJECT_REF,
      }),
    ],
    ["claims production", JSON.stringify({ ...base, production: true })],
    ["not isolated", JSON.stringify({ ...base, isolated: false })],
    ["other instance", JSON.stringify({ ...base, instanceId: randomUUID() })],
    [
      "other project",
      JSON.stringify({ ...base, projectRef: "zyxwvutsrqponmlkjihg" }),
    ],
    ["foreign purpose", JSON.stringify({ ...base, purpose: "ot-commerce" })],
  ])("refuses %s", (_name, raw) => {
    expect(refusal(() => assertIsolatedPreviewMarker(raw, target())).code).toBe(
      "marker_invalid",
    );
  });
});

// ---------------------------------------------------------------------------
// The harness over the real route, store, barrier, collector and parser
// ---------------------------------------------------------------------------

describe("signed end-to-end consumer proof", () => {
  test("pinned bytes seed, prove, clean and return to default-off without persisting a secret", async () => {
    const journal = memoryJournal();
    const { ports: p, captured, secretsSeen } = ports(journal);
    const outcome = await harness(p).run();

    expect(outcome).toMatchObject({ complete: true, phase: "complete" });
    expect(mockDb.rows.size).toBe(0);
    expect(flagsOff()).toBe(true);
    const j = journal.journal!;
    expect(Object.keys(j.phases)).toEqual([
      "preflight",
      "seedIntent",
      "seeded",
      "proof",
      "cleanupStarted",
      "cleanup",
      "defaultOff",
    ]);
    expect(j.failures).toEqual([]);
    expect(j.phases.seeded!.rows.map((r) => r.key)).toEqual([
      SNAPSHOT_KEY,
      ATTEMPT_KEY,
    ]);
    // Stamped from the true DB epoch, not the zone-nominal clock used for row ownership.
    expect(j.phases.seeded!.retrievedAt).toBe(
      new Date(Date.parse(AT) - 2_000).toISOString(),
    );
    expect(j.phases.cleanup).toMatchObject({
      deleted: 2,
      absentOnFreshConnection: true,
    });
    expect(j.phases.defaultOff!.checks).toEqual({
      flagsUnsetInProcess: true,
      routeStatus: 404,
      routeNotFound: true,
      storeDisabled: true,
      snapshotKeysAbsent: true,
    });
    const { controls, rendered } = j.phases.proof!.evidence;
    expect(Object.values(controls).map((c) => c.status)).toEqual([
      401, 403, 403, 403,
    ]);
    expect(rendered).toMatchObject({
      status: 200,
      verdict: "rendered",
      cacheControl: "private, no-store",
      reviewOnly: true,
      postAllowed: false,
      renderedText: PINNED.renderedText,
    });
    expect(rendered.binding).toMatchObject({
      sourceContentSha256: PINNED.fixtureSha256,
      candidateId: PINNED.candidateId,
      candidateContentHash: PINNED.candidateContentHash,
    });
    expect(sha256(journal.receipt!)).toBe(outcome.receiptSha256);

    // Nothing persisted carries the credential, a key, a bearer or a signature.
    const signatures = captured
      .map((c) => JSON.parse(c.body).approvalSignature)
      .filter(Boolean);
    const bearers = captured.map((c) => c.authorization!.slice(7));
    expect(secretsSeen.size).toBe(3);
    for (const text of journal.writes)
      for (const secret of [
        PASSWORD,
        ...secretsSeen,
        ...bearers,
        ...signatures,
      ])
        expect(text).not.toContain(secret);
  });

  test("the pinned digests are what the collector produces from the reviewed bytes", async () => {
    process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED = "true";
    const capture = await collectOfficialDeadlineCapture({
      fetchSource: fixtureFetch(FIXTURE, INFORMATIONAL_SOURCE_URL),
      parseHtml: parseInformationalAssessorHtml,
      now: () => new Date(AT),
    });
    expect(sha256(FIXTURE)).toBe(PINNED.fixtureSha256);
    expect(snapshotContentDigest(capture!.snapshot)).toBe(PINNED.contentDigest);
    expect(SNAPSHOT_KEY).toBe(INFORMATIONAL_SNAPSHOT_KEY);
  });

  test("a captured signed request cannot be replayed after the run", async () => {
    const journal = memoryJournal();
    const { ports: p, captured } = ports(journal);
    await harness(p).run();
    const signed = captured.find(
      (c) => JSON.parse(c.body).approvalSignature && c.authorization,
    );
    const replay = () =>
      POST(
        new Request(
          "https://isolated-preview.invalid/api/internal/official-calendar-preview",
          {
            method: "POST",
            headers: {
              authorization: signed!.authorization!,
              "content-type": "application/json",
            },
            body: signed!.body,
          },
        ),
      );
    expect((await replay()).status).toBe(404);
    // Even re-enabled with new keys and the capability reused, the approval is dead.
    Object.assign(process.env, {
      VERCEL_ENV: "preview",
      OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED: "true",
      OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY: signed!.authorization!.slice(7),
      OT_OFFICIAL_CALENDAR_PREVIEW_APPROVAL_SECRET:
        "a-fresh-approval-key-over-thirty-two-chars",
    });
    expect((await replay()).status).toBe(403);
  });
});

describe("fail closed before any write", () => {
  const schemaCases: [string, (s: SchemaFacts) => void][] = [
    [
      "missing column",
      (s) => void (s.columns = s.columns.filter((c) => c.name !== "updatedAt")),
    ],
    ["wrong type", (s) => void (s.columns[2]!.dataType = "jsonb")],
    ["nullable value", (s) => void (s.columns[2]!.nullable = true)],
    [
      "extra column",
      (s) =>
        void (s.columns = [
          ...s.columns,
          { name: "tenant", dataType: "text", nullable: false },
        ]),
    ],
    ["no unique key index", (s) => void (s.uniqueKeyIndex = false)],
    ["no delete privilege", (s) => void (s.privileges.delete = false)],
    [
      "table absent",
      (s) => void Object.assign(s, { columns: [], uniqueKeyIndex: false }),
    ],
  ];
  test.each(schemaCases)("wrong schema: %s", async (_name, mutate) => {
    mockDb.schema = structuredClone(GOOD_SCHEMA);
    mutate(mockDb.schema);
    const journal = memoryJournal();
    await expect(harness(ports(journal).ports).run()).rejects.toMatchObject({
      code: "schema_invalid",
    });
    expect(mockDb.mutations).toBe(0);
    expect(journal.journal!.phases.seedIntent).toBeUndefined();
  });

  test.each([
    [
      "Production marker",
      () =>
        void (mockDb.marker = JSON.stringify({
          schema: "ot.database-environment.v1",
          purpose: "ot-neutral-report",
          environment: "production",
          production: true,
          projectRef: OT_PRODUCTION_PROJECT_REF,
          instanceId: MARKER_ID,
        })),
      "marker_invalid",
    ],
    ["unmarked database", () => void (mockDb.marker = null), "marker_invalid"],
    [
      "different database",
      () => void (mockDb.databaseName = "other"),
      "database_mismatch",
    ],
    [
      "existing snapshot rows",
      () =>
        void mockDb.rows.set(SNAPSHOT_KEY, {
          id: "real",
          key: SNAPSHOT_KEY,
          value: "{}",
          createdAtMs: 0,
        }),
      "target_not_clean",
    ],
  ])("%s", async (_name, arrange, code) => {
    arrange();
    const before = JSON.stringify([...mockDb.rows]);
    await expect(
      harness(ports(memoryJournal()).ports).run(),
    ).rejects.toMatchObject({ code });
    expect(mockDb.mutations).toBe(0);
    expect(JSON.stringify([...mockDb.rows])).toBe(before);
  });

  test("a tampered fixture never reaches the store", async () => {
    const tampered = new Uint8Array(FIXTURE);
    tampered[tampered.length - 2] ^= 1;
    const journal = memoryJournal();
    const { ports: p } = ports(journal, { fixture: async () => tampered });
    await expect(harness(p).run()).rejects.toMatchObject({
      code: "fixture_digest_mismatch",
    });
    expect(mockDb.mutations).toBe(0);
    expect(journal.journal!.failures).toEqual([
      expect.objectContaining({
        phase: "seed",
        code: "fixture_digest_mismatch",
      }),
    ]);
  });

  test("a dirty source tree cannot produce qualification evidence", async () => {
    await expect(
      harness(ports(memoryJournal()).ports, { clean: false }).run(),
    ).rejects.toMatchObject({
      code: "source_tree_dirty",
    });
    expect(mockDb.opens).toBe(0);
  });

  test("a journal write that would carry a secret is refused", async () => {
    const t = target();
    await expect(
      harness(ports(memoryJournal()).ports, { secrets: [t.fingerprint] }).run(),
    ).rejects.toMatchObject({
      code: "secret_leak_blocked",
    });
    expect(mockDb.opens).toBe(0);
    expect(() =>
      assertNoSecrets(`x${encodeURIComponent("p@ss word!")}y`, ["p@ss word!"]),
    ).toThrow(QualificationRefusal);
  });
});

describe("wrong snapshot digest after seeding", () => {
  test("a coherent foreign rewrite of the stored snapshot is refused and our rows are still cleaned", async () => {
    const journal = memoryJournal();
    let calls = 0;
    const { ports: p } = ports(journal, {
      store: async () => {
        if (++calls === 2) {
          // Rewrite the value and re-bind the barrier, as a foreign writer could.
          const row = mockDb.rows.get(SNAPSHOT_KEY)!;
          const snapshot = JSON.parse(row.value);
          snapshot.townships.calumet.stages.assessor.lastFileDate =
            "2026-10-09";
          row.value = JSON.stringify(snapshot);
          const marker = JSON.parse(mockDb.rows.get(ATTEMPT_KEY)!.value);
          mockDb.rows.get(ATTEMPT_KEY)!.value = JSON.stringify({
            ...marker,
            digest: sha256(row.value),
          });
        }
        return informationalSnapshotStore();
      },
    });
    await expect(harness(p).run()).rejects.toMatchObject({
      code: "snapshot_digest_mismatch",
    });
    expect(mockDb.rows.size).toBe(0);
    expect(journal.journal!.phases.proof).toBeUndefined();
    expect(journal.journal!.phases.cleanup).toMatchObject({ deleted: 2 });
    expect(flagsOff()).toBe(true);
  });

  test("a stored value that no longer matches the barrier is unreadable, so the proof fails closed", async () => {
    const journal = memoryJournal();
    let calls = 0;
    const { ports: p } = ports(journal, {
      store: async () => {
        if (++calls === 2) {
          const row = mockDb.rows.get(SNAPSHOT_KEY)!;
          row.value = row.value.replace(
            '"lastFileDate":"2026-10-02"',
            '"lastFileDate":"2026-10-09"',
          );
        }
        return informationalSnapshotStore();
      },
    });
    await expect(harness(p).run()).rejects.toMatchObject({
      code: "proof_failed",
    });
    expect(mockDb.rows.size).toBe(0);
  });
});

describe("replay and resume", () => {
  const killAfter = (
    journal: ReturnType<typeof memoryJournal>,
    when: (j: Journal) => boolean,
  ) => {
    const write = journal.write;
    journal.write = async (j) => {
      await write(j);
      if (when(j)) mockDb.killed = true;
    };
    return () => void (journal.write = write);
  };

  test("a process killed after seeding resumes without reseeding and completes", async () => {
    const journal = memoryJournal();
    const revive = killAfter(journal, (j) => Boolean(j.phases.seeded));
    await expect(harness(ports(journal).ports).run()).rejects.toThrow();
    const seededIds = journal.journal!.phases.seeded!.rows.map((r) => r.id);
    expect([...mockDb.rows.values()].map((r) => r.id).sort()).toEqual(
      [...seededIds].sort(),
    );

    mockDb.killed = false;
    revive();
    const outcome = await harness(ports(journal).ports).run();
    expect(outcome.complete).toBe(true);
    expect(journal.journal!.phases.seeded!.rows.map((r) => r.id)).toEqual(
      seededIds,
    );
    expect(mockDb.rows.size).toBe(0);
    expect(flagsOff()).toBe(true);
  });

  test("a process killed mid-seed resumes by removing only its partial rows and reseeding", async () => {
    const journal = memoryJournal();
    mockDb.onPublish = () => {
      mockDb.killed = true;
    };
    await expect(harness(ports(journal).ports).run()).rejects.toThrow();
    expect([...mockDb.rows.keys()]).toEqual([ATTEMPT_KEY]);
    expect(journal.journal!.phases.seedIntent).toBeDefined();
    expect(journal.journal!.phases.seeded).toBeUndefined();

    mockDb.killed = false;
    mockDb.onPublish = null;
    const outcome = await harness(ports(journal).ports).run();
    expect(outcome.complete).toBe(true);
    expect(mockDb.rows.size).toBe(0);
  });

  test("replaying a completed run performs no database access", async () => {
    const journal = memoryJournal();
    const first = await harness(ports(journal).ports).run();
    mockDb.opens = 0;
    mockDb.mutations = 0;
    const again = await harness(ports(journal).ports).run();
    expect(again).toEqual(first);
    expect(mockDb.opens).toBe(0);
    expect(mockDb.mutations).toBe(0);
  });

  test("resuming against a different target, run or commit is refused before connecting", async () => {
    const journal = memoryJournal();
    const revive = killAfter(journal, (j) => Boolean(j.phases.seeded));
    await expect(harness(ports(journal).ports).run()).rejects.toThrow();
    mockDb.killed = false;
    revive();
    mockDb.opens = 0;
    const other = resolveQualificationTarget(
      rehearsalEnv(),
      "local-rehearsal",
    ).target;
    await expect(
      harness(ports(journal).ports, { target: other }).run(),
    ).rejects.toMatchObject({ code: "journal_mismatch" });
    await expect(
      harness(ports(journal).ports, { runId: createRunId() }).run(),
    ).rejects.toMatchObject({ code: "journal_mismatch" });
    await expect(
      harness(ports(journal).ports, { commit: "d".repeat(40) }).run(),
    ).rejects.toMatchObject({ code: "journal_mismatch" });
    expect(mockDb.opens).toBe(0);
  });

  test("a failed proof ends the run cleaned; resuming it cannot manufacture a pass", async () => {
    const journal = memoryJournal();
    const { ports: p } = ports(journal, {
      route: async () => new Response("{}", { status: 500 }),
    });
    await expect(harness(p).run()).rejects.toMatchObject({
      code: "proof_failed",
      detail: "500:none",
    });
    expect(mockDb.rows.size).toBe(0);
    await expect(harness(ports(journal).ports).run()).rejects.toMatchObject({
      code: "proof_failed",
    });
    expect(journal.journal!.receiptSha256).toBeUndefined();
    expect(mockDb.rows.size).toBe(0);
  });
});

describe("interrupted cleanup", () => {
  test("resume finishes an interrupted cleanup without re-seeding or re-proving", async () => {
    const journal = memoryJournal();
    mockDb.deleteHook = (deleted) => {
      if (deleted === 1) throw new Error("connection reset");
    };
    await expect(harness(ports(journal).ports).run()).rejects.toThrow(
      "connection reset",
    );
    expect(mockDb.rows.size).toBe(1);
    expect(journal.journal!.phases.cleanupStarted).toBeDefined();
    expect(journal.journal!.failures).toEqual([
      expect.objectContaining({ phase: "cleanup", code: "unexpected_error" }),
    ]);
    expect(flagsOff()).toBe(true);

    mockDb.deleteHook = null;
    const route = jest.fn(POST);
    const outcome = await harness(ports(journal, { route }).ports).run();
    expect(outcome.complete).toBe(true);
    expect(mockDb.rows.size).toBe(0);
    expect(route).toHaveBeenCalledTimes(1); // the default-off probe only
    expect(journal.journal!.phases.cleanup!.deleted).toBe(1);
  });

  test("the cleanup command recovers a run and leaves a foreign row untouched", async () => {
    const journal = memoryJournal();
    mockDb.deleteHook = (deleted) => {
      if (deleted === 2)
        mockDb.rows.set(SNAPSHOT_KEY, {
          id: "foreign-writer",
          key: SNAPSHOT_KEY,
          value: "{}",
          createdAtMs: Date.now() + mockDb.zoneOffsetMs,
        });
    };
    await expect(harness(ports(journal).ports).run()).rejects.toMatchObject({
      code: "foreign_rows_present",
    });
    mockDb.deleteHook = null;
    await expect(harness(ports(journal).ports).recover()).rejects.toMatchObject(
      { code: "foreign_rows_present" },
    );
    expect(mockDb.rows.get(SNAPSHOT_KEY)?.id).toBe("foreign-writer");

    mockDb.rows.clear(); // the owner removes the foreign row by their own procedure
    const recovered = await harness(ports(journal).ports).recover();
    expect(recovered.phase).toBe("recovered");
    expect(journal.journal!.phases.defaultOff!.checks.snapshotKeysAbsent).toBe(
      true,
    );
  });
});

describe("default-off restoration", () => {
  test("flags are restored even when the route throws mid-proof", async () => {
    const journal = memoryJournal();
    const { ports: p } = ports(journal, {
      route: async () => {
        throw new Error("consumer crashed");
      },
    });
    await expect(harness(p).run()).rejects.toThrow("consumer crashed");
    expect(flagsOff()).toBe(true);
    expect(mockDb.rows.size).toBe(0);
    expect(await informationalSnapshotStore()).toBeNull();
  });

  test("a flag left on by anything in the process fails the default-off proof", async () => {
    const journal = memoryJournal();
    const { ports: p } = ports(journal, {
      route: async (request) => {
        process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED = "true";
        return POST(request);
      },
    });
    await expect(harness(p).run()).rejects.toMatchObject({
      code: "default_off_failed",
    });
    expect(journal.journal!.receiptSha256).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Operator CLI
// ---------------------------------------------------------------------------

describe("operator CLI", () => {
  const repoRoot = process.cwd();
  const run = async (
    argv: string[],
    env: Record<string, string | undefined> = rehearsalEnv(),
    journalOverride?: (dir: string) => void,
  ) => {
    const out: string[] = [];
    const code = await runQualificationCli({
      argv,
      env,
      repoRoot,
      out: (line) => out.push(line),
      source: () => ({
        commit: "c".repeat(40),
        tree: "t".repeat(40),
        clean: true,
      }),
      preflightDb: async () => mockDb.port,
      ports: async (_resolved, journal) => {
        journalOverride?.((journal as ReturnType<typeof fileJournal>).dir);
        return ports(journal).ports;
      },
    });
    return { code, out: out.join("\n") };
  };

  test.each([
    [
      [
        "run",
        "--run-dir",
        `postgresql://postgres:${PASSWORD}@db.${REF}.supabase.co/postgres`,
      ],
    ],
    [["run", `--password=${PASSWORD}`]],
    [["run", "--run-dir", `/tmp/${PASSWORD}@host`]],
    [["deploy"]],
    [["resume", "--run-dir", "/tmp/x"]],
    [["run", "--run-dir", "relative/dir"]],
    [["run", "--run-dir", join(repoRoot, "evidence")]],
  ])(
    "refuses unsafe or incomplete argv %j without echoing it",
    async (argv) => {
      const { code, out } = await run(argv);
      expect(code).toBe(2);
      expect(out).not.toContain(PASSWORD);
      expect(mockDb.opens).toBe(0);
    },
  );

  test("parses the documented commands", () => {
    expect(parseQualificationArgs(["preflight"])).toMatchObject({
      command: "preflight",
      mode: "isolated-preview",
    });
    expect(
      parseQualificationArgs([
        "run",
        "--mode",
        "local-rehearsal",
        "--run-dir",
        "/x",
      ]),
    ).toMatchObject({
      mode: "local-rehearsal",
      runDir: "/x",
    });
  });

  test("run, status, verify and cleanup through files, with no credential in output or evidence", async () => {
    mockDb.databaseName = "ot_calendar_rehearsal_a";
    const dir = mkdtempSync(join(tmpdir(), "ocq-"));
    const first = await run([
      "run",
      "--mode",
      "local-rehearsal",
      "--run-dir",
      dir,
    ]);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/run: PASS phase=complete receipt=[0-9a-f]{64}/);
    const runId = /run-id: (ocq-[0-9a-f-]+)/.exec(first.out)![1]!;
    const runDir = join(dir, runId);
    expect(readdirSync(runDir).sort()).toEqual([
      "journal.json",
      "receipt.json",
      "receipt.sha256",
    ]);
    for (const name of readdirSync(runDir)) {
      expect(statSync(join(runDir, name)).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(runDir, name), "utf8")).not.toContain(PASSWORD);
    }
    expect(statSync(runDir).mode & 0o777).toBe(0o700);
    expect(first.out).not.toContain(PASSWORD);

    expect(
      (await run(["status", "--run-dir", dir, "--run-id", runId])).out,
    ).toContain("receipt: ");
    expect(
      await run(["verify", "--run-dir", dir, "--run-id", runId]),
    ).toMatchObject({ code: 0, out: "verify: PASS" });
    expect(
      await run([
        "resume",
        "--mode",
        "local-rehearsal",
        "--run-dir",
        dir,
        "--run-id",
        runId,
      ]),
    ).toMatchObject({ code: 0 });
    expect(
      (
        await run([
          "cleanup",
          "--mode",
          "local-rehearsal",
          "--run-dir",
          dir,
          "--run-id",
          runId,
        ])
      ).code,
    ).toBe(0);

    writeFileSync(join(runDir, ".journal.json.abc.tmp"), "partial");
    expect((await verifyReceipt(runDir)).ok).toBe(true);
    expect(
      (
        await run([
          "cleanup",
          "--mode",
          "local-rehearsal",
          "--run-dir",
          dir,
          "--run-id",
          runId,
        ])
      ).code,
    ).toBe(0);
    expect(readdirSync(runDir)).not.toContain(".journal.json.abc.tmp");

    const receipt = readFileSync(join(runDir, "receipt.json"), "utf8");
    writeFileSync(
      join(runDir, "receipt.json"),
      receipt.replace(PINNED.renderedText, "Tampered."),
    );
    const verify = await run(["verify", "--run-dir", dir, "--run-id", runId]);
    expect(verify.code).toBe(1);
    expect(verify.out).toContain("receipt_digest_mismatch");
    writeFileSync(join(runDir, "receipt.json"), "{truncated");
    expect(await verifyReceipt(runDir)).toEqual({
      ok: false,
      problems: ["receipt_digest_mismatch", "receipt_or_journal_unparseable"],
    });
  });

  test("refusals print a code and a static message only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ocq-"));
    const production = await run(
      ["run", "--run-dir", dir],
      hostedEnv({ OT_CALENDAR_PREVIEW_PROJECT_REF: OT_PRODUCTION_PROJECT_REF }),
    );
    expect(production).toMatchObject({ code: 1 });
    expect(production.out).toMatch(/^FAIL production_target: /);
    expect(production.out).not.toContain(PASSWORD);
    const resumeUnknown = await run([
      "resume",
      "--mode",
      "local-rehearsal",
      "--run-dir",
      dir,
      "--run-id",
      createRunId(),
    ]);
    expect(resumeUnknown.out).toMatch(/^FAIL journal_missing/);
    expect(mockDb.opens).toBe(0);
  });

  test("preflight is read-only", async () => {
    mockDb.databaseName = "ot_calendar_rehearsal_a";
    const result = await run(["preflight", "--mode", "local-rehearsal"]);
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toMatch(
      /^preflight: PASS mode=local-rehearsal fingerprint=[0-9a-f]{64}$/,
    );
    expect(mockDb.mutations).toBe(0);
  });
});
