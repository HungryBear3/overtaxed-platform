import {
  OT_PREVIEW_LOGIN_ROLES,
  OT_PRODUCTION_LOGIN_IDENTITIES,
  OT_PRODUCTION_PROJECT_REF,
  assertNeutralProductionPreMigrationIdentities,
  assertProductionUrlIdentity,
  declaredProductionDatabaseRole,
  readNeutralProductionConnectionConfig,
  type ProductionPreMigrationIdentity,
} from "@/lib/fulfillment/neutral-production-identity";

const REF = OT_PRODUCTION_PROJECT_REF;
const INSTANCE = "6a5c0f2e-3b1d-4e7a-9c88-2f4b6d0a1e33";
const POOLER = `aws-1-us-east-2.pooler.supabase.com`;

const url = (role: string, port = 5432, host = POOLER, extra = "") =>
  `postgresql://${role}.${REF}:pw@${host}:${port}/postgres?sslmode=verify-full${extra}`;

const OWNER = url("postgres");
const APP = url("ot_prod_app", 6543, POOLER, "&pgbouncer=true");
const RUNTIME = url("ot_prod_neutral_runtime");
const DELIVERY = url("ot_prod_neutral_delivery");

const env = (overrides: Record<string, string | undefined> = {}) => ({
  OT_NEUTRAL_PRODUCTION_PROJECT_REF: REF,
  OT_NEUTRAL_PRODUCTION_MARKER_INSTANCE_ID: INSTANCE,
  DIRECT_URL: OWNER,
  DATABASE_URL: APP,
  OT_NEUTRAL_PRODUCTION_DATABASE_URL: RUNTIME,
  OT_NEUTRAL_PRODUCTION_DELIVERY_DATABASE_URL: DELIVERY,
  ...overrides,
});

const marker = JSON.stringify({
  schema: "ot.database-environment.v1",
  purpose: "ot-neutral-report",
  environment: "production",
  production: true,
  projectRef: REF,
  instanceId: INSTANCE,
});

const identity = (
  kind: ProductionPreMigrationIdentity["kind"],
  role: string,
  overrides: Partial<ProductionPreMigrationIdentity> = {},
): ProductionPreMigrationIdentity => ({
  kind,
  declaredRole: role,
  currentRole: role,
  sessionRole: role,
  databaseName: "postgres",
  marker,
  isSuperuser: false,
  bypassesRls: false,
  canCreateRole: kind === "owner",
  canCreateDb: false,
  canReplicate: false,
  canLogin: true,
  inherits: true,
  canCreateSchema: kind === "owner",
  ...overrides,
});

const identities = (
  overrides: Partial<Record<number, Partial<ProductionPreMigrationIdentity>>> = {},
): ProductionPreMigrationIdentity[] => [
  identity("owner", "postgres", overrides[0]),
  identity("app", "ot_prod_app", overrides[1]),
  identity("neutralRuntime", "ot_prod_neutral_runtime", overrides[2]),
  identity("neutralDelivery", "ot_prod_neutral_delivery", overrides[3]),
];

const options = { env: {}, expectedMarkerInstanceId: INSTANCE };

describe("Production login names", () => {
  test("are explicit, ordered, and disjoint from Preview for every restricted login", () => {
    expect(OT_PRODUCTION_LOGIN_IDENTITIES.map((i) => [i.kind, i.role])).toEqual([
      ["owner", "postgres"],
      ["app", "ot_prod_app"],
      ["neutralRuntime", "ot_prod_neutral_runtime"],
      ["neutralDelivery", "ot_prod_neutral_delivery"],
    ]);
    for (const { role } of OT_PRODUCTION_LOGIN_IDENTITIES)
      expect(OT_PREVIEW_LOGIN_ROLES.has(role)).toBe(false);
  });

  test("strip the project-ref suffix a pooler login carries", () => {
    expect(declaredProductionDatabaseRole(RUNTIME)).toBe(
      "ot_prod_neutral_runtime",
    );
    expect(
      declaredProductionDatabaseRole(
        `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
      ),
    ).toBe("postgres");
  });
});

describe("Production URL identity", () => {
  test("accepts the verified Production Supabase pooler", () => {
    expect(assertProductionUrlIdentity(OWNER, "postgres", "owner")).toMatchObject({
      pooler: true,
      port: 5432,
      transactionMode: false,
    });
    expect(
      assertProductionUrlIdentity(APP, "ot_prod_app", "app"),
    ).toMatchObject({ pooler: true, port: 6543, transactionMode: true });
  });

  test("accepts the direct owner host but only for the owner", () => {
    const direct = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres?sslmode=verify-full`;
    expect(assertProductionUrlIdentity(direct, "postgres", "owner").pooler).toBe(
      false,
    );
    expect(() =>
      assertProductionUrlIdentity(
        direct.replace("postgres:pw", "ot_prod_app:pw"),
        "ot_prod_app",
        "app",
      ),
    ).toThrow(/exact approved Production identity/);
  });

  test("refuses a pooler URL whose login does not carry the approved project ref", () => {
    expect(() =>
      assertProductionUrlIdentity(
        `postgresql://ot_prod_app.iyaxdrehtxsfkaexgxls:pw@${POOLER}:5432/postgres?sslmode=verify-full`,
        "ot_prod_app",
        "app",
      ),
    ).toThrow(/exact approved Production identity/);
  });

  test("refuses a non-Supabase host, a non-postgres database, and a wrong role", () => {
    expect(() =>
      assertProductionUrlIdentity(
        `postgresql://ot_prod_app.${REF}:pw@evil.example.invalid:5432/postgres?sslmode=verify-full`,
        "ot_prod_app",
        "app",
      ),
    ).toThrow(/exact approved Production identity/);
    expect(() =>
      assertProductionUrlIdentity(
        url("ot_prod_app").replace("/postgres?", "/other?"),
        "ot_prod_app",
        "app",
      ),
    ).toThrow(/exact approved Production identity/);
    expect(() =>
      assertProductionUrlIdentity(RUNTIME, "ot_prod_app", "app"),
    ).toThrow(/exact approved Production identity/);
  });

  test("refuses weak TLS, routing overrides, duplicates, and unknown options", () => {
    expect(() =>
      assertProductionUrlIdentity(
        url("postgres").replace("verify-full", "require"),
        "postgres",
        "owner",
      ),
    ).toThrow(/verify-full/);
    expect(() =>
      assertProductionUrlIdentity(
        `${OWNER}&host=evil.example.invalid`,
        "postgres",
        "owner",
      ),
    ).toThrow(/routing overrides/);
    expect(() =>
      assertProductionUrlIdentity(
        `${OWNER}&sslmode=verify-full`,
        "postgres",
        "owner",
      ),
    ).toThrow(/Duplicate/);
    expect(() =>
      assertProductionUrlIdentity(
        `${OWNER}&options=-c%20role%3Dpostgres`,
        "postgres",
        "owner",
      ),
    ).toThrow(/forbidden/);
  });

  test("allows pgbouncer only on the transaction-mode port", () => {
    expect(() =>
      assertProductionUrlIdentity(
        `${RUNTIME}&pgbouncer=true`,
        "ot_prod_neutral_runtime",
        "neutralRuntime",
      ),
    ).toThrow(/pgbouncer/);
  });

  test("refuses a transaction-mode owner migration connection", () => {
    expect(() =>
      assertProductionUrlIdentity(
        url("postgres", 6543, POOLER, "&pgbouncer=true"),
        "postgres",
        "owner",
      ),
    ).toThrow(/exact approved Production identity/);
  });
});

describe("Production connection config", () => {
  test("reads four distinct approved URLs", () => {
    const config = readNeutralProductionConnectionConfig(env());
    expect(config.urls).toEqual({
      owner: OWNER,
      app: APP,
      neutralRuntime: RUNTIME,
      neutralDelivery: DELIVERY,
    });
    expect(config.markerInstanceId).toBe(INSTANCE);
  });

  test("refuses a wrong project ref, a missing marker id, and a missing URL", () => {
    expect(() =>
      readNeutralProductionConnectionConfig(
        env({ OT_NEUTRAL_PRODUCTION_PROJECT_REF: "iyaxdrehtxsfkaexgxls" }),
      ),
    ).toThrow(/approved Production project identity/);
    expect(() =>
      readNeutralProductionConnectionConfig(
        env({ OT_NEUTRAL_PRODUCTION_MARKER_INSTANCE_ID: " " }),
      ),
    ).toThrow(/marker instance ID/);
    expect(() =>
      readNeutralProductionConnectionConfig(env({ DIRECT_URL: undefined })),
    ).toThrow(/DIRECT_URL is required/);
  });

  test("refuses reused URLs across identities", () => {
    expect(() =>
      readNeutralProductionConnectionConfig(env({ DATABASE_URL: OWNER })),
    ).toThrow(/distinct/);
  });

  test("refuses a Preview credential in a Production position", () => {
    expect(() =>
      readNeutralProductionConnectionConfig(
        env({ DATABASE_URL: url("ot_preview_app", 6543, POOLER, "&pgbouncer=true") }),
      ),
    ).toThrow(/exact approved Production identity/);
  });
});

describe("Production four-role pre-migration preflight", () => {
  test("passes for the verified Production authority shape without superuser", () => {
    const marker = assertNeutralProductionPreMigrationIdentities(
      identities(),
      options,
    );
    expect(marker.projectRef).toBe(REF);
  });

  test("refuses the wrong count or the wrong order", () => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        identities().slice(0, 3),
        options,
      ),
    ).toThrow(/Exactly four ordered/);
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        [identities()[1]!, identities()[0]!, identities()[2]!, identities()[3]!],
        options,
      ),
    ).toThrow(/Exactly four ordered/);
  });

  test("refuses when the four credentials are not the same marked database", () => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        identities({ 3: { databaseName: "other" } }),
        options,
      ),
    ).toThrow(/same marked OT Production database instance/);
  });

  test("refuses a marker instance the operator packet did not approve", () => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(identities(), {
        ...options,
        expectedMarkerInstanceId: "11111111-2222-4333-8444-555555555555",
      }),
    ).toThrow(/approved instance/);
  });

  test("refuses a credential that connected as something other than its declared role", () => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        identities({ 1: { currentRole: "postgres" } }),
        options,
      ),
    ).toThrow(/explicitly declared role/);
  });

  test("refuses a Preview login role anywhere", () => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        identities({
          2: { declaredRole: "ot_preview_neutral_runtime", currentRole: "ot_preview_neutral_runtime", sessionRole: "ot_preview_neutral_runtime" },
        }),
        options,
      ),
    ).toThrow(/Preview login role/);
  });

  test("refuses an owner without schema or role authority", () => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        identities({ 0: { canCreateRole: false } }),
        options,
      ),
    ).toThrow(/Owner identity lacks/);
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        identities({ 0: { canCreateSchema: false } }),
        options,
      ),
    ).toThrow(/Owner identity lacks/);
  });

  test("does not require the owner to be a superuser", () => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        identities({ 0: { isSuperuser: false } }),
        options,
      ),
    ).not.toThrow();
  });

  test.each([
    ["isSuperuser", { isSuperuser: true }],
    ["bypassesRls", { bypassesRls: true }],
    ["canCreateRole", { canCreateRole: true }],
    ["canCreateDb", { canCreateDb: true }],
    ["canReplicate", { canReplicate: true }],
    ["canCreateSchema", { canCreateSchema: true }],
    ["canLogin", { canLogin: false }],
  ])("refuses a restricted identity with %s", (_label, override) => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(
        identities({ 2: override }),
        options,
      ),
    ).toThrow(/over-privileged before migration|declared role/);
  });

  test("refuses when any neutral feature flag is already active", () => {
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(identities(), {
        ...options,
        env: { OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true" },
      }),
    ).toThrow(/OT_NEUTRAL_REPORT_CHECKOUT_ENABLED/);
    expect(() =>
      assertNeutralProductionPreMigrationIdentities(identities(), {
        ...options,
        env: { OT_T2_PACKET_DOWNLOAD_ENABLED: "true" },
      }),
    ).toThrow(/OT_T2_PACKET_DOWNLOAD_ENABLED/);
  });
});
