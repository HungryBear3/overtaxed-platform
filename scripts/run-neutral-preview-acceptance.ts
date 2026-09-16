import { Client } from "pg";
import {
  createPreviewAcceptanceRunId,
  proveAcceptanceAbsence,
  provePreviewAcceptanceIdentity,
  readPreviewAcceptanceConfig,
  redactAcceptanceError,
  runAcceptanceWithFreshVerifier,
  runTransactionalAcceptance,
} from "../lib/fulfillment/neutral-preview-acceptance";

async function main() {
  const { urls, markerInstanceId } = readPreviewAcceptanceConfig(process.env);
  const runId = createPreviewAcceptanceRunId();
  await provePreviewAcceptanceIdentity(urls, markerInstanceId);
  const owner = new Client({ connectionString: urls.direct });
  const verifier = new Client({ connectionString: urls.direct });
  await runAcceptanceWithFreshVerifier(
    owner,
    verifier,
    runId,
    runTransactionalAcceptance,
    proveAcceptanceAbsence,
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
