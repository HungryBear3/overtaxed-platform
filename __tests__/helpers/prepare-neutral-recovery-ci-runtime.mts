import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { prepareManagedExtensionRuntime } =
  require("../../scripts/neutral-production-extension-fixture-files") as typeof import("../../scripts/neutral-production-extension-fixture-files");
const { unitTestTrustedExecutablePolicy } =
  require("../../scripts/trusted-executable") as typeof import("../../scripts/trusted-executable");

function main(): void {
  const [runtimeRoot, sourcePgConfig, unexpected] = process.argv.slice(2);
  if (!runtimeRoot || !sourcePgConfig || unexpected !== undefined) {
    throw new Error(
      "Synthetic recovery fixture preparation requires runtime-root and pg-config arguments",
    );
  }
  if (!process.getuid) {
    throw new Error(
      "Synthetic recovery fixture preparation requires a POSIX uid",
    );
  }
  const result = prepareManagedExtensionRuntime({
    runtimeRoot,
    sourcePgConfig,
    testOnlyOwnershipPolicy: unitTestTrustedExecutablePolicy(process.getuid()),
  });
  process.stdout.write(
    `synthetic recovery fixture portability: PASS target_pg=${result.major}\n`,
  );
}

main();
