import fs from "node:fs";
import path from "node:path";
import {
  assertProductionDatabaseMarker,
  assertProductionLedgerExactness,
  assertProductionRoleBindings,
  assertProductionRoleInventory,
  redactProductionDiagnostic,
  runNeutralProductionPostconditionChecks,
  verifyNeutralProductionPostconditions,
  type ProductionBindingRow,
  type ProductionLedgerRow,
  type ProductionRoleRow,
} from "@/lib/fulfillment/neutral-production-verifier";
import {
  OT_PRODUCTION_LAST_APPLIED_MIGRATION,
  coveredMigrationNames,
} from "@/lib/fulfillment/neutral-production-baseline-manifest";
import {
  OT_PRODUCTION_PROJECT_REF,
  readApprovedProductionDatabase,
} from "@/lib/fulfillment/neutral-production-identity";

const INSTANCE = "6a5c0f2e-3b1d-4e7a-9c88-2f4b6d0a1e33";
const EXPECTED_DATABASE = {
  projectRef: OT_PRODUCTION_PROJECT_REF,
  markerInstanceId: INSTANCE,
};
const marker = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: "ot.database-environment.v1",
    purpose: "ot-neutral-report",
    environment: "production",
    production: true,
    projectRef: OT_PRODUCTION_PROJECT_REF,
    instanceId: INSTANCE,
    ...overrides,
  });

const ledger = (): ProductionLedgerRow[] => [
  {
    migration_name: OT_PRODUCTION_LAST_APPLIED_MIGRATION,
    finished_at: new Date(),
    rolled_back_at: null,
  },
  ...coveredMigrationNames().map((migration_name) => ({
    migration_name,
    finished_at: new Date(),
    rolled_back_at: null,
  })),
];

const role = (
  rolname: string,
  overrides: Partial<ProductionRoleRow> = {},
): ProductionRoleRow => ({
  rolname,
  rolcanlogin: false,
  rolinherit: false,
  rolsuper: false,
  rolcreaterole: false,
  rolcreatedb: false,
  rolreplication: false,
  rolbypassrls: false,
  schema_usage: true,
  direct_schema_create: false,
  owned_relations: 0,
  owned_routines: 0,
  ...overrides,
});

const inventory = (
  overrides: Record<string, Partial<ProductionRoleRow>> = {},
): ProductionRoleRow[] => [
  role("ot_neutral_runtime", overrides.ot_neutral_runtime),
  role("ot_neutral_app_reader", overrides.ot_neutral_app_reader),
  role("ot_neutral_delivery_runtime", overrides.ot_neutral_delivery_runtime),
  role("ot_neutral_reversal_guard_owner", {
    owned_routines: 1,
    ...overrides.ot_neutral_reversal_guard_owner,
  }),
  role("ot_commerce_capture_owner", {
    owned_relations: 1,
    owned_routines: 2,
    ...overrides.ot_commerce_capture_owner,
  }),
  role("ot_prod_app", { rolcanlogin: true, rolinherit: true, ...overrides.ot_prod_app }),
  role("ot_prod_neutral_runtime", {
    rolcanlogin: true,
    rolinherit: true,
    ...overrides.ot_prod_neutral_runtime,
  }),
  role("ot_prod_neutral_delivery", {
    rolcanlogin: true,
    rolinherit: true,
    ...overrides.ot_prod_neutral_delivery,
  }),
];

const binding = (
  login: string,
  functional: string,
  overrides: Partial<ProductionBindingRow> = {},
): ProductionBindingRow => ({
  login,
  functional,
  can_set: false,
  edge_count: 1,
  exact_edge_count: 1,
  total_edge_count: 1,
  ...overrides,
});

const bindings = (
  overrides: Record<string, Partial<ProductionBindingRow>> = {},
): ProductionBindingRow[] => [
  binding("ot_prod_app", "ot_neutral_app_reader", overrides.ot_prod_app),
  binding(
    "ot_prod_neutral_runtime",
    "ot_neutral_runtime",
    overrides.ot_prod_neutral_runtime,
  ),
  binding(
    "ot_prod_neutral_delivery",
    "ot_neutral_delivery_runtime",
    overrides.ot_prod_neutral_delivery,
  ),
];

describe("ledger exactness", () => {
  test("accepts a fully resolved Production ledger", () => {
    expect(() => assertProductionLedgerExactness(ledger())).not.toThrow();
  });

  test("refuses a missing, duplicated, unfinished or rolled-back entry", () => {
    expect(() => assertProductionLedgerExactness(ledger().slice(1))).toThrow(
      /is absent from the ledger/,
    );
    expect(() =>
      assertProductionLedgerExactness([...ledger(), ledger()[3]!]),
    ).toThrow(/appears 2 times/);
    expect(() =>
      assertProductionLedgerExactness(
        ledger().map((row, index) =>
          index === 4 ? { ...row, finished_at: null } : row,
        ),
      ),
    ).toThrow(/not recorded as cleanly applied/);
    expect(() =>
      assertProductionLedgerExactness(
        ledger().map((row, index) =>
          index === 5 ? { ...row, rolled_back_at: new Date() } : row,
        ),
      ),
    ).toThrow(/rolled back/);
  });
});

describe("role inventory", () => {
  test("accepts the exact post-baseline inventory", () => {
    expect(() => assertProductionRoleInventory(inventory())).not.toThrow();
  });

  test("refuses a functional role that can log in or carries authority", () => {
    expect(() =>
      assertProductionRoleInventory(
        inventory({ ot_neutral_runtime: { rolcanlogin: true } }),
      ),
    ).toThrow(/carries authority it must not have/);
    expect(() =>
      assertProductionRoleInventory(
        inventory({ ot_neutral_app_reader: { rolbypassrls: true } }),
      ),
    ).toThrow(/carries authority it must not have/);
  });

  test("refuses a direct CREATE on schema public anywhere", () => {
    expect(() =>
      assertProductionRoleInventory(
        inventory({ ot_neutral_delivery_runtime: { direct_schema_create: true } }),
      ),
    ).toThrow(/direct CREATE on schema public/);
    expect(() =>
      assertProductionRoleInventory(
        inventory({ ot_prod_app: { direct_schema_create: true } }),
      ),
    ).toThrow(/holds CREATE on schema public/);
  });

  test("refuses ownership where none is designed, and requires it where it is", () => {
    expect(() =>
      assertProductionRoleInventory(
        inventory({ ot_neutral_runtime: { owned_relations: 1 } }),
      ),
    ).toThrow(/owns 1 relations/);
    expect(() =>
      assertProductionRoleInventory(
        inventory({ ot_commerce_capture_owner: { owned_relations: 0, owned_routines: 2 } }),
      ),
    ).toThrow(/owns 0 relations/);
    expect(() =>
      assertProductionRoleInventory(
        inventory({ ot_prod_neutral_runtime: { owned_relations: 1 } }),
      ),
    ).toThrow(/owns database objects/);
  });

  test("refuses a missing role", () => {
    expect(() =>
      assertProductionRoleInventory(
        inventory().filter((row) => row.rolname !== "ot_neutral_app_reader"),
      ),
    ).toThrow(/functional role ot_neutral_app_reader is missing/);
  });
});

describe("login role bindings", () => {
  test("accepts exactly one functional role per restricted login", () => {
    expect(() => assertProductionRoleBindings(bindings())).not.toThrow();
  });

  test("refuses an extra reachable role", () => {
    expect(() =>
      assertProductionRoleBindings([
        ...bindings(),
        binding("ot_prod_app", "ot_neutral_runtime"),
      ]),
    ).toThrow(/ot_prod_app can assume ot_neutral_runtime/);
  });

  test("refuses a missing binding", () => {
    expect(() => assertProductionRoleBindings(bindings().slice(1))).toThrow(
      /missing binding ot_prod_app\|ot_neutral_app_reader/,
    );
  });

  /**
   * THE TWO-GRANTOR BYPASS, as this function sees it.
   *
   * `pg_auth_members` is keyed on (roleid, member, GRANTOR). A platform
   * operator's `GRANT ot_neutral_app_reader TO ot_prod_app WITH SET TRUE` and
   * the baseline's own `INHERIT TRUE, SET FALSE` edge are two catalog rows for
   * one pair, and PostgreSQL unions their options. The row set coming back from
   * PRODUCTION_BINDING_SQL is IDENTICAL to the designed one — same login, same
   * functional role, one row — which is exactly why the previous form of this
   * function, which compared pairs and nothing else, passed on it.
   *
   * Every one of the four counters is exercised separately, because in a real
   * bypass they do not all move.
   */
  test("refuses a second grantor's edge on the designed pair", () => {
    expect(() =>
      assertProductionRoleBindings(
        bindings({
          ot_prod_app: { can_set: true, edge_count: 2, total_edge_count: 2 },
        }),
      ),
    ).toThrow(/ot_prod_app can SET ROLE to ot_neutral_app_reader/);
    expect(() =>
      assertProductionRoleBindings(
        bindings({
          ot_prod_app: { can_set: true, edge_count: 2, total_edge_count: 2 },
        }),
      ),
    ).toThrow(/bound to ot_neutral_app_reader by 2 membership edges/);
  });

  test("refuses a SET path even when the edge count still looks designed", () => {
    expect(() =>
      assertProductionRoleBindings(bindings({ ot_prod_app: { can_set: true } })),
    ).toThrow(/reachable by inheritance only/);
  });

  test("refuses an edge that does not carry the designed options", () => {
    expect(() =>
      assertProductionRoleBindings(
        bindings({ ot_prod_neutral_runtime: { exact_edge_count: 0 } }),
      ),
    ).toThrow(
      /ot_prod_neutral_runtime has 0 ADMIN FALSE, INHERIT TRUE, SET FALSE edges/,
    );
  });

  /**
   * An edge to a role that is itself a member of something else does not show
   * up as an extra PAIR when the intermediate role is filtered out of the row
   * set — but it does move the login's total direct edge count.
   */
  test("refuses an extra direct edge that does not widen the reachable pairs", () => {
    expect(() =>
      assertProductionRoleBindings(
        bindings({ ot_prod_neutral_delivery: { total_edge_count: 2 } }),
      ),
    ).toThrow(/ot_prod_neutral_delivery holds 2 membership edges in total/);
  });
});

describe("database marker", () => {
  const markerSession = (raw: string | null) => ({
    async query() {
      return {
        rows: [{ databaseName: "postgres", marker: raw }] as Record<
          string,
          unknown
        >[],
      };
    },
  });

  test("accepts the approved project and instance", async () => {
    await expect(
      assertProductionDatabaseMarker(markerSession(marker()), EXPECTED_DATABASE),
    ).resolves.toMatchObject({
      projectRef: OT_PRODUCTION_PROJECT_REF,
      instanceId: INSTANCE,
    });
  });

  /**
   * A restored copy, a Supabase branch and a Staging database that once had the
   * baseline applied all satisfy every other proof this file makes. The instance
   * id is the only thing that separates them.
   */
  test("refuses a correctly formed marker for a different instance", async () => {
    await expect(
      assertProductionDatabaseMarker(
        markerSession(marker({ instanceId: "11111111-2222-4333-8444-555555555555" })),
        EXPECTED_DATABASE,
      ),
    ).rejects.toThrow(/does not match the approved instance/);
  });

  test("refuses a marker for a different Supabase project", async () => {
    await expect(
      assertProductionDatabaseMarker(
        markerSession(marker({ projectRef: "abcdefghijklmnopqrst" })),
        EXPECTED_DATABASE,
      ),
    ).rejects.toThrow(/approved OT Production Supabase project/);
  });

  test("refuses an unmarked database and a Preview marker", async () => {
    await expect(
      assertProductionDatabaseMarker(markerSession(null), EXPECTED_DATABASE),
    ).rejects.toThrow(/missing the durable Production environment marker/);
    await expect(
      assertProductionDatabaseMarker(
        markerSession(marker({ environment: "preview", production: false })),
        EXPECTED_DATABASE,
      ),
    ).rejects.toThrow(/not explicitly marked as the OT Production database/);
  });

  test("the approved pair is read from the environment and fails closed", () => {
    expect(
      readApprovedProductionDatabase({
        OT_NEUTRAL_PRODUCTION_PROJECT_REF: OT_PRODUCTION_PROJECT_REF,
        OT_NEUTRAL_PRODUCTION_MARKER_INSTANCE_ID: ` ${INSTANCE} `,
      }),
    ).toEqual(EXPECTED_DATABASE);
    expect(() =>
      readApprovedProductionDatabase({
        OT_NEUTRAL_PRODUCTION_MARKER_INSTANCE_ID: INSTANCE,
      }),
    ).toThrow(/approved Production project identity/);
    expect(() =>
      readApprovedProductionDatabase({
        OT_NEUTRAL_PRODUCTION_PROJECT_REF: OT_PRODUCTION_PROJECT_REF,
      }),
    ).toThrow(/marker instance ID is required/);
  });
});

describe("verifier session", () => {
  const session = (statements: string[], markerJson: string | null = marker()) => ({
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("shobj_description"))
        return {
          rows: [{ databaseName: "postgres", marker: markerJson }] as Record<
            string,
            unknown
          >[],
        };
      if (sql.includes("from pg_roles r")) return { rows: inventory() as unknown as Record<string, unknown>[] };
      if (sql.includes("cross join pg_roles target"))
        return { rows: bindings() as unknown as Record<string, unknown>[] };
      if (sql.includes("_prisma_migrations")) return { rows: ledger() as unknown as Record<string, unknown>[] };
      return { rows: [] };
    },
  });

  test("runs everything inside a read-only transaction and rolls back", async () => {
    const statements: string[] = [];
    await verifyNeutralProductionPostconditions({
      env: {},
      session: session(statements),
      postconditions: "--postconditions",
      expectLedgerResolved: true,
      expectedDatabase: EXPECTED_DATABASE,
    });
    expect(statements[0]).toBe("BEGIN READ ONLY");
    expect(statements).toContain("--postconditions");
    expect(statements.at(-1)).toBe("ROLLBACK");
  });

  /**
   * Which database, before what is in it. Every other proof here is equally true
   * of a restored copy, so a PASS that never asked would be a receipt for the
   * wrong rollout.
   */
  test("proves the durable marker before any other proof, on every path", async () => {
    for (const expectLedgerResolved of [true, false]) {
      const statements: string[] = [];
      await verifyNeutralProductionPostconditions({
        env: {},
        session: session(statements),
        postconditions: "--postconditions",
        expectLedgerResolved,
        expectedDatabase: EXPECTED_DATABASE,
      });
      expect(statements[0]).toBe("BEGIN READ ONLY");
      expect(statements[1]).toContain("shobj_description");
      expect(statements.indexOf("--postconditions")).toBeGreaterThan(1);
    }
  });

  test("refuses the wrong database before the postconditions are ever issued", async () => {
    const statements: string[] = [];
    await expect(
      verifyNeutralProductionPostconditions({
        env: {},
        session: session(
          statements,
          marker({ instanceId: "11111111-2222-4333-8444-555555555555" }),
        ),
        postconditions: "--postconditions",
        expectLedgerResolved: true,
        expectedDatabase: EXPECTED_DATABASE,
      }),
    ).rejects.toThrow(/does not match the approved instance/);
    expect(statements).not.toContain("--postconditions");
    expect(statements.at(-1)).toBe("ROLLBACK");
  });

  /**
   * The same proof set, with no transaction control of its own. This is what the
   * baseline runner calls from INSIDE its uncommitted transaction, so that a
   * rehearsal proves exactly what the apply proves rather than a subset of it.
   */
  test("the in-transaction form proves the same things and opens no transaction", async () => {
    const statements: string[] = [];
    await runNeutralProductionPostconditionChecks({
      session: session(statements),
      postconditions: "--postconditions",
      expectLedgerResolved: false,
      expectedDatabase: EXPECTED_DATABASE,
    });
    expect(statements).toContain("--postconditions");
    expect(statements.some((sql) => sql.includes("shobj_description"))).toBe(true);
    expect(statements.some((sql) => sql.includes("from pg_roles r"))).toBe(true);
    expect(
      statements.some((sql) => sql.includes("cross join pg_roles target")),
    ).toBe(true);
    for (const control of ["BEGIN", "BEGIN READ ONLY", "COMMIT", "ROLLBACK"])
      expect(statements).not.toContain(control);
  });

  test("skips ledger exactness in the window before resolve has run", async () => {
    const statements: string[] = [];
    await verifyNeutralProductionPostconditions({
      env: {},
      session: session(statements),
      postconditions: "--postconditions",
      expectLedgerResolved: false,
      expectedDatabase: EXPECTED_DATABASE,
    });
    expect(statements.join("\n")).not.toContain("_prisma_migrations");
  });

  test("refuses before connecting when a neutral feature flag is active", async () => {
    const statements: string[] = [];
    await expect(
      verifyNeutralProductionPostconditions({
        env: { OT_NEUTRAL_QA_ENABLED: "true" },
        session: session(statements),
        postconditions: "--postconditions",
        expectLedgerResolved: true,
        expectedDatabase: EXPECTED_DATABASE,
      }),
    ).rejects.toThrow(/OT_NEUTRAL_QA_ENABLED/);
    expect(statements).toEqual([]);
  });

  test("rolls back even when a proof throws", async () => {
    const statements: string[] = [];
    await expect(
      verifyNeutralProductionPostconditions({
        env: {},
        session: {
          async query(sql: string) {
            statements.push(sql);
            if (sql === "--postconditions") throw new Error("boom");
            if (sql.includes("shobj_description"))
              return {
                rows: [{ databaseName: "postgres", marker: marker() }] as Record<
                  string,
                  unknown
                >[],
              };
            return { rows: [] };
          },
        },
        postconditions: "--postconditions",
        expectLedgerResolved: true,
        expectedDatabase: EXPECTED_DATABASE,
      }),
    ).rejects.toThrow(/boom/);
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
});

/**
 * Phase 7 is the receipt an operator files as "Production is in the expected
 * steady state". It used to take `DIRECT_URL` and verify whatever was on the
 * other end of it without ever asking which database that was.
 */
describe("Phase 7 verifier source contract", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "scripts/verify-neutral-production-postconditions.ts"),
    "utf8",
  );

  test("reads the approved project and marker instance from the environment", () => {
    expect(source).toContain("readApprovedProductionDatabase");
    expect(source).toMatch(/expectedDatabase/);
  });

  test("pins the owner URL host, project, role and TLS before connecting", () => {
    const identityIndex = source.indexOf(
      'assertProductionUrlIdentity(datasource.url, "postgres", "owner")',
    );
    const connectIndex = source.indexOf("new Client(");
    expect(identityIndex).toBeGreaterThan(-1);
    expect(connectIndex).toBeGreaterThan(identityIndex);
  });

  test("proves the marker before it can print PASS", () => {
    const readIndex = source.indexOf("readApprovedProductionDatabase(process.env)");
    const passIndex = source.indexOf("verification: PASS");
    expect(readIndex).toBeGreaterThan(-1);
    expect(passIndex).toBeGreaterThan(readIndex);
    expect(source).toContain("marker=verified");
  });
});

describe("diagnostics", () => {
  test("redact connection strings and named secrets", () => {
    const url =
      "postgresql://ot_prod_neutral_runtime.kdvjiijzgflumgkndxsl:s3cretpass@aws-1-us-east-2.pooler.supabase.com:5432/postgres";
    const message = redactProductionDiagnostic(
      new Error(`connect failed for ${url} using s3cretpass`),
      [url],
    );
    expect(message).not.toContain("s3cretpass");
    expect(message).not.toContain("pooler.supabase.com");
    expect(message).toContain("[REDACTED_DATABASE_URL]");
  });

  test("keep catalog diagnostics readable", () => {
    const message = redactProductionDiagnostic(
      new Error("relation ot_neutral_qa_review is not ENABLE + FORCE row level security"),
      [],
    );
    expect(message).toContain("ot_neutral_qa_review");
    expect(message).toContain("FORCE row level security");
  });

  test("walk aggregate and cause chains", () => {
    const message = redactProductionDiagnostic(
      new AggregateError(
        [new Error("first"), new Error("second", { cause: new Error("third") })],
        "outer",
      ),
      [],
    );
    for (const part of ["outer", "first", "second", "third"])
      expect(message).toContain(part);
  });
});
