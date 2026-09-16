import { randomUUID } from "node:crypto";
import { Client, type QueryResult } from "pg";
import { parse } from "pg-connection-string";
import { assertSameNeutralPreviewDatabase } from "./neutral-preview-database-marker";

export const OT_PREVIEW_PROJECT_REF = "iyaxdrehtxsfkaexgxls";
const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const RUN_ID = new RegExp(`^ot-accept-${UUID_V4}$`);
const ROUTING_KEYS = new Set([
  "host",
  "hostaddr",
  "port",
  "dbname",
  "database",
  "user",
  "username",
]);
const ALLOWED_URL_OPTIONS = new Set(["sslmode"]);
const APPROVED_POOLER_HOSTS = new Set([
  "aws-0-us-east-2.pooler.supabase.com",
  "aws-1-us-east-2.pooler.supabase.com",
]);
const ROLES = [
  "postgres",
  "ot_preview_app",
  "ot_preview_neutral_runtime",
  "ot_preview_neutral_delivery",
] as const;
/**
 * Every relation the runner writes that carries a run-scoped key, paired with
 * the column that carries it. Rows whose primary key a production helper
 * generated are proved absent by exact identity instead (see [[PROBE_TARGETS]]).
 */
export const ACCEPTANCE_SCOPES = [
  ["ot_order", "id"],
  ["ot_payment_binding", "order_id"],
  ["ot_settlement_reversal", "event_id"],
  ["ot_neutral_report_reservation", "order_id"],
  ["ot_neutral_qa_review", "order_id"],
  ["ot_neutral_customer_zip_attempt", "reservation_id"],
  ["ot_neutral_refund_work", "order_id"],
  ["ot_fulfillment", "order_id"],
  ["ot_fulfillment_artifact", "source_order_id"],
  ["ot_packet_download_capability", "source_order_id"],
] as const satisfies ReadonlyArray<readonly [string, string]>;
export const ACCEPTANCE_TABLES = ACCEPTANCE_SCOPES.map(([table]) => table);
/**
 * Rows this run created whose primary keys the helpers generated themselves.
 *
 * A `LIKE '<runId>-%'` sweep cannot see them — `promoteApprovedNeutralCustomerZip`
 * and `persistAttempt` mint UUIDs — so the absence proof needs their exact
 * identities. Recording them is what makes "nothing survived" a statement about
 * the rows that actually existed rather than about a naming convention.
 */
export type AcceptanceIdKind =
  | "reservation"
  | "qaReview"
  | "refundWork"
  | "fulfillment"
  | "artifact"
  | "capability";

export const PROBE_TARGETS: Readonly<
  Record<AcceptanceIdKind, ReadonlyArray<readonly [string, string]>>
> = {
  reservation: [
    ["ot_neutral_report_reservation", "id"],
    ["ot_neutral_customer_zip_attempt", "reservation_id"],
    ["ot_neutral_qa_review", "reservation_id"],
    ["ot_neutral_blob_attempt", "reservation_id"],
  ],
  qaReview: [
    ["ot_neutral_qa_review", "id"],
    ["ot_neutral_refund_work", "qa_review_id"],
  ],
  refundWork: [["ot_neutral_refund_work", "id"]],
  fulfillment: [
    ["ot_fulfillment", "id"],
    ["ot_fulfillment_artifact", "fulfillment_id"],
    ["ot_delivery_attempt", "fulfillment_id"],
    ["ot_delivery_event", "fulfillment_id"],
    ["ot_packet_download_capability", "fulfillment_id"],
    ["ot_neutral_qa_review", "fulfillment_id"],
  ],
  artifact: [
    ["ot_fulfillment_artifact", "id"],
    ["ot_packet_download_capability", "artifact_id"],
  ],
  capability: [
    ["ot_packet_download_capability", "id"],
    ["ot_delivery_attempt", "download_capability_id"],
  ],
};

const PROBE_COLUMNS: ReadonlySet<string> = new Set(
  Object.values(PROBE_TARGETS).flatMap((targets) =>
    targets.map(([table, column]) => `${table}.${column}`),
  ),
);

export type AcceptanceRowProbe = {
  table: string;
  column: string;
  values: readonly string[];
};
export type PreviewAcceptanceEvidence = {
  runId: string;
  probes: readonly AcceptanceRowProbe[];
};

export type PreviewAcceptanceUrls = {
  direct: string;
  app: string;
  runtime: string;
  delivery: string;
};
export type Queryable = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};
export type PreviewMembershipRow = { role:string; member:string; grantor:string; admin_option:boolean; inherit_option:boolean; set_option:boolean };

export function assertPreviewMembershipGraph(rows: readonly PreviewMembershipRow[]): void {
  const expected = new Set([
    "ot_neutral_app_reader|ot_preview_app|postgres|false|true|true",
    "ot_neutral_runtime|ot_preview_neutral_runtime|postgres|false|true|true",
    "ot_neutral_delivery_runtime|ot_preview_neutral_delivery|postgres|false|true|true",
    ...ROLES.slice(1).map(role => `${role}|postgres|supabase_admin|true|false|false`),
  ]);
  for (const row of rows) {
    const key=`${row.role}|${row.member}|${row.grantor}|${row.admin_option}|${row.inherit_option}|${row.set_option}`;
    if (!expected.delete(key)) throw new Error("Preview identity membership graph is invalid");
  }
  if ([...expected].some(key => key.startsWith("ot_neutral_")))
    throw new Error("Preview identity membership graph is incomplete");
}

export function createPreviewAcceptanceRunId(): string {
  return `ot-accept-${randomUUID()}`;
}
export function assertPreviewAcceptanceRunId(value: string): string {
  if (!RUN_ID.test(value))
    throw new Error(
      "Synthetic acceptance run ID must contain an internal UUID v4",
    );
  return value;
}

export function readPreviewAcceptanceConfig(
  env: Record<string, string | undefined>,
): { urls: PreviewAcceptanceUrls; markerInstanceId: string } {
  if (env.OT_NEUTRAL_PREVIEW_PROJECT_REF?.trim() !== OT_PREVIEW_PROJECT_REF)
    throw new Error("Exact isolated Preview project identity is required");
  const markerInstanceId = env.OT_NEUTRAL_PREVIEW_MARKER_INSTANCE_ID?.trim();
  if (!markerInstanceId)
    throw new Error("Expected durable Preview marker instance ID is required");
  const urls = {
    direct: env.DIRECT_URL?.trim(),
    app: env.DATABASE_URL?.trim(),
    runtime: env.OT_NEUTRAL_DATABASE_URL?.trim(),
    delivery: env.OT_NEUTRAL_DELIVERY_DATABASE_URL?.trim(),
  };
  if (Object.values(urls).some((value) => !value))
    throw new Error("All four protected Preview database URLs are required");
  if (new Set(Object.values(urls)).size !== 4)
    throw new Error(
      "All four protected Preview database URLs must be distinct",
    );
  Object.entries(urls).forEach(([kind, raw], index) =>
    assertUrlIdentity(raw!, ROLES[index]!, kind === "direct"),
  );
  return { urls: urls as PreviewAcceptanceUrls, markerInstanceId };
}

function assertUrlIdentity(
  raw: string,
  expectedRole: string,
  direct: boolean,
): void {
  const url = new URL(raw);
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (seen.has(normalized))
      throw new Error("Duplicate database URL option is forbidden");
    seen.add(normalized);
  }
  for (const normalized of seen) {
    if (ROUTING_KEYS.has(normalized))
      throw new Error("Database URL routing overrides are forbidden");
    if (!ALLOWED_URL_OPTIONS.has(normalized))
      throw new Error("Unknown database URL option is forbidden");
  }
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode !== "verify-full")
    throw new Error(
      "Hosted Preview database URLs require secure TLS semantics",
    );
  const config = parse(raw);
  if (typeof config.sslmode !== "string" || config.sslmode.toLowerCase() !== "verify-full" || config.ssl === false)
    throw new Error("Parsed database URL TLS semantics are not verify-full");
  const pooler = typeof config.host === "string" && APPROVED_POOLER_HOSTS.has(config.host);
  const expectedUser = pooler
    ? `${expectedRole}.${OT_PREVIEW_PROJECT_REF}`
    : expectedRole;
  if (
    (direct && config.host !== `db.${OT_PREVIEW_PROJECT_REF}.supabase.co`) ||
    (!direct && !pooler) ||
    config.database !== "postgres" ||
    Number(config.port ?? 5432) !== 5432 ||
    config.user !== expectedUser
  )
    throw new Error(
      "Database URL does not resolve to the exact approved Preview identity",
    );
}

export async function provePreviewAcceptanceIdentity(
  urls: PreviewAcceptanceUrls,
  markerId: string,
): Promise<void> {
  const clients = Object.values(urls).map(
    (connectionString) => new Client({ connectionString }),
  );
  try {
    await Promise.all(clients.map((client) => client.connect()));
    const results = await Promise.all(
      clients.map((client) =>
        client.query(
          `select current_user role,session_user "sessionRole",current_database() as "databaseName",shobj_description(d.oid,'pg_database') marker,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()`,
        ),
      ),
    );
    const marker = assertSameNeutralPreviewDatabase(
      results.map((result) => result.rows[0]),
    );
    if (marker.instanceId !== markerId)
      throw new Error(
        "Durable Preview marker does not match the approved instance",
      );
    results.forEach((result, index) => {
      const role = result.rows[0];
      if (role?.role !== ROLES[index] || role?.sessionRole !== ROLES[index])
        throw new Error(
          "Connected database role does not match its ordered approved identity",
        );
      if (!role.rolcanlogin || !role.rolinherit)
        throw new Error("Preview identity role attributes are invalid");
      if (index && (role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.rolreplication || role.rolbypassrls))
        throw new Error("Restricted Preview identity has elevated authority");
    });
    const [appSecurity, runtimeSecurity, deliverySecurity] = await Promise.all([
      clients[1]!.query(
        `select has_schema_privilege(current_user,'public','CREATE') can_create,pg_has_role(current_user,'ot_neutral_app_reader','member') reader_member,(select count(*)::int from pg_class where relnamespace='public'::regnamespace and relowner=(select oid from pg_roles where rolname=current_user)) owned_objects`,
      ),
      clients[2]!.query(
        `select bool_and(c.relrowsecurity and c.relforcerowsecurity) forced_rls,bool_or(has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER')) excessive,has_schema_privilege(current_user,'public','CREATE') can_create,pg_has_role(current_user,'ot_neutral_runtime','member') expected_member,bool_or(c.relowner=(select oid from pg_roles where rolname=current_user)) owns_scoped from pg_class c where c.oid in ('ot_neutral_report_reservation'::regclass,'ot_neutral_qa_review'::regclass,'ot_neutral_customer_zip_attempt'::regclass,'ot_neutral_refund_work'::regclass)`,
      ),
      clients[3]!.query(
        `select c.relrowsecurity and c.relforcerowsecurity forced_rls,has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') excessive,has_schema_privilege(current_user,'public','CREATE') can_create,pg_has_role(current_user,'ot_neutral_delivery_runtime','member') expected_member,c.relowner=(select oid from pg_roles where rolname=current_user) owns_scoped from pg_class c where c.oid='ot_packet_download_capability'::regclass`,
      ),
    ]);
    const membership = await clients[0]!.query(
      `select role.rolname role,member.rolname member,grantor.rolname grantor,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles role on role.oid=m.roleid join pg_roles member on member.oid=m.member join pg_roles grantor on grantor.oid=m.grantor where role.rolname=any($1::text[]) or member.rolname=any($1::text[]) order by 1,2,3`,
      [[...ROLES.slice(1),"ot_neutral_app_reader","ot_neutral_runtime","ot_neutral_delivery_runtime"]],
    );
    assertPreviewMembershipGraph(membership.rows as PreviewMembershipRow[]);
    if (
      appSecurity.rows[0]?.can_create ||
      !appSecurity.rows[0]?.reader_member ||
      appSecurity.rows[0]?.owned_objects !== 0 ||
      !runtimeSecurity.rows[0]?.forced_rls ||
      runtimeSecurity.rows[0]?.excessive ||
      runtimeSecurity.rows[0]?.can_create ||
      !runtimeSecurity.rows[0]?.expected_member ||
      runtimeSecurity.rows[0]?.owns_scoped ||
      !deliverySecurity.rows[0]?.forced_rls ||
      deliverySecurity.rows[0]?.excessive ||
      deliverySecurity.rows[0]?.can_create ||
      !deliverySecurity.rows[0]?.expected_member ||
      deliverySecurity.rows[0]?.owns_scoped
    )
      throw new Error("Restricted-role/RLS Preview invariants are invalid");
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
  }
}

/**
 * Prove on a FRESH connection that the run left nothing behind.
 *
 * Two mechanisms, because one is not enough: a `LIKE` sweep over every
 * run-scoped key the runner chose, and an exact-identity probe for every row a
 * helper keyed with its own generated UUID.
 */
export async function proveAcceptanceAbsence(
  db: Queryable,
  runId: string,
  evidence?: PreviewAcceptanceEvidence,
): Promise<void> {
  assertPreviewAcceptanceRunId(runId);
  if (evidence && evidence.runId !== runId)
    throw new Error("Absence evidence belongs to a different acceptance run");
  const pattern = `${runId}-%`;
  for (const [table, column] of ACCEPTANCE_SCOPES) {
    const result = await db.query(
      `select count(*)::int count from ${table} where ${column} like $1`,
      [pattern],
    );
    if (result.rows[0]?.count !== 0)
      throw new Error(`Synthetic rollback absence proof failed for ${table}`);
  }
  for (const probe of evidence?.probes ?? []) {
    if (!PROBE_COLUMNS.has(`${probe.table}.${probe.column}`))
      throw new Error("Absence evidence names a relation this runner never writes");
    if (probe.values.length === 0) continue;
    const result = await db.query(
      `select count(*)::int count from ${probe.table} where ${probe.column} = any($1::text[])`,
      [[...probe.values]],
    );
    if (result.rows[0]?.count !== 0)
      throw new Error(
        `Synthetic rollback absence proof failed for ${probe.table}.${probe.column}`,
      );
  }
}

export function redactAcceptanceError(
  error: unknown,
  secrets: readonly string[],
): string {
  const seen = new Set<object>();
  const messages: string[] = [];
  const visit = (value: unknown, label?: string): void => {
    if (value && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
    }
    const message = value instanceof Error ? value.message : String(value);
    messages.push(label ? `${label}: ${message}` : message);
    if (value instanceof AggregateError)
      for (const nested of value.errors) visit(nested, "nested");
    if (value instanceof Error && value.cause !== undefined)
      visit(value.cause, "cause");
  };
  visit(error);
  let message = messages.join("\n").replace(
    /postgres(?:ql)?:\/\/[^\s]+/gi,
    "[REDACTED_DATABASE_URL]",
  );
  const variants = new Set<string>();
  for (const secret of secrets.filter(Boolean)) {
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
    try {
      const u = new URL(secret);
      for (const [kind, v] of [["username", u.username], ["password", u.password]] as const) {
        const decoded = decodeURIComponent(v);
        // Very short login names can occur in ordinary prose. Passwords are
        // always secrets regardless of length; usernames below four characters
        // rely on complete-URL redaction to avoid destroying the diagnostic.
        if (kind === "password" || decoded.length >= 4) {
          variants.add(v);
          variants.add(decoded);
          variants.add(encodeURIComponent(decoded));
        }
      }
    } catch {
      try { variants.add(decodeURIComponent(secret)); } catch { variants.add(secret); }
    }
  }
  for (const value of [...variants]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    message = message.split(value).join("[REDACTED]");
  return message;
}

// Keep the public acceptance entrypoint stable while the behavioral journey
// lives beside the runtime adapters it exercises.
export {
  applyAcceptanceFlags,
  loadAcceptanceRuntime,
  runTransactionalAcceptance,
  type AcceptanceRuntime,
} from "@/lib/fulfillment-runtime/neutral-preview-acceptance-runner";
