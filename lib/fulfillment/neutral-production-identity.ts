import { parse } from "pg-connection-string";
import {
  OT_PRODUCTION_PROJECT_REF,
  assertSameNeutralProductionDatabase,
  type NeutralProductionDatabaseMarker,
} from "./neutral-production-database-marker";
import { assertNeutralFeatureFlagsOff } from "./neutral-production-flags";

export { OT_PRODUCTION_PROJECT_REF };

/**
 * The Production identity model.
 *
 * WHY THESE NAMES ARE NOT THE PREVIEW NAMES
 *
 * Preview logs in as `ot_preview_app`, `ot_preview_neutral_runtime` and
 * `ot_preview_neutral_delivery`. If Production reused those names then a
 * Preview credential pasted into a Production variable — or the reverse — would
 * pass every name check and be caught only by the database marker. The marker is
 * the backstop, not the only stop: the login names are disjoint by construction
 * and [[assertNeutralProductionPreMigrationIdentities]] refuses any Preview name
 * outright.
 *
 * The OWNER login is the exception and stays `postgres`, because that is the
 * role Supabase provisions as the database owner and it already owns every
 * deployed OT relation. Renaming it is a platform operation this architecture
 * does not perform. Its Production-ness is proved differently — by the project
 * ref embedded in the pooler username and by the durable database marker — and
 * it is the only identity allowed to carry migration authority at all.
 */

export type ProductionIdentityKind =
  | "owner"
  | "app"
  | "neutralRuntime"
  | "neutralDelivery";

export type ProductionLoginIdentity = {
  kind: ProductionIdentityKind;
  role: string;
  envVar: string;
  /** Provisioned by Supabase rather than by this architecture. */
  platformProvided: boolean;
};

export const OT_PRODUCTION_LOGIN_IDENTITIES: readonly ProductionLoginIdentity[] =
  [
    {
      kind: "owner",
      role: "postgres",
      envVar: "DIRECT_URL",
      platformProvided: true,
    },
    {
      kind: "app",
      role: "ot_prod_app",
      envVar: "DATABASE_URL",
      platformProvided: false,
    },
    {
      kind: "neutralRuntime",
      role: "ot_prod_neutral_runtime",
      envVar: "OT_NEUTRAL_PRODUCTION_DATABASE_URL",
      platformProvided: false,
    },
    {
      kind: "neutralDelivery",
      role: "ot_prod_neutral_delivery",
      envVar: "OT_NEUTRAL_PRODUCTION_DELIVERY_DATABASE_URL",
      platformProvided: false,
    },
  ];

export const OT_PRODUCTION_IDENTITY_KINDS = OT_PRODUCTION_LOGIN_IDENTITIES.map(
  (identity) => identity.kind,
);

/** Refused in every Production position, including the owner position. */
export const OT_PREVIEW_LOGIN_ROLES: ReadonlySet<string> = new Set([
  "ot_preview_app",
  "ot_preview_neutral_runtime",
  "ot_preview_neutral_delivery",
]);

/**
 * The environment-neutral functional roles the baseline creates. They are the
 * same names in Preview and Production on purpose: they are grant targets, they
 * never log in, and giving them environment-specific names would make the
 * baseline SQL environment-specific too.
 */
export const OT_NEUTRAL_FUNCTIONAL_ROLES = [
  "ot_neutral_app_reader",
  "ot_neutral_runtime",
  "ot_neutral_delivery_runtime",
  "ot_neutral_reversal_guard_owner",
  "ot_commerce_capture_owner",
] as const;

/**
 * Which functional role each restricted Production login must be able to reach,
 * and nothing else.
 */
export const OT_PRODUCTION_ROLE_BINDINGS: Readonly<Record<string, string>> = {
  ot_prod_app: "ot_neutral_app_reader",
  ot_prod_neutral_runtime: "ot_neutral_runtime",
  ot_prod_neutral_delivery: "ot_neutral_delivery_runtime",
};

const ROUTING_KEYS: ReadonlySet<string> = new Set([
  "host",
  "hostaddr",
  "port",
  "dbname",
  "database",
  "user",
  "username",
]);

/**
 * `sslmode` is always allowed; `pgbouncer` only on the transaction-mode port,
 * where Prisma genuinely needs it. Everything else — options, target_session_attrs,
 * a second sslmode — is refused, because each is a way to change where or as
 * whom the connection lands after the URL has been inspected.
 */
const ALWAYS_ALLOWED_URL_OPTIONS: ReadonlySet<string> = new Set(["sslmode"]);
const TRANSACTION_PORT = 6543;
const SESSION_PORT = 5432;

/**
 * Supabase regional poolers, matched structurally.
 *
 * Preview pins an exact two-host allowlist and keeps it; Production cannot,
 * because the verified Production pooler host was not part of the read-only
 * inventory and a wrong literal would fail closed on a correct environment. The
 * structural form is still tight — `aws-<n>-<region>.pooler.supabase.com` — and
 * it is never the only binding: the username must carry the approved project
 * ref, and the marker must name the approved instance.
 */
const POOLER_HOST = /^aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com$/;

export function declaredProductionDatabaseRole(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("Database credential is not a valid URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("Database credential is not a PostgreSQL URL");
  const user = decodeURIComponent(parsed.username);
  if (!user) throw new Error("Database credential does not declare a role");
  // On a pooler the login name carries the project: `role.projectref`.
  const suffix = `.${OT_PRODUCTION_PROJECT_REF}`;
  return user.endsWith(suffix) ? user.slice(0, -suffix.length) : user;
}

export type ProductionUrlFacts = {
  role: string;
  host: string;
  port: number;
  pooler: boolean;
  transactionMode: boolean;
};

/**
 * Prove a single URL resolves to the exact approved Production identity.
 *
 * `owner` is allowed the direct `db.<ref>.supabase.co` host as well as the
 * pooler, because a migration connection legitimately bypasses pooling. The
 * three restricted logins must arrive through the pooler.
 */
export function assertProductionUrlIdentity(
  raw: string,
  expectedRole: string,
  kind: ProductionIdentityKind,
): ProductionUrlFacts {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`The ${kind} database URL is not a valid URL`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error(`The ${kind} database URL is not a PostgreSQL URL`);

  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (seen.has(normalized))
      throw new Error("Duplicate database URL option is forbidden");
    seen.add(normalized);
  }

  const config = parse(raw);
  const host = typeof config.host === "string" ? config.host : "";
  const port = Number(config.port ?? SESSION_PORT);
  const pooler = POOLER_HOST.test(host);
  const transactionMode = pooler && port === TRANSACTION_PORT;

  for (const normalized of seen) {
    if (ROUTING_KEYS.has(normalized))
      throw new Error("Database URL routing overrides are forbidden");
    if (ALWAYS_ALLOWED_URL_OPTIONS.has(normalized)) continue;
    if (normalized === "pgbouncer" && transactionMode) continue;
    throw new Error(`Unknown database URL option ${normalized} is forbidden`);
  }

  if (url.searchParams.get("sslmode")?.toLowerCase() !== "verify-full")
    throw new Error("Hosted Production database URLs require sslmode=verify-full");
  if (
    typeof config.sslmode !== "string" ||
    config.sslmode.toLowerCase() !== "verify-full" ||
    config.ssl === false
  )
    throw new Error("Parsed database URL TLS semantics are not verify-full");

  const directHost = `db.${OT_PRODUCTION_PROJECT_REF}.supabase.co`;
  const owner = kind === "owner";
  const approvedHost = pooler || (owner && host === directHost);
  const expectedUser = pooler
    ? `${expectedRole}.${OT_PRODUCTION_PROJECT_REF}`
    : expectedRole;
  const approvedPort = owner
    ? port === SESSION_PORT
    : port === SESSION_PORT || port === TRANSACTION_PORT;

  if (
    !approvedHost ||
    !approvedPort ||
    config.database !== "postgres" ||
    config.user !== expectedUser
  )
    throw new Error(
      `The ${kind} database URL does not resolve to the exact approved Production identity`,
    );

  return { role: expectedRole, host, port, pooler, transactionMode };
}

/**
 * WHICH database every Production path is allowed to be talking to, read from
 * the environment and nothing else.
 *
 * Split out of [[readNeutralProductionConnectionConfig]] because the two facts
 * have different audiences. The full config needs all four credentials and is
 * what the identity preflight and the baseline runner want. The read-only
 * verifier connects on `DIRECT_URL` alone, and demanding the other three from it
 * would make the Phase 7 confirmation fail for a reason that has nothing to do
 * with what it proves — while leaving it with no approved instance to compare
 * the durable marker against at all, which is the gap this exists to close.
 */
export type ApprovedProductionDatabase = {
  projectRef: string;
  markerInstanceId: string;
};

export function readApprovedProductionDatabase(
  env: Readonly<Record<string, string | undefined>>,
): ApprovedProductionDatabase {
  if (env.OT_NEUTRAL_PRODUCTION_PROJECT_REF?.trim() !== OT_PRODUCTION_PROJECT_REF)
    throw new Error("Exact approved Production project identity is required");
  const markerInstanceId = env.OT_NEUTRAL_PRODUCTION_MARKER_INSTANCE_ID?.trim();
  if (!markerInstanceId)
    throw new Error("Expected durable Production marker instance ID is required");
  return { projectRef: OT_PRODUCTION_PROJECT_REF, markerInstanceId };
}

export type ProductionConnectionConfig = ApprovedProductionDatabase & {
  urls: Record<ProductionIdentityKind, string>;
};

/**
 * Read and prove the four Production credentials from the environment, without
 * connecting to anything. Every refusal here happens before a socket is opened.
 */
export function readNeutralProductionConnectionConfig(
  env: Readonly<Record<string, string | undefined>>,
): ProductionConnectionConfig {
  const approved = readApprovedProductionDatabase(env);

  const entries = OT_PRODUCTION_LOGIN_IDENTITIES.map((identity) => {
    const raw = env[identity.envVar]?.trim();
    if (!raw)
      throw new Error(
        `${identity.envVar} is required for the Production identity proof`,
      );
    return [identity, raw] as const;
  });
  if (new Set(entries.map(([, raw]) => raw)).size !== entries.length)
    throw new Error("All four Production database URLs must be distinct");

  const urls = {} as Record<ProductionIdentityKind, string>;
  for (const [identity, raw] of entries) {
    assertProductionUrlIdentity(raw, identity.role, identity.kind);
    urls[identity.kind] = raw;
  }
  return { urls, ...approved };
}

export type ProductionPreMigrationIdentity = {
  kind: ProductionIdentityKind;
  declaredRole: string;
  currentRole: string;
  sessionRole: string;
  databaseName: string;
  marker: string | null;
  isSuperuser: boolean;
  bypassesRls: boolean;
  canCreateRole: boolean;
  canCreateDb: boolean;
  canReplicate: boolean;
  canLogin: boolean;
  inherits: boolean;
  canCreateSchema: boolean;
};

export type ProductionPreMigrationOptions = {
  env: Readonly<Record<string, string | undefined>>;
  /** The marker instance the operator packet approved. */
  expectedMarkerInstanceId: string;
};

/**
 * The four-role pre-migration proof.
 *
 * Deliberately NOT a superuser check. Production `postgres` has
 * `rolsuper = false` (verified read-only, 2026-09-17) and `rolcreaterole = true`,
 * which is exactly the authority the Production baseline was written to need.
 * Requiring superuser here would reproduce the defect that made migration
 * 20260913170000 un-runnable.
 */
export function assertNeutralProductionPreMigrationIdentities(
  identities: readonly ProductionPreMigrationIdentity[],
  options: ProductionPreMigrationOptions,
): NeutralProductionDatabaseMarker {
  if (
    identities.length !== OT_PRODUCTION_LOGIN_IDENTITIES.length ||
    identities.some(
      (identity, index) =>
        identity.kind !== OT_PRODUCTION_LOGIN_IDENTITIES[index]!.kind,
    )
  )
    throw new Error(
      "Exactly four ordered Production database identities are required",
    );

  const marker = assertSameNeutralProductionDatabase(identities);
  if (marker.instanceId !== options.expectedMarkerInstanceId)
    throw new Error(
      "Durable Production marker does not match the approved instance",
    );

  for (const identity of identities) {
    if (
      !identity.declaredRole ||
      identity.currentRole !== identity.declaredRole ||
      identity.sessionRole !== identity.declaredRole
    )
      throw new Error(
        `The ${identity.kind} credential did not connect as its explicitly declared role`,
      );
    if (OT_PREVIEW_LOGIN_ROLES.has(identity.currentRole))
      throw new Error(
        `The ${identity.kind} credential connected as a Preview login role`,
      );
  }

  OT_PRODUCTION_LOGIN_IDENTITIES.forEach((expected, index) => {
    if (identities[index]!.currentRole !== expected.role)
      throw new Error(
        `The ${expected.kind} identity must be the canonical Production login ${expected.role}`,
      );
  });

  if (new Set(identities.map((identity) => identity.currentRole)).size !== 4)
    throw new Error("All four Production database roles must be distinct");

  const [owner, ...restricted] = identities as [
    ProductionPreMigrationIdentity,
    ...ProductionPreMigrationIdentity[],
  ];
  if (!owner.canLogin || !owner.canCreateSchema || !owner.canCreateRole)
    throw new Error(
      "Owner identity lacks the schema and role authority the Production baseline requires",
    );

  for (const identity of restricted) {
    if (
      !identity.canLogin ||
      identity.isSuperuser ||
      identity.bypassesRls ||
      identity.canCreateRole ||
      identity.canCreateDb ||
      identity.canReplicate ||
      identity.canCreateSchema
    )
      throw new Error(
        `The ${identity.kind} identity is over-privileged before migration`,
      );
  }

  assertNeutralFeatureFlagsOff(options.env);
  return marker;
}

/**
 * One row per connection, shaped for [[assertNeutralProductionPreMigrationIdentities]].
 * Read-only: it inspects catalogs and reads no application row.
 */
export const PRODUCTION_IDENTITY_SQL = `select
  current_user as "currentRole",
  session_user as "sessionRole",
  current_database() as "databaseName",
  shobj_description(d.oid, 'pg_database') as marker,
  r.rolsuper as "isSuperuser",
  r.rolbypassrls as "bypassesRls",
  r.rolcreaterole as "canCreateRole",
  r.rolcreatedb as "canCreateDb",
  r.rolreplication as "canReplicate",
  r.rolcanlogin as "canLogin",
  r.rolinherit as "inherits",
  has_schema_privilege(current_user, 'public', 'CREATE') as "canCreateSchema"
from pg_database d
join pg_roles r on r.rolname = current_user
where d.datname = current_database()`;
