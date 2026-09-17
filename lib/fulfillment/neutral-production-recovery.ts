import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const OT_PRODUCTION_RECOVERY_SCHEMA =
  "ot.neutral-production-recovery.v3" as const;
export const OT_PRODUCTION_RESTORE_SCHEMA =
  "ot.neutral-production-restore-rehearsal.v3" as const;
export const OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA =
  "ot.neutral-production-rehearsal-sentinel.v2" as const;
export const OT_PRODUCTION_RECOVERY_RECEIPT_VAR =
  "OT_NEUTRAL_PRODUCTION_RECOVERY_RECEIPT" as const;
export const OT_PRODUCTION_RECOVERY_AUTH_KEY_VAR =
  "OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY" as const;
export const OT_PRODUCTION_RECOVERY_PASSPHRASE_VAR =
  "OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE" as const;
export const OT_PRODUCTION_RECOVERY_MAX_AGE_MINUTES = 60;
// Keep this singleton: normalizing multiple grantors would collapse distinct
// pg_auth_members rows and make the catalog proof ambiguous.
export const OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS = [
  "supabase_admin",
] as const;
export const OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR =
  "__ot_managed_source_grantor_normalization_sentinel_not_a_postgresql_role__" as const;
export const OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY =
  "supabase-managed-grantor-v1" as const;
export const OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY =
  "supabase-managed-extension-fixture-v1" as const;

export const OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS = [
  {
    extname: "pg_stat_statements",
    extversion: "1.11",
    schema_name: "extensions",
    portability: "stock" as const,
  },
  {
    extname: "pgcrypto",
    extversion: "1.3",
    schema_name: "extensions",
    portability: "stock" as const,
  },
  {
    extname: "plpgsql",
    extversion: "1.0",
    schema_name: "pg_catalog",
    portability: "bootstrap" as const,
  },
  {
    extname: "supabase_vault",
    extversion: "0.3.1",
    schema_name: "vault",
    portability: "managed-fixture" as const,
  },
  {
    extname: "uuid-ossp",
    extversion: "1.1",
    schema_name: "extensions",
    portability: "stock" as const,
  },
] as const;

export const OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_MEMBERS = [
  {
    type: "function",
    schema: "vault",
    name: "",
    identity:
      "vault._crypto_aead_det_decrypt(pg_catalog.bytea,pg_catalog.bytea,bigint,pg_catalog.bytea,pg_catalog.bytea)",
  },
  {
    type: "function",
    schema: "vault",
    name: "",
    identity:
      "vault._crypto_aead_det_encrypt(pg_catalog.bytea,pg_catalog.bytea,bigint,pg_catalog.bytea,pg_catalog.bytea)",
  },
  {
    type: "function",
    schema: "vault",
    name: "",
    identity: "vault._crypto_aead_det_noncegen()",
  },
  {
    type: "function",
    schema: "vault",
    name: "",
    identity:
      "vault.create_secret(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.uuid)",
  },
  {
    type: "function",
    schema: "vault",
    name: "",
    identity:
      "vault.update_secret(pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.uuid)",
  },
  {
    type: "table",
    schema: "vault",
    name: "secrets",
    identity: "vault.secrets",
  },
  {
    type: "type",
    schema: "vault",
    name: "_decrypted_secrets",
    identity: "vault.decrypted_secrets[]",
  },
  {
    type: "type",
    schema: "vault",
    name: "_secrets",
    identity: "vault.secrets[]",
  },
  {
    type: "type",
    schema: "vault",
    name: "decrypted_secrets",
    identity: "vault.decrypted_secrets",
  },
  {
    type: "type",
    schema: "vault",
    name: "secrets",
    identity: "vault.secrets",
  },
  {
    type: "view",
    schema: "vault",
    name: "decrypted_secrets",
    identity: "vault.decrypted_secrets",
  },
] as const;

export const OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES = {
  "supabase_vault.control":
    "92dce37b7096985c4f60c43726f09f383ed80c5ff7844d1557ad485085db7742",
  "supabase_vault--0.3.1.sql":
    "4bea17027ffd365fc31b4711e07784b0d0979dccdce4863f1983da17885d64ce",
} as const;

export const OT_PRODUCTION_RECOVERY_RELEVANT_ROLES = [
  "postgres",
  "anon",
  "authenticated",
  "service_role",
  "supabase_admin",
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
         case when grantor.rolname = any($2::text[])
              then '${OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR}'
              else grantor.rolname::text end grantor_role,
         m.admin_option, m.inherit_option, m.set_option
  from pg_auth_members m
  join pg_roles granted on granted.oid=m.roleid
  join pg_roles member on member.oid=m.member
  join pg_roles grantor on grantor.oid=m.grantor
  where granted.rolname = any($1::text[])
     or member.rolname = any($1::text[])
     or grantor.rolname = any($2::text[])
  order by 1,2,3,4,5,6
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
), managed_extension_member_rows as (
  select e.extname, identified.type, coalesce(identified.schema,'') schema,
         coalesce(identified.name,'') name, identified.identity
  from pg_extension e
  join pg_depend d on d.refclassid='pg_extension'::regclass
   and d.refobjid=e.oid and d.deptype='e'
  cross join lateral pg_identify_object(d.classid,d.objid,d.objsubid) identified
  where e.extname='supabase_vault'
  order by 1,2,3,4,5
), managed_extension_relation_rows as (
  select e.extname, c.relname, c.relkind, c.relpersistence,
         c.relrowsecurity, c.relforcerowsecurity,
         coalesce(array_to_string(c.reloptions,','),'') options,
         case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) else '' end definition
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  join pg_class c on c.relnamespace=n.oid
  where e.extname='supabase_vault' and c.relkind in ('r','p','v','m','S','f')
  order by 1,2,3
), managed_extension_column_rows as (
  select e.extname, c.relname, a.attname, a.attnum,
         format_type(a.atttypid,a.atttypmod) data_type, a.attnotnull,
         a.attidentity, a.attgenerated,
         coalesce(pg_get_expr(ad.adbin,ad.adrelid,true),'') default_expression
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  join pg_class c on c.relnamespace=n.oid
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum
  where e.extname='supabase_vault' and c.relkind in ('r','p','v','m','f')
  order by 1,2,4
), managed_extension_function_rows as (
  select e.extname, p.oid::regprocedure::text identity,
         pg_get_function_result(p.oid) result_type, p.prokind, p.provolatile,
         p.proisstrict, p.prosecdef, p.proleakproof, p.proparallel,
         coalesce(array_to_string(p.proconfig,','),'') config
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  join pg_proc p on p.pronamespace=n.oid
  where e.extname='supabase_vault'
  order by 1,2
), managed_extension_index_rows as (
  select e.extname, c.relname, i.relname index_name, pg_get_indexdef(i.oid) definition
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  join pg_class c on c.relnamespace=n.oid and c.relkind in ('r','p','m')
  join pg_index x on x.indrelid=c.oid
  join pg_class i on i.oid=x.indexrelid
  where e.extname='supabase_vault'
  order by 1,2,3
), managed_extension_constraint_rows as (
  select e.extname, c.relname, x.conname, x.contype,
         pg_get_constraintdef(x.oid,true) definition
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  join pg_class c on c.relnamespace=n.oid and c.relkind in ('r','p','m')
  join pg_constraint x on x.conrelid=c.oid
  where e.extname='supabase_vault' and x.contype <> 'n'
  order by 1,2,3
), managed_extension_config_rows as (
  select e.extname, c.ord position, coalesce(c.relation::regclass::text,'') relation,
         coalesce(e.extcondition[c.ord],'') condition
  from pg_extension e
  cross join lateral unnest(coalesce(e.extconfig,'{}'::oid[])) with ordinality c(relation,ord)
  where e.extname='supabase_vault'
  order by 1,2
), managed_extension_acl_rows as (
  select rows.extname, rows.object_identity, rows.subobject,
         case when rows.grantee=0 then 'PUBLIC'
              when grantee.rolname = any($2::text[])
              then '${OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR}'
              else grantee.rolname end grantee_role,
         case when grantor.rolname = any($2::text[])
              then '${OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR}'
              else grantor.rolname end grantor_role,
         rows.privilege_type, rows.is_grantable
  from (
    select e.extname, c.oid::regclass::text object_identity, '' subobject,
           acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    join pg_class c on c.relnamespace=n.oid
    cross join lateral aclexplode(case when cardinality(c.relacl)>0 then c.relacl end) acl
    where e.extname='supabase_vault'
    union all
    select e.extname, p.oid::regprocedure::text object_identity, '' subobject,
           acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    join pg_proc p on p.pronamespace=n.oid
    cross join lateral aclexplode(case when cardinality(p.proacl)>0 then p.proacl end) acl
    where e.extname='supabase_vault'
    union all
    select e.extname, c.oid::regclass::text object_identity, a.attname subobject,
           acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    join pg_class c on c.relnamespace=n.oid
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where e.extname='supabase_vault'
  ) rows
  left join pg_roles grantee on grantee.oid=rows.grantee
  join pg_roles grantor on grantor.oid=rows.grantor
  order by 1,2,3,4,5,6,7
)
select jsonb_build_object(
  'public_schema_owner', pg_get_userbyid(n.nspowner),
  'public_schema_acl', coalesce(n.nspacl::text,''),
  'roles', coalesce((select jsonb_agg(to_jsonb(role_rows) order by rolname) from role_rows),'[]'::jsonb),
  'memberships', coalesce((select jsonb_agg(to_jsonb(membership_rows) order by granted_role,member_role,grantor_role collate "C",admin_option,inherit_option,set_option) from membership_rows),'[]'::jsonb),
  'default_acls', coalesce((select jsonb_agg(to_jsonb(default_acl_rows) order by owner_role,schema_name,object_type,acl) from default_acl_rows),'[]'::jsonb),
  'relations', coalesce((select jsonb_agg(to_jsonb(relation_rows) order by relname,relkind) from relation_rows),'[]'::jsonb),
  'column_acls', coalesce((select jsonb_agg(to_jsonb(column_acl_rows) order by relname,attname) from column_acl_rows),'[]'::jsonb),
  'policies', coalesce((select jsonb_agg(to_jsonb(policy_rows) order by tablename,policyname) from policy_rows),'[]'::jsonb),
  'functions', coalesce((select jsonb_agg(to_jsonb(function_rows) order by identity) from function_rows),'[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(to_jsonb(trigger_rows) order by relname,tgname) from trigger_rows),'[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(to_jsonb(constraint_rows) order by relname,conname) from constraint_rows),'[]'::jsonb),
  'types', coalesce((select jsonb_agg(to_jsonb(type_rows) order by typname) from type_rows),'[]'::jsonb),
  'extensions', coalesce((select jsonb_agg(to_jsonb(extension_rows) order by extname) from extension_rows),'[]'::jsonb),
  'managed_extension_members', coalesce((select jsonb_agg(to_jsonb(managed_extension_member_rows) order by extname,type,schema,name,identity) from managed_extension_member_rows),'[]'::jsonb),
  'managed_extension_relations', coalesce((select jsonb_agg(to_jsonb(managed_extension_relation_rows) order by extname,relname,relkind) from managed_extension_relation_rows),'[]'::jsonb),
  'managed_extension_columns', coalesce((select jsonb_agg(to_jsonb(managed_extension_column_rows) order by extname,relname,attnum) from managed_extension_column_rows),'[]'::jsonb),
  'managed_extension_functions', coalesce((select jsonb_agg(to_jsonb(managed_extension_function_rows) order by extname,identity) from managed_extension_function_rows),'[]'::jsonb),
  'managed_extension_indexes', coalesce((select jsonb_agg(to_jsonb(managed_extension_index_rows) order by extname,relname,index_name) from managed_extension_index_rows),'[]'::jsonb),
  'managed_extension_constraints', coalesce((select jsonb_agg(to_jsonb(managed_extension_constraint_rows) order by extname,relname,conname) from managed_extension_constraint_rows),'[]'::jsonb),
  'managed_extension_config', coalesce((select jsonb_agg(to_jsonb(managed_extension_config_rows) order by extname,position) from managed_extension_config_rows),'[]'::jsonb),
  'managed_extension_acls', coalesce((select jsonb_agg(to_jsonb(managed_extension_acl_rows) order by extname,object_identity,subobject,grantee_role,grantor_role,privilege_type,is_grantable) from managed_extension_acl_rows),'[]'::jsonb)
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
  roleMembershipPortability: {
    policy: typeof OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY;
    sourceGrantors: [(typeof OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS)[number]];
    normalizedGrantor: typeof OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR;
    managedMembershipCount: number;
  };
  extensionPortability: RecoveryExtensionPortability;
  authenticator: string;
};

export type RecoveryExtensionPortability = {
  policy: typeof OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY;
  sourceExtensions: Array<{
    extname: string;
    extversion: string;
    schema_name: string;
    portability: "bootstrap" | "stock" | "managed-fixture";
  }>;
  sourceExtensionsSha256: string;
  managedExtensionCatalogSha256: string;
  fixtureFilesSha256: Record<string, string>;
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
  roleMembershipPortability: {
    policy: typeof OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY;
    authenticatedSourceCount: number;
    pristineTargetCount: number;
    adaptedStatementCount: number;
    adaptedRolesSha256: string;
  };
  extensionPortability: RecoveryExtensionPortability & {
    pinnedCreateExtensionStatements: number;
    pinnedCreateExtensionStatementsSha256: string;
  };
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
  managedExtensionFixture: {
    policy: typeof OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY;
    filesSha256: Record<string, string>;
  };
  authenticator: string;
};

const HEX = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SQL_IDENTIFIER = String.raw`(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)`;
const ROLE_MEMBERSHIP_GRANT = new RegExp(
  String.raw`^GRANT (?<granted>${SQL_IDENTIFIER}) TO (?<member>${SQL_IDENTIFIER})(?: WITH (?<options>(?:ADMIN OPTION|INHERIT (?:TRUE|FALSE)|SET (?:TRUE|FALSE))(?:, (?:ADMIN OPTION|INHERIT (?:TRUE|FALSE)|SET (?:TRUE|FALSE)))*))? GRANTED BY (?<grantor>${SQL_IDENTIFIER});$`,
);
const MANAGED_EXTENSION_CATALOG_KEYS = [
  "managed_extension_members",
  "managed_extension_relations",
  "managed_extension_columns",
  "managed_extension_functions",
  "managed_extension_indexes",
  "managed_extension_constraints",
  "managed_extension_config",
  "managed_extension_acls",
] as const;

export const sha256 = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(sortJson(value), null, 2)}\n`;

function requiredArray(
  snapshot: Record<string, unknown>,
  key: string,
): unknown[] {
  const value = snapshot[key];
  if (!Array.isArray(value))
    throw new Error(`Recovery catalog ${key} is invalid`);
  return value;
}

export function recoveryExtensionPortability(
  snapshot: unknown,
): RecoveryExtensionPortability {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new Error("Recovery catalog snapshot is invalid");
  const catalog = snapshot as Record<string, unknown>;
  const extensionRows = requiredArray(catalog, "extensions");
  const observed = extensionRows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("Recovery catalog extension row is invalid");
    const value = row as Record<string, unknown>;
    return {
      extname: String(value.extname ?? ""),
      extversion: String(value.extversion ?? ""),
      schema_name: String(value.schema_name ?? ""),
    };
  });
  const expected = OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS.map(
    ({ portability: _ignored, ...extension }) => extension,
  );
  if (canonicalJson(observed) !== canonicalJson(expected))
    throw new Error(
      "Recovery source extension set, version, or schema is unsupported",
    );

  const members = requiredArray(catalog, "managed_extension_members");
  if (
    canonicalJson(
      members.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new Error("Recovery managed extension member row is invalid");
        const value = row as Record<string, unknown>;
        return {
          type: String(value.type ?? ""),
          schema: String(value.schema ?? ""),
          name: String(value.name ?? ""),
          identity: String(value.identity ?? ""),
        };
      }),
    ) !== canonicalJson(OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_MEMBERS)
  )
    throw new Error("Recovery managed extension member set is unsupported");

  const managedCatalog = Object.fromEntries(
    MANAGED_EXTENSION_CATALOG_KEYS.map((key) => [
      key,
      requiredArray(catalog, key),
    ]),
  );
  const sourceExtensions = OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS.map(
    (row) => ({ ...row }),
  );
  return {
    policy: OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY,
    sourceExtensions,
    sourceExtensionsSha256: sha256(canonicalJson(sourceExtensions)),
    managedExtensionCatalogSha256: sha256(canonicalJson(managedCatalog)),
    fixtureFilesSha256: {
      ...OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
    },
  };
}

export function assertRecoveryExtensionPortability(
  value: unknown,
  snapshot?: unknown,
): asserts value is RecoveryExtensionPortability {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Production recovery extension portability evidence is invalid",
    );
  const observed = value as Partial<RecoveryExtensionPortability>;
  const expected = snapshot
    ? recoveryExtensionPortability(snapshot)
    : undefined;
  if (
    observed.policy !== OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY ||
    !Array.isArray(observed.sourceExtensions) ||
    !HEX.test(observed.sourceExtensionsSha256 ?? "") ||
    !HEX.test(observed.managedExtensionCatalogSha256 ?? "") ||
    canonicalJson(observed.fixtureFilesSha256) !==
      canonicalJson(OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES) ||
    sha256(canonicalJson(observed.sourceExtensions)) !==
      observed.sourceExtensionsSha256 ||
    canonicalJson(observed.sourceExtensions) !==
      canonicalJson(OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS) ||
    (expected !== undefined &&
      canonicalJson(observed) !== canonicalJson(expected))
  )
    throw new Error(
      "Production recovery extension portability evidence is invalid",
    );
}

function sqlIdentifierValue(identifier: string): string {
  return identifier.startsWith('"')
    ? identifier.slice(1, -1).replaceAll('""', '"')
    : identifier;
}

/**
 * PostgreSQL 17 cannot replay some Supabase-managed membership rows with an
 * explicit `GRANTED BY supabase_admin`: the legacy managed grantor lacks the
 * ADMIN edge that stock PostgreSQL now requires. The edge and every option are
 * portable; only that explicit grantor metadata is not.
 *
 * This adapter accepts only pg_dumpall's strict, standalone membership form,
 * removes only the exact managed suffix, and leaves every other grantor and
 * every membership option byte-for-byte unchanged. The caller must compare the
 * adapted count with the independently captured normalized source catalog.
 */
export function adaptManagedRoleMembershipGrantors(input: Buffer): {
  bytes: Buffer;
  managedMembershipCount: number;
} {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(input);
  let managedMembershipCount = 0;
  const output = source
    .split(/(?<=\n)/)
    .map((line) => {
      const newline = line.endsWith("\r\n")
        ? "\r\n"
        : line.endsWith("\n")
          ? "\n"
          : "";
      const statement = newline ? line.slice(0, -newline.length) : line;
      // pg_dumpall emits membership statements in canonical uppercase GRANT
      // form. Other statements may legitimately contain the text
      // "GRANTED BY" inside a role comment or ALTER ROLE ... SET value and
      // must remain opaque. Once a canonical GRANT mentions GRANTED BY,
      // however, require the entire line to be the one supported membership
      // grammar so a second statement or trailing payload cannot be hidden.
      if (!statement.startsWith("GRANT ")) return line;
      if (!/\bGRANTED\s+BY\b/i.test(statement)) return line;
      const match = ROLE_MEMBERSHIP_GRANT.exec(statement);
      if (!match?.groups)
        throw new Error(
          "Role backup contains an ambiguous GRANTED BY statement",
        );
      const grantor = sqlIdentifierValue(match.groups.grantor!);
      if (!OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS.includes(grantor as never))
        return line;
      managedMembershipCount += 1;
      const suffix = ` GRANTED BY ${match.groups.grantor};`;
      if (!statement.endsWith(suffix))
        throw new Error(
          "Managed role membership grantor suffix is not canonical",
        );
      return `${statement.slice(0, -suffix.length)};${newline}`;
    })
    .join("");
  return {
    bytes: Buffer.from(output, "utf8"),
    managedMembershipCount,
  };
}

export function countNormalizedManagedMemberships(snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new Error("Recovery catalog snapshot is invalid");
  const memberships = (snapshot as { memberships?: unknown }).memberships;
  if (!Array.isArray(memberships))
    throw new Error("Recovery catalog memberships are invalid");
  return memberships.filter((membership) => {
    if (
      !membership ||
      typeof membership !== "object" ||
      Array.isArray(membership)
    )
      throw new Error("Recovery catalog membership row is invalid");
    return (
      (membership as { grantor_role?: unknown }).grantor_role ===
      OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR
    );
  }).length;
}

export function assertManagedRoleMembershipPortabilityCounts(input: {
  authenticatedSourceCount: number;
  sourceCatalogCount: number;
  pristineTargetCount: number;
  adaptedStatementCount: number;
}): void {
  for (const [name, value] of Object.entries(input))
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`Managed role membership ${name} is invalid`);
  if (
    input.sourceCatalogCount !== input.authenticatedSourceCount ||
    input.pristineTargetCount + input.adaptedStatementCount !==
      input.sourceCatalogCount
  )
    throw new Error(
      `Managed role membership portability count does not match the authenticated source catalog and pristine target (authenticated=${input.authenticatedSourceCount} source=${input.sourceCatalogCount} pristine=${input.pristineTargetCount} adapted=${input.adaptedStatementCount})`,
    );
}

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
  const portability = receipt.roleMembershipPortability;
  if (
    portability?.policy !== OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY ||
    portability.normalizedGrantor !==
      OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR ||
    !Array.isArray(portability.sourceGrantors) ||
    portability.sourceGrantors.length !== 1 ||
    portability.sourceGrantors[0] !==
      OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS[0] ||
    !Number.isSafeInteger(portability.managedMembershipCount) ||
    portability.managedMembershipCount < 0
  )
    throw new Error(
      "Production recovery role membership portability evidence is invalid",
    );
  assertRecoveryExtensionPortability(receipt.extensionPortability);
  if (!receipt.authenticator || !HEX.test(receipt.authenticator))
    throw new Error("Production recovery receipt authenticator is invalid");
}
