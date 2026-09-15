import { Client } from "pg";
import {
  assertNeutralPreviewPreMigrationIdentities,
  declaredDatabaseRole,
  type PreMigrationIdentity,
  type PreMigrationIdentityKind,
} from "../lib/fulfillment/neutral-preview-pre-migration";

const credentials: readonly [PreMigrationIdentityKind, string][] = [
  ["migration", "DIRECT_URL"],
  ["app", "DATABASE_URL"],
  ["neutralRuntime", "OT_NEUTRAL_DATABASE_URL"],
  ["neutralDelivery", "OT_NEUTRAL_DELIVERY_DATABASE_URL"],
];

async function main() {
  const configured = credentials.map(([kind, environmentName]) => {
    const connectionString = process.env[environmentName]?.trim();
    if (!connectionString)
      throw new Error(`${environmentName} is required for pre-migration proof`);
    return { kind, connectionString };
  });
  if (
    new Set(configured.map(({ connectionString }) => connectionString)).size !==
    4
  )
    throw new Error("All four database URLs must be distinct");

  const clients = configured.map(
    ({ connectionString }) => new Client({ connectionString }),
  );
  try {
    await Promise.all(clients.map((client) => client.connect()));
    const identities = await Promise.all(
      clients.map(async (client, index): Promise<PreMigrationIdentity> => {
        const result = await client.query(
          `select current_user as "currentRole", session_user as "sessionRole", current_database() as "databaseName", obj_description(d.oid, 'pg_database') as marker, r.rolsuper as "isSuperuser", r.rolbypassrls as "bypassesRls", r.rolcreaterole as "canCreateRole", has_schema_privilege(current_user, 'public', 'CREATE') as "canCreateSchema" from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()`,
        );
        if (result.rows.length !== 1)
          throw new Error(
            "Database identity query did not return exactly one row",
          );
        return {
          kind: configured[index].kind,
          declaredRole: declaredDatabaseRole(
            configured[index].connectionString,
          ),
          ...result.rows[0],
        };
      }),
    );
    assertNeutralPreviewPreMigrationIdentities(identities);
    process.stdout.write(
      "neutral-report PRE-MIGRATION identity preflight: PASS\n",
    );
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
  }
}

main().catch(() => {
  process.stderr.write(
    "neutral-report PRE-MIGRATION identity preflight: FAIL\n",
  );
  process.exitCode = 1;
});
