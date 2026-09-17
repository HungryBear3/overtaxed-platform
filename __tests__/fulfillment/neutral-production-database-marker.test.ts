import {
  OT_PRODUCTION_PROJECT_REF,
  assertSameNeutralProductionDatabase,
  parseNeutralProductionDatabaseMarker,
} from "@/lib/fulfillment/neutral-production-database-marker";

const INSTANCE = "6a5c0f2e-3b1d-4e7a-9c88-2f4b6d0a1e33";

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

const identity = (m: string | null, databaseName = "postgres") => ({
  databaseName,
  marker: m,
});

describe("Production database marker", () => {
  test("binds environment, production, project ref and instance id together", () => {
    expect(parseNeutralProductionDatabaseMarker(marker())).toEqual({
      schema: "ot.database-environment.v1",
      purpose: "ot-neutral-report",
      environment: "production",
      production: true,
      projectRef: OT_PRODUCTION_PROJECT_REF,
      instanceId: INSTANCE,
    });
  });

  test("refuses an absent marker", () => {
    expect(() => parseNeutralProductionDatabaseMarker(null)).toThrow(
      /durable Production environment marker/,
    );
  });

  test("refuses a Preview marker outright", () => {
    const preview = JSON.stringify({
      schema: "ot.database-environment.v1",
      purpose: "ot-neutral-report",
      environment: "preview",
      isolated: true,
      production: false,
      instanceId: INSTANCE,
    });
    expect(() => parseNeutralProductionDatabaseMarker(preview)).toThrow(
      /explicitly marked as the OT Production database/,
    );
  });

  test.each([
    ["environment", { environment: "staging" }],
    ["production flag", { production: false }],
    ["production flag type", { production: "true" }],
    ["purpose", { purpose: "something-else" }],
    ["schema", { schema: "ot.database-environment.v2" }],
    ["project ref shape", { projectRef: "TOO-SHORT" }],
    ["instance id shape", { instanceId: "not-a-uuid" }],
  ])("refuses a marker with a bad %s", (_label, override) => {
    expect(() => parseNeutralProductionDatabaseMarker(marker(override))).toThrow(
      /explicitly marked as the OT Production database/,
    );
  });

  test("refuses a marker naming a different Supabase project", () => {
    expect(() =>
      parseNeutralProductionDatabaseMarker(
        marker({ projectRef: "iyaxdrehtxsfkaexgxls" }),
      ),
    ).toThrow(/approved OT Production Supabase project/);
  });

  test("refuses non-JSON and non-object markers", () => {
    expect(() => parseNeutralProductionDatabaseMarker("{")).toThrow(/valid JSON/);
    expect(() => parseNeutralProductionDatabaseMarker("[]")).toThrow(/object/);
  });

  test("proves four identities are the same marked database", () => {
    const resolved = assertSameNeutralProductionDatabase([
      identity(marker()),
      identity(marker()),
      identity(marker()),
      identity(marker()),
    ]);
    expect(resolved.instanceId).toBe(INSTANCE);
  });

  test("refuses when the four identities are not four", () => {
    expect(() =>
      assertSameNeutralProductionDatabase([identity(marker())]),
    ).toThrow(/Exactly four/);
  });

  test("refuses a mixed instance id or database name", () => {
    const other = "11111111-2222-4333-8444-555555555555";
    expect(() =>
      assertSameNeutralProductionDatabase([
        identity(marker()),
        identity(marker()),
        identity(marker()),
        identity(marker({ instanceId: other })),
      ]),
    ).toThrow(/same marked OT Production database instance/);
    expect(() =>
      assertSameNeutralProductionDatabase([
        identity(marker()),
        identity(marker()),
        identity(marker()),
        identity(marker(), "other_db"),
      ]),
    ).toThrow(/same marked OT Production database instance/);
  });
});
