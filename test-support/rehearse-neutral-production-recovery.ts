import { rehearseNeutralProductionRecovery } from "../scripts/rehearse-neutral-production-recovery";
import { unitTestTrustedExecutablePolicy } from "../scripts/trusted-executable";

const uid = process.getuid?.();
if (uid === undefined) throw new Error("uid unavailable");

rehearseNeutralProductionRecovery({
  env: process.env,
  testOnlyOwnershipPolicy: unitTestTrustedExecutablePolicy(uid),
}).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Recovery rehearsal failed"}\n`,
  );
  process.exitCode = 1;
});
