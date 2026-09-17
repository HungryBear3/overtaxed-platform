import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE,
  assertResolveChecksums,
  flattenResolveChecksums,
  manifestPinnedPaths,
  parseResolveChecksumFile,
} from "./neutral-production-baseline-manifest";

/**
 * "The SQL that was reviewed" and "the SQL that ran" as one claim, for every
 * Production path — not only the one that mutates.
 *
 * WHY THE READ-ONLY VERIFIER NEEDS THIS TOO
 *
 * The baseline runner has always proved its bytes at Gate 2 before executing
 * them. The standalone Phase 7 verifier did not: it read
 * `03_postconditions.sql` off disk, executed whatever was there, and printed
 * `PASS` on the strength of it. That is the receipt the rollout packet files as
 * the durable proof that Production is in the state the review approved — and a
 * postcondition file with its checks quietly weakened produces exactly that
 * receipt, from a verifier that never once asked whether the file it ran was
 * the reviewed one. Being read-only makes it safe; it does not make it
 * truthful.
 *
 * So the same pin the runner enforces is enforced here, over the same list of
 * paths, BEFORE the verification runs and long before anything prints `PASS`.
 * It is exact in both directions: a pinned file that is missing, a pinned file
 * whose bytes differ, and a pin for a path the manifest does not name are all
 * refusals.
 */

export function observedManifestDigests(root: string): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const relative of manifestPinnedPaths()) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) continue;
    digests[relative] = createHash("sha256")
      .update(fs.readFileSync(absolute))
      .digest("hex");
  }
  return digests;
}

export function pinnedManifestDigests(root: string): Record<string, string> {
  return flattenResolveChecksums(
    parseResolveChecksumFile(
      fs.readFileSync(
        path.join(root, OT_NEUTRAL_PRODUCTION_CHECKSUM_FILE),
        "utf8",
      ),
    ),
  );
}

/**
 * Prove every manifest-pinned file on disk is the reviewed one. Throws on the
 * first inconsistency, naming all of them.
 */
export function assertProductionArtifactIntegrity(root: string): void {
  assertResolveChecksums(
    pinnedManifestDigests(root),
    observedManifestDigests(root),
  );
}
