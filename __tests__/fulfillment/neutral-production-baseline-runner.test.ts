import fs from "node:fs";
import path from "node:path";
import {
  OT_PRODUCTION_APPLY_TOKEN_VAR,
  OT_PRODUCTION_RESOLVE_TOKEN_VAR,
  assertLedgerPostState,
  classifyBaselinePreflight,
  classifyLedgerPreState,
  expectedApplyToken,
  expectedResolveToken,
  runNeutralProductionBaseline,
  withoutConfirmationTokens,
  type BaselineMode,
  type BaselinePreflightRow,
  type BaselineRunnerDeps,
  type LedgerRow,
} from "@/lib/fulfillment/neutral-production-baseline-runner";
import {
  OT_LOCAL_PRISMA_BINARY,
  OT_PRODUCTION_LAST_APPLIED_MIGRATION,
  coveredMigrationNames,
  manifestPinnedPaths,
} from "@/lib/fulfillment/neutral-production-baseline-manifest";
import { OT_PRODUCTION_PROJECT_REF } from "@/lib/fulfillment/neutral-production-identity";

const REF = OT_PRODUCTION_PROJECT_REF;
const INSTANCE = "6a5c0f2e-3b1d-4e7a-9c88-2f4b6d0a1e33";
const POOLER = "aws-1-us-east-2.pooler.supabase.com";
const url = (role: string, port = 5432, extra = "") =>
  `postgresql://${role}.${REF}:pw@${POOLER}:${port}/postgres?sslmode=verify-full${extra}`;

const MARKER = JSON.stringify({
  schema: "ot.database-environment.v1",
  purpose: "ot-neutral-report",
  environment: "production",
  production: true,
  projectRef: REF,
  instanceId: INSTANCE,
});

const FUNCTIONAL_ROLES = [
  "ot_commerce_capture_owner",
  "ot_neutral_app_reader",
  "ot_neutral_delivery_runtime",
  "ot_neutral_reversal_guard_owner",
  "ot_neutral_runtime",
];

/** login -> the one functional role the baseline binds it to. */
const DESIGNED_BINDINGS: Record<string, string> = {
  ot_prod_app: "ot_neutral_app_reader",
  ot_prod_neutral_runtime: "ot_neutral_runtime",
  ot_prod_neutral_delivery: "ot_neutral_delivery_runtime",
};

/** One catalog edge, rendered exactly as 01_preflight.sql renders it. */
const edge = (
  login: string,
  overrides: { grantor?: string; inherit?: boolean; set?: boolean; admin?: boolean } = {},
): string =>
  `${login}->${DESIGNED_BINDINGS[login]}:grantor=${overrides.grantor ?? "postgres"},` +
  `inherit=${overrides.inherit ?? true},set=${overrides.set ?? false},admin=${overrides.admin ?? false}`;

const preflightRow = (
  overrides: Partial<BaselinePreflightRow> = {},
): BaselinePreflightRow => ({
  state: "ABSENT",
  present_objects: 0,
  expected_objects: 40,
  missing_objects: [],
  present_object_names: [],
  missing_prerequisites: [],
  present_roles: [],
  missing_roles: [...FUNCTIONAL_ROLES],
  unsafe_preexisting_roles: [],
  missing_login_roles: [],
  unsafe_login_roles: [],
  unexpected_login_memberships: [],
  // An ABSENT database has no binding edges at all: the baseline has not
  // granted them yet, and nobody else is allowed to have.
  login_binding_edges: [],
  unsafe_login_binding_edges: [],
  duplicate_login_bindings: [],
  missing_login_bindings: [...Object.entries(DESIGNED_BINDINGS)].map(
    ([login, functional]) => `${login}->${functional}`,
  ),
  login_binding_set_paths: [],
  createrole_self_grant: "",
  owner_role_grant_options: [],
  owner_role: "postgres",
  database_name: "postgres",
  server_version_num: 170006,
  database_marker: MARKER,
  owner_is_superuser: false,
  owner_can_create_role: true,
  owner_can_create_schema: true,
  public_schema_public_create: false,
  rls_auto_enable_present: false,
  pg_stat_statements_present: true,
  pg_stat_statements_info_present: true,
  platform_roles: ["anon", "authenticated", "service_role", "supabase_admin"],
  ...overrides,
});

/** A database the baseline has already been applied to, roles and all. */
const completeRow = (
  overrides: Partial<BaselinePreflightRow> = {},
): BaselinePreflightRow =>
  preflightRow({
    state: "COMPLETE",
    present_objects: 40,
    present_roles: [...FUNCTIONAL_ROLES],
    missing_roles: [],
    // A COMPLETE database is one the baseline already bound: exactly one edge
    // per login, carrying exactly the designed options.
    login_binding_edges: Object.keys(DESIGNED_BINDINGS).map((login) => edge(login)),
    missing_login_bindings: [],
    ...overrides,
  });

const baseEnv = (overrides: Record<string, string | undefined> = {}) => ({
  OT_NEUTRAL_PRODUCTION_PROJECT_REF: REF,
  OT_NEUTRAL_PRODUCTION_MARKER_INSTANCE_ID: INSTANCE,
  DIRECT_URL: url("postgres"),
  DATABASE_URL: url("ot_prod_app", 6543, "&pgbouncer=true"),
  OT_NEUTRAL_PRODUCTION_DATABASE_URL: url("ot_prod_neutral_runtime"),
  OT_NEUTRAL_PRODUCTION_DELIVERY_DATABASE_URL: url("ot_prod_neutral_delivery"),
  ...overrides,
});

const cleanLedger = (): LedgerRow[] => [
  {
    migration_name: OT_PRODUCTION_LAST_APPLIED_MIGRATION,
    finished_at: new Date(),
    rolled_back_at: null,
  },
];

const resolvedLedger = (): LedgerRow[] => [
  ...cleanLedger(),
  ...coveredMigrationNames().map((migration_name) => ({
    migration_name,
    finished_at: new Date(),
    rolled_back_at: null,
  })),
];

const PRISMA_BINARY = `/repo/${OT_LOCAL_PRISMA_BINARY}`;

type Recorder = {
  statements: string[];
  deps: BaselineRunnerDeps;
  spawned: string[][];
  /** One entry per in-transaction verification, in order. */
  inTransaction: string[];
  /** One entry per durable, separate-connection verification, in order. */
  durable: boolean[];
};

function makeDeps(options: {
  mode?: BaselineMode;
  env?: Record<string, string | undefined>;
  row?: BaselinePreflightRow;
  ledger?: () => LedgerRow[];
  spawnStatus?: number;
  spawnOutput?: string;
  digestOverride?: Record<string, string>;
} = {}): Recorder {
  const statements: string[] = [];
  const spawned: string[][] = [];
  const inTransaction: string[] = [];
  const durable: boolean[] = [];
  const state = { ledger: options.ledger ?? cleanLedger };
  const pinned = Object.fromEntries(
    manifestPinnedPaths().map((relative, index) => [
      relative,
      index.toString(16).padStart(64, "0"),
    ]),
  );
  const recorder: Recorder = {
    statements,
    spawned,
    inTransaction,
    durable,
    deps: {
      mode: options.mode ?? "apply",
      env: options.env ?? baseEnv({
        [OT_PRODUCTION_APPLY_TOKEN_VAR]: expectedApplyToken(INSTANCE),
      }),
      artifacts: {
        preflight: "--preflight",
        baseline: "--baseline",
        postconditions: "--postconditions",
      },
      observedDigests: options.digestOverride ?? pinned,
      pinnedDigests: pinned,
      owner: {
        async query(sql: string) {
          statements.push(sql);
          if (sql === "--preflight")
            return { rows: [options.row ?? preflightRow()] as unknown as Record<string, unknown>[] };
          return { rows: [] };
        },
      },
      readLedger: async () => state.ledger(),
      // The real wiring issues the postcondition SQL plus the role-inventory
      // and binding queries on this very session; recording the statement is
      // enough to prove it happened inside the open transaction.
      verifyInTransaction: async (session) => {
        await session.query("--postconditions");
        inTransaction.push("in-transaction");
      },
      verifyDurable: async ({ expectLedgerResolved }) => {
        durable.push(expectLedgerResolved);
      },
      prismaBinary: PRISMA_BINARY,
      spawn: (command) => {
        spawned.push([command.command, ...command.args]);
        return {
          status: options.spawnStatus ?? 0,
          output: options.spawnOutput ?? "",
        };
      },
    },
  };
  return recorder;
}

describe("baseline preflight classification", () => {
  test("an untouched Production database is APPLY", () => {
    expect(classifyBaselinePreflight(preflightRow())).toEqual({
      action: "APPLY",
      reasons: [],
    });
  });

  test("a fully applied database is a verified REPLAY", () => {
    expect(classifyBaselinePreflight(completeRow()).action).toBe("REPLAY");
  });

  test("partial state REFUSES and says how partial", () => {
    const result = classifyBaselinePreflight(
      preflightRow({
        state: "PARTIAL",
        present_objects: 9,
        missing_objects: ["relation:ot_neutral_qa_review"],
      }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(/partially present \(9\/40\)/);
    expect(result.reasons.join(" ")).toMatch(/ot_neutral_qa_review/);
  });

  test("refuses a missing prerequisite, an unsupported server, and a weak owner", () => {
    expect(
      classifyBaselinePreflight(
        preflightRow({ missing_prerequisites: ["relation:ot_order"] }),
      ).action,
    ).toBe("REFUSE");
    expect(
      classifyBaselinePreflight(preflightRow({ server_version_num: 160004 })).reasons.join(" "),
    ).toMatch(/not supported/);
    expect(
      classifyBaselinePreflight(preflightRow({ server_version_num: 190000 })).action,
    ).toBe("REFUSE");
    expect(
      classifyBaselinePreflight(preflightRow({ owner_can_create_role: false })).action,
    ).toBe("REFUSE");
  });

  test("accepts PostgreSQL 17 and 18 and refuses 16", () => {
    for (const version of [170000, 170006, 180000, 189999])
      expect(
        classifyBaselinePreflight(preflightRow({ server_version_num: version })).action,
      ).toBe("APPLY");
    expect(
      classifyBaselinePreflight(preflightRow({ server_version_num: 169999 })).action,
    ).toBe("REFUSE");
  });

  test("does not require the owner to be a superuser", () => {
    expect(
      classifyBaselinePreflight(preflightRow({ owner_is_superuser: false })).action,
    ).toBe("APPLY");
  });

  test("refuses while PUBLIC still holds CREATE on schema public", () => {
    const result = classifyBaselinePreflight(
      preflightRow({ public_schema_public_create: true }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(/PUBLIC still holds CREATE/);
  });

  test("does not require rls_auto_enable to exist", () => {
    expect(
      classifyBaselinePreflight(preflightRow({ rls_auto_enable_present: false })).action,
    ).toBe("APPLY");
  });

  /**
   * Roles are cluster-global: they survive a dropped schema and a platform
   * operator can create them ahead of time. 02_baseline.sql adopts a pristine
   * pre-created role, so a classification that called that state PARTIAL was
   * refusing a database the body was written to handle.
   */
  test("pristine pre-created roles do not make an empty database PARTIAL", () => {
    const result = classifyBaselinePreflight(
      preflightRow({
        state: "ABSENT",
        present_objects: 0,
        present_roles: [...FUNCTIONAL_ROLES],
        missing_roles: [],
      }),
    );
    expect(result).toEqual({ action: "APPLY", reasons: [] });
  });

  test("a pre-created role with unsafe attributes is refused by name", () => {
    const result = classifyBaselinePreflight(
      preflightRow({
        present_roles: ["ot_neutral_runtime"],
        missing_roles: FUNCTIONAL_ROLES.filter((r) => r !== "ot_neutral_runtime"),
        unsafe_preexisting_roles: ["ot_neutral_runtime"],
      }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(
      /pre-existing roles carry unsafe attributes: ot_neutral_runtime/,
    );
  });

  test("a COMPLETE schema whose roles are gone is not a replay", () => {
    const result = classifyBaselinePreflight(
      preflightRow({
        state: "COMPLETE",
        present_objects: 40,
        present_roles: ["ot_neutral_runtime"],
        missing_roles: ["ot_commerce_capture_owner"],
      }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(
      /complete but functional roles are missing: ot_commerce_capture_owner/,
    );
  });

  test("a COMPLETE schema with every role present is a REPLAY", () => {
    expect(
      classifyBaselinePreflight(
        completeRow(),
      ).action,
    ).toBe("REPLAY");
  });

  /**
   * The three restricted logins are the mirror image of the functional roles:
   * provisioned out-of-band because minting one means choosing a password, and
   * bound by exactly one edge each that the baseline DOES own. All three
   * provisioning defects are classified here so a rehearsal names them on its
   * receipt rather than the operator meeting them as a RAISE part-way through
   * the body.
   */
  test("an unprovisioned restricted login is refused by name", () => {
    const result = classifyBaselinePreflight(
      preflightRow({ missing_login_roles: ["ot_prod_neutral_delivery"] }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(
      /restricted Production logins are not provisioned: ot_prod_neutral_delivery/,
    );
  });

  test("a restricted login carrying ambient authority is refused by name", () => {
    const result = classifyBaselinePreflight(
      preflightRow({ unsafe_login_roles: ["ot_prod_app"] }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(
      /restricted Production logins are not pristine: ot_prod_app/,
    );
  });

  test("a restricted login that already reaches another role is refused with the edge", () => {
    const result = classifyBaselinePreflight(
      preflightRow({
        unexpected_login_memberships: ["ot_prod_app->ot_neutral_runtime"],
      }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(
      /already reach roles this rollout did not design: ot_prod_app->ot_neutral_runtime/,
    );
  });

  /**
   * THE TWO-GRANTOR BYPASS, classified.
   *
   * `pg_auth_members` is keyed on (roleid, member, GRANTOR), so two grantors can
   * record two edges for the same login -> functional pair and PostgreSQL unions
   * the options on them. The old `unexpected_login_memberships` list could never
   * see it: that query excluded the designed functional role from what it looked
   * at, which is precisely where the second edge lives.
   *
   * Four separate refusals, because in a real bypass they do not all fire.
   */
  test("a SET path from a login to its functional role is refused on every state", () => {
    for (const row of [
      preflightRow({ login_binding_set_paths: ["ot_prod_app->ot_neutral_app_reader"] }),
      completeRow({ login_binding_set_paths: ["ot_prod_app->ot_neutral_app_reader"] }),
    ]) {
      const result = classifyBaselinePreflight(row);
      expect(result.action).toBe("REFUSE");
      expect(result.reasons.join(" ")).toMatch(
        /can SET ROLE to their functional role: ot_prod_app->ot_neutral_app_reader/,
      );
    }
  });

  test("a binding recorded by two grantors is refused by name", () => {
    const result = classifyBaselinePreflight(
      completeRow({
        login_binding_edges: [
          edge("ot_prod_app"),
          edge("ot_prod_app", { grantor: "supabase_admin", set: true }),
          edge("ot_prod_neutral_runtime"),
          edge("ot_prod_neutral_delivery"),
        ],
        duplicate_login_bindings: ["ot_prod_app->ot_neutral_app_reader x2"],
        unsafe_login_binding_edges: [
          edge("ot_prod_app", { grantor: "supabase_admin", set: true }),
        ],
      }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(
      /recorded by more than one grantor: ot_prod_app->ot_neutral_app_reader x2/,
    );
    expect(result.reasons.join(" ")).toMatch(
      /are not ADMIN FALSE, INHERIT TRUE, SET FALSE: ot_prod_app->ot_neutral_app_reader:grantor=supabase_admin/,
    );
  });

  /**
   * "Exactly this edge and no other" is not provable by adding one on top of
   * somebody else's, so on an ABSENT database the pair must have no edge at all.
   */
  test("a pre-existing binding on an ABSENT database is refused", () => {
    const result = classifyBaselinePreflight(
      preflightRow({ login_binding_edges: [edge("ot_prod_app")] }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(
      /already bound to their functional role, which this baseline has not yet granted/,
    );
  });

  /** The mirror image: a complete schema whose binding has gone missing. */
  test("a COMPLETE database missing a binding is refused", () => {
    const result = classifyBaselinePreflight(
      completeRow({
        login_binding_edges: [edge("ot_prod_neutral_runtime"), edge("ot_prod_neutral_delivery")],
        missing_login_bindings: ["ot_prod_app->ot_neutral_app_reader"],
      }),
    );
    expect(result.action).toBe("REFUSE");
    expect(result.reasons.join(" ")).toMatch(
      /complete but restricted Production login bindings are missing: ot_prod_app->ot_neutral_app_reader/,
    );
  });

  /**
   * Section 11 of the body revokes the PUBLIC grant on both statistics views and
   * aborts if either is absent. That abort used to be the FIRST an operator
   * heard of it — forty statements into a transaction, as
   * 'statistics-view topology is invalid'. It is a preflight refusal now, and it
   * is never repaired: CREATE EXTENSION is a platform operation with its own
   * review.
   */
  test("a missing pg_stat_statements view is a preflight refusal, not a mid-transaction abort", () => {
    const stats = classifyBaselinePreflight(
      preflightRow({ pg_stat_statements_present: false }),
    );
    expect(stats.action).toBe("REFUSE");
    expect(stats.reasons.join(" ")).toMatch(
      /statistics views the baseline closes to PUBLIC are absent: extensions\.pg_stat_statements$/,
    );

    const info = classifyBaselinePreflight(
      preflightRow({ pg_stat_statements_info_present: false }),
    );
    expect(info.action).toBe("REFUSE");
    expect(info.reasons.join(" ")).toMatch(/extensions\.pg_stat_statements_info/);

    const both = classifyBaselinePreflight(
      preflightRow({
        pg_stat_statements_present: false,
        pg_stat_statements_info_present: false,
      }),
    );
    expect(both.reasons.join(" ")).toMatch(
      /extensions\.pg_stat_statements, extensions\.pg_stat_statements_info/,
    );
  });

  test("a COMPLETE database is also refused while a statistics view is missing", () => {
    expect(
      classifyBaselinePreflight(
        completeRow({ pg_stat_statements_info_present: false }),
      ).action,
    ).toBe("REFUSE");
  });
});

describe("migration ledger gates", () => {
  const partiallyResolvedLedger = (count: number): LedgerRow[] => [
    ...cleanLedger(),
    ...coveredMigrationNames()
      .slice(0, count)
      .map((migration_name) => ({
        migration_name,
        finished_at: new Date(),
        rolled_back_at: null,
      })),
  ];

  test("a fresh Production ledger has nothing resolved and everything pending", () => {
    expect(classifyLedgerPreState(cleanLedger())).toEqual({
      alreadyResolved: [],
      pending: coveredMigrationNames(),
    });
  });

  test("refuses when the last applied migration is absent or unfinished", () => {
    expect(() => classifyLedgerPreState([])).toThrow(
      /is not recorded as applied/,
    );
    expect(() =>
      classifyLedgerPreState([{ ...cleanLedger()[0]!, finished_at: null }]),
    ).toThrow(/is not recorded as applied/);
  });

  /**
   * `prisma migrate resolve` is one process per migration, so an interrupted
   * Phase 6 leaves the ledger genuinely half-written. The previous gate refused
   * on any covered migration being present at all, which made the only exit from
   * that state a hand-edit of `_prisma_migrations` in Production.
   */
  test("a partially resolved ledger is a resumable split, not a refusal", () => {
    const covered = coveredMigrationNames();
    expect(classifyLedgerPreState(partiallyResolvedLedger(7))).toEqual({
      alreadyResolved: covered.slice(0, 7),
      pending: covered.slice(7),
    });
  });

  test("a fully resolved ledger leaves nothing pending, and is idempotent", () => {
    expect(classifyLedgerPreState(resolvedLedger())).toEqual({
      alreadyResolved: coveredMigrationNames(),
      pending: [],
    });
  });

  test("refuses a covered migration that is unfinished, rolled back or duplicated", () => {
    const name = coveredMigrationNames()[0]!;
    expect(() =>
      classifyLedgerPreState([
        ...cleanLedger(),
        { migration_name: name, finished_at: null, rolled_back_at: null },
      ]),
    ).toThrow(/not recorded as cleanly applied/);
    expect(() =>
      classifyLedgerPreState([
        ...cleanLedger(),
        {
          migration_name: name,
          finished_at: new Date(),
          rolled_back_at: new Date(),
        },
      ]),
    ).toThrow(/not recorded as cleanly applied/);
    expect(() =>
      classifyLedgerPreState([
        ...partiallyResolvedLedger(1),
        ...partiallyResolvedLedger(1).slice(1),
      ]),
    ).toThrow(/appears in the ledger 2 times/);
  });

  test("post-state requires every covered migration cleanly applied", () => {
    expect(() => assertLedgerPostState(resolvedLedger())).not.toThrow();
    expect(() => assertLedgerPostState(cleanLedger())).toThrow(/is missing/);
    expect(() =>
      assertLedgerPostState(
        resolvedLedger().map((row, index) =>
          index === 2 ? { ...row, rolled_back_at: new Date() } : row,
        ),
      ),
    ).toThrow(/not recorded as cleanly applied/);
  });
});

describe("rehearsal entrypoint", () => {
  const rehearsal = (options: Parameters<typeof makeDeps>[0] = {}) =>
    makeDeps({ mode: "rehearsal", env: baseEnv(), ...options });

  test("applies, proves EVERY postcondition inside the transaction, and rolls back", async () => {
    const recorder = rehearsal();
    const outcome = await runNeutralProductionBaseline(recorder.deps);

    expect(outcome).toMatchObject({
      mode: "rehearsal",
      action: "APPLY",
      committed: false,
      resolved: false,
    });
    expect(recorder.statements).toEqual([
      "BEGIN",
      "--preflight",
      "--baseline",
      "--postconditions",
      "ROLLBACK",
    ]);
    // The role inventory and binding graph ran here too, inside the open
    // transaction. A rehearsal that proved less than the apply does could pass
    // where the apply then fails, which is the one thing it exists to rule out.
    expect(recorder.inTransaction).toEqual(["in-transaction"]);
    // Nothing committed, so nothing to verify durably and nothing to resolve.
    expect(recorder.durable).toEqual([]);
    expect(recorder.spawned).toEqual([]);
  });

  /**
   * The whole point of a separate entrypoint: a token left exported from an
   * earlier attempt must not be able to turn a rehearsal into a mutation.
   */
  test("ignores an apply token that is exactly right for this database", async () => {
    const recorder = rehearsal({
      env: baseEnv({
        [OT_PRODUCTION_APPLY_TOKEN_VAR]: expectedApplyToken(INSTANCE),
        [OT_PRODUCTION_RESOLVE_TOKEN_VAR]: expectedResolveToken(INSTANCE),
      }),
    });
    const outcome = await runNeutralProductionBaseline(recorder.deps);
    expect(outcome.committed).toBe(false);
    expect(outcome.resolved).toBe(false);
    expect(recorder.statements).toContain("ROLLBACK");
    expect(recorder.statements).not.toContain("COMMIT");
    expect(recorder.spawned).toEqual([]);
  });

  test("withoutConfirmationTokens strips both tokens and keeps everything else", () => {
    const stripped = withoutConfirmationTokens(
      baseEnv({
        [OT_PRODUCTION_APPLY_TOKEN_VAR]: expectedApplyToken(INSTANCE),
        [OT_PRODUCTION_RESOLVE_TOKEN_VAR]: expectedResolveToken(INSTANCE),
      }),
    );
    expect(OT_PRODUCTION_APPLY_TOKEN_VAR in stripped).toBe(false);
    expect(OT_PRODUCTION_RESOLVE_TOKEN_VAR in stripped).toBe(false);
    expect(stripped.DIRECT_URL).toBe(url("postgres"));
  });
});

describe("guarded runner", () => {
  test("the apply entrypoint refuses a wrong token instead of rehearsing", async () => {
    const wrong = makeDeps({
      env: baseEnv({
        [OT_PRODUCTION_APPLY_TOKEN_VAR]: expectedApplyToken(
          "11111111-2222-4333-8444-555555555555",
        ),
      }),
    });
    await expect(runNeutralProductionBaseline(wrong.deps)).rejects.toThrow(
      /does not fall back to a rehearsal/,
    );
    expect(wrong.statements).toEqual([]);

    const missing = makeDeps({ env: baseEnv() });
    await expect(runNeutralProductionBaseline(missing.deps)).rejects.toThrow(
      new RegExp(OT_PRODUCTION_APPLY_TOKEN_VAR),
    );
    expect(missing.statements).toEqual([]);
  });

  test("commits with the exact apply token and verifies durably afterwards", async () => {
    const recorder = makeDeps();
    const outcome = await runNeutralProductionBaseline(recorder.deps);
    expect(outcome).toMatchObject({ mode: "apply", committed: true });
    expect(recorder.statements).toContain("COMMIT");
    expect(recorder.statements).not.toContain("ROLLBACK");
    expect(recorder.inTransaction).toEqual(["in-transaction"]);
    expect(recorder.durable).toEqual([false]);
    expect(recorder.spawned).toEqual([]);
  });

  test("resolves the ledger only after commit and verification, in manifest order", async () => {
    const recorder = makeDeps({
      env: baseEnv({
        [OT_PRODUCTION_APPLY_TOKEN_VAR]: expectedApplyToken(INSTANCE),
        [OT_PRODUCTION_RESOLVE_TOKEN_VAR]: expectedResolveToken(INSTANCE),
      }),
      ledger: (() => {
        let call = 0;
        return () => (call++ === 0 ? cleanLedger() : resolvedLedger());
      })(),
    });
    const outcome = await runNeutralProductionBaseline(recorder.deps);

    expect(outcome.resolved).toBe(true);
    expect(recorder.spawned).toHaveLength(coveredMigrationNames().length);
    // The Prisma CLI from this checkout, never `npx`.
    expect(recorder.spawned[0]).toEqual([
      PRISMA_BINARY,
      "migrate",
      "resolve",
      "--applied",
      "20260912000000_add_ot_order_attribution",
    ]);
    expect(recorder.spawned.at(-1)?.at(-1)).toBe(
      "20260916220000_harden_ot_supabase_public_acl",
    );
    // Durably verified before the ledger was touched, and again afterwards —
    // and the second pass is the one that proves ledger exactness.
    expect(recorder.durable).toEqual([false, true]);
  });

  /**
   * Phase 6 interrupted part-way: the baseline is committed, the schema is
   * COMPLETE, and seven of the fourteen entries are already recorded. Re-running
   * the same command has to finish the job rather than refuse it, and must not
   * re-issue `resolve --applied` for a migration Prisma already records.
   */
  test("resumes a partially resolved ledger and skips what is already recorded", async () => {
    const covered = coveredMigrationNames();
    const partial = (): LedgerRow[] => [
      ...cleanLedger(),
      ...covered.slice(0, 7).map((migration_name) => ({
        migration_name,
        finished_at: new Date(),
        rolled_back_at: null,
      })),
    ];
    const recorder = makeDeps({
      row: completeRow(),
      env: baseEnv({
        [OT_PRODUCTION_APPLY_TOKEN_VAR]: expectedApplyToken(INSTANCE),
        [OT_PRODUCTION_RESOLVE_TOKEN_VAR]: expectedResolveToken(INSTANCE),
      }),
      ledger: (() => {
        let call = 0;
        return () => (call++ === 0 ? partial() : resolvedLedger());
      })(),
    });
    const outcome = await runNeutralProductionBaseline(recorder.deps);

    expect(outcome.action).toBe("REPLAY");
    expect(outcome.resolved).toBe(true);
    expect(outcome.alreadyResolved).toEqual(covered.slice(0, 7));
    expect(recorder.spawned.map((argv) => argv.at(-1))).toEqual(covered.slice(7));
    expect(recorder.durable).toEqual([false, true]);
  });

  test("an already fully resolved ledger spawns nothing and still verifies", async () => {
    const recorder = makeDeps({
      row: completeRow(),
      env: baseEnv({
        [OT_PRODUCTION_APPLY_TOKEN_VAR]: expectedApplyToken(INSTANCE),
        [OT_PRODUCTION_RESOLVE_TOKEN_VAR]: expectedResolveToken(INSTANCE),
      }),
      ledger: resolvedLedger,
    });
    const outcome = await runNeutralProductionBaseline(recorder.deps);
    expect(outcome.resolved).toBe(true);
    expect(recorder.spawned).toEqual([]);
    expect(recorder.durable).toEqual([false, true]);
  });

  test("a ledger that names covered migrations the schema lacks is a mismatch, not a resume", async () => {
    const recorder = makeDeps({
      ledger: () => [
        ...cleanLedger(),
        {
          migration_name: coveredMigrationNames()[0]!,
          finished_at: new Date(),
          rolled_back_at: null,
        },
      ],
    });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /mismatch, not a resumable resolve/,
    );
    expect(recorder.statements).toEqual(["BEGIN", "--preflight", "ROLLBACK"]);
  });

  test("stops before opening a transaction when a feature flag is active", async () => {
    const recorder = makeDeps({
      env: baseEnv({ OT_NEUTRAL_DELIVERY_ENABLED: "true" }),
    });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /OT_NEUTRAL_DELIVERY_ENABLED/,
    );
    expect(recorder.statements).toEqual([]);
  });

  test("stops before opening a transaction when DIRECT_URL is absent", async () => {
    const recorder = makeDeps({ env: baseEnv({ DIRECT_URL: undefined }) });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /DIRECT_URL/,
    );
    expect(recorder.statements).toEqual([]);
  });

  test("stops before opening a transaction when an artifact was tampered with", async () => {
    const tampered = Object.fromEntries(
      manifestPinnedPaths().map((relative) => [relative, "f".repeat(64)]),
    );
    const recorder = makeDeps({ digestOverride: tampered });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /artifact integrity failed/,
    );
    expect(recorder.statements).toEqual([]);
  });

  test("refuses partial state without executing the body", async () => {
    const recorder = makeDeps({
      row: preflightRow({
        state: "PARTIAL",
        present_objects: 3,
        missing_objects: ["relation:ot_neutral_refund_work"],
      }),
    });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /partially present/,
    );
    expect(recorder.statements).toEqual(["BEGIN", "--preflight", "ROLLBACK"]);
  });

  test("a complete database replays the postconditions without the body", async () => {
    const recorder = makeDeps({ row: completeRow() });
    const outcome = await runNeutralProductionBaseline(recorder.deps);
    expect(outcome.action).toBe("REPLAY");
    expect(recorder.statements).toEqual([
      "BEGIN",
      "--preflight",
      "--postconditions",
      "COMMIT",
    ]);
  });

  test("rolls back and rethrows when the postconditions fail", async () => {
    const recorder = makeDeps();
    recorder.deps.owner.query = async (sql: string) => {
      recorder.statements.push(sql);
      if (sql === "--preflight") return { rows: [preflightRow()] as unknown as Record<string, unknown>[] };
      if (sql === "--postconditions") throw new Error("postconditions failed: x");
      return { rows: [] };
    };
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /postconditions failed/,
    );
    expect(recorder.statements).toContain("ROLLBACK");
    expect(recorder.statements).not.toContain("COMMIT");
  });

  test("a failing resolve command aborts, names the recovery, and carries redacted output", async () => {
    const recorder = makeDeps({
      env: baseEnv({
        [OT_PRODUCTION_APPLY_TOKEN_VAR]: expectedApplyToken(INSTANCE),
        [OT_PRODUCTION_RESOLVE_TOKEN_VAR]: expectedResolveToken(INSTANCE),
      }),
      spawnStatus: 1,
      spawnOutput: "P3009 datasource [REDACTED_DATABASE_URL]",
    });
    const error = await runNeutralProductionBaseline(recorder.deps).then(
      () => null,
      (thrown: unknown) => thrown as Error,
    );
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("expected baseline failure");
    expect(error.message).toMatch(/prisma migrate resolve failed/);
    expect(error.message).toMatch(/Re-run the SAME apply command/);
    expect(error.message).toMatch(/P3009 datasource \[REDACTED_DATABASE_URL\]/);
    // The ledger was never claimed correct and the second verification never ran.
    expect(recorder.durable).toEqual([false]);
  });

  /**
   * The apply token names a marker instance id, but the id is a value an
   * operator typed into the environment. Only the durable marker on the other
   * end of this connection proves which database the token actually authorized.
   */
  test("refuses when the owner connection reports no database marker", async () => {
    const recorder = makeDeps({ row: preflightRow({ database_marker: null }) });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /missing the durable Production environment marker/,
    );
    expect(recorder.statements).toContain("ROLLBACK");
    expect(recorder.statements).not.toContain("--baseline");
  });

  test("refuses a marker for a different instance even with a matching token", async () => {
    const other = JSON.stringify({
      schema: "ot.database-environment.v1",
      purpose: "ot-neutral-report",
      environment: "production",
      production: true,
      projectRef: REF,
      instanceId: "11111111-2222-4333-8444-555555555555",
    });
    const recorder = makeDeps({ row: preflightRow({ database_marker: other }) });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /does not match the approved instance/,
    );
    expect(recorder.statements).toContain("ROLLBACK");
    expect(recorder.statements).not.toContain("COMMIT");
  });

  test("refuses a marker for a different Supabase project", async () => {
    const foreign = JSON.stringify({
      schema: "ot.database-environment.v1",
      purpose: "ot-neutral-report",
      environment: "production",
      production: true,
      projectRef: "abcdefghijklmnopqrst",
      instanceId: INSTANCE,
    });
    const recorder = makeDeps({
      row: preflightRow({ database_marker: foreign }),
    });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /approved OT Production Supabase project/,
    );
    expect(recorder.statements).not.toContain("COMMIT");
  });

  test("refuses a Preview-shaped marker outright", async () => {
    const preview = JSON.stringify({
      schema: "ot.database-environment.v1",
      purpose: "ot-neutral-report",
      environment: "preview",
      production: false,
      projectRef: REF,
      instanceId: INSTANCE,
    });
    const recorder = makeDeps({
      row: preflightRow({ database_marker: preview }),
    });
    await expect(runNeutralProductionBaseline(recorder.deps)).rejects.toThrow(
      /not explicitly marked as the OT Production database/,
    );
    expect(recorder.statements).not.toContain("COMMIT");
  });
});

describe("operator script source contracts", () => {
  const read = (relative: string) =>
    fs.readFileSync(path.join(process.cwd(), relative), "utf8");

  test("the operator entrypoint spawns with argument arrays and never a shell", () => {
    const source = read("scripts/neutral-production-baseline-entrypoint.ts");
    expect(source).toContain("shell: false");
    expect(source).not.toMatch(/exec\(|execSync\(/);
    expect(source).toContain("assertOperatorMigrationDatasource");
  });

  /**
   * `npx` resolves a missing package by downloading one. An operator path that
   * can fetch and execute a fresh binary mid-rollout is a supply chain the
   * rollout packet never reviewed, so the CLI comes from this checkout and its
   * absence is a refusal.
   */
  test("the resolve never runs npx and never inherits child stdio", () => {
    const source = read("scripts/neutral-production-baseline-entrypoint.ts");
    expect(source).toContain("OT_LOCAL_PRISMA_BINARY");
    expect(source).not.toMatch(/["']npx["']/);
    expect(source).toContain('stdio: ["ignore", "pipe", "pipe"]');
    expect(source).toContain("redactProductionDiagnostic");
    expect(
      read("lib/fulfillment/neutral-production-baseline-manifest.ts"),
    ).not.toMatch(/command:\s*["']npx["']/);
  });

  /**
   * Two entrypoints, and the rehearsal one is not merely "the apply script with
   * the token unset". It deletes both tokens from its own process environment
   * before anything is read, connected to, or spawned.
   */
  test("rehearsal and apply are distinct entrypoints with distinct modes", () => {
    const rehearse = read("scripts/rehearse-neutral-production-baseline.ts");
    const apply = read("scripts/apply-neutral-production-baseline.ts");
    expect(rehearse).toContain('runProductionBaselineEntrypoint("rehearsal")');
    expect(rehearse).not.toContain('"apply"');
    expect(apply).toContain('runProductionBaselineEntrypoint("apply")');
    expect(apply).not.toContain('"rehearsal"');

    const entrypoint = read("scripts/neutral-production-baseline-entrypoint.ts");
    expect(entrypoint).toMatch(
      /delete process\.env\[OT_PRODUCTION_APPLY_TOKEN_VAR\]/,
    );
    expect(entrypoint).toMatch(
      /delete process\.env\[OT_PRODUCTION_RESOLVE_TOKEN_VAR\]/,
    );
  });

  test("package.json points the two commands at the two scripts", () => {
    const scripts = (
      JSON.parse(read("package.json")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["neutral-report:production-baseline-rehearsal"]).toContain(
      "scripts/rehearse-neutral-production-baseline.ts",
    );
    expect(scripts["neutral-report:production-baseline-apply"]).toContain(
      "scripts/apply-neutral-production-baseline.ts",
    );
  });

  test("the Production verifier never imports the write-capable Preview runner", () => {
    for (const relative of [
      "lib/fulfillment/neutral-production-verifier.ts",
      "scripts/verify-neutral-production-postconditions.ts",
    ]) {
      const source = read(relative);
      expect(source).not.toContain("neutral-preview-acceptance");
      expect(source).not.toContain("runTransactionalAcceptance");
      expect(source).not.toContain("applyAcceptanceFlags");
    }
    expect(read("lib/fulfillment/neutral-production-verifier.ts")).toContain(
      "BEGIN READ ONLY",
    );
  });

  /**
   * What the baseline transaction actually EXECUTES.
   *
   * The header of 02_baseline.sql explains, at length, why it does not require
   * `rolsuper`, why it never references `rls_auto_enable`, and why it drops the
   * `ot_preview_app` fingerprint. Grepping the raw file for those names
   * therefore matches the explanation rather than the code, and a contract test
   * that passes only while the file stays undocumented is worse than no test.
   *
   * Dollar-quoted bodies are stripped separately and for a different reason:
   * plpgsql inside `CREATE FUNCTION` is source text, not a statement this
   * transaction runs. The reversal guard legitimately contains UPDATEs and the
   * publish function legitimately contains an INSERT; both execute long after
   * the baseline commits, if ever. What must contain no DML is the statement
   * stream itself.
   */
  const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
  /**
   * Statement STARTS, not keyword occurrences. `GRANT UPDATE (...)`,
   * `BEFORE UPDATE ON`, `FOR UPDATE TO`, `ON DELETE CASCADE` and
   * `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` all contain DML keywords and are
   * none of them DML, so the only sound question is what each statement begins
   * with.
   */
  const statementStarts = (sql: string) =>
    stripComments(sql)
      // Tag-generic: `$$...$$` and `$tag$...$tag$` alike, so a future body that
      // needs a tag to nest does not silently stop being stripped.
      .replace(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, " OMITTED_BODY ")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => statement.split(/\s+/)[0]!.toUpperCase());

  test("the baseline SQL never writes an application row or the Prisma ledger", () => {
    const body = read("prisma/production-baseline/02_baseline.sql");
    const executable = stripComments(body);

    expect(executable).not.toMatch(/\b_prisma_migrations\b/);
    // An allowlist rather than a denylist, so a verb nobody thought of —
    // COMMENT, SET, COPY, a future DML spelling — is a failure by default
    // instead of something the denylist happened not to mention.
    const starts = statementStarts(body);
    expect(starts.length).toBeGreaterThan(50);
    for (const verb of new Set(starts))
      expect(["CREATE", "ALTER", "GRANT", "REVOKE", "DO"]).toContain(verb);
    expect(executable).not.toContain("ot_preview_app");
    expect(executable).not.toContain("rls_auto_enable");
    expect(executable).not.toContain("iyaxdrehtxsfkaexgxls");
    // Role-attribute validation may inspect `rolsuper`; the baseline must not
    // demand that the connected migration role itself be superuser.
    expect(executable).not.toMatch(/current_user[^;]{0,160}rolsuper|rolsuper[^;]{0,160}current_user/i);
  });

  /**
   * The baseline binds the three restricted logins and never mints one.
   *
   * Creating a login means choosing a password, and a migration that can mint a
   * Production credential can mint a back door — so the logins arrive from the
   * protected Supabase Management API flow and the baseline's whole claim on
   * them is one membership edge each.
   */
  test("the baseline grants exactly the three login bindings and creates no login", () => {
    const body = read("prisma/production-baseline/02_baseline.sql");
    const executable = stripComments(body);

    for (const [login, functional] of [
      ["ot_prod_app", "ot_neutral_app_reader"],
      ["ot_prod_neutral_runtime", "ot_neutral_runtime"],
      ["ot_prod_neutral_delivery", "ot_neutral_delivery_runtime"],
    ]) {
      expect(executable).toContain(`('${login}', '${functional}')`);
    }
    // `LOGIN` never appears as a CREATE ROLE attribute: every role the baseline
    // creates is NOLOGIN, and the three that do log in are not created here.
    expect(executable).not.toMatch(/CREATE ROLE\s+\S+[^;]*?(?<!NO)LOGIN/i);
    expect(executable).toMatch(/INHERIT TRUE, SET FALSE/);
  });

  test("the postconditions prove the three bindings rather than assuming them", () => {
    const source = read("prisma/production-baseline/03_postconditions.sql");
    for (const login of [
      "ot_prod_app",
      "ot_prod_neutral_runtime",
      "ot_prod_neutral_delivery",
    ])
      expect(stripComments(source)).toContain(`'${login}'`);
    expect(source).toMatch(/m\.inherit_option AND NOT m\.set_option/);
  });

  /**
   * The predicate that proves the superseded single-action admin-event CHECK is
   * gone used to anchor on two parentheses while reading the one-parenthesis
   * pretty rendering, so it could never match. Its replacement normalizes the
   * rendering before matching; a plain two-paren literal reappearing here would
   * be the same defect coming back.
   */
  test("the superseded-CHECK predicate is rendering-agnostic", () => {
    const source = read("prisma/production-baseline/03_postconditions.sql");
    expect(source).not.toContain(
      "'^CHECK \\(\\(action = ''ENTER_MANUAL_REVIEW''::text\\)\\)$'",
    );
    expect(source).toContain("regexp_replace(pg_get_constraintdef(c.oid, true)");
  });

  test("the prose that explains those omissions is still present", () => {
    // The stripping above is only sound while the reasons live in comments.
    const body = read("prisma/production-baseline/02_baseline.sql");
    for (const reason of ["rolsuper", "rls_auto_enable", "ot_preview_app"])
      expect(body).toContain(reason);
  });

  test("the baseline SQL activates no feature and pins no Preview catalog digest", () => {
    const body = read("prisma/production-baseline/02_baseline.sql");
    for (const flag of [
      "OT_NEUTRAL_REPORT_CHECKOUT_ENABLED",
      "OT_NEUTRAL_DELIVERY_ENABLED",
      "OT_T2_PACKET_DOWNLOAD_ENABLED",
    ])
      expect(body).not.toContain(flag);
    expect(body).not.toContain("8782889552b478d71c5ab63e2bace721");
    expect(body).not.toContain("27b99eb0aada08c4a93990a35f2d0e1c");
  });
});
