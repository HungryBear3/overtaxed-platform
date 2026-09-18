import {
  assertManagedExtensionFixtureInstalled,
  prepareManagedExtensionRuntime,
  PRIVATE_RUNTIME_ROOT_VAR,
} from "./neutral-production-extension-fixture-files";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";

function main(): void {
  const action = process.argv[2];
  const sourcePgConfig =
    process.env.OT_NEUTRAL_RECOVERY_REHEARSAL_PG_CONFIG ?? "";
  const runtimeRoot = process.env[PRIVATE_RUNTIME_ROOT_VAR] ?? "";
  if (action !== "prepare" && action !== "verify")
    throw new Error("Fixture action must be prepare or verify");
  if (!runtimeRoot) throw new Error(`${PRIVATE_RUNTIME_ROOT_VAR} is required`);
  const result =
    action === "verify"
      ? assertManagedExtensionFixtureInstalled(runtimeRoot)
      : prepareManagedExtensionRuntime({
          runtimeRoot,
          sourcePgConfig,
        });
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
