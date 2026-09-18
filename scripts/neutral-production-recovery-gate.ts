import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OT_PRODUCTION_RECOVERY_AUTH_KEY_VAR,
  OT_PRODUCTION_RECOVERY_GPG_PATH_VAR,
  OT_PRODUCTION_NATIVE_VAULT_PROOF_VAR,
  OT_PRODUCTION_NATIVE_VAULT_PROOF_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_TRANSCRIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
  OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256,
  OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256,
  OT_PRODUCTION_NATIVE_VAULT_APPROVED_PLATFORM_RECEIPT_SHA256,
  OT_PRODUCTION_RECOVERY_MAX_AGE_MINUTES,
  OT_PRODUCTION_RECOVERY_PASSPHRASE_VAR,
  OT_PRODUCTION_RECOVERY_RECEIPT_VAR,
  OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
  OT_PRODUCTION_RECOVERY_CANDIDATE_COMMIT_VAR,
  OT_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST_VAR,
  OT_PRODUCTION_RESTORE_SCHEMA,
  adaptManagedRoleMembershipGrantors,
  assertReceiptAuthenticator,
  assertRecoveryReceipt,
  assertRecoveryExtensionPortability,
  canonicalJson,
  recoveryExtensionPortability,
  sha256,
  type ProductionRecoveryReceipt,
  type RestoreRehearsalReceipt,
  type NativeVaultProof,
  type NativeVaultPlatformReceipt,
  type NativeVaultTranscript,
} from "../lib/fulfillment/neutral-production-recovery";
import {
  resolveTrustedExecutable,
  spawnTrusted,
  type TrustedExecutable,
} from "./trusted-executable";
import { expectedExtensionSqlPortabilityProof } from "../lib/fulfillment/neutral-production-extension-portability";

export function readProtectedFile(
  file: string,
  beforeRelativeOpen?: () => void,
): Buffer {
  const absolute = path.resolve(file);
  const uid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  const parent = path.dirname(absolute);
  const directoryStat = fs.lstatSync(parent);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (uid !== undefined && directoryStat.uid !== uid) ||
    (directoryStat.mode & 0o077) !== 0
  )
    throw new Error(
      "Recovery evidence directory ownership or permissions are unsafe",
    );
  const directoryDescriptor = fs.openSync(
    parent,
    fs.constants.O_RDONLY |
      (fs.constants.O_DIRECTORY ?? 0) |
      (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const openedDirectoryStat = fs.fstatSync(directoryDescriptor);
    if (
      openedDirectoryStat.dev !== directoryStat.dev ||
      openedDirectoryStat.ino !== directoryStat.ino
    )
      throw new Error(
        "Recovery evidence directory identity changed while opening",
      );
    const stat = fs.lstatSync(absolute);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (uid !== undefined && stat.uid !== uid) ||
      (stat.mode & 0o077) !== 0 ||
      stat.nlink !== 1
    )
      throw new Error(
        `Recovery evidence ownership, type or permissions are unsafe: ${path.basename(file)}`,
      );
    let descriptor: number | undefined;
    try {
      beforeRelativeOpen?.();
      descriptor = fs.openSync(
        absolute,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
      );
      const opened = fs.fstatSync(descriptor);
      const parentAfter = fs.fstatSync(directoryDescriptor);
      if (
        opened.dev !== stat.dev ||
        opened.ino !== stat.ino ||
        opened.uid !== stat.uid ||
        opened.mode !== stat.mode ||
        opened.size !== stat.size ||
        opened.nlink !== 1 ||
        parentAfter.dev !== directoryStat.dev ||
        parentAfter.ino !== directoryStat.ino
      )
        throw new Error("identity mismatch");
      return fs.readFileSync(descriptor);
    } catch {
      throw new Error(
        `Recovery evidence identity changed while opening: ${path.basename(file)}`,
      );
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  } finally {
    fs.closeSync(directoryDescriptor);
  }
}

export type PrivateArtifactCopy = {
  file: string;
  descriptor: number;
  sha256: string;
  device: number;
  inode: number;
  size: number;
  cleanup: () => void;
};

export function materializePrivateCopy(bytes: Buffer): PrivateArtifactCopy {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ot-recovery-bytes-"),
  );
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, "artifact.gpg");
  const descriptor = fs.openSync(file, "wx+", 0o600);
  fs.writeFileSync(descriptor, bytes);
  fs.fsyncSync(descriptor);
  fs.fchmodSync(descriptor, 0o400);
  const stat = fs.fstatSync(descriptor);
  const digest = sha256(bytes);
  let descriptorOpen = true;
  let directoryRemoved = false;
  return {
    file,
    descriptor,
    sha256: digest,
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    cleanup: () => {
      if (!descriptorOpen && directoryRemoved) return;
      let closeFailure: unknown;
      let removalFailure: unknown;
      if (descriptorOpen) {
        // POSIX close may release the descriptor and still report EIO. Give up
        // ownership before the sole attempt so a later cleanup can never close
        // an unrelated resource that reused the same numeric descriptor.
        descriptorOpen = false;
        try {
          fs.closeSync(descriptor);
        } catch (error) {
          closeFailure = error;
        }
      }
      if (!directoryRemoved) {
        try {
          fs.rmSync(directory, { recursive: true, force: true });
          directoryRemoved = true;
        } catch (error) {
          removalFailure = error;
        }
      }
      if (closeFailure) {
        if (removalFailure && closeFailure instanceof Error) {
          try {
            Object.defineProperty(closeFailure, "cause", {
              configurable: true,
              value: removalFailure,
            });
          } catch {
            // Preserve the descriptor-close failure as the primary error.
          }
        }
        throw closeFailure;
      }
      if (removalFailure) throw removalFailure;
    },
  };
}

export function verifyPrivateCopy(copy: PrivateArtifactCopy): void {
  const opened = fs.fstatSync(copy.descriptor);
  const linked = fs.lstatSync(copy.file);
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  for (;;) {
    const count = fs.readSync(
      copy.descriptor,
      buffer,
      0,
      buffer.length,
      position,
    );
    if (count === 0) break;
    hash.update(buffer.subarray(0, count));
    position += count;
  }
  buffer.fill(0);
  if (
    !opened.isFile() ||
    opened.nlink !== 1 ||
    opened.dev !== copy.device ||
    opened.ino !== copy.inode ||
    opened.size !== copy.size ||
    linked.isSymbolicLink() ||
    linked.dev !== copy.device ||
    linked.ino !== copy.inode ||
    hash.digest("hex") !== copy.sha256
  )
    throw new Error("Private recovery artifact identity changed");
}

export function privateCopyReadStream(
  copy: PrivateArtifactCopy,
): fs.ReadStream {
  verifyPrivateCopy(copy);
  return fs.createReadStream(copy.file, {
    fd: copy.descriptor,
    autoClose: true,
    start: 0,
    fs: {
      read: fs.read,
      // The materialized copy owns this identity descriptor across every
      // restore pass. A stream closes only its view; cleanup closes the fd.
      close: (_descriptor, callback) => callback(null),
    },
  });
}

async function decryptArtifact(
  copy: PrivateArtifactCopy,
  passphrase: string,
  gpgExecutable: TrustedExecutable,
  capturePlaintext = false,
): Promise<{ plaintextSha256: string; plaintext?: Buffer }> {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-gpg-"));
  fs.chmodSync(homedir, 0o700);
  try {
    const encrypted = privateCopyReadStream(copy);
    const child = spawnTrusted(
      gpgExecutable,
      [
        "--batch",
        "--quiet",
        "--no-options",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "3",
        "--decrypt",
      ],
      {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          LANG: "C",
          LC_ALL: "C",
          GNUPGHOME: homedir,
        },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    encrypted.pipe(child.stdin!);
    const hash = createHash("sha256");
    const plaintextChunks: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      if (capturePlaintext) plaintextChunks.push(Buffer.from(chunk));
    });
    (child.stdio[3] as NodeJS.WritableStream).end(`${passphrase}\n`);
    const [code] = (await once(child, "close")) as [number];
    if (code !== 0) {
      for (const chunk of plaintextChunks) chunk.fill(0);
      throw new Error("Production recovery artifact is not decryptable");
    }
    const plaintextSha256 = hash.digest("hex");
    if (!capturePlaintext) return { plaintextSha256 };
    const plaintext = Buffer.concat(plaintextChunks);
    for (const chunk of plaintextChunks) chunk.fill(0);
    return { plaintextSha256, plaintext };
  } finally {
    fs.rmSync(homedir, { recursive: true, force: true });
  }
}

const NATIVE_VAULT_EVIDENCE_BASENAME =
  /^([a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)-(darwin|linux)\.([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)$/;

export function reserveNativeVaultEvidenceBasename(
  file: string,
  platform: "darwin" | "linux",
  seenBasenames: Set<string>,
): string {
  const basename = path.basename(file);
  const collisionKey = basename.normalize("NFKC").toLowerCase();
  if (seenBasenames.has(collisionKey))
    throw new Error("Native Vault evidence basename is colliding");
  const match = NATIVE_VAULT_EVIDENCE_BASENAME.exec(basename);
  if (
    basename !== file ||
    basename.normalize("NFC") !== basename ||
    !match ||
    match[2] !== platform
  )
    throw new Error("Native Vault evidence basename is unsafe");
  seenBasenames.add(collisionKey);
  return basename;
}

function readEvidenceReference(
  directory: string,
  reference: { file: string; sha256: string },
  platform: "darwin" | "linux",
  seenBasenames: Set<string>,
): Buffer {
  const basename = reserveNativeVaultEvidenceBasename(
    reference.file,
    platform,
    seenBasenames,
  );
  if (!/^[0-9a-f]{64}$/.test(reference.sha256))
    throw new Error("Native Vault evidence reference is invalid");
  const bytes = readProtectedFile(path.join(directory, basename));
  if (sha256(bytes) !== reference.sha256)
    throw new Error("Native Vault evidence file changed");
  return bytes;
}

function assertNativeVaultPlatformEvidence(input: {
  proofDirectory: string;
  reference: NativeVaultProof["platformReceipts"][number];
  expectedPlatform: "darwin" | "linux";
  authenticationKey: string;
  backupId: string;
  backupReceiptSha256: string;
  candidateCommit: string;
  candidateManifestSha256: string;
  now: Date;
  backupCreatedAt: string;
  seenBasenames: Set<string>;
}): void {
  if (input.reference.platform !== input.expectedPlatform)
    throw new Error("Native Vault platform receipt order is invalid");
  const receiptBytes = readEvidenceReference(
    input.proofDirectory,
    input.reference,
    input.expectedPlatform,
    input.seenBasenames,
  );
  const receipt = JSON.parse(
    receiptBytes.toString("utf8"),
  ) as NativeVaultPlatformReceipt;
  assertReceiptAuthenticator(receipt, input.authenticationKey);
  const verifiedAt = Date.parse(receipt.verifiedAt);
  if (
    receipt.schema !== OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA ||
    receipt.platform !== input.expectedPlatform ||
    receipt.backupId !== input.backupId ||
    receipt.backupReceiptSha256 !== input.backupReceiptSha256 ||
    receipt.candidateCommit !== input.candidateCommit ||
    receipt.candidateManifestSha256 !== input.candidateManifestSha256 ||
    receipt.upstreamCommit !== OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT ||
    receipt.baseSqlSha256 !== OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256 ||
    receipt.upgradeSqlSha256 !==
      OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256 ||
    !/^PostgreSQL (17|18)\./.test(receipt.toolchain.postgresVersion) ||
    !receipt.toolchain.compilerVersion ||
    !/^[0-9a-f]{64}$/.test(receipt.toolchain.pgConfigSha256) ||
    !/^[0-9a-f]{64}$/.test(receipt.toolchain.compilerSha256) ||
    !/^[0-9a-f]{64}$/.test(receipt.toolchain.pgxsTreeSha256) ||
    !/^[0-9a-f]{64}$/.test(receipt.toolchain.dependencyHeaderTreeSha256) ||
    !/^[0-9a-f]{64}$/.test(receipt.toolchain.sodiumStaticLibrarySha256) ||
    !/^[0-9a-f]{64}$/.test(receipt.nativeSourceCatalogSha256) ||
    !/^[0-9a-f]{64}$/.test(receipt.functionalSecretRoundTripSha256) ||
    !Number.isFinite(verifiedAt) ||
    verifiedAt < Date.parse(input.backupCreatedAt) ||
    verifiedAt > input.now.getTime()
  )
    throw new Error("Native Vault platform receipt is invalid");
  const receiptDirectory = input.proofDirectory;
  const sourceArchive = readEvidenceReference(
    receiptDirectory,
    receipt.evidence.sourceArchive,
    input.expectedPlatform,
    input.seenBasenames,
  );
  const nativeLibrary = readEvidenceReference(
    receiptDirectory,
    receipt.evidence.nativeLibrary,
    input.expectedPlatform,
    input.seenBasenames,
  );
  const transcriptBytes = readEvidenceReference(
    receiptDirectory,
    receipt.evidence.transcript,
    input.expectedPlatform,
    input.seenBasenames,
  );
  if (sourceArchive.length === 0 || nativeLibrary.length === 0)
    throw new Error("Native Vault binary/source evidence is empty");
  const transcript = JSON.parse(
    transcriptBytes.toString("utf8"),
  ) as NativeVaultTranscript;
  if (
    transcript.schema !== OT_PRODUCTION_NATIVE_VAULT_TRANSCRIPT_SCHEMA ||
    transcript.platform !== receipt.platform ||
    transcript.backupId !== receipt.backupId ||
    transcript.backupReceiptSha256 !== receipt.backupReceiptSha256 ||
    transcript.candidateCommit !== receipt.candidateCommit ||
    transcript.candidateManifestSha256 !== receipt.candidateManifestSha256 ||
    transcript.upstreamCommit !== receipt.upstreamCommit ||
    transcript.sourceArchiveSha256 !== receipt.evidence.sourceArchive.sha256 ||
    transcript.nativeLibrarySha256 !== receipt.evidence.nativeLibrary.sha256 ||
    transcript.nativeSourceCatalogSha256 !==
      receipt.nativeSourceCatalogSha256 ||
    transcript.functionalSecretRoundTripSha256 !==
      receipt.functionalSecretRoundTripSha256 ||
    canonicalJson(transcript.operations) !==
      canonicalJson([
        "build",
        "install",
        "create_secret",
        "read_decrypted_secret",
        "update_secret",
        "read_updated_secret",
        "drop_secret",
      ]) ||
    transcript.result !== "PASS"
  )
    throw new Error("Native Vault functional transcript is invalid");
}

/**
 * Everything the Production gate proves about recovery evidence except the two
 * things only a reviewed release may decide: which gpg binary is trusted and
 * which platform receipt hashes are approved. Those stay in
 * {@link assertProductionRecoveryGate}, which takes no input for either.
 */
export type PreparedProductionRecoveryEvidence = {
  receipt: ProductionRecoveryReceipt;
  receiptDigest: string;
  directory: string;
  now: Date;
  authenticationKey: string;
  nativeProof: NativeVaultProof;
  proofDirectory: string;
  candidateCommit: string;
  candidateManifestSha256: string;
  independentlyAdaptedRolesSha256: string;
  independentlyAdaptedStatementCount: number;
  independentlyVerifiedExtensionPortability: ProductionRecoveryReceipt["extensionPortability"];
};

export function assertProductionRecoveryEnvironmentPresent(
  env: Readonly<Record<string, string | undefined>>,
): {
  receiptPath: string;
  authenticationKey: string;
  passphrase: string;
  gpgPath: string;
} {
  const receiptPath = env[OT_PRODUCTION_RECOVERY_RECEIPT_VAR];
  if (!receiptPath)
    throw new Error(
      `${OT_PRODUCTION_RECOVERY_RECEIPT_VAR} is required before Production apply`,
    );
  const authenticationKey = env[OT_PRODUCTION_RECOVERY_AUTH_KEY_VAR];
  const passphrase = env[OT_PRODUCTION_RECOVERY_PASSPHRASE_VAR];
  const gpgPath = env[OT_PRODUCTION_RECOVERY_GPG_PATH_VAR];
  if (!authenticationKey || !passphrase || !gpgPath)
    throw new Error(
      "Production recovery authentication key and passphrase are required",
    );
  return { receiptPath, authenticationKey, passphrase, gpgPath };
}

export async function prepareProductionRecoveryEvidence(input: {
  env: Readonly<Record<string, string | undefined>>;
  projectRef: string;
  markerInstanceId: string;
  now?: Date;
  gpgExecutable: TrustedExecutable;
}): Promise<PreparedProductionRecoveryEvidence> {
  const { receiptPath, authenticationKey, passphrase } =
    assertProductionRecoveryEnvironmentPresent(input.env);
  const gpgExecutable = input.gpgExecutable;
  if (authenticationKey === passphrase)
    throw new Error(
      "Production recovery authentication key and passphrase must be independent",
    );
  const receiptBytes = readProtectedFile(receiptPath);
  const receipt = JSON.parse(
    receiptBytes.toString("utf8"),
  ) as ProductionRecoveryReceipt;
  assertRecoveryReceipt(receipt);
  assertReceiptAuthenticator(receipt, authenticationKey);
  if (
    receipt.projectRef !== input.projectRef ||
    receipt.markerInstanceId !== input.markerInstanceId
  )
    throw new Error(
      "Production recovery receipt is bound to a different database marker",
    );
  const now = input.now ?? new Date();
  const age = now.getTime() - Date.parse(receipt.backupStartedAt);
  const captureDuration =
    Date.parse(receipt.backupCompletedAt) - Date.parse(receipt.backupStartedAt);
  if (
    captureDuration < 0 ||
    captureDuration > OT_PRODUCTION_RECOVERY_MAX_AGE_MINUTES * 60_000
  )
    throw new Error(
      "Production recovery capture duration exceeds the hard limit",
    );
  if (age < 0 || age > OT_PRODUCTION_RECOVERY_MAX_AGE_MINUTES * 60_000)
    throw new Error("Production recovery receipt is stale or from the future");
  const directory = path.dirname(path.resolve(receiptPath));
  let independentlyAdaptedRolesSha256: string | undefined;
  let independentlyAdaptedStatementCount: number | undefined;
  let independentlyVerifiedExtensionPortability:
    | ProductionRecoveryReceipt["extensionPortability"]
    | undefined;
  for (const artifact of receipt.artifacts) {
    const absolute = path.join(directory, artifact.file);
    const bytes = readProtectedFile(absolute);
    if (bytes.byteLength !== artifact.ciphertextBytes)
      throw new Error(
        `Production recovery artifact size changed: ${artifact.file}`,
      );
    if (sha256(bytes) !== artifact.ciphertextSha256)
      throw new Error(
        `Production recovery artifact checksum changed: ${artifact.file}`,
      );
    const privateCopy = materializePrivateCopy(bytes);
    try {
      const decrypted = await decryptArtifact(
        privateCopy,
        passphrase,
        gpgExecutable,
        artifact.format === "postgres-roles-sql" ||
          artifact.format === "catalog-json",
      );
      if (artifact.format === "postgres-roles-sql") {
        if (!decrypted.plaintext)
          throw new Error("Production recovery roles artifact was not read");
        try {
          if (decrypted.plaintextSha256 !== artifact.plaintextSha256)
            throw new Error(
              `Production recovery artifact plaintext changed: ${artifact.file}`,
            );
          const adapted = adaptManagedRoleMembershipGrantors(
            decrypted.plaintext,
          );
          try {
            independentlyAdaptedRolesSha256 = sha256(adapted.bytes);
            independentlyAdaptedStatementCount = adapted.managedMembershipCount;
          } finally {
            adapted.bytes.fill(0);
          }
        } finally {
          decrypted.plaintext.fill(0);
        }
      } else {
        if (decrypted.plaintextSha256 !== artifact.plaintextSha256)
          throw new Error(
            `Production recovery artifact plaintext changed: ${artifact.file}`,
          );
        if (artifact.format === "catalog-json") {
          if (!decrypted.plaintext)
            throw new Error(
              "Production recovery catalog artifact was not read",
            );
          try {
            const snapshot = JSON.parse(
              decrypted.plaintext.toString("utf8"),
            ) as unknown;
            independentlyVerifiedExtensionPortability =
              recoveryExtensionPortability(snapshot);
            assertRecoveryExtensionPortability(
              receipt.extensionPortability,
              snapshot,
            );
          } finally {
            decrypted.plaintext.fill(0);
          }
        }
      }
    } finally {
      privateCopy.cleanup();
    }
  }
  if (
    independentlyAdaptedRolesSha256 === undefined ||
    independentlyAdaptedStatementCount === undefined
  )
    throw new Error(
      "Production recovery roles portability evidence is incomplete",
    );
  if (!independentlyVerifiedExtensionPortability)
    throw new Error(
      "Production recovery extension portability evidence is incomplete",
    );
  const receiptDigest = sha256(receiptBytes);
  const nativeProofPath = input.env[OT_PRODUCTION_NATIVE_VAULT_PROOF_VAR];
  const candidateCommit =
    input.env[OT_PRODUCTION_RECOVERY_CANDIDATE_COMMIT_VAR];
  const candidateManifestSha256 =
    input.env[OT_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST_VAR];
  if (
    !nativeProofPath ||
    !/^[0-9a-f]{40}$/.test(candidateCommit ?? "") ||
    !/^[0-9a-f]{64}$/.test(candidateManifestSha256 ?? "")
  )
    throw new Error(
      "Authenticated native Vault proof is required with released candidate identity before Production apply",
    );
  const proofBytes = readProtectedFile(nativeProofPath);
  const nativeProof = JSON.parse(
    proofBytes.toString("utf8"),
  ) as NativeVaultProof;
  assertReceiptAuthenticator(nativeProof, authenticationKey);
  if (
    nativeProof.schema !== OT_PRODUCTION_NATIVE_VAULT_PROOF_SCHEMA ||
    nativeProof.backupId !== receipt.backupId ||
    nativeProof.backupReceiptSha256 !== receiptDigest ||
    nativeProof.candidateCommit !== candidateCommit ||
    nativeProof.candidateManifestSha256 !== candidateManifestSha256 ||
    !Array.isArray(nativeProof.platformReceipts) ||
    nativeProof.platformReceipts.length !== 2
  )
    throw new Error("Authenticated native Vault proof is invalid");
  return {
    receipt,
    receiptDigest,
    directory,
    now,
    authenticationKey,
    nativeProof,
    proofDirectory: path.dirname(path.resolve(nativeProofPath)),
    candidateCommit: candidateCommit!,
    candidateManifestSha256: candidateManifestSha256!,
    independentlyAdaptedRolesSha256,
    independentlyAdaptedStatementCount,
    independentlyVerifiedExtensionPortability,
  };
}

/**
 * The released candidate's own pins, and nothing else. There is no parameter
 * here for a caller to supply, and both entries are deliberately null until a
 * separately reviewed release commit fills them in from the exact bytes two
 * independent Darwin and Linux jobs produced.
 */
export function assertApprovedPlatformReceiptPins(
  nativeProof: NativeVaultProof,
): void {
  const approved = OT_PRODUCTION_NATIVE_VAULT_APPROVED_PLATFORM_RECEIPT_SHA256;
  if (
    !approved.darwin ||
    !approved.linux ||
    nativeProof.platformReceipts[0].sha256 !== approved.darwin ||
    nativeProof.platformReceipts[1].sha256 !== approved.linux
  )
    throw new Error(
      "Native Vault platform receipts are not pinned by the released candidate",
    );
}

export function assertNativeVaultPlatformEvidenceBundle(
  prepared: PreparedProductionRecoveryEvidence,
): void {
  const seenNativeEvidenceBasenames = new Set<string>();
  for (const [index, expectedPlatform] of [
    [0, "darwin"],
    [1, "linux"],
  ] as const)
    assertNativeVaultPlatformEvidence({
      proofDirectory: prepared.proofDirectory,
      reference: prepared.nativeProof.platformReceipts[index],
      expectedPlatform,
      authenticationKey: prepared.authenticationKey,
      backupId: prepared.receipt.backupId,
      backupReceiptSha256: prepared.receiptDigest,
      candidateCommit: prepared.candidateCommit,
      candidateManifestSha256: prepared.candidateManifestSha256,
      now: prepared.now,
      backupCreatedAt: prepared.receipt.createdAt,
      seenBasenames: seenNativeEvidenceBasenames,
    });
}

export function assertRestoreRehearsalEvidence(
  prepared: PreparedProductionRecoveryEvidence,
): void {
  const { receipt, receiptDigest, directory, now, authenticationKey } =
    prepared;
  let adaptedRolesSha256: string | undefined;
  let adaptedStatementCount: number | undefined;
  let archiveTocSha256: string | undefined;
  const expectedExtensionSql = expectedExtensionSqlPortabilityProof();
  for (const major of [17, 18] as const) {
    const parsed = JSON.parse(
      readProtectedFile(
        path.join(directory, `restore-rehearsal-pg${major}.json`),
      ).toString("utf8"),
    ) as Partial<RestoreRehearsalReceipt>;
    assertReceiptAuthenticator(parsed, authenticationKey);
    if (
      parsed.schema !== OT_PRODUCTION_RESTORE_SCHEMA ||
      parsed.backupId !== receipt.backupId ||
      parsed.backupReceiptSha256 !== receiptDigest ||
      parsed.targetServerMajor !== major ||
      parsed.verified !== true ||
      parsed.sourceCatalogDigest !== receipt.catalogDigest ||
      parsed.restoredCatalogDigest !== receipt.catalogDigest
    )
      throw new Error(
        `Production recovery PostgreSQL ${major} restore receipt is invalid`,
      );
    if (!parsed.clusterSystemIdentifier || !parsed.clusterSentinelNonce)
      throw new Error(
        `Production recovery PostgreSQL ${major} cluster proof is incomplete`,
      );
    const portability = parsed.roleMembershipPortability;
    if (
      portability?.policy !== OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY ||
      portability.authenticatedSourceCount !==
        receipt.roleMembershipPortability.managedMembershipCount ||
      !Number.isSafeInteger(portability.pristineTargetCount) ||
      portability.pristineTargetCount < 0 ||
      !Number.isSafeInteger(portability.adaptedStatementCount) ||
      portability.adaptedStatementCount < 0 ||
      portability.pristineTargetCount + portability.adaptedStatementCount !==
        portability.authenticatedSourceCount ||
      !/^[0-9a-f]{64}$/.test(portability.adaptedRolesSha256) ||
      portability.adaptedRolesSha256 !==
        prepared.independentlyAdaptedRolesSha256 ||
      portability.adaptedStatementCount !==
        prepared.independentlyAdaptedStatementCount ||
      (adaptedRolesSha256 !== undefined &&
        portability.adaptedRolesSha256 !== adaptedRolesSha256) ||
      (adaptedStatementCount !== undefined &&
        portability.adaptedStatementCount !== adaptedStatementCount)
    )
      throw new Error(
        `Production recovery PostgreSQL ${major} role membership portability proof is invalid`,
      );
    adaptedRolesSha256 = portability.adaptedRolesSha256;
    adaptedStatementCount = portability.adaptedStatementCount;
    const extensionPortability = parsed.extensionPortability;
    assertRecoveryExtensionPortability(extensionPortability);
    if (
      canonicalJson({
        policy: extensionPortability.policy,
        sourceExtensions: extensionPortability.sourceExtensions,
        sourceExtensionsSha256: extensionPortability.sourceExtensionsSha256,
        managedExtensionCatalogSha256:
          extensionPortability.managedExtensionCatalogSha256,
        fixtureFilesSha256: extensionPortability.fixtureFilesSha256,
      }) !==
        canonicalJson(prepared.independentlyVerifiedExtensionPortability) ||
      extensionPortability.pinnedCreateExtensionStatements !==
        expectedExtensionSql.pinnedCreateExtensionStatements ||
      extensionPortability.pinnedCreateExtensionStatementsSha256 !==
        expectedExtensionSql.pinnedCreateExtensionStatementsSha256 ||
      !/^[0-9a-f]{64}$/.test(extensionPortability.archiveTocSha256 ?? "") ||
      (archiveTocSha256 !== undefined &&
        extensionPortability.archiveTocSha256 !== archiveTocSha256)
    )
      throw new Error(
        `Production recovery PostgreSQL ${major} extension portability proof is invalid`,
      );
    archiveTocSha256 = extensionPortability.archiveTocSha256;
    const restoredAt = parsed.restoredAt
      ? Date.parse(parsed.restoredAt)
      : Number.NaN;
    if (
      !Number.isFinite(restoredAt) ||
      restoredAt < Date.parse(receipt.createdAt) ||
      restoredAt > now.getTime()
    )
      throw new Error(
        `Production recovery PostgreSQL ${major} restore time is out of bounds`,
      );
    for (const artifact of receipt.artifacts)
      if (
        parsed.artifactPlaintextSha256?.[artifact.file] !==
        artifact.plaintextSha256
      )
        throw new Error(
          `Production recovery PostgreSQL ${major} artifact proof is incomplete`,
        );
  }
}

/**
 * The Production apply gate. It takes no policy of any kind: the gpg binary is
 * resolved under the default root-only ownership rule and the approved platform
 * receipt hashes come from the compile-time release pins. A caller that passes
 * extra properties changes nothing, because nothing here reads them.
 */
export async function assertProductionRecoveryGate(input: {
  env: Readonly<Record<string, string | undefined>>;
  projectRef: string;
  markerInstanceId: string;
  now?: Date;
}): Promise<ProductionRecoveryReceipt> {
  const { gpgPath } = assertProductionRecoveryEnvironmentPresent(input.env);
  const gpgExecutable = resolveTrustedExecutable(gpgPath);
  const prepared = await prepareProductionRecoveryEvidence({
    env: input.env,
    projectRef: input.projectRef,
    markerInstanceId: input.markerInstanceId,
    ...(input.now === undefined ? {} : { now: input.now }),
    gpgExecutable,
  });
  assertApprovedPlatformReceiptPins(prepared.nativeProof);
  assertNativeVaultPlatformEvidenceBundle(prepared);
  assertRestoreRehearsalEvidence(prepared);
  return prepared.receipt;
}
