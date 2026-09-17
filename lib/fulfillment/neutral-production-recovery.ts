import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const OT_PRODUCTION_RECOVERY_SCHEMA =
  "ot.neutral-production-recovery.v1" as const;
export const OT_PRODUCTION_RESTORE_SCHEMA =
  "ot.neutral-production-restore-rehearsal.v1" as const;
export const OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA =
  "ot.neutral-production-rehearsal-sentinel.v1" as const;
export const OT_PRODUCTION_RECOVERY_RECEIPT_VAR =
  "OT_NEUTRAL_PRODUCTION_RECOVERY_RECEIPT" as const;
export const OT_PRODUCTION_RECOVERY_AUTH_KEY_VAR =
  "OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY" as const;
export const OT_PRODUCTION_RECOVERY_PASSPHRASE_VAR =
  "OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE" as const;
export const OT_PRODUCTION_RECOVERY_MAX_AGE_MINUTES = 60;

export const OT_PRODUCTION_RECOVERY_RELEVANT_ROLES = [
  "postgres",
  "anon",
  "authenticated",
  "service_role",
  "ot_prod_app",
  "ot_prod_neutral_runtime",
  "ot_prod_neutral_delivery",
  "ot_commerce_capture_owner",
  "ot_neutral_app_reader",
  "ot_neutral_delivery_runtime",
  "ot_neutral_reversal_guard_owner",
  "ot_neutral_runtime",
] as const;

export const OT_PRODUCTION_RECOVERY_CATALOG_SQL = `
with role_rows as (
  select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
         rolreplication, rolbypassrls, rolconnlimit,
         coalesce(rolvaliduntil::text,'') valid_until
  from pg_roles where rolname = any($1::text[]) order by rolname
), membership_rows as (
  select granted.rolname granted_role, member.rolname member_role,
         grantor.rolname grantor_role, m.admin_option, m.inherit_option, m.set_option
  from pg_auth_members m
  join pg_roles granted on granted.oid=m.roleid
  join pg_roles member on member.oid=m.member
  join pg_roles grantor on grantor.oid=m.grantor
  where granted.rolname = any($1::text[]) or member.rolname = any($1::text[])
  order by 1,2,3
), default_acl_rows as (
  select owner.rolname owner_role, coalesce(n.nspname,'') schema_name,
         d.defaclobjtype object_type, coalesce(d.defaclacl::text,'') acl
  from pg_default_acl d join pg_roles owner on owner.oid=d.defaclrole
  left join pg_namespace n on n.oid=d.defaclnamespace
  where owner.rolname = any($1::text[]) order by 1,2,3,4
), relation_rows as (
  select c.relname, c.relkind, pg_get_userbyid(c.relowner) owner_role,
         coalesce(c.relacl::text,'') acl, c.relrowsecurity, c.relforcerowsecurity,
         coalesce(array_to_string(c.reloptions,','),'') options
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','S','f') order by 1,2
), column_acl_rows as (
  select c.relname, a.attname, a.attnotnull, coalesce(a.attacl::text,'') acl
  from pg_attribute a join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and a.attnum>0 and not a.attisdropped
  order by 1,2
), policy_rows as (
  select schemaname, tablename, policyname, permissive, roles, cmd,
         coalesce(qual,'') qual, coalesce(with_check,'') with_check
  from pg_policies where schemaname='public' order by 2,3
), function_rows as (
  select p.oid::regprocedure::text identity, pg_get_userbyid(p.proowner) owner_role,
         coalesce(p.proacl::text,'') acl, p.prosecdef,
         coalesce(array_to_string(p.proconfig,','),'') config,
         pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' order by 1
), trigger_rows as (
  select c.relname, t.tgname, pg_get_triggerdef(t.oid,true) definition,
         t.tgenabled
  from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal order by 1,2
), constraint_rows as (
  select c.relname, x.conname, x.contype, pg_get_constraintdef(x.oid,true) definition
  from pg_constraint x join pg_class c on c.oid=x.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and x.contype <> 'n' order by 1,2
), type_rows as (
  select t.typname, t.typtype, pg_get_userbyid(t.typowner) owner_role,
         coalesce(t.typacl::text,'') acl,
         coalesce((select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'[]'::jsonb) enum_labels
  from pg_type t join pg_namespace n on n.oid=t.typnamespace
  where n.nspname='public' and (t.typtype='e' or t.typrelid=0) order by 1
), extension_rows as (
  select e.extname, e.extversion, n.nspname schema_name
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1
)
select jsonb_build_object(
  'public_schema_owner', pg_get_userbyid(n.nspowner),
  'public_schema_acl', coalesce(n.nspacl::text,''),
  'roles', coalesce((select jsonb_agg(to_jsonb(role_rows) order by rolname) from role_rows),'[]'::jsonb),
  'memberships', coalesce((select jsonb_agg(to_jsonb(membership_rows) order by granted_role,member_role,grantor_role) from membership_rows),'[]'::jsonb),
  'default_acls', coalesce((select jsonb_agg(to_jsonb(default_acl_rows) order by owner_role,schema_name,object_type,acl) from default_acl_rows),'[]'::jsonb),
  'relations', coalesce((select jsonb_agg(to_jsonb(relation_rows) order by relname,relkind) from relation_rows),'[]'::jsonb),
  'column_acls', coalesce((select jsonb_agg(to_jsonb(column_acl_rows) order by relname,attname) from column_acl_rows),'[]'::jsonb),
  'policies', coalesce((select jsonb_agg(to_jsonb(policy_rows) order by tablename,policyname) from policy_rows),'[]'::jsonb),
  'functions', coalesce((select jsonb_agg(to_jsonb(function_rows) order by identity) from function_rows),'[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(to_jsonb(trigger_rows) order by relname,tgname) from trigger_rows),'[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(to_jsonb(constraint_rows) order by relname,conname) from constraint_rows),'[]'::jsonb),
  'types', coalesce((select jsonb_agg(to_jsonb(type_rows) order by typname) from type_rows),'[]'::jsonb),
  'extensions', coalesce((select jsonb_agg(to_jsonb(extension_rows) order by extname) from extension_rows),'[]'::jsonb)
) snapshot
from pg_namespace n
where n.nspname='public'`;

export type RecoveryArtifact = {
  file: string;
  format: "postgres-custom" | "postgres-roles-sql" | "catalog-json";
  plaintextSha256: string;
  ciphertextSha256: string;
  ciphertextBytes: number;
};

export type ProductionRecoveryReceipt = {
  schema: typeof OT_PRODUCTION_RECOVERY_SCHEMA;
  backupId: string;
  createdAt: string;
  backupStartedAt: string;
  backupCompletedAt: string;
  projectRef: string;
  markerInstanceId: string;
  sourceServerMajor: 17 | 18;
  encryption: {
    implementation: "gpg-symmetric-aes256";
    plaintextAtRest: false;
  };
  artifacts: RecoveryArtifact[];
  catalogDigest: string;
  authenticator: string;
};

export type RestoreRehearsalReceipt = {
  schema: typeof OT_PRODUCTION_RESTORE_SCHEMA;
  backupId: string;
  backupReceiptSha256: string;
  targetServerMajor: 17 | 18;
  restoredAt: string;
  artifactPlaintextSha256: Record<string, string>;
  sourceCatalogDigest: string;
  restoredCatalogDigest: string;
  verified: true;
  clusterSystemIdentifier: string;
  clusterSentinelNonce: string;
  authenticator: string;
};

export type RehearsalClusterSentinel = {
  schema: typeof OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA;
  nonce: string;
  createdAt: string;
  systemIdentifier: string;
  dataDirectorySha256: string;
  databaseName: string;
  temporarySuperuser: string;
  targetServerMajor: 17 | 18;
  authenticator: string;
};

const HEX = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const sha256 = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(sortJson(value), null, 2)}\n`;

export function assertFreshRehearsalSentinelTimestamp(
  createdAt: string,
  now = new Date(),
): void {
  const parsed = Date.parse(createdAt);
  const age = now.getTime() - parsed;
  if (!Number.isFinite(parsed) || age < 0 || age > 15 * 60_000)
    throw new Error(
      "Rehearsal cluster sentinel timestamp is invalid, future, or stale",
    );
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}

export function authenticatedPayload<T extends { authenticator?: string }>(
  value: T,
): string {
  const { authenticator: _ignored, ...payload } = value;
  return canonicalJson(payload);
}

export function authenticateReceipt(
  value: { authenticator?: string },
  authenticationKey: string,
): string {
  if (Buffer.byteLength(authenticationKey, "utf8") < 32)
    throw new Error("Production recovery authentication key is too short");
  return createHmac("sha256", authenticationKey)
    .update(authenticatedPayload(value))
    .digest("hex");
}

export function assertReceiptAuthenticator(
  value: { authenticator?: string },
  authenticationKey: string,
): void {
  const expected = authenticateReceipt(value, authenticationKey);
  const observed = value.authenticator ?? "";
  if (!HEX.test(observed))
    throw new Error("Production recovery receipt authenticator is invalid");
  if (
    !timingSafeEqual(Buffer.from(observed, "hex"), Buffer.from(expected, "hex"))
  )
    throw new Error("Production recovery receipt authentication failed");
}

export function newBackupId(): string {
  return randomUUID();
}

export function readRecoveryReceipt(
  receiptPath: string,
  authenticationKey?: string,
): ProductionRecoveryReceipt {
  const parsed = JSON.parse(
    fs.readFileSync(path.resolve(receiptPath), "utf8"),
  ) as unknown;
  assertRecoveryReceipt(parsed);
  if (authenticationKey) assertReceiptAuthenticator(parsed, authenticationKey);
  return parsed;
}

export function assertRecoveryReceipt(
  value: unknown,
): asserts value is ProductionRecoveryReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Production recovery receipt is not an object");
  const receipt = value as Partial<ProductionRecoveryReceipt>;
  if (receipt.schema !== OT_PRODUCTION_RECOVERY_SCHEMA)
    throw new Error("Production recovery receipt schema is unknown");
  if (!receipt.backupId || !UUID.test(receipt.backupId))
    throw new Error("Production recovery receipt backupId is invalid");
  if (!receipt.createdAt || !Number.isFinite(Date.parse(receipt.createdAt)))
    throw new Error("Production recovery receipt createdAt is invalid");
  if (
    !receipt.backupStartedAt ||
    !receipt.backupCompletedAt ||
    !Number.isFinite(Date.parse(receipt.backupStartedAt)) ||
    !Number.isFinite(Date.parse(receipt.backupCompletedAt)) ||
    Date.parse(receipt.backupCompletedAt) <
      Date.parse(receipt.backupStartedAt) ||
    Date.parse(receipt.backupCompletedAt) -
      Date.parse(receipt.backupStartedAt) >
      OT_PRODUCTION_RECOVERY_MAX_AGE_MINUTES * 60_000
  )
    throw new Error(
      "Production recovery capture window is invalid or too long",
    );
  if (!receipt.projectRef || !receipt.markerInstanceId)
    throw new Error("Production recovery receipt is not database-marker bound");
  if (receipt.sourceServerMajor !== 17 && receipt.sourceServerMajor !== 18)
    throw new Error("Production recovery receipt source major is unsupported");
  if (
    receipt.encryption?.implementation !== "gpg-symmetric-aes256" ||
    receipt.encryption.plaintextAtRest !== false
  )
    throw new Error(
      "Production recovery receipt does not prove encrypted-at-rest artifacts",
    );
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length !== 3)
    throw new Error(
      "Production recovery receipt must contain exactly three artifacts",
    );
  const formats = new Set(receipt.artifacts.map((artifact) => artifact.format));
  for (const required of [
    "postgres-custom",
    "postgres-roles-sql",
    "catalog-json",
  ])
    if (!formats.has(required as RecoveryArtifact["format"]))
      throw new Error(`Production recovery receipt is missing ${required}`);
  for (const artifact of receipt.artifacts) {
    if (
      !artifact.file.endsWith(".gpg") ||
      artifact.file.includes("/") ||
      artifact.file.includes("\\")
    )
      throw new Error("Production recovery artifact file is unsafe");
    if (
      !HEX.test(artifact.plaintextSha256) ||
      !HEX.test(artifact.ciphertextSha256)
    )
      throw new Error("Production recovery artifact digest is invalid");
    if (
      !Number.isSafeInteger(artifact.ciphertextBytes) ||
      artifact.ciphertextBytes <= 0
    )
      throw new Error("Production recovery artifact size is invalid");
  }
  if (!receipt.catalogDigest || !HEX.test(receipt.catalogDigest))
    throw new Error("Production recovery catalog digest is invalid");
  if (!receipt.authenticator || !HEX.test(receipt.authenticator))
    throw new Error("Production recovery receipt authenticator is invalid");
}
