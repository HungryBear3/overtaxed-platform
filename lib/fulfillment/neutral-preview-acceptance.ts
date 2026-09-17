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
export type AcceptanceClient = Queryable & {
  connect(): Promise<unknown>;
  end(): Promise<void>;
};
export type PreviewMembershipRow = { role:string; member:string; grantor:string; admin_option:boolean; inherit_option:boolean; set_option:boolean };
export type PreviewSetRoleRow = { source: string; target: string };
export type PreviewAuthorityRow = {
  role: string;
  rolcanlogin: boolean;
  rolinherit: boolean;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  owns_database: boolean;
  owned_schemas: number;
  owned_relations: number;
  owned_routines: number;
  owned_types: number;
  owned_other_objects: number;
  database_create: boolean;
  database_temp: boolean;
  direct_database_temp: boolean;
  schema_create: boolean;
};
export type PreviewAclRow = {
  role: string;
  schema: string;
  object: string;
  kind: "relation" | "sequence" | "routine";
  privilege: string;
  table_wide: boolean;
  columns: readonly string[];
  security_definer: boolean;
  public_derived: boolean;
};

const APPROVED_SET_ROLE_EDGES = new Set([
  "ot_preview_app|ot_neutral_app_reader",
  "ot_preview_neutral_runtime|ot_neutral_runtime",
  "ot_preview_neutral_delivery|ot_neutral_delivery_runtime",
]);

export function assertPreviewMembershipGraph(rows: readonly PreviewMembershipRow[]): void {
  const required = new Set([
    "ot_neutral_app_reader|ot_preview_app|postgres|false|true|true",
    "ot_neutral_runtime|ot_preview_neutral_runtime|postgres|false|true|true",
    "ot_neutral_delivery_runtime|ot_preview_neutral_delivery|postgres|false|true|true",
  ]);
  const optionalManaged = new Set([...AUTHORITY_PRINCIPALS].map(
    role => `${role}|postgres|supabase_admin|true|false|false`,
  ));
  for (const row of rows) {
    const key=`${row.role}|${row.member}|${row.grantor}|${row.admin_option}|${row.inherit_option}|${row.set_option}`;
    if (!required.delete(key) && !optionalManaged.delete(key))
      throw new Error("Preview identity membership graph is invalid");
  }
  if (required.size !== 0)
    throw new Error("Preview identity membership graph is incomplete");
}

/** Reject direct or transitive SET ROLE authority beyond the three pinned
 * functional roles.  pg_has_role(..., 'SET') expands the whole membership
 * graph, so an innocuous-looking intermediate role cannot conceal a path to a
 * superuser, database owner, object owner, or other unexpected identity. */
export function assertPreviewSetRoleGraph(rows: readonly PreviewSetRoleRow[]): void {
  const remaining = new Set(APPROVED_SET_ROLE_EDGES);
  for (const row of rows) {
    if (!remaining.delete(`${row.source}|${row.target}`))
      throw new Error("Restricted Preview identity has unexpected SET ROLE authority");
  }
  if (remaining.size !== 0)
    throw new Error("Restricted Preview identity SET ROLE graph is incomplete");
}

const RESTRICTED_LOGINS: ReadonlySet<string> = new Set(ROLES.slice(1));
const AUTHORITY_PRINCIPALS: ReadonlySet<string> = new Set([
  ...ROLES.slice(1),
  "ot_neutral_app_reader",
  "ot_neutral_runtime",
  "ot_neutral_delivery_runtime",
]);
const cols = (...values: string[]) => values.sort().join(",");
const ACL = (role:string, object:string, privilege:string, columns="*") => `${role}|public|relation|${object}|${privilege}|${columns}`;
const BASE_ACLS = new Set([
  ...["ot_neutral_report_reservation","ot_neutral_blob_attempt","ot_neutral_checkout_attempt"].flatMap(o => ["SELECT","INSERT","UPDATE"].map(p => ACL("ot_neutral_runtime",o,p))),
  ...["ot_neutral_runtime_order","ot_neutral_runtime_payment_binding","ot_neutral_runtime_settlement_reversal"].map(o => ACL("ot_neutral_runtime",o,"SELECT")),
  ACL("ot_neutral_runtime","ot_neutral_customer_zip_attempt","SELECT"), ACL("ot_neutral_runtime","ot_neutral_customer_zip_attempt","INSERT",cols("id","reservation_id","zip_sha256","byte_size","storage_locator","status")), ACL("ot_neutral_runtime","ot_neutral_customer_zip_attempt","UPDATE",cols("status","reason_code","observed_at")),
  ACL("ot_neutral_runtime","ot_neutral_qa_review","SELECT"), ACL("ot_neutral_runtime","ot_neutral_qa_review","INSERT",cols("id","reservation_id","order_id","status","reviewer_key","reviewer_week_start","started_at","policy_version","artifact_sha256","evidence_digest_sha256","payment_binding_sha256","property_binding_fingerprint","updated_at")), ACL("ot_neutral_runtime","ot_neutral_qa_review","UPDATE",cols("status","minutes_spent","reason_code","decided_at","fulfillment_id","customer_artifact_sha256","updated_at")),
  ACL("ot_neutral_runtime","ot_neutral_refund_work","SELECT"), ACL("ot_neutral_runtime","ot_neutral_refund_work","INSERT",cols("id","qa_review_id","order_id","status","reason_code","payment_binding_sha256","artifact_sha256","updated_at")), ACL("ot_neutral_runtime","ot_neutral_refund_work","UPDATE",cols("status","claimed_by","claimed_at","provider_attempt_key","provider_receipt_id","provider_receipt_sha256","verification_reason","verified_at","confirmed_by","confirmed_at","updated_at","provider_lookup_attempts","last_provider_lookup_at","last_provider_lookup_result")),
  ACL("ot_neutral_runtime","ot_fulfillment","SELECT",cols("id","order_id","kind","status","attempt_count")), ACL("ot_neutral_runtime","ot_fulfillment","INSERT",cols("id","order_id","kind","status","updated_at")),
  ACL("ot_neutral_runtime","ot_fulfillment_artifact","SELECT",cols("fulfillment_id","version","artifact_sha256","byte_size","storage_locator","generator_version","template_version","source_order_id","property_binding_fingerprint")), ACL("ot_neutral_runtime","ot_fulfillment_artifact","INSERT",cols("id","fulfillment_id","version","artifact_sha256","byte_size","storage_locator","generator_version","template_version","generated_at","source_order_id","property_binding_fingerprint")),
  ...["ot_neutral_report_reservation","ot_neutral_qa_review"].map(o => ACL("ot_neutral_app_reader",o,"SELECT", o.endsWith("reservation") ? cols("id","order_id","status","bundle_sha256","policy_version","property_fingerprint","superseded_by_sha256","customer_zip_sha256","customer_zip_byte_size","customer_zip_locator","customer_zip_media_type","customer_zip_filename") : cols("reservation_id","order_id","status","policy_version","artifact_sha256","customer_artifact_sha256","property_binding_fingerprint","fulfillment_id"))),
  ...["ot_fulfillment_kind_authority","ot_packet_capability_kind_authority"].map(o => ACL("ot_neutral_app_reader",o,"SELECT")),
  ACL("ot_neutral_delivery_runtime","ot_fulfillment","SELECT",cols("id","order_id","kind","status","status_revision","attempt_count")), ACL("ot_neutral_delivery_runtime","ot_fulfillment_artifact","SELECT",cols("id","fulfillment_id","version","artifact_sha256","byte_size","storage_locator","template_version","source_order_id","property_binding_fingerprint")), ACL("ot_neutral_delivery_runtime","ot_delivery_attempt","SELECT",cols("fulfillment_id","attempt_number","provider","idempotency_key","download_capability_id")), ACL("ot_neutral_delivery_runtime","ot_delivery_attempt","UPDATE",cols("download_capability_id")), ACL("ot_neutral_delivery_runtime","ot_packet_download_capability","SELECT",cols("id","capability_hash","fulfillment_id","artifact_id","artifact_version","artifact_sha256","source_order_id","property_binding_fingerprint","expires_at","max_uses","use_count","revoked_at")), ACL("ot_neutral_delivery_runtime","ot_packet_download_capability","INSERT",cols("id","capability_hash","fulfillment_id","artifact_id","artifact_version","artifact_sha256","source_order_id","property_binding_fingerprint","issued_at","expires_at","max_uses","use_count")), ACL("ot_neutral_delivery_runtime","ot_packet_download_capability","UPDATE",cols("use_count","last_used_at","revoked_at","revoked_reason_code")),
  ACL("ot_neutral_delivery_runtime","ot_neutral_report_reservation","SELECT",cols("id","order_id","status","bundle_sha256","policy_version","property_fingerprint","superseded_by_sha256")), ACL("ot_neutral_delivery_runtime","ot_neutral_qa_review","SELECT",cols("reservation_id","order_id","status","policy_version","artifact_sha256","customer_artifact_sha256","property_binding_fingerprint","fulfillment_id")), ACL("ot_neutral_delivery_runtime","ot_neutral_delivery_order","SELECT"),
]);

/** No restricted login or reachable functional role may own database objects
 * or carry ambient creation authority. There is intentionally no ownership
 * allowlist: these principals consume narrowly granted objects but own none. */
export function assertPreviewAuthority(rows: readonly PreviewAuthorityRow[]): void {
  const remaining = new Set(AUTHORITY_PRINCIPALS);
  for (const row of rows) {
    if (!remaining.delete(row.role))
      throw new Error("Preview authority inventory contains an unexpected identity");
    const login = RESTRICTED_LOGINS.has(row.role);
    if (
      row.rolcanlogin !== login ||
      row.rolinherit !== login ||
      row.rolsuper || row.rolcreaterole || row.rolcreatedb ||
      row.rolreplication || row.rolbypassrls ||
      row.owns_database || row.owned_schemas !== 0 ||
      row.owned_relations !== 0 || row.owned_routines !== 0 ||
      row.owned_types !== 0 || row.owned_other_objects !== 0 ||
      row.database_create || row.direct_database_temp || row.schema_create
    ) throw new Error("Restricted Preview authority or ownership invariant is invalid");
  }
  if (remaining.size !== 0)
    throw new Error("Preview authority inventory is incomplete");
}

/** Effective privileges include direct, inherited, and PUBLIC-derived grants.
 * The allowlist is deliberately operation-scoped and contains no sequences or
 * routines. SECURITY DEFINER execution is therefore impossible by contract. */
export function assertPreviewEffectiveAcls(rows: readonly PreviewAclRow[]): void {
  const expected = new Set(expectedPreviewAclRows().map(aclKey));
  const unexpected: string[] = [];
  for (const row of rows) {
    if (row.kind === "routine") {
      if (row.security_definer)
        unexpected.push(`${aclKey(row)}|security-definer`);
      continue;
    }
    const key = aclKey(row);
    if (row.public_derived) unexpected.push(`${key}|PUBLIC-derived`);
    else if (!expected.delete(key)) unexpected.push(key);
  }
  if (unexpected.length || expected.size) {
    const details = [
      unexpected.length ? `unexpected=${unexpected.slice(0, 12).join(",")}` : "",
      expected.size ? `missing=${[...expected].slice(0, 12).join(",")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`Restricted Preview effective ACL inventory is invalid or incomplete: ${details}`);
  }
}

function aclKey(row: PreviewAclRow): string {
  const scope=row.table_wide ? "*" : cols(...row.columns);
  return `${row.role}|${row.schema}|${row.kind}|${row.object}|${row.privilege}|${scope}`;
}

export function expectedPreviewAclRows(): PreviewAclRow[] {
  const authorityRole: Readonly<Record<string, string>> = {
    ot_preview_app: "ot_neutral_app_reader",
    ot_preview_neutral_runtime: "ot_neutral_runtime",
    ot_preview_neutral_delivery: "ot_neutral_delivery_runtime",
  };
  const rows: PreviewAclRow[]=[];
  for (const role of AUTHORITY_PRINCIPALS) {
    const baseRole=authorityRole[role] ?? role;
    for (const item of BASE_ACLS) {
      if (!item.startsWith(`${baseRole}|`)) continue;
      const [,schema,kind,object,privilege,scope]=item.split("|");
      rows.push({role,schema: schema!,kind:kind as "relation",object:object!,privilege:privilege!,table_wide:scope==="*",columns:scope==="*"?[]:scope!.split(","),security_definer:false,public_derived:false});
    }
  }
  return rows;
}

export const PREVIEW_EFFECTIVE_ACL_SQL = `with principals as (select oid,rolname from pg_roles where rolname=any($1::text[])),
 relations as (select c.oid,n.nspname schema,c.relname,c.relkind,c.relacl,c.relowner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname<>'information_schema' and n.nspname<>'pg_catalog' and n.nspname!~'^pg_(toast|temp)' and c.relkind=any(array['r','p','v','m','f','S']::"char"[])),
 candidates as (select p.oid principal_oid,p.rolname role,r.*,v.privilege from principals p cross join relations r cross join lateral (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('USAGE')) v(privilege)),
 relation_privileges as (select c.role,c.schema,c.relname object,case when c.relkind='S' then 'sequence' else 'relation' end kind,c.privilege,
   case when c.relkind='S' then case when c.privilege in ('SELECT','UPDATE','USAGE') then has_sequence_privilege(c.principal_oid,c.oid,c.privilege) else false end else case when c.privilege<>'USAGE' then has_table_privilege(c.principal_oid,c.oid,c.privilege) else false end end table_wide,
   case when c.relkind='S' or c.privilege not in ('SELECT','INSERT','UPDATE','REFERENCES') then array[]::text[] else coalesce((select array_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and has_column_privilege(c.principal_oid,c.oid,a.attnum,c.privilege)),array[]::text[]) end columns,
   coalesce((select bool_or(a.grantee=0 and a.privilege_type=c.privilege) from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a),false) or coalesce((select bool_or(x.grantee=0 and x.privilege_type=c.privilege) from pg_attribute aa cross join lateral aclexplode(case when cardinality(aa.attacl)>0 then aa.attacl end) x where aa.attrelid=c.oid),false) public_derived
   from candidates c where case when c.relkind='S' then case when c.privilege in ('SELECT','UPDATE','USAGE') then has_sequence_privilege(c.principal_oid,c.oid,c.privilege) else false end else case when c.privilege<>'USAGE' then has_table_privilege(c.principal_oid,c.oid,c.privilege) or (c.privilege in ('SELECT','INSERT','UPDATE','REFERENCES') and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and has_column_privilege(c.principal_oid,c.oid,a.attnum,c.privilege))) else false end end),
 routines as (select p.rolname role,n.nspname schema,format('%I(%s)',x.proname,pg_get_function_identity_arguments(x.oid)) object,'routine' kind,'EXECUTE' privilege,false table_wide,array[]::text[] columns,x.prosecdef security_definer,coalesce((select bool_or(a.grantee=0 and a.privilege_type='EXECUTE') from aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) a),false) public_derived from principals p cross join pg_proc x join pg_namespace n on n.oid=x.pronamespace where (x.prosecdef or n.nspname~'^(ot|private)' or x.proname~'^ot_') and has_function_privilege(p.oid,x.oid,'EXECUTE'))
 select role,schema,object,kind,privilege,table_wide,to_json(columns) columns,false security_definer,public_derived from relation_privileges
 union all select role,schema,object,kind,privilege,table_wide,to_json(columns) columns,security_definer,public_derived from routines order by 1,2,3,4,5`;

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
  const approvedDirectTarget =
    config.host === `db.${OT_PREVIEW_PROJECT_REF}.supabase.co` || pooler;
  const expectedUser = pooler
    ? `${expectedRole}.${OT_PREVIEW_PROJECT_REF}`
    : expectedRole;
  if (
    (direct && !approvedDirectTarget) ||
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
    const setRoleReachability = await clients[0]!.query(
      `select source.rolname source,target.rolname target from pg_roles source cross join pg_roles target where source.rolname=any($1::text[]) and target.rolname<>source.rolname and pg_has_role(source.oid,target.oid,'SET') order by 1,2`,
      [[...ROLES.slice(1)]],
    );
    assertPreviewSetRoleGraph(setRoleReachability.rows as PreviewSetRoleRow[]);
    const authority = await clients[0]!.query(
      `select r.rolname role,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
        d.datdba=r.oid owns_database,
        (select count(*)::int from pg_namespace n where n.nspowner=r.oid and n.nspname<>'information_schema' and n.nspname<>'pg_catalog' and n.nspname!~'^pg_(toast|temp)') owned_schemas,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relowner=r.oid and c.relkind=any(array['r','p','v','m','S','f','i','I']::"char"[]) and n.nspname<>'information_schema' and n.nspname<>'pg_catalog' and n.nspname!~'^pg_(toast|temp)') owned_relations,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proowner=r.oid and n.nspname<>'information_schema' and n.nspname<>'pg_catalog' and n.nspname!~'^pg_(toast|temp)') owned_routines,
        (select count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typowner=r.oid and n.nspname<>'information_schema' and n.nspname<>'pg_catalog' and n.nspname!~'^pg_(toast|temp)') owned_types,
        ((select count(*) from pg_collation x join pg_namespace n on n.oid=x.collnamespace where x.collowner=r.oid and n.nspname!~'^pg_' and n.nspname<>'information_schema')+
         (select count(*) from pg_conversion x join pg_namespace n on n.oid=x.connamespace where x.conowner=r.oid and n.nspname!~'^pg_' and n.nspname<>'information_schema')+
         (select count(*) from pg_operator x join pg_namespace n on n.oid=x.oprnamespace where x.oprowner=r.oid and n.nspname!~'^pg_' and n.nspname<>'information_schema')+
         (select count(*) from pg_opclass x join pg_namespace n on n.oid=x.opcnamespace where x.opcowner=r.oid and n.nspname!~'^pg_' and n.nspname<>'information_schema')+
         (select count(*) from pg_opfamily x join pg_namespace n on n.oid=x.opfnamespace where x.opfowner=r.oid and n.nspname!~'^pg_' and n.nspname<>'information_schema')+
         (select count(*) from pg_ts_config x join pg_namespace n on n.oid=x.cfgnamespace where x.cfgowner=r.oid and n.nspname!~'^pg_' and n.nspname<>'information_schema')+
         (select count(*) from pg_ts_dict x join pg_namespace n on n.oid=x.dictnamespace where x.dictowner=r.oid and n.nspname!~'^pg_' and n.nspname<>'information_schema'))::int owned_other_objects,
        has_database_privilege(r.oid,d.oid,'CREATE') database_create,
        has_database_privilege(r.oid,d.oid,'TEMP') database_temp,
        coalesce((select bool_or(a.grantee=r.oid and a.privilege_type='TEMPORARY') from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a),false) direct_database_temp,
        exists(select 1 from pg_namespace n where n.nspname<>'information_schema' and n.nspname<>'pg_catalog' and n.nspname!~'^pg_(toast|temp)' and has_schema_privilege(r.oid,n.oid,'CREATE')) schema_create
       from pg_roles r cross join pg_database d
       where d.datname=current_database() and r.rolname=any($1::text[]) order by 1`,
      [[...AUTHORITY_PRINCIPALS]],
    );
    assertPreviewAuthority(authority.rows as PreviewAuthorityRow[]);
    const effectiveAcls = await clients[0]!.query(PREVIEW_EFFECTIVE_ACL_SQL, [[...AUTHORITY_PRINCIPALS]]);
    assertPreviewEffectiveAcls(effectiveAcls.rows as PreviewAclRow[]);
    const app = appSecurity.rows[0];
    const runtime = runtimeSecurity.rows[0];
    const delivery = deliverySecurity.rows[0];
    const invariants: ReadonlyArray<readonly [string, boolean]> = [
      ["app-no-schema-create", app?.can_create === false],
      ["app-reader-member", app?.reader_member === true],
      ["app-owns-zero", app?.owned_objects === 0],
      ["runtime-forced-rls", runtime?.forced_rls === true],
      ["runtime-no-excessive", runtime?.excessive === false],
      ["runtime-no-schema-create", runtime?.can_create === false],
      ["runtime-member", runtime?.expected_member === true],
      ["runtime-owns-none", runtime?.owns_scoped === false],
      ["delivery-forced-rls", delivery?.forced_rls === true],
      ["delivery-no-excessive", delivery?.excessive === false],
      ["delivery-no-schema-create", delivery?.can_create === false],
      ["delivery-member", delivery?.expected_member === true],
      ["delivery-owns-none", delivery?.owns_scoped === false],
    ];
    const failed = invariants.filter(([, valid]) => !valid).map(([name]) => name);
    if (failed.length)
      throw new Error(`Restricted-role/RLS Preview invariants are invalid: ${failed.join(",")}`);
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

/** Coordinate two physically separate connections while preserving every
 * failure. The verifier is always attempted after owner connection, BEGIN,
 * journey, or rollback failure; it never reuses the possibly poisoned owner. */
export async function runAcceptanceWithFreshVerifier(
  owner: AcceptanceClient,
  verifier: AcceptanceClient,
  runId: string,
  journey: (db: Queryable, runId: string) => Promise<PreviewAcceptanceEvidence>,
  absence: (db: Queryable, runId: string, evidence?: PreviewAcceptanceEvidence) => Promise<void>,
): Promise<void> {
  const failures: unknown[] = [];
  let evidence: PreviewAcceptanceEvidence | undefined;
  try {
    await owner.connect();
    evidence = await journey(owner, runId);
  } catch (error) {
    failures.push(error);
    evidence = error && typeof error === "object" && "acceptanceEvidence" in error
      ? (error as { acceptanceEvidence?: PreviewAcceptanceEvidence }).acceptanceEvidence
      : undefined;
  } finally {
    try { await owner.end(); } catch (error) { failures.push(error); }
  }
  try {
    await verifier.connect();
    await absence(verifier, runId, evidence);
  } catch (error) {
    failures.push(error);
  } finally {
    try { await verifier.end(); } catch (error) { failures.push(error); }
  }
  if (failures.length)
    throw new AggregateError(failures, "Preview acceptance journey or cleanup proof failed");
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
