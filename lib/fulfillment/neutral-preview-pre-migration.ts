import { assertSameNeutralPreviewDatabase } from "./neutral-preview-database-marker";

export type PreMigrationIdentityKind =
  | "migration"
  | "app"
  | "neutralRuntime"
  | "neutralDelivery";

export type PreMigrationIdentity = {
  kind: PreMigrationIdentityKind;
  declaredRole: string;
  currentRole: string;
  sessionRole: string;
  databaseName: string;
  marker: string | null;
  isSuperuser: boolean;
  bypassesRls: boolean;
  canCreateRole: boolean;
  canCreateSchema: boolean;
};

export function declaredDatabaseRole(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("Database credential is not a valid URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("Database credential is not a PostgreSQL URL");
  const role = decodeURIComponent(parsed.username);
  if (!role) throw new Error("Database credential does not declare a role");
  return role;
}

export function assertNeutralPreviewPreMigrationIdentities(
  identities: readonly PreMigrationIdentity[],
): void {
  const expectedKinds: readonly PreMigrationIdentityKind[] = [
    "migration",
    "app",
    "neutralRuntime",
    "neutralDelivery",
  ];
  if (
    identities.length !== expectedKinds.length ||
    identities.some((identity, index) => identity.kind !== expectedKinds[index])
  )
    throw new Error(
      "Exactly four ordered Preview database identities are required",
    );

  assertSameNeutralPreviewDatabase(identities);

  for (const identity of identities) {
    if (
      !identity.declaredRole ||
      identity.currentRole !== identity.declaredRole ||
      identity.sessionRole !== identity.declaredRole
    )
      throw new Error(
        `The ${identity.kind} credential did not connect as its explicitly declared role`,
      );
  }

  const roles = identities.map((identity) => identity.currentRole);
  if (new Set(roles).size !== identities.length)
    throw new Error("All four Preview database roles must be distinct");

  const [migration, ...restricted] = identities;
  if (
    !migration.canCreateSchema ||
    (!migration.isSuperuser && !migration.canCreateRole)
  )
    throw new Error("Migration identity lacks schema/role migration authority");

  for (const identity of restricted) {
    if (
      identity.isSuperuser ||
      identity.bypassesRls ||
      identity.canCreateRole ||
      identity.canCreateSchema
    )
      throw new Error(
        `The ${identity.kind} identity is over-privileged before migration`,
      );
  }
}
