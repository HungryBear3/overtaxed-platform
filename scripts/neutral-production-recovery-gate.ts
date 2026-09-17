import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OT_PRODUCTION_RECOVERY_AUTH_KEY_VAR,
  OT_PRODUCTION_RECOVERY_MAX_AGE_MINUTES,
  OT_PRODUCTION_RECOVERY_PASSPHRASE_VAR,
  OT_PRODUCTION_RECOVERY_RECEIPT_VAR,
  OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
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
} from "../lib/fulfillment/neutral-production-recovery";
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
    // Node does not expose openat(2). Delegate the single relative open to a
    // tiny, non-shell Python helper while passing the already-verified parent
    // directory descriptor as fd 3. The child is therefore resolved beneath
    // the held directory object, not through an attacker-swappable pathname.
    // Expected inode metadata also preserves the child swap check.
    const helper = `
import os, stat, sys
name = sys.argv[1]
expected = tuple(int(value) for value in sys.argv[2:8])
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
fd = os.open(name, flags, dir_fd=3)
try:
    observed = os.fstat(fd)
    actual = (observed.st_dev, observed.st_ino, observed.st_uid, observed.st_mode, observed.st_size, observed.st_nlink)
    if not stat.S_ISREG(observed.st_mode) or actual != expected or observed.st_nlink != 1:
        raise RuntimeError("Recovery evidence identity changed while opening")
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        os.write(1, chunk)
finally:
    os.close(fd)
`;
    try {
      beforeRelativeOpen?.();
      return execFileSync(
        "python3",
        [
          "-c",
          helper,
          path.basename(absolute),
          String(stat.dev),
          String(stat.ino),
          String(stat.uid),
          String(stat.mode),
          String(stat.size),
          String(stat.nlink),
        ],
        {
          stdio: ["ignore", "pipe", "pipe", directoryDescriptor],
          maxBuffer: 1024 * 1024 * 1024,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "production",
            LANG: "C",
            LC_ALL: "C",
          },
        },
      );
    } catch {
      throw new Error(
        `Recovery evidence identity changed while opening: ${path.basename(file)}`,
      );
    }
  } finally {
    fs.closeSync(directoryDescriptor);
  }
}

export function materializePrivateCopy(bytes: Buffer): {
  file: string;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ot-recovery-bytes-"),
  );
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, "artifact.gpg");
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.chmodSync(file, 0o400);
  return {
    file,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

async function decryptArtifact(
  file: string,
  passphrase: string,
  capturePlaintext = false,
): Promise<{ plaintextSha256: string; plaintext?: Buffer }> {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-gpg-"));
  fs.chmodSync(homedir, 0o700);
  try {
    const child = spawn(
      "gpg",
      [
        "--batch",
        "--quiet",
        "--no-options",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "3",
        "--decrypt",
        file,
      ],
      {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          LANG: "C",
          LC_ALL: "C",
          GNUPGHOME: homedir,
        },
        stdio: ["ignore", "pipe", "pipe", "pipe"],
        shell: false,
      },
    );
    const hash = createHash("sha256");
    const plaintextChunks: Buffer[] = [];
    let error = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      if (capturePlaintext) plaintextChunks.push(Buffer.from(chunk));
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk) => (error += chunk));
    (child.stdio[3] as NodeJS.WritableStream).end(`${passphrase}\n`);
    const [code] = (await once(child, "close")) as [number];
    if (code !== 0) {
      for (const chunk of plaintextChunks) chunk.fill(0);
      throw new Error(
        `Production recovery artifact is not decryptable: ${error.trim()}`,
      );
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

export async function assertProductionRecoveryGate(input: {
  env: Readonly<Record<string, string | undefined>>;
  projectRef: string;
  markerInstanceId: string;
  now?: Date;
}): Promise<ProductionRecoveryReceipt> {
  const receiptPath = input.env[OT_PRODUCTION_RECOVERY_RECEIPT_VAR];
  if (!receiptPath)
    throw new Error(
      `${OT_PRODUCTION_RECOVERY_RECEIPT_VAR} is required before Production apply`,
    );
  const authenticationKey = input.env[OT_PRODUCTION_RECOVERY_AUTH_KEY_VAR];
  const passphrase = input.env[OT_PRODUCTION_RECOVERY_PASSPHRASE_VAR];
  if (!authenticationKey || !passphrase)
    throw new Error(
      "Production recovery authentication key and passphrase are required",
    );
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
        privateCopy.file,
        passphrase,
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
  let adaptedRolesSha256: string | undefined;
  let adaptedStatementCount: number | undefined;
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
      portability.adaptedRolesSha256 !== independentlyAdaptedRolesSha256 ||
      portability.adaptedStatementCount !==
        independentlyAdaptedStatementCount ||
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
      }) !== canonicalJson(independentlyVerifiedExtensionPortability) ||
      extensionPortability.pinnedCreateExtensionStatements !==
        expectedExtensionSql.pinnedCreateExtensionStatements ||
      extensionPortability.pinnedCreateExtensionStatementsSha256 !==
        expectedExtensionSql.pinnedCreateExtensionStatementsSha256
    )
      throw new Error(
        `Production recovery PostgreSQL ${major} extension portability proof is invalid`,
      );
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
  return receipt;
}
