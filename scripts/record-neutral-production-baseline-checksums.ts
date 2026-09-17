import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  OT_NEUTRAL_PRODUCTION_BASELINE_ARTIFACTS,
  OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE,
  OT_NEUTRAL_PRODUCTION_CHECKSUM_SCHEMA,
  OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST,
} from "../lib/fulfillment/neutral-production-baseline-manifest";

/**
 * Record the exact SHA-256 of every file the Production resolve manifest pins.
 *
 * This is a DEVELOPMENT command, not a Production one. It touches no database
 * and reads no environment. Its output is committed and reviewed by a human,
 * and from then on the operator runner refuses to execute any artifact whose
 * bytes do not match the recorded digest — which is what makes "the SQL that was
 * reviewed" and "the SQL that ran" the same claim rather than two.
 *
 * `--check` re-computes without writing and exits non-zero on any drift, which
 * is the form CI and the source-contract test use.
 */

const root = process.cwd();
const check = process.argv.includes("--check");

const digest = (relative: string): string => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute))
    throw new Error(`manifest pins a file that does not exist: ${relative}`);
  return createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
};

const section = (paths: readonly string[]): Record<string, string> =>
  Object.fromEntries([...paths].sort().map((relative) => [relative, digest(relative)]));

const recorded = {
  schema: OT_NEUTRAL_PRODUCTION_CHECKSUM_SCHEMA,
  baselineArtifacts: section(OT_NEUTRAL_PRODUCTION_BASELINE_ARTIFACTS),
  coveredMigrations: section(
    OT_NEUTRAL_PRODUCTION_RESOLVE_MANIFEST.map((entry) => entry.path),
  ),
};

const serialized = `${JSON.stringify(recorded, null, 2)}\n`;
const target = path.join(root, OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE);

if (check) {
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (existing !== serialized) {
    process.stderr.write(
      "neutral-report PRODUCTION checksum manifest is out of date; run neutral-report:production-record-checksums\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("neutral-report PRODUCTION checksum manifest: PASS\n");
  }
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serialized);
  process.stdout.write(
    `neutral-report PRODUCTION checksum manifest written: ${OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE}\n`,
  );
}
