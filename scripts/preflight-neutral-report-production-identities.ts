import { Client } from "pg";
import {
  PRODUCTION_IDENTITY_SQL,
  assertNeutralProductionPreMigrationIdentities,
  declaredProductionDatabaseRole,
  readNeutralProductionConnectionConfig,
  OT_PRODUCTION_LOGIN_IDENTITIES,
  type ProductionPreMigrationIdentity,
} from "../lib/fulfillment/neutral-production-identity";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";

/**
 * The four-role Production pre-migration identity proof.
 *
 * Read-only in the strongest sense available: it issues one catalog SELECT per
 * connection and nothing else. It is the gate every later Production phase
 * depends on, so it refuses on the first thing it cannot prove.
 */
async function main(): Promise<void> {
  const config = readNeutralProductionConnectionConfig(process.env);
  const ordered = OT_PRODUCTION_LOGIN_IDENTITIES.map((identity) => ({
    identity,
    connectionString: config.urls[identity.kind],
  }));

  const clients = ordered.map(
    ({ connectionString }) => new Client({ connectionString }),
  );
  try {
    await Promise.all(clients.map((client) => client.connect()));
    const identities = await Promise.all(
      clients.map(async (client, index): Promise<ProductionPreMigrationIdentity> => {
        const result = await client.query(PRODUCTION_IDENTITY_SQL);
        if (result.rows.length !== 1)
          throw new Error("Database identity query did not return exactly one row");
        const { identity, connectionString } = ordered[index]!;
        return {
          kind: identity.kind,
          declaredRole: declaredProductionDatabaseRole(connectionString),
          ...(result.rows[0] as Omit<
            ProductionPreMigrationIdentity,
            "kind" | "declaredRole"
          >),
        };
      }),
    );
    assertNeutralProductionPreMigrationIdentities(identities, {
      env: process.env,
      expectedMarkerInstanceId: config.markerInstanceId,
    });
    process.stdout.write(
      "neutral-report PRODUCTION identity preflight: PASS\n",
    );
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `neutral-report PRODUCTION identity preflight: FAIL\n${redactProductionDiagnostic(
      error,
      Object.values(process.env).filter((value): value is string => Boolean(value)),
    )}\n`,
  );
  process.exitCode = 1;
});
