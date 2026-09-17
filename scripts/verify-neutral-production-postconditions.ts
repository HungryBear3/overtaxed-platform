import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { assertOperatorMigrationDatasource } from "../lib/db/prisma-migration-identity";
import { assertProductionArtifactIntegrity } from "../lib/fulfillment/neutral-production-artifact-integrity";
import {
  assertProductionUrlIdentity,
  readApprovedProductionDatabase,
} from "../lib/fulfillment/neutral-production-identity";
import {
  redactProductionDiagnostic,
  verifyNeutralProductionPostconditions,
} from "../lib/fulfillment/neutral-production-verifier";

/**
 * Read-only Production postcondition verification.
 *
 * Runs on its own, against a Production database that has already had the
 * baseline applied and (by default) its ledger resolved. It never writes: the
 * whole verification happens inside `BEGIN READ ONLY`.
 *
 * `OT_NEUTRAL_PRODUCTION_EXPECT_LEDGER=absent` verifies the schema and role
 * state after the baseline commit but before `prisma migrate resolve` has run,
 * which is the one window where ledger exactness is legitimately not yet true.
 *
 * WHICH DATABASE, PROVED BEFORE PASS
 *
 * This script used to take `DIRECT_URL` and verify whatever was on the other end
 * of it. Every proof it makes is a statement about catalog contents, and every
 * one of them is equally true of a restored copy, a Supabase branch of the same
 * project, or a Staging database the baseline was once applied to — so its
 * `PASS` line could be filed as a Phase 7 receipt for the Production rollout
 * while describing a different database entirely. The apply path never had that
 * gap: its Gate 4 reads the durable marker and pins both fields.
 *
 * So the approved project ref and marker instance are now required here too, and
 * the durable `COMMENT ON DATABASE` marker is parsed and exact-matched against
 * them before any other proof runs and long before anything prints `PASS`.
 *
 * WHICH BYTES, PROVED BEFORE PASS
 *
 * The same gap existed one level down. This script read
 * `03_postconditions.sql` off disk and executed whatever was in it, so a
 * postcondition file whose checks had been weakened — a deleted loop, a
 * predicate that can no longer match — produced a clean `PASS` line from a
 * verifier that never asked whether the file was the reviewed one. The apply
 * path proves its bytes at Gate 2 before executing them; being read-only makes
 * this path safe, not truthful, and the receipt it emits is the durable one.
 *
 * So every manifest-pinned artifact is checksum-verified against the committed
 * manifest here as well, first, before a socket is opened.
 */
async function main(): Promise<void> {
  const root = process.cwd();
  // Before the environment, before the connection: the bytes. A receipt issued
  // by an unverified verifier is the thing this exists to make impossible.
  assertProductionArtifactIntegrity(root);
  const datasource = assertOperatorMigrationDatasource(process.env);
  assertProductionUrlIdentity(datasource.url, "postgres", "owner");
  // Read before connecting: a missing or wrong approved instance is an
  // environment defect, and there is no reason to open a socket to learn it.
  const expectedDatabase = readApprovedProductionDatabase(process.env);
  const postconditions = fs.readFileSync(
    path.join(root, "prisma/production-baseline/03_postconditions.sql"),
    "utf8",
  );
  const expectLedgerResolved =
    process.env.OT_NEUTRAL_PRODUCTION_EXPECT_LEDGER !== "absent";

  const session = new Client({ connectionString: datasource.url });
  await session.connect();
  try {
    await verifyNeutralProductionPostconditions({
      env: process.env,
      session,
      postconditions,
      expectLedgerResolved,
      expectedDatabase,
    });
    process.stdout.write(
      `neutral-report PRODUCTION verification: PASS ledger=${expectLedgerResolved ? "resolved" : "not-yet-resolved"} marker=verified artifacts=checksum-verified\n`,
    );
  } finally {
    await session.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `neutral-report PRODUCTION verification: FAIL\n${redactProductionDiagnostic(
      error,
      Object.values(process.env).filter((value): value is string => Boolean(value)),
    )}\n`,
  );
  process.exitCode = 1;
});
