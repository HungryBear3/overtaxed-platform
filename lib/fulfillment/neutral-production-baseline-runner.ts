import {
  OT_PRODUCTION_LAST_APPLIED_MIGRATION,
  assertResolveChecksums,
  coveredMigrationNames,
  planResolveCommands,
  type MigrationCommand,
} from "./neutral-production-baseline-manifest";
import { parseNeutralProductionDatabaseMarker } from "./neutral-production-database-marker";
import { readNeutralProductionConnectionConfig } from "./neutral-production-identity";
import { assertNeutralFeatureFlagsOff } from "./neutral-production-flags";

/**
 * The guarded Production baseline runner.
 *
 * A single Prisma migration cannot do this job. Prisma orders migration
 * directories lexicographically and applies every unapplied one in sequence, so
 * a new directory would be applied AFTER the fourteen it is meant to replace —
 * including the three that cannot run at all. The replacement therefore has to
 * live outside the migration folder and be driven by a runner that:
 *
 *   1. proves the environment before opening a connection,
 *   2. proves the artifact bytes it is about to execute,
 *   3. applies the baseline SQL on the OWNER connection in one transaction,
 *   4. proves EVERY postcondition inside that transaction,
 *   5. proves them again from a SEPARATE read-only connection after commit,
 *   6. and only then records the covered migrations with exact
 *      `prisma migrate resolve` commands.
 *
 * Every one of those is a gate, and every gate fails closed.
 *
 * TWO ENTRYPOINTS, NOT ONE FLAG
 *
 * `mode` is the caller's declared intent and there is no value of the
 * environment that changes it. A `"rehearsal"` run does the entire thing inside
 * a transaction it then ROLLS BACK, and it strips the apply and resolve
 * confirmation tokens out of the environment it works from, so a token that is
 * still exported from an earlier attempt cannot turn a rehearsal into a
 * mutation. An `"apply"` run REFUSES outright without the exact apply token for
 * the approved marker instance; it never silently degrades to a rehearsal,
 * because "I thought I applied it" and "I thought I rehearsed it" are both
 * failures and only one of them is visible in the exit status.
 */

export type QueryResultRow = Record<string, unknown>;

export type OwnerSession = {
  query(sql: string, values?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
};

export type MigrationCommandResult = {
  status: number | null;
  error?: Error;
  /** Captured, already-redacted child output. Never inherited stdio. */
  output?: string;
};

export type CommandRunner = (
  command: MigrationCommand,
) => MigrationCommandResult | Promise<MigrationCommandResult>;

export type LedgerRow = {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
};

export type BaselinePreflightRow = {
  state: string;
  present_objects: number;
  expected_objects: number;
  missing_objects: string[];
  present_object_names: string[];
  missing_prerequisites: string[];
  /** Cluster-global roles the baseline needs, that already exist. */
  present_roles: string[];
  /** Cluster-global roles the baseline needs, that do not exist yet. */
  missing_roles: string[];
  /** Pre-existing roles whose attributes are not the pristine NOLOGIN shape. */
  unsafe_preexisting_roles: string[];
  /**
   * Restricted Production logins that do not exist. They are a provisioning
   * prerequisite the baseline binds but never creates, so an absent one is a
   * refusal rather than something to fill in.
   */
  missing_login_roles: string[];
  /** Existing logins that cannot log in, cannot inherit, or carry authority. */
  unsafe_login_roles: string[];
  /** `login->role` for every membership edge this rollout did not design. */
  unexpected_login_memberships: string[];
  /**
   * One entry PER CATALOG ROW on the designed login -> functional pair, with its
   * grantor: `login->functional:grantor=…,inherit=…,set=…,admin=…`.
   * `pg_auth_members` is keyed on (roleid, member, grantor), so this can hold
   * more than one entry for a pair — which is the whole reason it is a list.
   */
  login_binding_edges: string[];
  /** Of those, the ones that are not exactly INHERIT TRUE, SET FALSE, ADMIN FALSE. */
  unsafe_login_binding_edges: string[];
  /** `login->functional xN` wherever more than one grantor recorded the pair. */
  duplicate_login_bindings: string[];
  /** `login->functional` for every designed pair with no edge at all. */
  missing_login_bindings: string[];
  /** `login->functional` wherever `pg_has_role(login, functional, 'SET')` is true. */
  login_binding_set_paths: string[];
  owner_role: string;
  database_name: string;
  server_version_num: number;
  database_marker: string | null;
  owner_is_superuser: boolean;
  owner_can_create_role: boolean;
  owner_can_create_schema: boolean;
  public_schema_public_create: boolean;
  rls_auto_enable_present: boolean;
  pg_stat_statements_present: boolean;
  pg_stat_statements_info_present: boolean;
  platform_roles: string[];
  /** `createrole_self_grant`, verbatim. Diagnostic only; nothing branches on it. */
  createrole_self_grant: string;
  /** `role:inherit=…,set=…,admin=…` for every owner-role edge the owner holds. */
  owner_role_grant_options: string[];
};

export type BaselineAction = "APPLY" | "REPLAY" | "REFUSE";

export type BaselineClassification = {
  action: BaselineAction;
  reasons: string[];
};

export type BaselineMode = "rehearsal" | "apply";

/**
 * PostgreSQL 17 and 18. 16 is excluded because the ownership transfers depend on
 * `GRANT ... WITH INHERIT/SET`, which is 16+, and because Production is 17.6 —
 * accepting a version nobody verified is accepting an untested code path.
 */
export const SUPPORTED_SERVER_VERSION_RANGE = { min: 170000, max: 189999 };

/**
 * Decide, from the preflight row alone, what may happen next. Pure: no
 * connection, no clock, no environment. Every refusal is listed rather than
 * short-circuited, so one rehearsal tells an operator everything that is wrong.
 *
 * WHY ROLES ARE NOT PART OF `state`
 *
 * `state` is computed from database-local objects only — relations, columns,
 * types, enum labels, constraints, functions. Roles are CLUSTER-global: they
 * survive a dropped schema, they can be created by a platform operator ahead of
 * time, and on Supabase they routinely are. Counting them into the
 * ABSENT/PARTIAL/COMPLETE tally meant a database with none of the baseline's
 * tables but with the five functional roles already created classified PARTIAL
 * and was refused forever — while 02_baseline.sql is explicitly written to
 * ACCEPT a pristine pre-created role and adopt it. The two halves disagreed, and
 * the half that refused was the one an operator hit.
 *
 * They are still proved, just as the thing they actually are: a pre-existing
 * role must be pristine (no login, no inherit, no ambient authority), and a
 * COMPLETE database must not be missing any of them.
 */
export function classifyBaselinePreflight(
  row: BaselinePreflightRow,
): BaselineClassification {
  const reasons: string[] = [];

  if (row.missing_prerequisites.length)
    reasons.push(
      `prerequisite objects are missing: ${row.missing_prerequisites.join(", ")}`,
    );
  if (
    row.server_version_num < SUPPORTED_SERVER_VERSION_RANGE.min ||
    row.server_version_num > SUPPORTED_SERVER_VERSION_RANGE.max
  )
    reasons.push(`server version ${row.server_version_num} is not supported`);
  if (!row.owner_can_create_role)
    reasons.push("the owner connection cannot create roles");
  if (!row.owner_can_create_schema)
    reasons.push("the owner connection cannot create objects in schema public");
  if (row.public_schema_public_create)
    reasons.push(
      "PUBLIC still holds CREATE on schema public; revoke it as a separate human-gated prerequisite first",
    );
  // A pre-created role is fine. A pre-created role that can log in, inherit, or
  // create is a role somebody else is using for something else.
  if (row.unsafe_preexisting_roles.length)
    reasons.push(
      `pre-existing roles carry unsafe attributes: ${row.unsafe_preexisting_roles.join(", ")}`,
    );

  // The three restricted logins are the mirror image of the functional roles:
  // provisioned out-of-band, never created here, and bound by exactly one edge
  // each. All three refusals are stated as preflight reasons rather than left to
  // the RAISE inside 02_baseline.sql, so a rehearsal names the provisioning gap
  // on its receipt instead of the operator meeting it as an abort part-way
  // through the body.
  if (row.missing_login_roles.length)
    reasons.push(
      `restricted Production logins are not provisioned: ${row.missing_login_roles.join(", ")}`,
    );
  if (row.unsafe_login_roles.length)
    reasons.push(
      `restricted Production logins are not pristine: ${row.unsafe_login_roles.join(", ")}`,
    );
  if (row.unexpected_login_memberships.length)
    reasons.push(
      `restricted Production logins already reach roles this rollout did not design: ${row.unexpected_login_memberships.join(", ")}`,
    );

  // THE EDGE ON THE DESIGNED PAIR, COUNTED RATHER THAN EXISTS-TESTED.
  //
  // `pg_auth_members` is keyed on (roleid, member, GRANTOR), so two grantors can
  // record two edges for the SAME login -> functional pair and PostgreSQL unions
  // their options. A platform operator's `WITH SET TRUE` edge sitting alongside
  // the baseline's `INHERIT TRUE, SET FALSE` one satisfies every check phrased
  // as "an edge with the right shape exists", while the login can SET ROLE to
  // its functional role and shed the identity the audit trail is keyed on.
  //
  // Three of these refusals are unconditional and one is state-dependent:
  //
  //   * a SET path, a duplicate edge and a mis-shaped edge are wrong on every
  //     path, before an apply and after one;
  //   * on ABSENT the pair must have NO edge at all, because "exactly this edge
  //     and no other" is not provable by adding one on top of somebody else's;
  //   * on COMPLETE the pair must have exactly the one the baseline created,
  //     because a complete schema whose binding has gone missing is a database
  //     somebody has since edited by hand.
  if (row.login_binding_set_paths.length)
    reasons.push(
      `restricted Production logins can SET ROLE to their functional role: ${row.login_binding_set_paths.join(", ")}`,
    );
  if (row.duplicate_login_bindings.length)
    reasons.push(
      `restricted Production login bindings are recorded by more than one grantor: ${row.duplicate_login_bindings.join(", ")}`,
    );
  if (row.unsafe_login_binding_edges.length)
    reasons.push(
      `restricted Production login bindings are not ADMIN FALSE, INHERIT TRUE, SET FALSE: ${row.unsafe_login_binding_edges.join(", ")}`,
    );
  if (row.state === "ABSENT" && row.login_binding_edges.length)
    reasons.push(
      `restricted Production logins are already bound to their functional role, which this baseline has not yet granted: ${row.login_binding_edges.join(", ")}`,
    );
  if (row.state === "COMPLETE" && row.missing_login_bindings.length)
    reasons.push(
      `the neutral schema is complete but restricted Production login bindings are missing: ${row.missing_login_bindings.join(", ")}`,
    );

  // Section 11 of the body closes the PUBLIC grant on both statistics views and
  // aborts if either is absent. Classifying the absence here makes it a refusal
  // an operator reads before a connection is opened, rather than a mid-transaction
  // 'statistics-view topology is invalid' forty statements in. It is never
  // repaired: CREATE EXTENSION is a platform operation with its own review.
  const statistics = [
    ...(row.pg_stat_statements_present ? [] : ["extensions.pg_stat_statements"]),
    ...(row.pg_stat_statements_info_present
      ? []
      : ["extensions.pg_stat_statements_info"]),
  ];
  if (statistics.length)
    reasons.push(
      `the Supabase statistics views the baseline closes to PUBLIC are absent: ${statistics.join(", ")}`,
    );

  if (row.state === "PARTIAL") {
    reasons.push(
      `the neutral schema is partially present (${row.present_objects}/${row.expected_objects}); missing: ${row.missing_objects.slice(0, 12).join(", ")}`,
    );
    return { action: "REFUSE", reasons };
  }
  if (row.state !== "ABSENT" && row.state !== "COMPLETE") {
    reasons.push(`unknown preflight state ${row.state}`);
    return { action: "REFUSE", reasons };
  }
  // A complete schema whose roles are gone is not a replay, it is a database
  // somebody has since edited by hand.
  if (row.state === "COMPLETE" && row.missing_roles.length)
    reasons.push(
      `the neutral schema is complete but functional roles are missing: ${row.missing_roles.join(", ")}`,
    );

  if (reasons.length) return { action: "REFUSE", reasons };
  return { action: row.state === "ABSENT" ? "APPLY" : "REPLAY", reasons };
}

export type LedgerPreState = {
  /**
   * Covered migrations already recorded cleanly applied. Non-empty means an
   * earlier run committed the baseline and got part-way through the resolve.
   */
  alreadyResolved: string[];
  /** Covered migrations still to record, in manifest order. */
  pending: string[];
};

/**
 * Classify the ledger before anything is touched, and make a partially-resolved
 * ledger a RESUMABLE state rather than a permanent refusal.
 *
 * `prisma migrate resolve` is one process per migration. If the eighth of
 * fourteen fails — a dropped connection, an interrupted shell — the first seven
 * are already recorded and committed. The previous form of this gate refused
 * whenever ANY covered migration appeared in the ledger, which meant the only
 * way out of a half-finished resolve was to hand-edit `_prisma_migrations` in
 * Production. That is a worse operation than the one the gate was protecting.
 *
 * What is still refused, because neither is resumable:
 *
 *   * the migration Production had before any of this is not cleanly applied —
 *     the manifest was written against a history this database does not have;
 *   * a covered migration is recorded unfinished or rolled back — a resolve that
 *     half-wrote a row, or a human `--rolled-back`, and either way the operator
 *     has to decide what it meant.
 *
 * The caller additionally requires the schema to be COMPLETE before it will act
 * on a non-empty `alreadyResolved`: a ledger that names migrations the database
 * does not contain is not a resume, it is a mismatch.
 */
export function classifyLedgerPreState(
  rows: readonly LedgerRow[],
): LedgerPreState {
  const problems: string[] = [];
  const covered = coveredMigrationNames();
  const coveredSet = new Set(covered);

  const last = rows.find(
    (row) => row.migration_name === OT_PRODUCTION_LAST_APPLIED_MIGRATION,
  );
  if (!last || !last.finished_at || last.rolled_back_at)
    problems.push(
      `${OT_PRODUCTION_LAST_APPLIED_MIGRATION} is not recorded as applied`,
    );

  const seen = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    if (!coveredSet.has(row.migration_name)) continue;
    const bucket = seen.get(row.migration_name) ?? [];
    bucket.push(row);
    seen.set(row.migration_name, bucket);
  }

  const alreadyResolved: string[] = [];
  const pending: string[] = [];
  for (const name of covered) {
    const bucket = seen.get(name);
    if (!bucket) {
      pending.push(name);
      continue;
    }
    if (bucket.length > 1) {
      problems.push(`${name} appears in the ledger ${bucket.length} times`);
      continue;
    }
    const row = bucket[0]!;
    if (!row.finished_at || row.rolled_back_at) {
      problems.push(
        `${name} is in the ledger but is not recorded as cleanly applied`,
      );
      continue;
    }
    alreadyResolved.push(name);
  }

  if (problems.length)
    throw new Error(
      `Production migration ledger pre-state is invalid: ${problems.join("; ")}`,
    );
  return { alreadyResolved, pending };
}

/** After resolve: every covered migration recorded applied, none rolled back. */
export function assertLedgerPostState(rows: readonly LedgerRow[]): void {
  const seen = new Map(rows.map((row) => [row.migration_name, row]));
  const problems: string[] = [];
  for (const name of coveredMigrationNames()) {
    const row = seen.get(name);
    if (!row) problems.push(`${name} is missing from the ledger`);
    else if (!row.finished_at || row.rolled_back_at)
      problems.push(`${name} is not recorded as cleanly applied`);
  }
  if (problems.length)
    throw new Error(
      `Production migration ledger post-state is invalid: ${problems.join("; ")}`,
    );
}

export const OT_PRODUCTION_APPLY_TOKEN_VAR =
  "OT_NEUTRAL_PRODUCTION_APPLY_CONFIRMATION";
export const OT_PRODUCTION_RESOLVE_TOKEN_VAR =
  "OT_NEUTRAL_PRODUCTION_RESOLVE_CONFIRMATION";

/**
 * A confirmation token is the approved marker instance id prefixed with the
 * phase it authorizes. Using the marker id means a token copied from a rehearsal
 * against a different database cannot authorize a mutation against this one.
 *
 * The token is necessary and NOT sufficient: the instance id it names is a
 * value the operator typed into the environment, so Gate 4 re-reads the durable
 * marker off the database itself and requires the two to agree.
 */
export function expectedApplyToken(markerInstanceId: string): string {
  return `apply-production-baseline:${markerInstanceId}`;
}
export function expectedResolveToken(markerInstanceId: string): string {
  return `resolve-production-ledger:${markerInstanceId}`;
}

/**
 * The environment a rehearsal is allowed to see: this one, minus both
 * confirmation tokens. Exported so the rehearsal entrypoint can delete them from
 * the real `process.env` too, which is what stops a child `prisma` process from
 * inheriting an authorization its parent declined to use.
 */
export function withoutConfirmationTokens(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const copy = { ...env };
  delete copy[OT_PRODUCTION_APPLY_TOKEN_VAR];
  delete copy[OT_PRODUCTION_RESOLVE_TOKEN_VAR];
  return copy;
}

export type BaselineRunnerDeps = {
  /** Declared by the entrypoint. No environment variable can change it. */
  mode: BaselineMode;
  env: Readonly<Record<string, string | undefined>>;
  /** Exact SQL text of the three artifacts, read from disk by the caller. */
  artifacts: { preflight: string; baseline: string; postconditions: string };
  /** Repo-relative path -> observed SHA-256 for every manifest-pinned file. */
  observedDigests: Record<string, string>;
  /** Repo-relative path -> pinned SHA-256, parsed from the committed manifest. */
  pinnedDigests: Record<string, string>;
  owner: OwnerSession;
  readLedger: () => Promise<LedgerRow[]>;
  /**
   * Every read-only proof, issued against the still-open baseline transaction:
   * postcondition SQL, role inventory, and role-binding graph. A rehearsal that
   * skipped any of them could pass where the apply then fails.
   */
  verifyInTransaction: (session: OwnerSession) => Promise<void>;
  /** The same proofs, on a SEPARATE connection, after COMMIT. */
  verifyDurable: (options: { expectLedgerResolved: boolean }) => Promise<void>;
  /** Absolute path to the Prisma CLI inside this checkout. Never `npx`. */
  prismaBinary: string;
  spawn: CommandRunner;
};

export type BaselineOutcome = {
  action: BaselineAction;
  mode: BaselineMode;
  committed: boolean;
  resolved: boolean;
  preflight: BaselinePreflightRow;
  /** Only the commands this run needed; an already-recorded migration is skipped. */
  resolveCommands: MigrationCommand[];
  /** Covered migrations a previous run had already recorded. */
  alreadyResolved: string[];
};

function succeeded(result: MigrationCommandResult): boolean {
  return !result.error && result.status === 0;
}

export async function runNeutralProductionBaseline(
  deps: BaselineRunnerDeps,
): Promise<BaselineOutcome> {
  const { mode, owner } = deps;
  // A rehearsal works from an environment with the tokens removed, so there is
  // no code path below that can read one even by mistake.
  const env =
    mode === "rehearsal" ? withoutConfirmationTokens(deps.env) : deps.env;

  // --- Gate 1: the environment, before a socket is opened. ------------------
  assertNeutralFeatureFlagsOff(env);
  const config = readNeutralProductionConnectionConfig(env);

  let apply = false;
  let resolve = false;
  if (mode === "apply") {
    apply =
      env[OT_PRODUCTION_APPLY_TOKEN_VAR] ===
      expectedApplyToken(config.markerInstanceId);
    resolve =
      env[OT_PRODUCTION_RESOLVE_TOKEN_VAR] ===
      expectedResolveToken(config.markerInstanceId);
    // Refuse rather than degrade. An apply entrypoint that quietly rehearses is
    // an operator who files a rehearsal receipt as an apply receipt.
    // The old "resolve without apply is refused" rule is now structural: an
    // apply entrypoint that has not been authorized to apply never reaches the
    // point where a resolve token could matter.
    if (!apply)
      throw new Error(
        `${OT_PRODUCTION_APPLY_TOKEN_VAR} must be exactly the apply token for the approved marker instance; the apply entrypoint does not fall back to a rehearsal`,
      );
  }

  // --- Gate 2: the bytes about to be executed. -----------------------------
  assertResolveChecksums(deps.pinnedDigests, deps.observedDigests);

  // --- Gate 3: the migration ledger pre-state. -----------------------------
  const ledgerPre = classifyLedgerPreState(await deps.readLedger());

  // --- Gate 4: the catalog, inside a transaction that can still be undone. --
  // The transaction is its own scope so that what it establishes leaves it as a
  // value. Assigning outer `let`s from inside a `try` would make every later use
  // possibly-unassigned, and widening the types to cover that would mean the
  // gates below could silently run against undefined.
  const transaction = await (async (): Promise<{
    preflight: BaselinePreflightRow;
    classification: BaselineClassification;
    committed: boolean;
  }> => {
    await owner.query("BEGIN");
    try {
      const result = await owner.query(deps.artifacts.preflight);
      const row = result.rows[0] as BaselinePreflightRow | undefined;
      if (!row) throw new Error("Production baseline preflight returned no row");

      // The durable marker, parsed by the same parser every other Production
      // path uses. A token names an instance id; only this proves the database
      // on the other end of THIS connection is that instance, and that it is
      // the approved project rather than a restored copy or a branch.
      const marker = parseNeutralProductionDatabaseMarker(row.database_marker);
      if (marker.projectRef !== config.projectRef)
        throw new Error(
          "Durable Production marker does not name the approved Supabase project",
        );
      if (marker.instanceId !== config.markerInstanceId)
        throw new Error(
          "Durable Production marker does not match the approved instance",
        );

      const classification = classifyBaselinePreflight(row);
      if (classification.action === "REFUSE")
        throw new Error(
          `Production baseline refused: ${classification.reasons.join("; ")}`,
        );
      // A ledger that already names covered migrations is only a resume if the
      // schema they describe is actually there.
      if (
        ledgerPre.alreadyResolved.length &&
        classification.action !== "REPLAY"
      )
        throw new Error(
          `The ledger already records ${ledgerPre.alreadyResolved.length} covered migration(s) but the schema is not complete; this is a mismatch, not a resumable resolve`,
        );

      if (classification.action === "APPLY")
        await owner.query(deps.artifacts.baseline);

      // Everything the durable verification proves, proved here first. On the
      // rehearsal path this is the whole point: it really ran against the real
      // catalog, and none of it survives.
      await deps.verifyInTransaction(owner);

      if (apply) await owner.query("COMMIT");
      else await owner.query("ROLLBACK");

      return { preflight: row, classification, committed: apply };
    } catch (error) {
      await owner.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  })();
  const { preflight, classification, committed } = transaction;

  // --- Gate 5: independent verification on a fresh connection. -------------
  if (committed) await deps.verifyDurable({ expectLedgerResolved: false });

  // --- Gate 6: the ledger, and only now. -----------------------------------
  // Only what is still missing. Re-running `resolve --applied` for a migration
  // Prisma already records is an error, so an idempotent resume has to skip it.
  const pendingResolves = new Set(ledgerPre.pending);
  const resolveCommands = planResolveCommands(deps.prismaBinary).filter(
    (command) => pendingResolves.has(command.args[command.args.length - 1]!),
  );

  if (!committed || !resolve)
    return {
      action: classification.action,
      mode,
      committed,
      resolved: false,
      preflight,
      resolveCommands,
      alreadyResolved: ledgerPre.alreadyResolved,
    };

  for (const command of resolveCommands) {
    const result = await deps.spawn(command);
    if (!succeeded(result))
      throw new Error(
        [
          `prisma migrate resolve failed for ${command.args[command.args.length - 1]}`,
          "Recovery: the baseline is committed and the ledger is partially written.",
          "Re-run the SAME apply command; the runner re-reads the ledger, skips every",
          "migration already recorded, and resumes at the first one that is not.",
          result.output ? `Child output: ${result.output}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
  }

  // The ledger, exactly — and only after that the durable verification that
  // additionally proves ledger exactness from a separate connection.
  assertLedgerPostState(await deps.readLedger());
  await deps.verifyDurable({ expectLedgerResolved: true });

  return {
    action: classification.action,
    mode,
    committed,
    resolved: true,
    preflight,
    resolveCommands,
    alreadyResolved: ledgerPre.alreadyResolved,
  };
}
