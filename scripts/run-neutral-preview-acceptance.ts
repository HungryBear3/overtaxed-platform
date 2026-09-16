import { Client } from "pg";
import {
  createPreviewAcceptanceRunId,
  proveAcceptanceAbsence,
  provePreviewAcceptanceIdentity,
  readPreviewAcceptanceConfig,
  redactAcceptanceError,
  runTransactionalAcceptance,
} from "../lib/fulfillment/neutral-preview-acceptance";

async function main() {
  const { urls, markerInstanceId } = readPreviewAcceptanceConfig(process.env);
  const runId = createPreviewAcceptanceRunId();
  await provePreviewAcceptanceIdentity(urls, markerInstanceId);
  const owner = new Client({ connectionString: urls.direct });
  await owner.connect();
  // The journey's evidence names every row a production helper keyed with its
  // own generated UUID, which the pattern sweep alone could not see.
  let evidence;
  let journeyError: unknown;
  try {
    evidence = await runTransactionalAcceptance(owner, runId);
  } catch (error) {
    journeyError = error;
    evidence = error && typeof error === "object" && "acceptanceEvidence" in error
      ? (error as { acceptanceEvidence?: typeof evidence }).acceptanceEvidence
      : undefined;
  } finally {
    await owner.end();
  }
  const verifier = new Client({ connectionString: urls.direct });
  await verifier.connect();
  let absenceError: unknown;
  try {
    await proveAcceptanceAbsence(verifier, runId, evidence);
  } catch (error) {
    absenceError = error;
  } finally {
    await verifier.end();
  }
  if (journeyError || absenceError)
    throw new AggregateError(
      [journeyError, absenceError].filter(Boolean),
      "Preview acceptance journey or cleanup proof failed",
    );
  process.stdout.write(
    "neutral-report Preview synthetic acceptance: PASS (rollback and zero-row proof verified)\n",
  );
}

main().catch((error) => {
  const secrets = [
    process.env.DIRECT_URL,
    process.env.DATABASE_URL,
    process.env.OT_NEUTRAL_DATABASE_URL,
    process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL,
  ].filter((v): v is string => Boolean(v));
  process.stderr.write(`${redactAcceptanceError(error, secrets)}\n`);
  process.exitCode = 1;
});
