/**
 * Isolated-Preview qualification harness for the review-only official-calendar
 * consumer ([[app/api/internal/official-calendar-preview/route]]).
 *
 * One run, five journaled phases, each safe to repeat:
 *
 *   preflight  exact target, durable isolated marker, SystemConfig schema,
 *              ambient environment default-off, both snapshot keys absent
 *   seed       the pinned fixture bytes through the real collector, store and
 *              refresh barrier; nothing else is written
 *   proof      the real route handler, ephemeral in-process capability and
 *              approval keys, hostile controls, then one signed render
 *   cleanup    delete exactly the rows this run created, prove absence on a
 *              fresh connection, never touch a row this run did not create
 *   defaultOff flags gone from the process, route 404, store off, keys absent
 *
 * Nothing here reads a secret from argv, prints a credential, or persists a
 * key: every journal and receipt write is scanned for the run's secrets first.
 * The seeded snapshot is marked `synthetic: false` only because the canonical
 * decoder admits nothing else; its retrieval instant is the seed instant, and
 * the receipt says so. That is why the target rules below refuse Production
 * before any connection is opened.
 */

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { OfficialDeadlineSnapshot } from "@/lib/deadlines/official-source-state";
import { OT_PRODUCTION_PROJECT_REF } from "@/lib/fulfillment/neutral-production-database-marker";
import { buildOfficialCalendarCandidates } from "@/lib/social/official-calendar-candidates";
import { CONTROLLED_COPY_TEMPLATES } from "@/lib/social/official-calendar-controlled-copy";

export const HARNESS_VERSION = "ot-calendar-preview-qualification/1";
export const SNAPSHOT_KEY = "ot:informational-assessor:2026:v1";
export const ATTEMPT_KEY = `${SNAPSHOT_KEY}:attempt`;
export const OWNED_KEYS = [SNAPSHOT_KEY, ATTEMPT_KEY] as const;

/** The reviewed Assessor bytes, and what they must canonically produce. */
export const PINNED = {
  fixturePath: "__tests__/fixtures/deadlines/assessor-calendar-20260827.html",
  fixtureSha256:
    "bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca",
  /** SHA-256 of the canonical snapshot with its retrieval instant removed. */
  contentDigest:
    "2e7c06f59aa4d8b232149eee9ef30a2b15d8b29c6cc7f85a43ee55ff73391190",
  townshipLabel: "Calumet",
  templateId: "official_dates_v1",
  candidateId: "occ_a702c9386291b1d2544b5d84",
  candidateContentHash:
    "a702c9386291b1d2544b5d842fcacc6b943e70653f4baebaa815419b9662689d",
  renderedText:
    "Official Cook County dates. Notice date: 2026-08-20. Filing window opens: 2026-08-20. Last day to file: 2026-10-02.",
} as const;

/** Environment the route, store and prisma client read. None may be ambient. */
export const FEATURE_ENV = [
  "OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED",
  "OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY",
  "OT_OFFICIAL_CALENDAR_PREVIEW_APPROVAL_SECRET",
  "OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED",
  "OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED",
  "VERCEL_ENV",
] as const;
const AMBIENT_FORBIDDEN = [
  ...FEATURE_ENV,
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "SHADOW_DATABASE_URL",
  "DATABASE_INSECURE_TLS",
  "DATABASE_SSL",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "VERCEL",
  "VERCEL_URL",
] as const;

export type TargetMode = "isolated-preview" | "local-rehearsal";
export type RefusalCode =
  | "ambient_env"
  | "credentials_missing"
  | "credentials_partial"
  | "target_invalid"
  | "production_target"
  | "target_not_isolated_preview"
  | "rehearsal_target_invalid"
  | "tls_ca_missing"
  | "marker_expected_missing"
  | "marker_invalid"
  | "database_mismatch"
  | "schema_invalid"
  | "target_not_clean"
  | "foreign_rows_present"
  | "fixture_digest_mismatch"
  | "snapshot_digest_mismatch"
  | "seed_refused"
  | "store_unavailable"
  | "proof_failed"
  | "cleanup_incomplete"
  | "default_off_failed"
  | "journal_mismatch"
  | "journal_missing"
  | "secret_leak_blocked"
  | "source_tree_dirty";

/** Every message is static. No caller-supplied value is ever interpolated. */
export class QualificationRefusal extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
    /** Route status and reason only; never request, header or credential text. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "QualificationRefusal";
  }
}
const refuse = (code: RefusalCode, message: string): never => {
  throw new QualificationRefusal(code, message);
};

export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

export type PublicTarget = {
  mode: TargetMode;
  host: string;
  port: number;
  database: string;
  user: string;
  projectRef: string | null;
  markerInstanceId: string;
  fingerprint: string;
};
export type ResolvedTarget = {
  target: PublicTarget;
  /** Credential material. Never serialized, logged or passed on argv. */
  connectionString: string;
  password: string;
  caPem: string | null;
};

const PROJECT_REF = /^[a-z]{20}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const ISOLATED_PREVIEW_SESSION_POOLER_HOSTS = new Set([
  "aws-0-us-east-2.pooler.supabase.com",
  "aws-1-us-east-2.pooler.supabase.com",
]);
export const REHEARSAL_DATABASE_PREFIX = "ot_calendar_rehearsal_";

/**
 * Resolve exactly one target from the environment, or refuse. Production and
 * ambiguity are refused here, before any socket exists.
 */
export function resolveQualificationTarget(
  env: Readonly<Record<string, string | undefined>>,
  mode: TargetMode,
): ResolvedTarget {
  const ambient = AMBIENT_FORBIDDEN.filter((name) => env[name] !== undefined);
  if (ambient.length)
    refuse(
      "ambient_env",
      `Unset ambient database/feature variables before running: ${ambient.join(", ")}`,
    );
  const raw = env.OT_CALENDAR_PREVIEW_DATABASE_URL;
  if (!raw || !raw.trim())
    refuse(
      "credentials_missing",
      "OT_CALENDAR_PREVIEW_DATABASE_URL is not set",
    );
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw!).toLowerCase();
  } catch {
    return refuse("target_invalid", "Target URL is not decodable");
  }
  // Anywhere at all: host, pooler-style user suffix, database name, password.
  if (decoded.includes(OT_PRODUCTION_PROJECT_REF))
    refuse("production_target", "Target names the Production project");
  let url: URL;
  try {
    url = new URL(raw!.trim());
  } catch {
    return refuse("target_invalid", "Target URL does not parse");
  }
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    url.search !== "" ||
    url.hash !== ""
  )
    refuse(
      "target_invalid",
      "Target must be a PostgreSQL URL without query parameters or fragment",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = url.port ? Number(url.port) : 5432;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!host || !database)
    refuse("target_invalid", "Target host and database are required");
  if (!user || !password)
    refuse(
      "credentials_partial",
      "Target must carry both a user and a password",
    );

  const markerInstanceId =
    env.OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID?.trim() ?? "";
  if (!UUID.test(markerInstanceId))
    refuse(
      "marker_expected_missing",
      "OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID must be the expected marker UUID",
    );

  let projectRef: string | null = null;
  let caPem: string | null = null;
  if (mode === "isolated-preview") {
    projectRef = env.OT_CALENDAR_PREVIEW_PROJECT_REF?.trim() ?? "";
    if (projectRef === OT_PRODUCTION_PROJECT_REF)
      refuse("production_target", "Declared project is the Production project");
    if (!PROJECT_REF.test(projectRef))
      refuse(
        "target_not_isolated_preview",
        "OT_CALENDAR_PREVIEW_PROJECT_REF must be the isolated project reference",
      );
    const directTarget =
      host === `db.${projectRef}.supabase.co` && user === "postgres";
    const sessionPoolerTarget =
      ISOLATED_PREVIEW_SESSION_POOLER_HOSTS.has(host) &&
      user === `postgres.${projectRef}`;
    if (
      (!directTarget && !sessionPoolerTarget) ||
      port !== 5432 ||
      database !== "postgres"
    )
      refuse(
        "target_not_isolated_preview",
        "Target must be the declared project's direct database host or approved us-east-2 session pooler identity, port 5432, database postgres",
      );
    caPem = env.SUPABASE_CA_PEM?.trim() ?? "";
    if (!caPem.startsWith("-----BEGIN CERTIFICATE-----"))
      refuse(
        "tls_ca_missing",
        "SUPABASE_CA_PEM must hold the project CA certificate",
      );
  } else {
    if (env.OT_CALENDAR_PREVIEW_PROJECT_REF !== undefined)
      refuse(
        "rehearsal_target_invalid",
        "A local rehearsal must not declare a project",
      );
    if (!LOOPBACK.has(host) || !database.startsWith(REHEARSAL_DATABASE_PREFIX))
      refuse(
        "rehearsal_target_invalid",
        `A local rehearsal requires a loopback host and a ${REHEARSAL_DATABASE_PREFIX}* database`,
      );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    refuse("target_invalid", "Target port is invalid");

  const identity = {
    mode,
    host,
    port,
    database,
    user,
    projectRef,
    markerInstanceId,
  };
  return {
    target: { ...identity, fingerprint: sha256(canonicalJson(identity)) },
    connectionString: raw!.trim(),
    password,
    caPem,
  };
}

/** The durable `COMMENT ON DATABASE` marker, shared with the neutral lane. */
export function assertIsolatedPreviewMarker(
  raw: string | null,
  target: PublicTarget,
): void {
  let marker: Record<string, unknown> | null = null;
  try {
    const value = raw ? JSON.parse(raw) : null;
    marker =
      value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
  } catch {
    marker = null;
  }
  if (
    !marker ||
    marker.schema !== "ot.database-environment.v1" ||
    (marker.purpose !== "ot-neutral-report" &&
      marker.purpose !== "ot-official-calendar-preview") ||
    marker.environment !== "preview" ||
    marker.isolated !== true ||
    marker.production !== false ||
    marker.projectRef === OT_PRODUCTION_PROJECT_REF ||
    (marker.projectRef !== undefined && marker.projectRef !== target.projectRef)
  )
    refuse(
      "marker_invalid",
      "Database is not durably marked as an isolated non-Production Preview database",
    );
  if (marker!.instanceId !== target.markerInstanceId)
    refuse(
      "marker_invalid",
      "Durable marker instance does not match the expected instance",
    );
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export type SchemaFacts = {
  columns: readonly { name: string; dataType: string; nullable: boolean }[];
  uniqueKeyIndex: boolean;
  privileges: {
    select: boolean;
    insert: boolean;
    update: boolean;
    delete: boolean;
  };
};
const EXPECTED_COLUMNS: Record<string, string> = {
  id: "text",
  key: "text",
  value: "text",
  createdAt: "timestamp without time zone",
  updatedAt: "timestamp without time zone",
};
export function assertSystemConfigSchema(facts: SchemaFacts): string {
  const names = facts.columns.map((c) => c.name).sort();
  const expected = Object.keys(EXPECTED_COLUMNS).sort();
  const columnsOk =
    names.join() === expected.join() &&
    facts.columns.every(
      (c) => EXPECTED_COLUMNS[c.name] === c.dataType && !c.nullable,
    );
  const { select, insert, update, delete: del } = facts.privileges;
  if (
    !columnsOk ||
    !facts.uniqueKeyIndex ||
    !select ||
    !insert ||
    !update ||
    !del
  )
    refuse(
      "schema_invalid",
      "SystemConfig is not schema-compatible (columns, unique key index or privileges)",
    );
  return sha256(canonicalJson(facts));
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** What the bytes say, independent of when they were stamped as retrieved. */
export function snapshotContentDigest(
  snapshot: OfficialDeadlineSnapshot,
): string {
  const clone = structuredClone(snapshot) as OfficialDeadlineSnapshot;
  if (clone.sources?.assessor)
    delete (clone.sources.assessor as { retrievedAt?: string }).retrievedAt;
  return sha256(canonicalJson(clone));
}

/** A Response carrying the pinned bytes, shaped exactly as the collector demands. */
export function fixtureFetch(
  bytes: Uint8Array,
  sourceUrl: string,
): typeof fetch {
  return (async () => {
    const response = new Response(Buffer.from(bytes) as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    Object.defineProperty(response, "url", { value: sourceUrl });
    return response;
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export type RowFact = {
  id: string;
  key: string;
  value: string;
  createdAtMs: number;
};
export interface QualificationDb {
  identity(): Promise<{ databaseName: string; marker: string | null }>;
  schema(): Promise<SchemaFacts>;
  /** Nominal session-zone clock; comparable only with `createdAt` (timestamp without zone). */
  clockMs(): Promise<number>;
  /** True epoch from `clock_timestamp()`, the clock the store's publish checks. */
  epochMs(): Promise<number>;
  rows(keys: readonly string[]): Promise<RowFact[]>;
  /** Delete only these exact (key, id) rows, and only if created at or after `sinceMs`. */
  deleteOwned(
    rows: readonly { id: string; key: string }[],
    sinceMs: number,
  ): Promise<number>;
  close(): Promise<void>;
}
export type SnapshotStore = {
  begin(): Promise<string | null>;
  publish(raw: string): Promise<"PUBLISHED" | "UNCHANGED" | "REFUSED">;
  complete(id: string, raw: string): Promise<boolean>;
  read(now: Date): Promise<OfficialDeadlineSnapshot | null>;
};
export type Capture = { snapshot: OfficialDeadlineSnapshot } | null;
export type Journal = {
  schema: "ot.calendar-preview-qualification.journal.v1";
  harness: string;
  runId: string;
  target: PublicTarget;
  source: SourceFacts;
  createdAt: string;
  phases: {
    preflight?: { at: string; databaseName: string; schemaDigest: string };
    seedIntent?: { at: string; dbClockMs: number };
    seeded?: {
      at: string;
      rows: { id: string; key: string }[];
      storedSha256: string;
      contentDigest: string;
      retrievedAt: string;
    };
    proof?: { at: string; evidence: ProofEvidence };
    cleanupStarted?: { at: string };
    cleanup?: { at: string; deleted: number; absentOnFreshConnection: true };
    defaultOff?: { at: string; checks: Record<string, boolean | number> };
  };
  failures: { at: string; phase: string; code: string }[];
  receiptSha256?: string;
};
export type SourceFacts = { commit: string; tree: string; clean: boolean };
export type JournalStore = {
  read(): Promise<Journal | null>;
  write(journal: Journal): Promise<void>;
  writeReceipt(receipt: string, digest: string): Promise<void>;
  removeTemporary(): Promise<number>;
};
export type HarnessPorts = {
  env: Record<string, string | undefined>;
  openDb(): Promise<QualificationDb>;
  store(): Promise<SnapshotStore | null>;
  capture(bytes: Uint8Array, now: Date): Promise<Capture>;
  route(request: Request): Promise<Response>;
  fixture(): Promise<Uint8Array>;
  journal: JournalStore;
  now(): Date;
  log(line: string): void;
};

// ---------------------------------------------------------------------------
// Secrets and environment scope
// ---------------------------------------------------------------------------

export function assertNoSecrets(
  text: string,
  secrets: readonly string[],
): void {
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    if (text.includes(secret) || text.includes(encodeURIComponent(secret)))
      refuse(
        "secret_leak_blocked",
        "Refused to persist or print secret material",
      );
  }
}

/** Set exactly these variables for `work`, then restore whatever was there. */
export async function withScopedEnv<T>(
  env: Record<string, string | undefined>,
  values: Partial<Record<(typeof FEATURE_ENV)[number], string>>,
  work: () => Promise<T>,
): Promise<T> {
  const prior = new Map(Object.keys(values).map((k) => [k, env[k]] as const));
  Object.assign(env, values);
  try {
    return await work();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Proof
// ---------------------------------------------------------------------------

export type ProbeResult = {
  status: number;
  reason: string | null;
  verdict: string | null;
};
export type ProofEvidence = {
  controls: Record<
    | "wrongCapability"
    | "unsigned"
    | "forgedSignature"
    | "replayAfterKeyRotation",
    ProbeResult
  >;
  rendered: ProbeResult & {
    cacheControl: string | null;
    reviewOnly: boolean;
    postAllowed: boolean;
    renderedText: string | null;
    renderedTextSha256: string | null;
    binding: Record<string, unknown> | null;
  };
  snapshotContentDigest: string;
  sourceContentSha256: string;
  candidateId: string;
  candidateContentHash: string;
};

const approvalPayload = (approval: Record<string, unknown>) =>
  JSON.stringify([
    "ot-calendar-preview-approval-v1",
    approval.candidateId,
    approval.contentHash,
    approval.approvedStatus,
    approval.templateId,
    approval.templateVersion,
    approval.templateDefinitionHash,
    approval.approvedIntents,
    approval.approvedAt,
  ]);
const ROUTE_URL =
  "https://isolated-preview.invalid/api/internal/official-calendar-preview";
const request = (bearer: string, body: unknown) =>
  new Request(ROUTE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
async function probe(
  response: Response,
): Promise<ProbeResult & { body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return {
    status: response.status,
    reason: typeof body.reason === "string" ? body.reason : null,
    verdict: typeof body.verdict === "string" ? body.verdict : null,
    body,
  };
}
const strip = ({ status, reason, verdict }: ProbeResult): ProbeResult => ({
  status,
  reason,
  verdict,
});
export const newSecret = () => randomBytes(48).toString("base64url");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export type RunOptions = {
  runId: string;
  target: PublicTarget;
  secrets: readonly string[];
  source: SourceFacts;
  /** Only the operator-owned credentialed run may claim qualification evidence. */
  requireCleanSource: boolean;
};
export type RunOutcome = {
  runId: string;
  complete: boolean;
  receiptSha256: string | null;
  phase: string;
};

export const RUN_ID =
  /^ocq-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const createRunId = () => `ocq-${randomUUID()}`;

export function createQualificationHarness(
  ports: HarnessPorts,
  options: RunOptions,
) {
  const { runId, target, secrets } = options;
  if (!RUN_ID.test(runId)) refuse("journal_mismatch", "Run ID is malformed");
  const iso = () => ports.now().toISOString();
  const persist = async (journal: Journal) => {
    assertNoSecrets(JSON.stringify(journal), secrets);
    await ports.journal.write(journal);
  };
  const withDb = async <T>(work: (db: QualificationDb) => Promise<T>) => {
    const db = await ports.openDb();
    try {
      return await work(db);
    } finally {
      await db.close().catch(() => undefined);
    }
  };
  const ownedSplit = (rows: RowFact[], journal: Journal) => {
    const intent = journal.phases.seedIntent?.dbClockMs;
    const recorded = journal.phases.seeded?.rows;
    const owned = rows.filter((row) =>
      intent === undefined
        ? false
        : recorded
          ? recorded.some((r) => r.id === row.id && r.key === row.key) &&
            row.createdAtMs >= intent
          : row.createdAtMs >= intent,
    );
    return { owned, foreign: rows.filter((row) => !owned.includes(row)) };
  };

  async function load(): Promise<Journal> {
    const existing = await ports.journal.read();
    if (existing) {
      if (
        existing.runId !== runId ||
        existing.target.fingerprint !== target.fingerprint ||
        existing.harness !== HARNESS_VERSION
      )
        refuse(
          "journal_mismatch",
          "Journal belongs to a different run, target or harness",
        );
      // A receipt names one commit; a resume from other code cannot finish it.
      if (
        existing.source.commit !== options.source.commit ||
        existing.source.tree !== options.source.tree ||
        existing.source.clean !== options.source.clean
      )
        refuse(
          "journal_mismatch",
          "Source tree changed since this run began; start a new run",
        );
      return existing;
    }
    if (options.requireCleanSource && !options.source.clean)
      refuse(
        "source_tree_dirty",
        "Qualification requires a clean committed source tree",
      );
    const journal: Journal = {
      schema: "ot.calendar-preview-qualification.journal.v1",
      harness: HARNESS_VERSION,
      runId,
      target,
      source: options.source,
      createdAt: iso(),
      phases: {},
      failures: [],
    };
    await persist(journal);
    return journal;
  }

  async function preflight(
    journal: Journal | null,
  ): Promise<{ databaseName: string; schemaDigest: string }> {
    return withDb(async (db) => {
      const identity = await db.identity();
      if (identity.databaseName !== target.database)
        refuse(
          "database_mismatch",
          "Connected database is not the declared database",
        );
      assertIsolatedPreviewMarker(identity.marker, target);
      const schemaDigest = assertSystemConfigSchema(await db.schema());
      const rows = await db.rows(OWNED_KEYS);
      if (!journal?.phases.seedIntent && rows.length)
        refuse(
          "target_not_clean",
          "Target already holds informational snapshot rows; nothing was changed",
        );
      if (
        journal?.phases.seedIntent &&
        ownedSplit(rows, journal).foreign.length
      )
        refuse(
          "foreign_rows_present",
          "Target holds snapshot rows this run did not create; nothing was changed",
        );
      return { databaseName: identity.databaseName, schemaDigest };
    });
  }

  async function seed(journal: Journal): Promise<void> {
    const bytes = await ports.fixture();
    if (sha256(bytes) !== PINNED.fixtureSha256)
      refuse(
        "fixture_digest_mismatch",
        "Pinned fixture bytes do not match the reviewed digest",
      );
    await withDb(async (db) => {
      const rows = await db.rows(OWNED_KEYS);
      const { owned, foreign } = ownedSplit(rows, journal);
      if (foreign.length)
        refuse(
          "foreign_rows_present",
          "Target holds snapshot rows this run did not create; nothing was changed",
        );
      // A partial seed from an interrupted attempt is ours; remove it and reseed.
      if (owned.length)
        await db.deleteOwned(owned, journal.phases.seedIntent!.dbClockMs);
      if (!journal.phases.seedIntent) {
        journal.phases.seedIntent = {
          at: iso(),
          dbClockMs: await db.clockMs(),
        };
        await persist(journal);
      }
      const dbNow = await db.epochMs();
      // Never ahead of either clock: the store checks the DB clock, the route the host clock.
      const retrievedAt = new Date(
        Math.min(dbNow, ports.now().getTime()) - 2_000,
      );
      await withScopedEnv(
        ports.env,
        { OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED: "true" },
        async () => {
          const capture = await ports.capture(bytes, retrievedAt);
          if (!capture)
            refuse("seed_refused", "Collector refused the pinned bytes");
          const { snapshot } = capture!;
          if (
            snapshot.sources.assessor?.contentSha256 !== PINNED.fixtureSha256 ||
            snapshotContentDigest(snapshot) !== PINNED.contentDigest
          )
            refuse(
              "snapshot_digest_mismatch",
              "Collected snapshot does not match the pinned canonical digest",
            );
          const store = await ports.store();
          if (!store)
            refuse(
              "store_unavailable",
              "Canonical snapshot store is unavailable",
            );
          const attempt = await store!.begin();
          if (!attempt)
            refuse("seed_refused", "Refresh barrier refused to begin");
          const raw = JSON.stringify(snapshot);
          if (
            (await store!.publish(raw)) !== "PUBLISHED" ||
            !(await store!.complete(attempt!, raw))
          )
            refuse(
              "seed_refused",
              "Canonical store refused the pinned snapshot",
            );
          const after = await db.rows(OWNED_KEYS);
          const split = ownedSplit(after, journal);
          const stored = after.find((r) => r.key === SNAPSHOT_KEY);
          if (
            split.foreign.length ||
            split.owned.length !== 2 ||
            stored?.value !== raw
          )
            refuse(
              "seed_refused",
              "Seeded rows are not exactly the two rows this run wrote",
            );
          journal.phases.seeded = {
            at: iso(),
            rows: split.owned
              .map(({ id, key }) => ({ id, key }))
              .sort((a, b) => (a.key < b.key ? -1 : 1)),
            storedSha256: sha256(raw),
            contentDigest: PINNED.contentDigest,
            retrievedAt: snapshot.sources.assessor!.retrievedAt,
          };
        },
      );
    });
    await persist(journal);
  }

  async function prove(journal: Journal): Promise<void> {
    const capability = newSecret();
    const approvalKey = newSecret();
    const rotatedKey = newSecret();
    const ephemeral = [capability, approvalKey, rotatedKey];
    const scope = {
      VERCEL_ENV: "preview",
      OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED: "true",
      OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY: capability,
      OT_OFFICIAL_CALENDAR_PREVIEW_APPROVAL_SECRET: approvalKey,
      OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED: "true",
    };
    const evidence = await withScopedEnv(ports.env, scope, async () => {
      const store = await ports.store();
      const snapshot = await store?.read(ports.now());
      if (!snapshot)
        refuse(
          "proof_failed",
          "Seeded snapshot is not readable through the canonical store",
        );
      const contentDigest = snapshotContentDigest(snapshot!);
      if (
        contentDigest !== PINNED.contentDigest ||
        snapshot!.sources.assessor?.contentSha256 !== PINNED.fixtureSha256
      )
        refuse(
          "snapshot_digest_mismatch",
          "Stored snapshot does not match the pinned canonical digest",
        );
      const approvedAt = ports.now().toISOString();
      const [candidate] = buildOfficialCalendarCandidates({
        snapshot: snapshot!,
        evaluatedAt: approvedAt,
        townshipLabels: [PINNED.townshipLabel],
        stages: ["assessor"],
        expectedSha256: { assessor: PINNED.fixtureSha256 },
      }).candidates;
      if (
        !candidate ||
        candidate.candidateId !== PINNED.candidateId ||
        candidate.contentHash !== PINNED.candidateContentHash
      )
        refuse(
          "proof_failed",
          "Pinned candidate did not rebuild from the stored snapshot",
        );
      const template = CONTROLLED_COPY_TEMPLATES[PINNED.templateId];
      const approval = {
        candidateId: candidate.candidateId,
        contentHash: candidate.contentHash,
        approvedStatus: candidate.status,
        approvedAt,
        approvedIntents: ["plain_date"],
        templateId: PINNED.templateId,
        templateVersion: template.version,
        templateDefinitionHash: template.definitionHash,
      };
      const sign = (key: string) =>
        createHmac("sha256", key)
          .update(approvalPayload(approval))
          .digest("hex");
      const body = {
        townshipLabel: PINNED.townshipLabel,
        expectedSha256: PINNED.fixtureSha256,
        templateId: PINNED.templateId,
        approval,
        approvalSignature: sign(approvalKey),
      };
      const { approvalSignature: _omit, ...unsigned } = body;
      const wrongCapability = await probe(
        await ports.route(request(newSecret(), body)),
      );
      const unsignedResult = await probe(
        await ports.route(request(capability, unsigned)),
      );
      const forged = await probe(
        await ports.route(
          request(capability, {
            ...body,
            approvalSignature: sign(newSecret()),
          }),
        ),
      );
      const renderedResponse = await ports.route(request(capability, body));
      const cacheControl = renderedResponse.headers.get("cache-control");
      const rendered = await probe(renderedResponse);
      ports.env.OT_OFFICIAL_CALENDAR_PREVIEW_APPROVAL_SECRET = rotatedKey;
      const replay = await probe(await ports.route(request(capability, body)));
      const b = rendered.body;
      const binding =
        b.binding && typeof b.binding === "object"
          ? (b.binding as Record<string, unknown>)
          : null;
      const renderedText =
        typeof b.renderedText === "string" ? b.renderedText : null;
      const result: ProofEvidence = {
        controls: {
          wrongCapability: strip(wrongCapability),
          unsigned: strip(unsignedResult),
          forgedSignature: strip(forged),
          replayAfterKeyRotation: strip(replay),
        },
        rendered: {
          ...strip(rendered),
          cacheControl,
          reviewOnly: b.reviewOnly === true,
          postAllowed: b.postAllowed !== false,
          renderedText,
          renderedTextSha256: renderedText ? sha256(renderedText) : null,
          binding,
        },
        snapshotContentDigest: contentDigest,
        sourceContentSha256: snapshot!.sources.assessor!.contentSha256,
        candidateId: candidate.candidateId,
        candidateContentHash: candidate.contentHash,
      };
      return result;
    });
    // The signed body and every key die with this scope; only outcomes persist.
    assertNoSecrets(JSON.stringify(evidence), [...secrets, ...ephemeral]);
    const { controls, rendered } = evidence;
    const ok =
      controls.wrongCapability.status === 401 &&
      controls.unsigned.status === 403 &&
      controls.forgedSignature.status === 403 &&
      controls.replayAfterKeyRotation.status === 403 &&
      rendered.status === 200 &&
      rendered.verdict === "rendered" &&
      rendered.cacheControl === "private, no-store" &&
      rendered.reviewOnly &&
      !rendered.postAllowed &&
      rendered.renderedText === PINNED.renderedText &&
      rendered.binding?.sourceContentSha256 === PINNED.fixtureSha256 &&
      rendered.binding?.candidateId === PINNED.candidateId &&
      rendered.binding?.candidateContentHash === PINNED.candidateContentHash;
    if (!ok)
      throw new QualificationRefusal(
        "proof_failed",
        "Signed end-to-end consumer proof did not produce the pinned outcome",
        `${rendered.status}:${rendered.reason ?? "none"}`,
      );
    journal.phases.proof = { at: iso(), evidence };
    await persist(journal);
  }

  async function cleanup(journal: Journal): Promise<void> {
    // Once cleanup starts this run never seeds or proves again.
    if (!journal.phases.cleanupStarted) {
      journal.phases.cleanupStarted = { at: iso() };
      await persist(journal);
    }
    let deleted = 0;
    await withDb(async (db) => {
      const { owned } = ownedSplit(await db.rows(OWNED_KEYS), journal);
      if (owned.length)
        deleted = await db.deleteOwned(
          owned,
          journal.phases.seedIntent!.dbClockMs,
        );
    });
    // Absence is proved on a separate connection, never the one that deleted.
    await withDb(async (db) => {
      const remaining = await db.rows(OWNED_KEYS);
      if (remaining.length) {
        const { foreign } = ownedSplit(remaining, journal);
        refuse(
          foreign.length ? "foreign_rows_present" : "cleanup_incomplete",
          foreign.length
            ? "Rows this run did not create remain under the snapshot keys; they were not touched"
            : "Task-created rows remain after cleanup; resume to finish cleanup",
        );
      }
    });
    journal.phases.cleanup = {
      at: iso(),
      deleted: (journal.phases.cleanup?.deleted ?? 0) + deleted,
      absentOnFreshConnection: true,
    };
    await persist(journal);
    await ports.journal.removeTemporary();
  }

  async function defaultOff(journal: Journal): Promise<void> {
    const flagsUnset = FEATURE_ENV.every(
      (name) => ports.env[name] === undefined,
    );
    const response = await probe(
      await ports.route(
        request(newSecret(), {
          townshipLabel: PINNED.townshipLabel,
          expectedSha256: PINNED.fixtureSha256,
        }),
      ),
    );
    const store = await ports.store();
    const rows = await withDb((db) => db.rows(OWNED_KEYS));
    const checks = {
      flagsUnsetInProcess: flagsUnset,
      routeStatus: response.status,
      routeNotFound: response.status === 404 && response.reason === "not_found",
      storeDisabled: store === null,
      snapshotKeysAbsent: rows.length === 0,
    };
    if (
      !checks.flagsUnsetInProcess ||
      !checks.routeNotFound ||
      !checks.storeDisabled ||
      !checks.snapshotKeysAbsent
    )
      refuse(
        "default_off_failed",
        "Route or store did not return to default-off after the run",
      );
    journal.phases.defaultOff = { at: iso(), checks };
    await persist(journal);
  }

  async function finish(journal: Journal): Promise<string> {
    const receipt = canonicalJson({
      schema: "ot.calendar-preview-qualification.receipt.v1",
      harness: HARNESS_VERSION,
      runId,
      mode: target.mode,
      qualificationEvidence: target.mode === "isolated-preview",
      target: {
        projectRef: target.projectRef,
        markerInstanceId: target.markerInstanceId,
        fingerprint: target.fingerprint,
      },
      source: journal.source,
      pinned: {
        fixtureSha256: PINNED.fixtureSha256,
        contentDigest: PINNED.contentDigest,
        candidateId: PINNED.candidateId,
        candidateContentHash: PINNED.candidateContentHash,
        renderedTextSha256: sha256(PINNED.renderedText),
      },
      seedDisclosure:
        "Seeded from pinned fixture bytes, not a live county retrieval; retrievedAt is the seed instant.",
      phases: journal.phases,
      failures: journal.failures,
    });
    assertNoSecrets(receipt, secrets);
    const digest = sha256(receipt);
    await ports.journal.writeReceipt(receipt, digest);
    journal.receiptSha256 = digest;
    await persist(journal);
    return digest;
  }

  const record = (journal: Journal, phase: string, error: unknown) =>
    journal.failures.push({
      at: iso(),
      phase,
      code:
        error instanceof QualificationRefusal
          ? error.detail
            ? `${error.code}:${error.detail}`
            : error.code
          : "unexpected_error",
    });

  /**
   * Run, or resume an interrupted run. Journaled phases are skipped. Any failure
   * after the seed intent is followed by cleanup, so a run ends either passed
   * or cleaned; the first failure is the one rethrown, never masked.
   */
  async function run(): Promise<RunOutcome> {
    const journal = await load();
    if (journal.receiptSha256) {
      ports.log("already complete; no database mutation performed");
      return {
        runId,
        complete: true,
        receiptSha256: journal.receiptSha256,
        phase: "complete",
      };
    }
    let phase = "preflight";
    let primary: unknown = null;
    try {
      if (!journal.phases.cleanupStarted) {
        const facts = await preflight(journal);
        if (!journal.phases.preflight) {
          journal.phases.preflight = { at: iso(), ...facts };
          await persist(journal);
        }
        ports.log("preflight: PASS");
        phase = "seed";
        if (!journal.phases.seeded) await seed(journal);
        ports.log("seed: PASS");
        phase = "proof";
        if (!journal.phases.proof) await prove(journal);
        ports.log("proof: PASS");
      }
    } catch (error) {
      primary = error;
      record(journal, phase, error);
    }
    if (journal.phases.seedIntent && !journal.phases.cleanup) {
      try {
        await cleanup(journal);
        ports.log("cleanup: PASS");
      } catch (error) {
        record(journal, "cleanup", error);
        primary ??= error;
      }
    }
    if (!primary) {
      try {
        phase = "proof";
        if (!journal.phases.proof)
          refuse(
            "proof_failed",
            "This run ended without a passing proof; start a new run",
          );
        phase = "defaultOff";
        await defaultOff(journal);
        ports.log("default-off: PASS");
        phase = "receipt";
        const digest = await finish(journal);
        return {
          runId,
          complete: true,
          receiptSha256: digest,
          phase: "complete",
        };
      } catch (error) {
        primary = error;
        record(journal, phase, error);
      }
    }
    try {
      await persist(journal);
    } catch {
      /* The original refusal is the one worth reporting. */
    }
    throw primary;
  }

  /** Cleanup-only recovery: remove this run's rows, prove absence and default-off. */
  async function recover(): Promise<RunOutcome> {
    const journal = await ports.journal.read();
    if (!journal)
      return refuse(
        "journal_missing",
        "No journal for this run; nothing was changed",
      );
    if (
      journal.runId !== runId ||
      journal.target.fingerprint !== target.fingerprint
    )
      refuse(
        "journal_mismatch",
        "Journal belongs to a different run or target",
      );
    try {
      if (!journal.phases.cleanup) await cleanup(journal);
      await defaultOff(journal);
      await ports.journal.removeTemporary();
    } catch (error) {
      record(journal, "recover", error);
      await persist(journal).catch(() => undefined);
      throw error;
    }
    return {
      runId,
      complete: Boolean(journal.receiptSha256),
      receiptSha256: journal.receiptSha256 ?? null,
      phase: "recovered",
    };
  }

  return { run, recover, preflight: () => preflight(null) };
}
