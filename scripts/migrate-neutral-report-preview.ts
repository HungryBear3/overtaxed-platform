import { spawnSync } from "node:child_process";
import {
  runNeutralPreviewMigrationEntrypoint,
  type MigrationCommandRunner,
} from "../lib/fulfillment/neutral-preview-migration-entrypoint";

const run: MigrationCommandRunner = ({ command, args }) => {
  const result = spawnSync(command, [...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  return { status: result.status, error: result.error };
};

try {
  runNeutralPreviewMigrationEntrypoint(process.env, run);
  process.stdout.write("neutral-report Preview migration: PASS\n");
} catch {
  process.stderr.write("neutral-report Preview migration: FAIL\n");
  process.exitCode = 1;
}
