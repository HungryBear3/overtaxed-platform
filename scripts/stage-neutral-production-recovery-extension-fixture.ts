import {
  assertManagedExtensionFixtureInstalled,
  stageManagedExtensionFixture,
} from "./neutral-production-extension-fixture-files";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";

function main(): void {
  const action = process.argv[2];
  const pgConfig = process.env.OT_NEUTRAL_RECOVERY_REHEARSAL_PG_CONFIG;
  if (action !== "install" && action !== "remove" && action !== "verify")
    throw new Error("Fixture action must be install, verify, or remove");
  const result =
    action === "verify"
      ? assertManagedExtensionFixtureInstalled(pgConfig)
      : stageManagedExtensionFixture({ action, pgConfig });
  process.stdout.write(
    `neutral-report recovery extension fixture: PASS action=${action} target_pg=${result.major}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `neutral-report recovery extension fixture: FAIL\n${redactProductionDiagnostic(
      error,
      Object.values(process.env).filter((value): value is string =>
        Boolean(value),
      ),
    )}\n`,
  );
  process.exitCode = 1;
}
