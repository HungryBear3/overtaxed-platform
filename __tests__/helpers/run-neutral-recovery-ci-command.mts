import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupNeutralProductionRecoveryRehearsal } =
  require("../../scripts/setup-neutral-production-recovery-rehearsal") as typeof import("../../scripts/setup-neutral-production-recovery-rehearsal");
const { rehearseNeutralProductionRecovery } =
  require("../../scripts/rehearse-neutral-production-recovery") as typeof import("../../scripts/rehearse-neutral-production-recovery");
const { assertManagedExtensionFixtureInstalled } =
  require("../../scripts/neutral-production-extension-fixture-files") as typeof import("../../scripts/neutral-production-extension-fixture-files");
const { resolveTrustedExecutable, unitTestTrustedExecutablePolicy } =
  require("../../scripts/trusted-executable") as typeof import("../../scripts/trusted-executable");

const [command, unexpected] = process.argv.slice(2);
if ((command !== "setup" && command !== "rehearse") || unexpected !== undefined)
  throw new Error("Synthetic recovery command must be setup or rehearse");
if (!process.getuid)
  throw new Error("Synthetic recovery command requires a POSIX uid");

const ownershipPolicy = unitTestTrustedExecutablePolicy(process.getuid());
const verifyInstalledFixture = (runtimeRoot: string) =>
  assertManagedExtensionFixtureInstalled(
    runtimeRoot,
    process.cwd(),
    ownershipPolicy,
  );

if (command === "setup") {
  await setupNeutralProductionRecoveryRehearsal({ verifyInstalledFixture });
} else {
  await rehearseNeutralProductionRecovery({
    verifyInstalledFixture,
    resolveRuntimeExecutable: (file) =>
      resolveTrustedExecutable(file, {
        allowStickyAncestors: true,
        ownershipPolicy,
      }),
  });
}
