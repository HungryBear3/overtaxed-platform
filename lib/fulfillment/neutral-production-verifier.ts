import {
  OT_PRODUCTION_LAST_APPLIED_MIGRATION,
  coveredMigrationNames,
} from "./neutral-production-baseline-manifest";
import {
  parseNeutralProductionDatabaseMarker,
  type NeutralProductionDatabaseMarker,
} from "./neutral-production-database-marker";
import { assertNeutralFeatureFlagsOff } from "./neutral-production-flags";
import {
  OT_NEUTRAL_FUNCTIONAL_ROLES,
  OT_PRODUCTION_LOGIN_IDENTITIES,
  OT_PRODUCTION_ROLE_BINDINGS,
  type ApprovedProductionDatabase,
} from "./neutral-production-identity";

/**
 * Read-only Production postcondition verifier.
 *
 * WHY THIS IS NOT THE PREVIEW ACCEPTANCE RUNNER
 *
 * The Preview runner proves the neutral journey by WRITING: it reserves, stages,
 * promotes, delivers, refunds, and then proves the rows are gone. That design is
 * correct for an isolated throwaway database and is exactly wrong for
 * Production. Pointing it at Production would create synthetic orders,
 * fulfillments, capabilities and refund work against real commerce tables and
 * then rely on a rollback to remove them. Nothing here imports it, and nothing
 * here can be made to call it.
 *
 * Every statement this verifier issues runs inside `BEGIN ... READ ONLY`, which
 * is not a convention but an enforcement: if any of it ever tried to write, the
 * server would refuse the statement rather than the reviewer having to notice.
 */

export type Queryable = {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};

export type ProductionLedgerRow = {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
};

export type ProductionRoleRow = {
  rolname: string;
  rolcanlogin: boolean;
  rolinherit: boolean;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  schema_usage: boolean;
  direct_schema_create: boolean;
  owned_relations: number;
  owned_routines: number;
};

export type ProductionBindingRow = {
  login: string;
  functional: string;
  /** `pg_has_role(login, functional, 'SET')`. Must be false on every path. */
  can_set: boolean;
  /** DIRECT catalog edges on this exact pair. Must be exactly 1. */
  edge_count: number;
  /** Of those, the ones that are ADMIN FALSE, INHERIT TRUE, SET FALSE. */
  exact_edge_count: number;
  /** DIRECT catalog edges on the login, to any role at all. Must be exactly 1. */
  total_edge_count: number;
};

export const PRODUCTION_DATABASE_MARKER_SQL = `select
  current_database() as "databaseName",
  shobj_description(d.oid, 'pg_database') as marker
from pg_database d
where d.datname = current_database()`;

/**
 * WHICH database the proofs below are about.
 *
 * Everything else this file asserts is a statement about catalog contents —
 * roles, policies, grants, ledger rows. Every one of them is true of a restored
 * copy, of a Supabase branch of the same project, and of a Staging database
 * somebody once applied the baseline to. `PASS` from a verifier that never asked
 * which database it was connected to is a receipt that proves the schema is
 * right somewhere, filed against a rollout that is about one specific instance.
 *
 * So the durable `COMMENT ON DATABASE` marker is parsed by the same parser every
 * other Production path uses, and BOTH of its identifying fields must match the
 * approved pair exactly. It runs first, before any other proof, because a proof
 * about the wrong database is not worth issuing.
 */
export async function assertProductionDatabaseMarker(
  session: Queryable,
  expected: ApprovedProductionDatabase,
): Promise<NeutralProductionDatabaseMarker> {
  const result = await session.query(PRODUCTION_DATABASE_MARKER_SQL);
  const row = result.rows[0];
  if (!row)
    throw new Error("Production database marker query returned no row");
  const marker = parseNeutralProductionDatabaseMarker(
    typeof row.marker === "string" ? row.marker : null,
  );
  if (marker.projectRef !== expected.projectRef)
    throw new Error(
      "Durable Production marker does not name the approved Supabase project",
    );
  if (marker.instanceId !== expected.markerInstanceId)
    throw new Error(
      "Durable Production marker does not match the approved instance",
    );
  return marker;
}

export const PRODUCTION_LEDGER_SQL = `select migration_name, finished_at, rolled_back_at
from "_prisma_migrations"
order by migration_name`;

export const PRODUCTION_ROLE_SQL = `select
  r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreaterole,
  r.rolcreatedb, r.rolreplication, r.rolbypassrls,
  has_schema_privilege(r.rolname, 'public', 'USAGE') as schema_usage,
  exists (
    select 1 from pg_namespace n
    cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
    where n.nspname = 'public' and acl.grantee = r.oid and acl.privilege_type = 'CREATE'
  ) as direct_schema_create,
  (select count(*)::int from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relowner = r.oid and n.nspname = 'public'
      and c.relkind = any(array['r','p','v','m','S','f']::"char"[])) as owned_relations,
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proowner = r.oid and n.nspname = 'public') as owned_routines
from pg_roles r
where r.rolname = any($1::text[])
order by r.rolname`;

/**
 * Which functional role each restricted login reaches, and HOW MANY catalog
 * edges say so.
 *
 * `MEMBER` expands the whole membership graph, so an intermediate role cannot
 * hide a path — that is what the row set is for. The counters are what the row
 * set alone could never say.
 *
 * THE TWO-GRANTOR BYPASS
 *
 * `pg_auth_members` is keyed on (roleid, member, GRANTOR). Two grantors can
 * therefore record two edges for the SAME login -> functional pair, and
 * PostgreSQL unions the options on them. A platform operator's
 * `GRANT ot_neutral_app_reader TO ot_prod_app WITH SET TRUE` plus the
 * baseline's own `INHERIT TRUE, SET FALSE` produces one row here and two rows
 * in the catalog — so a verifier that only looked at which pairs came back saw
 * exactly the designed graph while the login could SET ROLE to its functional
 * role and shed the identity every audit trail is keyed on.
 *
 * So each row now carries the direct-edge count for the pair, the count of
 * those edges that carry exactly the designed options, the login's total direct
 * edge count, and — the end state itself, asked of the server rather than
 * derived — whether SET ROLE is permitted.
 */
export const PRODUCTION_BINDING_SQL = `select
  source.rolname as login,
  target.rolname as functional,
  pg_has_role(source.oid, target.oid, 'SET') as can_set,
  (select count(*)::int from pg_auth_members m
    where m.member = source.oid and m.roleid = target.oid) as edge_count,
  (select count(*)::int from pg_auth_members m
    where m.member = source.oid and m.roleid = target.oid
      and m.inherit_option and not m.set_option and not m.admin_option) as exact_edge_count,
  (select count(*)::int from pg_auth_members m
    where m.member = source.oid) as total_edge_count
from pg_roles source
cross join pg_roles target
where source.rolname = any($1::text[])
  and target.rolname <> source.rolname
  and target.rolname !~ '^pg_'
  and pg_has_role(source.oid, target.oid, 'MEMBER')
order by 1, 2`;

/**
 * The ledger must name every covered migration exactly once as a clean
 * application, alongside the migration Production had before any of this
 * began. Prisma retains attempts after `migrate resolve --rolled-back`; those
 * historical rows are valid only when the same migration has exactly one later
 * clean application.
 */
export function assertProductionLedgerExactness(
  rows: readonly ProductionLedgerRow[],
): void {
  const problems: string[] = [];
  for (const name of [
    OT_PRODUCTION_LAST_APPLIED_MIGRATION,
    ...coveredMigrationNames(),
  ]) {
    const seen = rows.filter((row) => row.migration_name === name);
    const clean = seen.filter(
      (row) => Boolean(row.finished_at) && !row.rolled_back_at,
    );
    if (seen.length === 0) problems.push(`${name} is absent from the ledger`);
    else if (clean.length > 1)
      problems.push(`${name} appears ${clean.length} times as cleanly applied`);
    else if (clean.length === 0)
      problems.push(`${name} is not recorded as cleanly applied`);
  }
  for (const name of new Set(rows.map((row) => row.migration_name))) {
    const attempts = rows.filter((row) => row.migration_name === name);
    const clean = attempts.filter(
      (row) => Boolean(row.finished_at) && !row.rolled_back_at,
    );
    const unfinished = attempts.filter(
      (row) => !row.finished_at && !row.rolled_back_at,
    );
    if (unfinished.length)
      problems.push(`${name} has ${unfinished.length} unfinished attempt(s)`);
    if (attempts.some((row) => row.rolled_back_at) && clean.length === 0)
      problems.push(`${name} is rolled back without a clean application`);
  }

  if (problems.length)
    throw new Error(
      `Production migration ledger is not exact: ${problems.join("; ")}`,
    );
}

export function assertProductionRoleInventory(
  rows: readonly ProductionRoleRow[],
): void {
  const problems: string[] = [];
  const byName = new Map(rows.map((row) => [row.rolname, row]));

  for (const role of OT_NEUTRAL_FUNCTIONAL_ROLES) {
    const row = byName.get(role);
    if (!row) {
      problems.push(`functional role ${role} is missing`);
      continue;
    }
    if (
      row.rolcanlogin ||
      row.rolinherit ||
      row.rolsuper ||
      row.rolcreaterole ||
      row.rolcreatedb ||
      row.rolreplication ||
      row.rolbypassrls
    )
      problems.push(`functional role ${role} carries authority it must not have`);
    if (!row.schema_usage)
      problems.push(`functional role ${role} cannot USAGE schema public`);
    if (row.direct_schema_create)
      problems.push(`functional role ${role} holds a direct CREATE on schema public`);
    // ot_commerce_capture_owner owns the capture table and its two functions by
    // design; every other functional role owns nothing at all.
    const expectedRelations = role === "ot_commerce_capture_owner" ? 1 : 0;
    const expectedRoutines = role === "ot_commerce_capture_owner" ? 2 : role === "ot_neutral_reversal_guard_owner" ? 1 : 0;
    if (row.owned_relations !== expectedRelations)
      problems.push(`functional role ${role} owns ${row.owned_relations} relations`);
    if (row.owned_routines !== expectedRoutines)
      problems.push(`functional role ${role} owns ${row.owned_routines} routines`);
  }

  for (const identity of OT_PRODUCTION_LOGIN_IDENTITIES) {
    if (identity.kind === "owner") continue;
    const row = byName.get(identity.role);
    if (!row) {
      problems.push(`Production login ${identity.role} is missing`);
      continue;
    }
    if (
      !row.rolcanlogin ||
      row.rolsuper ||
      row.rolcreaterole ||
      row.rolcreatedb ||
      row.rolreplication ||
      row.rolbypassrls
    )
      problems.push(`Production login ${identity.role} has invalid attributes`);
    if (row.direct_schema_create)
      problems.push(`Production login ${identity.role} holds CREATE on schema public`);
    if (row.owned_relations !== 0 || row.owned_routines !== 0)
      problems.push(`Production login ${identity.role} owns database objects`);
  }

  if (problems.length)
    throw new Error(`Production role inventory is invalid: ${problems.join("; ")}`);
}

/**
 * Each restricted login reaches exactly one functional role, through exactly
 * ONE catalog edge, carrying exactly ADMIN FALSE / INHERIT TRUE / SET FALSE,
 * and cannot SET ROLE to it.
 *
 * Every one of those four is checked separately because they fail separately.
 * An extra PAIR is a privilege path nobody designed; an extra EDGE on the
 * designed pair is the two-grantor bypass described on [[PRODUCTION_BINDING_SQL]],
 * where a second grantor's SET-carrying edge sits invisibly alongside the
 * baseline's correct one and confers its options anyway. The previous form of
 * this function compared the returned pairs against the designed set and
 * nothing else, so it passed on exactly that state.
 */
export function assertProductionRoleBindings(
  rows: readonly ProductionBindingRow[],
): void {
  const remaining = new Set(
    Object.entries(OT_PRODUCTION_ROLE_BINDINGS).map(
      ([login, functional]) => `${login}|${functional}`,
    ),
  );
  const problems: string[] = [];
  for (const row of rows) {
    const key = `${row.login}|${row.functional}`;
    if (!remaining.delete(key)) {
      problems.push(`${row.login} can assume ${row.functional}`);
      continue;
    }
    if (row.can_set)
      problems.push(
        `${row.login} can SET ROLE to ${row.functional}; the binding must be reachable by inheritance only`,
      );
    if (row.edge_count !== 1)
      problems.push(
        `${row.login} is bound to ${row.functional} by ${row.edge_count} membership edges; exactly one is designed`,
      );
    if (row.exact_edge_count !== 1)
      problems.push(
        `${row.login} has ${row.exact_edge_count} ADMIN FALSE, INHERIT TRUE, SET FALSE edges to ${row.functional}; exactly one is designed`,
      );
    if (row.total_edge_count !== 1)
      problems.push(
        `${row.login} holds ${row.total_edge_count} membership edges in total; exactly one is designed`,
      );
  }
  for (const key of remaining) problems.push(`missing binding ${key}`);
  if (problems.length)
    throw new Error(
      `Production login role bindings are invalid: ${problems.join("; ")}`,
    );
}

export type ProductionPostconditionChecks = {
  /** A connection for the OWNER identity. Never a write-capable journey runner. */
  session: Queryable;
  /** Exact text of prisma/production-baseline/03_postconditions.sql. */
  postconditions: string;
  /** When false the ledger is not expected to be resolved yet. */
  expectLedgerResolved: boolean;
  /** The approved project and marker instance, from the operator environment. */
  expectedDatabase: ApprovedProductionDatabase;
};

/**
 * EVERY read-only proof this architecture knows how to make, issued against
 * whatever transaction the caller has already opened: the postcondition SQL, the
 * role inventory, and the login->functional-role binding graph.
 *
 * It opens no transaction and closes none. That is what lets the baseline runner
 * make exactly the same set of proofs from INSIDE its uncommitted transaction —
 * a rehearsal that proved less than the apply would is a rehearsal that can pass
 * where the apply then fails, which is the one thing a rehearsal exists to rule
 * out. The durable, separate-connection form is
 * [[verifyNeutralProductionPostconditions]] below.
 */
export async function runNeutralProductionPostconditionChecks(
  deps: ProductionPostconditionChecks,
): Promise<void> {
  const { session } = deps;
  // First, and on every path: which database is this.
  await assertProductionDatabaseMarker(session, deps.expectedDatabase);
  await session.query(deps.postconditions);

  const roles = await session.query(PRODUCTION_ROLE_SQL, [
    [
      ...OT_NEUTRAL_FUNCTIONAL_ROLES,
      ...OT_PRODUCTION_LOGIN_IDENTITIES.filter((i) => i.kind !== "owner").map(
        (i) => i.role,
      ),
    ],
  ]);
  assertProductionRoleInventory(roles.rows as unknown as ProductionRoleRow[]);

  const bindings = await session.query(PRODUCTION_BINDING_SQL, [
    Object.keys(OT_PRODUCTION_ROLE_BINDINGS),
  ]);
  assertProductionRoleBindings(
    bindings.rows as unknown as ProductionBindingRow[],
  );

  if (deps.expectLedgerResolved) {
    const ledger = await session.query(PRODUCTION_LEDGER_SQL);
    assertProductionLedgerExactness(
      ledger.rows as unknown as ProductionLedgerRow[],
    );
  }
}

export type ProductionVerifierDeps = ProductionPostconditionChecks & {
  env: Readonly<Record<string, string | undefined>>;
};

export async function verifyNeutralProductionPostconditions(
  deps: ProductionVerifierDeps,
): Promise<void> {
  assertNeutralFeatureFlagsOff(deps.env);
  const { session } = deps;
  // READ ONLY is the enforcement, not a label. Any accidental write below
  // becomes a server-side error instead of a Production change.
  await session.query("BEGIN READ ONLY");
  try {
    await runNeutralProductionPostconditionChecks(deps);
  } finally {
    await session.query("ROLLBACK").catch(() => undefined);
  }
}

/**
 * Diagnostics leave this process as catalog names and privilege names only.
 * Connection strings are redacted whole, and any secret the caller names is
 * removed in its raw, decoded and percent-encoded forms.
 */
export function redactProductionDiagnostic(
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

  let message = messages
    .join("\n")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]");
  const variants = new Set<string>();
  for (const secret of secrets.filter(Boolean)) {
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
    try {
      const url = new URL(secret);
      for (const value of [url.username, url.password]) {
        if (!value) continue;
        variants.add(value);
        const decoded = decodeURIComponent(value);
        variants.add(decoded);
        variants.add(encodeURIComponent(decoded));
      }
    } catch {
      try {
        variants.add(decodeURIComponent(secret));
      } catch {
        variants.add(secret);
      }
    }
  }
  for (const value of [...variants]
    .filter((candidate) => candidate.length >= 4)
    .sort((a, b) => b.length - a.length))
    message = message.split(value).join("[REDACTED]");
  return message;
}
