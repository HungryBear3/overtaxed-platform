import {
  assertNeutralPreviewPreMigrationIdentities,
  declaredDatabaseRole,
  type PreMigrationIdentity,
} from "@/lib/fulfillment/neutral-preview-pre-migration";

const marker = JSON.stringify({
  schema: "ot.database-environment.v1",
  purpose: "ot-neutral-report",
  environment: "preview",
  isolated: true,
  production: false,
  instanceId: "15b140f0-c5ef-4a73-8b5f-193ef7885e76",
});

function identities(): PreMigrationIdentity[] {
  return ["migration", "app", "neutralRuntime", "neutralDelivery"].map(
    (kind, index) => ({
      kind: kind as PreMigrationIdentity["kind"],
      declaredRole: [
        "preview_migrator",
        "preview_app",
        "preview_neutral",
        "preview_delivery",
      ][index],
      currentRole: [
        "preview_migrator",
        "preview_app",
        "preview_neutral",
        "preview_delivery",
      ][index],
      sessionRole: [
        "preview_migrator",
        "preview_app",
        "preview_neutral",
        "preview_delivery",
      ][index],
      databaseName: "ot_preview_15b140f0",
      marker,
      isSuperuser: index === 0,
      bypassesRls: index === 0,
      canCreateRole: index === 0,
      canCreateSchema: index === 0,
    }),
  );
}

describe("neutral Preview PRE-MIGRATION identity proof", () => {
  test("accepts one explicitly marked database and four exact isolated roles", () => {
    expect(() =>
      assertNeutralPreviewPreMigrationIdentities(identities()),
    ).not.toThrow();
  });

  test("extracts and decodes the role declared by a PostgreSQL credential", () => {
    expect(
      declaredDatabaseRole("postgresql://preview%5Fapp:secret@db/preview"),
    ).toBe("preview_app");
  });

  test.each([
    [
      "duplicate role",
      (rows: PreMigrationIdentity[]) => {
        rows[3].declaredRole = rows[2].declaredRole;
        rows[3].currentRole = rows[2].currentRole;
        rows[3].sessionRole = rows[2].sessionRole;
      },
    ],
    [
      "SET ROLE indirection",
      (rows: PreMigrationIdentity[]) => {
        rows[2].currentRole = "shared_role";
      },
    ],
    [
      "session identity mismatch",
      (rows: PreMigrationIdentity[]) => {
        rows[1].sessionRole = "pooler";
      },
    ],
    [
      "runtime schema creation",
      (rows: PreMigrationIdentity[]) => {
        rows[2].canCreateSchema = true;
      },
    ],
    [
      "app role creation",
      (rows: PreMigrationIdentity[]) => {
        rows[1].canCreateRole = true;
      },
    ],
    [
      "delivery superuser",
      (rows: PreMigrationIdentity[]) => {
        rows[3].isSuperuser = true;
      },
    ],
    [
      "runtime bypass RLS",
      (rows: PreMigrationIdentity[]) => {
        rows[2].bypassesRls = true;
      },
    ],
    [
      "migration lacks schema authority",
      (rows: PreMigrationIdentity[]) => {
        rows[0].canCreateSchema = false;
      },
    ],
    [
      "migration lacks role authority",
      (rows: PreMigrationIdentity[]) => {
        rows[0].isSuperuser = false;
        rows[0].canCreateRole = false;
      },
    ],
    [
      "different database",
      (rows: PreMigrationIdentity[]) => {
        rows[3].databaseName = "production";
      },
    ],
    [
      "different marker",
      (rows: PreMigrationIdentity[]) => {
        rows[3].marker = marker.replace("15b140f0", "25b140f0");
      },
    ],
    [
      "Production marker",
      (rows: PreMigrationIdentity[]) => {
        rows[0].marker = rows[0].marker!.replace(
          '"production":false',
          '"production":true',
        );
      },
    ],
  ])("fails closed for %s", (_name, mutate) => {
    const rows = identities();
    mutate(rows);
    expect(() => assertNeutralPreviewPreMigrationIdentities(rows)).toThrow();
  });

  test.each([
    "",
    "not a url",
    "https://role:secret@example.test/db",
    "postgresql://example.test/db",
  ])("rejects invalid or role-less credential %p", (credential) =>
    expect(() => declaredDatabaseRole(credential)).toThrow(),
  );
});
