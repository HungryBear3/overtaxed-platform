import fs from "node:fs";
import path from "node:path";
import {
  OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_PROOF_SCHEMA,
  OT_PRODUCTION_RECOVERY_CANDIDATE_COMMIT_VAR,
  OT_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST_VAR,
  authenticateReceipt,
  assertReceiptAuthenticator,
  canonicalJson,
  sha256,
  type NativeVaultPlatformReceipt,
  type NativeVaultProof,
  type ProductionRecoveryReceipt,
} from "../lib/fulfillment/neutral-production-recovery";
import { readProtectedFile } from "./neutral-production-recovery-gate";

const DARWIN_RECEIPT = "OT_NEUTRAL_NATIVE_VAULT_DARWIN_RECEIPT";
const LINUX_RECEIPT = "OT_NEUTRAL_NATIVE_VAULT_LINUX_RECEIPT";
const OUTPUT = "OT_NEUTRAL_NATIVE_VAULT_PROOF_OUTPUT";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function main(): void {
  const authenticationKey = required("OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY");
  const backupPath = required("OT_NEUTRAL_PRODUCTION_RECOVERY_RECEIPT");
  const candidateCommit = required(OT_PRODUCTION_RECOVERY_CANDIDATE_COMMIT_VAR);
  const candidateManifestSha256 = required(
    OT_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST_VAR,
  );
  if (
    !/^[0-9a-f]{40}$/.test(candidateCommit) ||
    !/^[0-9a-f]{64}$/.test(candidateManifestSha256)
  )
    throw new Error("Released candidate identity is invalid");
  const backupBytes = readProtectedFile(backupPath);
  const backup = JSON.parse(
    backupBytes.toString("utf8"),
  ) as ProductionRecoveryReceipt;
  assertReceiptAuthenticator(backup, authenticationKey);
  const output = path.resolve(required(OUTPUT));
  const outputDirectory = path.dirname(output);
  const receiptPaths = [
    ["darwin", path.resolve(required(DARWIN_RECEIPT))],
    ["linux", path.resolve(required(LINUX_RECEIPT))],
  ] as const;
  const evidenceBasenames = new Set<string>();
  const reserve = (file: string, platform: "darwin" | "linux"): string => {
    const basename = path.basename(file);
    if (
      basename !== file ||
      !basename.toLowerCase().includes(platform) ||
      evidenceBasenames.has(basename)
    )
      throw new Error("Native Vault evidence basename is unsafe or colliding");
    evidenceBasenames.add(basename);
    return basename;
  };
  const platformReceipts = receiptPaths.map(([platform, receiptPath]) => {
    if (path.dirname(receiptPath) !== outputDirectory)
      throw new Error(
        "Platform receipts must already be in the proof directory",
      );
    const bytes = readProtectedFile(receiptPath);
    const receipt = JSON.parse(
      bytes.toString("utf8"),
    ) as NativeVaultPlatformReceipt;
    assertReceiptAuthenticator(receipt, authenticationKey);
    if (
      receipt.schema !== OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA ||
      receipt.platform !== platform ||
      receipt.backupId !== backup.backupId ||
      receipt.backupReceiptSha256 !== sha256(backupBytes) ||
      receipt.candidateCommit !== candidateCommit ||
      receipt.candidateManifestSha256 !== candidateManifestSha256
    )
      throw new Error(`${platform} native Vault receipt is not bound`);
    const receiptFile = reserve(path.basename(receiptPath), platform);
    for (const reference of Object.values(receipt.evidence)) {
      const evidenceFile = reserve(reference.file, platform);
      const evidenceBytes = readProtectedFile(
        path.join(outputDirectory, evidenceFile),
      );
      if (sha256(evidenceBytes) !== reference.sha256)
        throw new Error(`${platform} native Vault evidence changed`);
    }
    return {
      platform,
      file: receiptFile,
      sha256: sha256(bytes),
    };
  }) as NativeVaultProof["platformReceipts"];
  const proof: NativeVaultProof = {
    schema: OT_PRODUCTION_NATIVE_VAULT_PROOF_SCHEMA,
    backupId: backup.backupId,
    backupReceiptSha256: sha256(backupBytes),
    candidateCommit,
    candidateManifestSha256,
    platformReceipts,
    authenticator: "",
  };
  proof.authenticator = authenticateReceipt(proof, authenticationKey);
  const descriptor = fs.openSync(output, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, canonicalJson(proof));
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  process.stdout.write(
    `neutral-report native Vault proof export: NON_AUTHORITATIVE file=${path.basename(output)}\n`,
  );
}

try {
  main();
} catch {
  process.stderr.write("neutral-report native Vault proof export: FAIL\n");
  process.exitCode = 1;
}
