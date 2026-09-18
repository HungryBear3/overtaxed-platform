import type { ProductionRecoveryReceipt } from "../lib/fulfillment/neutral-production-recovery";
import {
  assertNativeVaultPlatformEvidenceBundle,
  assertProductionRecoveryEnvironmentPresent,
  assertRestoreRehearsalEvidence,
  prepareProductionRecoveryEvidence,
} from "../scripts/neutral-production-recovery-gate";
import {
  resolveTrustedExecutable,
  unitTestTrustedExecutablePolicy,
} from "../scripts/trusted-executable";

/**
 * A test-only boundary for the lower-level recovery proof validation.
 *
 * The Production gate is closed: it resolves gpg under the default root-only
 * ownership rule and compares platform receipt hashes against the compile-time
 * release pins, and it accepts no input for either. A non-root unit process
 * cannot produce a root-owned gpg binary, and the release pins are deliberately
 * null, so the gate itself is unreachable from a unit test by design.
 *
 * What this boundary relaxes is exactly one thing: which uid may own the gpg
 * binary. It cannot relax the release pin, because no function anywhere accepts
 * a replacement pin — `assertApprovedPlatformReceiptPins` reads the constant
 * and nothing else, and it is deliberately not called from here.
 */
export async function assertProductionRecoveryEvidenceForTests(input: {
  env: Readonly<Record<string, string | undefined>>;
  projectRef: string;
  markerInstanceId: string;
  now?: Date;
}): Promise<ProductionRecoveryReceipt> {
  const { gpgPath } = assertProductionRecoveryEnvironmentPresent(input.env);
  const uid = process.getuid?.();
  if (uid === undefined)
    throw new Error("Unit recovery evidence boundary requires a POSIX user");
  const gpgExecutable = resolveTrustedExecutable(gpgPath, {
    ownershipPolicy: unitTestTrustedExecutablePolicy(uid),
  });
  const prepared = await prepareProductionRecoveryEvidence({
    env: input.env,
    projectRef: input.projectRef,
    markerInstanceId: input.markerInstanceId,
    ...(input.now === undefined ? {} : { now: input.now }),
    gpgExecutable,
  });
  assertNativeVaultPlatformEvidenceBundle(prepared);
  assertRestoreRehearsalEvidence(prepared);
  return prepared.receipt;
}
