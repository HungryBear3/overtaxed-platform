import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { assertOperatorMigrationDatasource } from "../lib/db/prisma-migration-identity";
import {
  observedManifestDigests,
  pinnedManifestDigests,
} from "../lib/fulfillment/neutral-production-artifact-integrity";
import {
  OT_LOCAL_PRISMA_BINARY,
  type MigrationCommand,
} from "../lib/fulfillment/neutral-production-baseline-manifest";
import {
  OT_PRODUCTION_APPLY_TOKEN_VAR,
  OT_PRODUCTION_RESOLVE_TOKEN_VAR,
  runNeutralProductionBaseline,
  type BaselineMode,
  type LedgerRow,
  type MigrationCommandResult,
} from "../lib/fulfillment/neutral-production-baseline-runner";
import { readApprovedProductionDatabase } from "../lib/fulfillment/neutral-production-identity";
import { assertProductionRecoveryGate } from "./neutral-production-recovery-gate";
import {
  redactProductionDiagnostic,
  runNeutralProductionPostconditionChecks,
  verifyNeutralProductionPostconditions,
} from "../lib/fulfillment/neutral-production-verifier";

/**
 * The shared body behind the two Production baseline entrypoints.
 *
 * REHEARSAL AND APPLY ARE DIFFERENT COMMANDS, NOT ONE COMMAND WITH A FLAG
 *
 * They used to be the same script, and which one you got was decided by whether
 * an environment variable happened to be exported. That is the wrong shape for
 * the one irreversible step in the packet: an operator who exported the apply
 * token in Phase 5, then re-ran "the rehearsal" in a later shell that still had
 * it, would have applied instead — and the output would have said so in a line
 * nobody re-reads.
 *
 * Now the rehearsal entrypoint DELETES both confirmation tokens from its own
 * `process.env` before it does anything else, so neither this process nor any
 * child it could spawn can see one, and the apply entrypoint REFUSES to start
 * without the exact token rather than quietly degrading into a rehearsal.
 *
 * Commands are spawned with argument ARRAYS, `shell: false`, and the Prisma CLI
 * from this checkout's `node_modules`. No string is ever assembled into a shell
 * invocation, and nothing is ever fetched from the network mid-rollout.
 */

const root = process.cwd();
const artifact = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

/** Every environment value, treated as a secret for redaction purposes. */
const environmentSecrets = (): string[] =>
  Object.values(process.env).filter((value): value is string => Boolean(value));

/**
 * The Prisma CLI this checkout installed, proved to exist before anything is
 * connected to. `npx prisma` would resolve a missing package by downloading one,
 * which is a supply chain the rollout packet never reviewed.
 */
export function localPrismaBinary(): string {
  const absolute = path.join(root, OT_LOCAL_PRISMA_BINARY);
  if (!fs.existsSync(absolute))
    throw new Error(
      `${OT_LOCAL_PRISMA_BINARY} is not present in this checkout. Run \`npm ci\`. The Production resolve never downloads a Prisma CLI.`,
    );
  return absolute;
}

/**
 * Child output is CAPTURED and redacted, never inherited.
 *
 * `stdio: "inherit"` sends whatever the child writes straight to the operator's
 * terminal and into whatever transcript the receipt is pasted from. Prisma
 * reports connection problems by echoing the datasource URL, and that URL
 * carries the Production owner password. Capturing it means the redactor sees it
 * first; the rollout packet asks for this output to be filed, so the only safe
 * form is the redacted one.
 */
function makeSpawn(
  childEnv: NodeJS.ProcessEnv,
): (command: MigrationCommand) => MigrationCommandResult {
  return (command) => {
    const result = spawnSync(command.command, [...command.args], {
      cwd: root,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      shell: false,
      maxBuffer: 8 * 1024 * 1024,
    });
    const raw = [result.stdout ?? "", result.stderr ?? ""].join("\n").trim();
    return {
      status: result.status,
      error: result.error,
      output: raw ? redactProductionDiagnostic(raw, environmentSecrets()) : "",
    };
  };
}

function minimalResolveEnvironment(directUrl: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: "C",
    LC_ALL: "C",
    NODE_ENV: "production",
    DIRECT_URL: directUrl,
  };
}

export async function runProductionBaselineEntrypoint(
  mode: BaselineMode,
  intent: "commit" | "ledger-resume" = "commit",
): Promise<void> {
  if (mode === "rehearsal") {
    // Before anything is read, connected to, or spawned. A rehearsal cannot
    // apply, and after this line there is nothing in this process that could.
    delete process.env[OT_PRODUCTION_APPLY_TOKEN_VAR];
    delete process.env[OT_PRODUCTION_RESOLVE_TOKEN_VAR];
  }
  if (mode === "apply" && intent === "commit") {
    // Phase 5 cannot accidentally consume a resolve token left in the shell.
    // Ledger writes belong only to the catalog-REPLAY resume entrypoint.
    delete process.env[OT_PRODUCTION_RESOLVE_TOKEN_VAR];
  }

  // The operator path refuses a derived migration connection outright, before
  // anything else is read. This is the defect that let a Supabase deployment
  // migrate as its application role while DIRECT_URL sat unused.
  const datasource = assertOperatorMigrationDatasource(process.env);
  // The same approved pair Gate 4 pins the durable marker against, threaded into
  // both verification callbacks so the in-transaction rehearsal, the post-commit
  // durable check and the standalone Phase 7 script all prove the same thing
  // about which database they are talking to.
  const expectedDatabase = readApprovedProductionDatabase(process.env);
  // Require fresh marker-bound bounded baseline rollback evidence and successful
  // restore receipts from both supported PostgreSQL majors before opening the
  // Production socket. This is not general disaster recovery or zero-RPO data
  // recovery; transactional apply provides zero-partial-apply safety.
  // Rehearsal remains read-only and deliberately does not require this gate.
  if (mode === "apply" && intent === "commit")
    await assertProductionRecoveryGate({
      env: process.env,
      projectRef: expectedDatabase.projectRef,
      markerInstanceId: expectedDatabase.markerInstanceId,
    });
  if (mode === "apply" && intent === "ledger-resume") {
    const expected = `resume-production-ledger:${expectedDatabase.markerInstanceId}`;
    if (
      process.env.OT_NEUTRAL_PRODUCTION_LEDGER_RESUME_CONFIRMATION !== expected
    )
      throw new Error(
        "OT_NEUTRAL_PRODUCTION_LEDGER_RESUME_CONFIRMATION is not the exact marker-bound resume token",
      );
  }
  const prismaBinary = localPrismaBinary();

  const postconditions = artifact(
    "prisma/production-baseline/03_postconditions.sql",
  );
  // The same pin the standalone Phase 7 verifier enforces, from the same
  // helper, so the two paths cannot drift into proving different things about
  // the same files.
  const pinned = pinnedManifestDigests(root);

  const owner = new Client({ connectionString: datasource.url });
  await owner.connect();
  try {
    const outcome = await runNeutralProductionBaseline({
      mode,
      env: process.env,
      artifacts: {
        preflight: artifact("prisma/production-baseline/01_preflight.sql"),
        baseline: artifact("prisma/production-baseline/02_baseline.sql"),
        postconditions,
      },
      observedDigests: observedManifestDigests(root),
      pinnedDigests: pinned,
      owner,
      readLedger: async () => {
        const result = await owner.query(
          `select migration_name, finished_at, rolled_back_at from "_prisma_migrations" order by migration_name`,
        );
        return result.rows as LedgerRow[];
      },
      // Inside the still-open baseline transaction, on the owner session. The
      // ledger is deliberately not expected here: it is written after COMMIT.
      verifyInTransaction: async (session) => {
        await runNeutralProductionPostconditionChecks({
          session,
          postconditions,
          expectLedgerResolved: false,
          expectedDatabase,
        });
      },
      verifyBeforeCommit:
        mode === "apply" && intent === "commit"
          ? async () => {
              await assertProductionRecoveryGate({
                env: process.env,
                projectRef: expectedDatabase.projectRef,
                markerInstanceId: expectedDatabase.markerInstanceId,
              });
            }
          : undefined,
      // A SEPARATE connection, so a poisoned or mid-transaction owner session
      // can never be the thing that reports success.
      verifyDurable: async ({ expectLedgerResolved }) => {
        const verifier = new Client({ connectionString: datasource.url });
        await verifier.connect();
        try {
          await verifyNeutralProductionPostconditions({
            env: process.env,
            session: verifier,
            postconditions,
            expectLedgerResolved,
            expectedDatabase,
          });
        } finally {
          await verifier.end();
        }
      },
      prismaBinary,
      spawn: makeSpawn(minimalResolveEnvironment(datasource.url)),
      requiredAction:
        mode === "apply"
          ? intent === "commit"
            ? "APPLY"
            : "REPLAY"
          : undefined,
    });

    process.stdout.write(
      `neutral-report PRODUCTION baseline: PASS mode=${outcome.mode} action=${outcome.action} committed=${outcome.committed} resolved=${outcome.resolved}\n`,
    );
    process.stdout.write(
      `preflight: ${outcome.preflight.present_objects}/${outcome.preflight.expected_objects} objects; roles present=[${outcome.preflight.present_roles.join(",")}] missing=[${outcome.preflight.missing_roles.join(",")}]\n`,
    );
    // Diagnostics for the SET/INHERIT borrow. Catalog and privilege names only.
    process.stdout.write(
      `createrole_self_grant=${JSON.stringify(outcome.preflight.createrole_self_grant)} owner-role edges=[${outcome.preflight.owner_role_grant_options.join(" ")}]\n`,
    );
    if (outcome.alreadyResolved.length)
      process.stdout.write(
        `ledger resume: ${outcome.alreadyResolved.length} covered migration(s) were already recorded; ${outcome.resolveCommands.length} remained\n`,
      );
    if (!outcome.committed)
      process.stdout.write(
        "rehearsal only: the transaction was rolled back and nothing was changed\n",
      );
  } finally {
    await owner.end();
  }
}

export function reportProductionBaselineFailure(error: unknown): void {
  process.stderr.write(
    `neutral-report PRODUCTION baseline: FAIL\n${redactProductionDiagnostic(
      error,
      environmentSecrets(),
    )}\n`,
  );
  process.exitCode = 1;
}
