import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA,
  OT_PRODUCTION_RECOVERY_GPG_PATH_VAR,
  OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY,
  OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
  OT_PRODUCTION_RESTORE_SCHEMA,
  OT_PRODUCTION_RECOVERY_CATALOG_SQL,
  OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
  adaptManagedRoleMembershipGrantors,
  assertManagedRoleMembershipPortabilityCounts,
  assertReceiptAuthenticator,
  assertFreshRehearsalSentinelTimestamp,
  authenticateReceipt,
  canonicalJson,
  assertRecoveryReceipt,
  assertRecoveryExtensionPortability,
  countNormalizedManagedMemberships,
  recoveryExtensionPortability,
  sha256,
  type ProductionRecoveryReceipt,
  type RehearsalClusterSentinel,
  type RestoreRehearsalReceipt,
} from "../lib/fulfillment/neutral-production-recovery";
import {
  RecoveryExtensionSqlTransform,
  planRecoveryArchiveToc,
  type ExtensionSqlPortabilityProof,
} from "../lib/fulfillment/neutral-production-extension-portability";
import {
  materializePrivateCopy,
  privateCopyReadStream,
  readProtectedFile,
  type PrivateArtifactCopy,
} from "./neutral-production-recovery-gate";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";
import { resolveRecoveryTarget } from "./neutral-recovery-target";
import {
  assertManagedExtensionFixtureInstalled,
  PRIVATE_RUNTIME_ROOT_VAR,
} from "./neutral-production-extension-fixture-files";
import {
  resolveTrustedExecutable,
  spawnTrusted,
  type TrustedExecutable,
} from "./trusted-executable";

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function observeRecoveryStreamErrors(
  stream: {
    on(
      event: "error",
      listener: (error: NodeJS.ErrnoException) => void,
    ): unknown;
  },
  failureMessage: string,
  ignoredCodes: readonly string[] = [],
  onFailure: () => void,
): { failure: Promise<never> } {
  const ignored = new Set(ignoredCodes);
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => undefined);
  let failed = false;
  stream.on("error", (error) => {
    if (!ignored.has(error.code ?? "") && !failed) {
      failed = true;
      try {
        onFailure();
      } catch {
        // Only the fixed diagnostic below may escape this boundary.
      }
      rejectFailure(new Error(failureMessage));
    }
  });
  return { failure };
}

type RecoverySelectionFile = {
  file: string;
  bytes: number;
  sha256: string;
  dev: bigint;
  ino: bigint;
};

type RecoverySelectionAnchor = {
  selection: RecoverySelectionFile;
  descriptor: number;
  closed: boolean;
  unlinked: boolean;
};

// Trust boundary: the runtime UID and pinned executables are trusted. Holding
// an unlinked, read-only descriptor removes ordinary pathname replacement from
// the restore path, but portable unprivileged Darwin/Linux code cannot defend
// against a truly hostile same-UID process with ptrace/fd capture or a writable
// descriptor retained before unlink. Production requiring that threat model
// needs a separately owned broker/container/VM; this disabled foundation does
// not claim to provide that isolation.

function currentUid(): number {
  if (typeof process.getuid !== "function")
    throw new Error("recovery selection owner is unavailable");
  return process.getuid();
}

function assertPrivateRecoveryDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== currentUid() ||
    (stat.mode & 0o777) !== 0o700 ||
    fs.realpathSync(directory) !== directory
  )
    throw new Error("recovery selection directory is not private");
}

function assertSelectionStat(
  stat: fs.BigIntStats,
  expected: RecoverySelectionFile,
  expectedLinkCount = BigInt(1),
): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== expectedLinkCount ||
    stat.uid !== BigInt(currentUid()) ||
    (stat.mode & BigInt(0o777)) !== BigInt(0o600) ||
    stat.size !== BigInt(expected.bytes) ||
    stat.dev !== expected.dev ||
    stat.ino !== expected.ino
  )
    throw new Error("recovery selection file identity changed");
}

export function materializeRecoverySelectionFile(
  directory: string,
  basename: string,
  bytes: Buffer,
): RecoverySelectionFile {
  assertPrivateRecoveryDirectory(directory);
  if (!/^selection-[0-9]+\.list$/.test(basename))
    throw new Error("recovery selection filename is invalid");
  const noFollow = fs.constants.O_NOFOLLOW;
  if (typeof noFollow !== "number")
    throw new Error("recovery selection no-follow support is unavailable");
  const file = path.join(directory, basename);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        noFollow,
      0o600,
    );
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (written <= 0) throw new Error("recovery selection write stalled");
      offset += written;
    }
    fs.fsyncSync(descriptor);
    const stat = fs.fstatSync(descriptor, { bigint: true });
    const result: RecoverySelectionFile = {
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      dev: stat.dev,
      ino: stat.ino,
    };
    assertSelectionStat(stat, result);
    const descriptorToClose = descriptor;
    descriptor = undefined;
    try {
      fs.closeSync(descriptorToClose);
    } catch {
      throw new Error("recovery selection close failed");
    }
    return result;
  } catch {
    if (descriptor !== undefined) {
      const descriptorToClose = descriptor;
      descriptor = undefined;
      try {
        fs.closeSync(descriptorToClose);
      } catch {
        // The original fixed failure remains authoritative.
      }
    }
    try {
      fs.unlinkSync(file);
    } catch {
      // The private directory is removed by the enclosing recovery cleanup.
    }
    throw new Error("recovery selection materialization failed");
  }
}

export function assertRecoverySelectionFile(
  selection: RecoverySelectionFile,
): void {
  const directory = path.dirname(selection.file);
  assertPrivateRecoveryDirectory(directory);
  const pathStat = fs.lstatSync(selection.file, { bigint: true });
  assertSelectionStat(pathStat, selection);
  if (fs.realpathSync(selection.file) !== selection.file)
    throw new Error("recovery selection path changed");
  const descriptor = fs.openSync(
    selection.file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  let validationFailure: unknown;
  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    assertSelectionStat(descriptorStat, selection);
    if (sha256(fs.readFileSync(descriptor)) !== selection.sha256)
      throw new Error("recovery selection content changed");
  } catch (error) {
    validationFailure = error;
    throw error;
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch {
      if (validationFailure === undefined)
        throw new Error("recovery selection validation close failed");
    }
  }
}

function selectionDescriptorSha256(
  descriptor: number,
  expectedBytes: number,
): string {
  const digest = createHash("sha256");
  const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, expectedBytes || 1));
  let offset = 0;
  while (offset < expectedBytes) {
    const read = fs.readSync(
      descriptor,
      chunk,
      0,
      Math.min(chunk.length, expectedBytes - offset),
      offset,
    );
    if (read <= 0) throw new Error("recovery selection descriptor truncated");
    digest.update(chunk.subarray(0, read));
    offset += read;
  }
  if (fs.readSync(descriptor, chunk, 0, 1, expectedBytes) !== 0)
    throw new Error("recovery selection descriptor grew");
  return digest.digest("hex");
}

export function openRecoverySelectionAnchor(
  selection: RecoverySelectionFile,
): RecoverySelectionAnchor {
  assertRecoverySelectionFile(selection);
  const descriptor = fs.openSync(
    selection.file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  const anchor: RecoverySelectionAnchor = {
    selection,
    descriptor,
    closed: false,
    unlinked: false,
  };
  try {
    assertRecoverySelectionAnchor(anchor);
    return anchor;
  } catch {
    anchor.closed = true;
    try {
      fs.closeSync(descriptor);
    } catch {
      // The fixed anchor validation failure remains authoritative.
    }
    throw new Error("recovery selection anchor validation failed");
  }
}

export function assertRecoverySelectionAnchor(
  anchor: RecoverySelectionAnchor,
): void {
  if (anchor.closed) throw new Error("recovery selection anchor is closed");
  const stat = fs.fstatSync(anchor.descriptor, { bigint: true });
  assertSelectionStat(
    stat,
    anchor.selection,
    anchor.unlinked ? BigInt(0) : BigInt(1),
  );
  if (
    selectionDescriptorSha256(anchor.descriptor, anchor.selection.bytes) !==
    anchor.selection.sha256
  )
    throw new Error("recovery selection anchor content changed");
}

export function unlinkRecoverySelectionPath(
  anchor: RecoverySelectionAnchor,
): void {
  if (anchor.closed || anchor.unlinked)
    throw new Error("recovery selection unlink state is invalid");
  assertRecoverySelectionFile(anchor.selection);
  fs.unlinkSync(anchor.selection.file);
  anchor.unlinked = true;
  try {
    fs.lstatSync(anchor.selection.file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("recovery selection path absence check failed");
  }
  throw new Error("recovery selection path still exists after unlink");
}

export function closeRecoverySelectionAnchor(
  anchor: RecoverySelectionAnchor,
): void {
  if (anchor.closed) return;
  anchor.closed = true;
  try {
    fs.closeSync(anchor.descriptor);
  } catch {
    throw new Error("recovery selection anchor close failed");
  }
}

export function recoverySelectionChildPath(): string {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("recovery selection descriptor platform is unsupported");
  return "/dev/fd/3";
}

export function removeRecoverySelectionFile(
  selection: RecoverySelectionFile,
): void {
  assertRecoverySelectionFile(selection);
  fs.unlinkSync(selection.file);
}

function childClose(
  child: ChildProcess,
  failureMessage: string,
): Promise<[number | null, NodeJS.Signals | null]> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve([child.exitCode, child.signalCode]);
  return new Promise((resolve, reject) => {
    child.once("error", () => reject(new Error(failureMessage)));
    child.once("close", (code, signal) => resolve([code, signal]));
  });
}

async function terminateChild(
  child: ChildProcess,
  closed: Promise<[number | null, NodeJS.Signals | null]>,
): Promise<[number | null, NodeJS.Signals | null]> {
  if (child.exitCode !== null || child.signalCode !== null) return closed;
  const boundedClose = async (): Promise<
    { status: [number | null, NodeJS.Signals | null] } | { timeout: true }
  > => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        closed.then((status) => ({ status })),
        new Promise<{ timeout: true }>((resolve) => {
          timer = setTimeout(() => resolve({ timeout: true }), 2_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  child.kill("SIGTERM");
  const term = await boundedClose();
  if ("status" in term) return term.status;
  child.kill("SIGKILL");
  const killed = await boundedClose();
  if ("status" in killed) return killed.status;
  throw new Error("recovery child cleanup timed out");
}

function streamEnded(stream: {
  once(event: "end", listener: () => void): unknown;
}): Promise<void> {
  return new Promise((resolve) => stream.once("end", resolve));
}

function streamDrained(stream: {
  once(event: "drain", listener: () => void): unknown;
}): Promise<void> {
  return new Promise((resolve) => stream.once("drain", resolve));
}

function destroyRecoveryStream(
  stream: NodeJS.ReadableStream | NodeJS.WritableStream,
): void {
  const destroy = (stream as { destroy?: () => void }).destroy;
  if (typeof destroy === "function") destroy.call(stream);
}

export function assertExpectedGpgTermination(
  status: [number | null, NodeJS.Signals | null],
): void {
  const [code, signal] = status;
  if (
    code !== 0 &&
    signal !== "SIGTERM" &&
    signal !== "SIGKILL" &&
    signal !== "SIGPIPE"
  )
    throw new Error("gpg archive termination was unexpected");
}

export async function settleRecoveryArchivePipeline(input: {
  producer: ChildProcess;
  producerClosed: Promise<[number | null, NodeJS.Signals | null]>;
  consumer: ChildProcess;
  consumerClosed: Promise<[number | null, NodeJS.Signals | null]>;
  consumerProgress: Promise<[number | null, NodeJS.Signals | null]>;
  failures: readonly Promise<never>[];
  consumerFailureMessage: string;
  producerEarlyFailureMessage: string;
  progressTimeoutMs?: number;
  progressTimeoutMessage?: string;
  stop: () => void;
  disconnect: () => void;
}): Promise<void> {
  const earlyProducerFailure = input.producerClosed.then((status) => {
    if (status[0] === 0 && status[1] === null)
      return new Promise<never>(() => undefined);
    throw new Error(input.producerEarlyFailureMessage);
  });
  void earlyProducerFailure.catch(() => undefined);
  let progressTimer: NodeJS.Timeout | undefined;
  const progressTimeout = input.progressTimeoutMs
    ? new Promise<never>((_resolve, reject) => {
        progressTimer = setTimeout(
          () =>
            reject(
              new Error(
                input.progressTimeoutMessage ??
                  "recovery archive consumer timed out",
              ),
            ),
          input.progressTimeoutMs,
        );
      })
    : undefined;
  try {
    const [consumerCode] = await Promise.race([
      input.consumerProgress,
      ...input.failures,
      earlyProducerFailure,
      ...(progressTimeout ? [progressTimeout] : []),
    ]);
    if (consumerCode !== 0) throw new Error(input.consumerFailureMessage);
    input.disconnect();
    const producerAlreadyClosed =
      input.producer.exitCode !== null || input.producer.signalCode !== null;
    const producerStatus = producerAlreadyClosed
      ? await input.producerClosed
      : await terminateChild(input.producer, input.producerClosed);
    if (producerAlreadyClosed) {
      if (producerStatus[0] !== 0 || producerStatus[1] !== null)
        throw new Error(input.producerEarlyFailureMessage);
    } else {
      assertExpectedGpgTermination(producerStatus);
    }
  } catch (error) {
    try {
      input.stop();
    } catch {
      // Bounded child termination below remains authoritative for cleanup.
    }
    await Promise.all([
      terminateChild(input.producer, input.producerClosed),
      terminateChild(input.consumer, input.consumerClosed),
    ]);
    throw error;
  } finally {
    if (progressTimer) clearTimeout(progressTimer);
  }
}

async function decryptRestoreSingleSession(input: {
  rolesSql: Buffer;
  rolesPlaintextSha256: string;
  databaseEncrypted: PrivateArtifactCopy;
  passphrase: string;
  env: NodeJS.ProcessEnv;
  sentinel: RehearsalClusterSentinel;
  psqlCommand: TrustedExecutable;
  pgRestoreCommand: TrustedExecutable;
  gpgCommand: TrustedExecutable;
  expectedDatabaseSha256: string;
}): Promise<{
  roles: string;
  adaptedRoles: string;
  database: string;
  extensions: ExtensionSqlPortabilityProof & { archiveTocSha256: string };
}> {
  const gpgHome = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-gpg-")),
  );
  fs.chmodSync(gpgHome, 0o700);
  const children = new Set<ChildProcess>();
  const track = <T extends ChildProcess>(child: T): T => {
    children.add(child);
    child.once("close", () => children.delete(child));
    return child;
  };
  const abortPipeline = async (): Promise<void> => {
    await Promise.all(
      [...children].map((child) =>
        terminateChild(
          child,
          childClose(child, "recovery child cleanup failed"),
        ),
      ),
    );
  };
  const psql = track(
    spawnTrusted(input.psqlCommand, ["--no-psqlrc", "--set=ON_ERROR_STOP=1"], {
      env: input.env,
      stdio: ["pipe", "ignore", "pipe"],
      shell: false,
    }),
  );
  const psqlClosed = childClose(psql, "single-session restore failed");
  const outerFailures: Promise<never>[] = [];
  const stopPsql = () => {
    psql.stdin.destroy();
    if (psql.exitCode === null && psql.signalCode === null)
      psql.kill("SIGTERM");
  };
  const psqlStderrErrors = observeRecoveryStreamErrors(
    psql.stderr,
    "single-session restore diagnostics failed",
    ["ECONNRESET"],
    stopPsql,
  );
  outerFailures.push(psqlStderrErrors.failure);
  psql.stderr.resume();
  const psqlInputFailed = new Promise<never>((_resolve, reject) => {
    psql.stdin.once("error", () => {
      reject(new Error("single-session restore input failed"));
    });
  });
  void psqlInputFailed.catch(() => undefined);
  const prematurePsqlExit = psqlClosed.then(([code, signal]) => {
    throw new Error(
      `single-session restore exited before commit: code=${String(code)} signal=${String(signal)}`,
    );
  });
  void prematurePsqlExit.catch(() => undefined);
  const guard = `BEGIN;
DO $ot_recovery_guard$
BEGIN
  IF (pg_control_system()).system_identifier::text <> ${sqlLiteral(input.sentinel.systemIdentifier)}
     OR encode(sha256(convert_to(current_setting('data_directory'),'UTF8')),'hex') <> ${sqlLiteral(input.sentinel.dataDirectorySha256)}
     OR current_database() <> ${sqlLiteral(input.sentinel.databaseName)}
     OR current_user <> ${sqlLiteral(input.sentinel.temporarySuperuser)}
     OR (select setting from pg_config where name='SHAREDIR') <> ${sqlLiteral(input.sentinel.managedExtensionFixture.privateSharedDirectory)}
     OR (select setting from pg_config where name='PKGLIBDIR') <> ${sqlLiteral(input.sentinel.managedExtensionFixture.privateLibraryDirectory)}
     OR coalesce((select shobj_description(oid,'pg_database') from pg_database where datname=current_database()),'') <> ${sqlLiteral(canonicalJson(input.sentinel))}
  THEN
    RAISE EXCEPTION 'recovery rehearsal sentinel mismatch';
  END IF;
END
$ot_recovery_guard$;
`;
  psql.stdin.write(guard);

  const decryptInto = async (
    consumer: NodeJS.WritableStream,
    endConsumer: boolean,
  ): Promise<string> => {
    const encrypted = privateCopyReadStream(input.databaseEncrypted);
    const gpg = track(
      spawnTrusted(
        input.gpgCommand,
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
            GNUPGHOME: gpgHome,
          },
          stdio: ["pipe", "pipe", "pipe", "pipe"],
        },
      ),
    );
    const gpgClosed = childClose(gpg, "gpg restore process failed");
    const stop = () => {
      encrypted.unpipe(gpg.stdin!);
      encrypted.destroy();
      gpg.stdout!.unpipe(consumer);
      gpg.stdin!.destroy();
      gpg.stdout!.destroy();
      destroyRecoveryStream(consumer);
      if (gpg.exitCode === null && gpg.signalCode === null) gpg.kill("SIGTERM");
    };
    const encryptedErrors = observeRecoveryStreamErrors(
      encrypted,
      "encrypted recovery archive read failed",
      [],
      stop,
    );
    const gpgInputErrors = observeRecoveryStreamErrors(
      gpg.stdin!,
      "gpg restore input failed",
      [],
      stop,
    );
    const gpgOutputErrors = observeRecoveryStreamErrors(
      gpg.stdout!,
      "gpg restore output failed",
      [],
      stop,
    );
    const passphraseErrors = observeRecoveryStreamErrors(
      gpg.stdio[3] as NodeJS.WritableStream,
      "gpg passphrase input failed",
      [],
      stop,
    );
    const gpgStderrErrors = observeRecoveryStreamErrors(
      gpg.stderr!,
      "gpg restore diagnostics failed",
      ["ECONNRESET"],
      stop,
    );
    const consumerErrors = observeRecoveryStreamErrors(
      consumer,
      "gpg restore destination failed",
      [],
      stop,
    );
    encrypted.pipe(gpg.stdin!);
    const digest = createHash("sha256");
    gpg.stdout!.on("data", (chunk: Buffer) => digest.update(chunk));
    gpg.stderr!.resume();
    gpg.stdout!.pipe(consumer, { end: endConsumer });
    (gpg.stdio[3] as NodeJS.WritableStream).end(`${input.passphrase}\n`);
    const [code] = await Promise.race([
      gpgClosed,
      prematurePsqlExit,
      psqlInputFailed,
      ...outerFailures,
      encryptedErrors.failure,
      gpgInputErrors.failure,
      gpgOutputErrors.failure,
      passphraseErrors.failure,
      gpgStderrErrors.failure,
      consumerErrors.failure,
    ]);
    if (code !== 0) throw new Error("gpg restore decrypt failed");
    return digest.digest("hex");
  };
  let recoveryFailure: unknown;
  try {
    const adaptedRoles = sha256(input.rolesSql);
    if (!psql.stdin.write(input.rolesSql))
      await Promise.race([
        streamDrained(psql.stdin),
        prematurePsqlExit,
        psqlInputFailed,
        ...outerFailures,
      ]);
    const integritySink = new PassThrough();
    integritySink.resume();
    const verifiedDatabaseHash = await decryptInto(integritySink, true);
    if (verifiedDatabaseHash !== input.expectedDatabaseSha256)
      throw new Error(
        "Recovery database plaintext checksum mismatch before restore",
      );

    let selectionSequence = 0;
    const runArchive = async (archiveInput: {
      args: string[];
      toc?: Buffer;
      output: NodeJS.WritableStream;
      endOutput: boolean;
    }): Promise<void> => {
      const selection = archiveInput.toc
        ? materializeRecoverySelectionFile(
            gpgHome,
            `selection-${selectionSequence++}.list`,
            archiveInput.toc,
          )
        : undefined;
      let selectionAnchor: RecoverySelectionAnchor | undefined;
      let primaryFailure: unknown;
      try {
        const encrypted = privateCopyReadStream(input.databaseEncrypted);
        const gpg = track(
          spawnTrusted(
            input.gpgCommand,
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
                GNUPGHOME: gpgHome,
              },
              stdio: ["pipe", "pipe", "ignore", "pipe"],
            },
          ),
        );
        if (selection) {
          selectionAnchor = openRecoverySelectionAnchor(selection);
          unlinkRecoverySelectionPath(selectionAnchor);
        }
        const restore = track(
          spawnTrusted(
            input.pgRestoreCommand,
            selection
              ? [
                  ...archiveInput.args,
                  `--use-list=${recoverySelectionChildPath()}`,
                ]
              : archiveInput.args,
            {
              env: input.env,
              stdio: selectionAnchor
                ? ["pipe", "pipe", "pipe", selectionAnchor.descriptor]
                : ["pipe", "pipe", "pipe"],
            },
          ),
        );
        const gpgClosed = childClose(gpg, "gpg archive process failed");
        const restoreClosed = childClose(
          restore,
          "pg_restore SQL emission failed",
        );
        const stop = () => {
          encrypted.unpipe(gpg.stdin!);
          encrypted.destroy();
          gpg.stdout!.unpipe(restore.stdin);
          restore.stdout.unpipe(archiveInput.output);
          gpg.stdin!.destroy();
          gpg.stdout!.destroy();
          restore.stdin.destroy();
          restore.stdout.destroy();
          destroyRecoveryStream(archiveInput.output);
          if (gpg.exitCode === null && gpg.signalCode === null)
            gpg.kill("SIGTERM");
          if (restore.exitCode === null && restore.signalCode === null)
            restore.kill("SIGTERM");
        };
        const encryptedErrors = observeRecoveryStreamErrors(
          encrypted,
          "encrypted recovery archive read failed",
          [],
          stop,
        );
        const gpgInputErrors = observeRecoveryStreamErrors(
          gpg.stdin!,
          "gpg archive input failed",
          ["EPIPE"],
          stop,
        );
        const gpgOutputErrors = observeRecoveryStreamErrors(
          gpg.stdout!,
          "gpg archive output failed",
          ["EPIPE", "ECONNRESET"],
          stop,
        );
        const passphraseErrors = observeRecoveryStreamErrors(
          gpg.stdio[3] as NodeJS.WritableStream,
          "gpg passphrase input failed",
          ["EPIPE"],
          stop,
        );
        const restoreOutputErrors = observeRecoveryStreamErrors(
          restore.stdout,
          "pg_restore output failed",
          [],
          stop,
        );
        const restoreStderrErrors = observeRecoveryStreamErrors(
          restore.stderr,
          "pg_restore diagnostics failed",
          ["ECONNRESET"],
          stop,
        );
        const outputErrors = observeRecoveryStreamErrors(
          archiveInput.output,
          "pg_restore destination failed",
          [],
          stop,
        );
        restore.stderr.resume();
        const restoreInputErrors = observeRecoveryStreamErrors(
          restore.stdin,
          "pg_restore input failed",
          ["EPIPE"],
          stop,
        );
        const outputEnded = archiveInput.endOutput
          ? streamEnded(archiveInput.output)
          : streamEnded(restore.stdout);
        encrypted.pipe(gpg.stdin!);
        restore.stdout.pipe(archiveInput.output, {
          end: archiveInput.endOutput,
        });
        gpg.stdout!.pipe(restore.stdin);
        (gpg.stdio[3] as NodeJS.WritableStream).end(`${input.passphrase}\n`);
        await settleRecoveryArchivePipeline({
          producer: gpg,
          producerClosed: gpgClosed,
          consumer: restore,
          consumerClosed: restoreClosed,
          consumerProgress: Promise.all([restoreClosed, outputEnded]).then(
            ([status]) => status,
          ),
          failures: [
            prematurePsqlExit,
            psqlInputFailed,
            ...outerFailures,
            encryptedErrors.failure,
            gpgInputErrors.failure,
            gpgOutputErrors.failure,
            passphraseErrors.failure,
            restoreOutputErrors.failure,
            restoreStderrErrors.failure,
            outputErrors.failure,
            restoreInputErrors.failure,
          ],
          consumerFailureMessage: "pg_restore SQL emission failed",
          producerEarlyFailureMessage:
            "gpg archive failed before pg_restore completed",
          progressTimeoutMs: 300_000,
          progressTimeoutMessage: "pg_restore SQL emission timed out",
          stop,
          disconnect: () => {
            encrypted.unpipe(gpg.stdin!);
            encrypted.destroy();
            gpg.stdout!.unpipe(restore.stdin);
          },
        });
        if (selectionAnchor) assertRecoverySelectionAnchor(selectionAnchor);
      } catch (error) {
        primaryFailure = error;
        throw error;
      } finally {
        let selectionCleanupFailed = false;
        if (selectionAnchor) {
          try {
            closeRecoverySelectionAnchor(selectionAnchor);
          } catch {
            selectionCleanupFailed = true;
          }
        }
        if (selectionCleanupFailed && primaryFailure === undefined)
          throw new Error("recovery selection cleanup failed");
      }
    };

    const readArchiveToc = async (): Promise<Buffer> => {
      const encrypted = privateCopyReadStream(input.databaseEncrypted);
      const gpg = track(
        spawnTrusted(
          input.gpgCommand,
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
              GNUPGHOME: gpgHome,
            },
            stdio: ["pipe", "pipe", "ignore", "pipe"],
          },
        ),
      );
      const restore = track(
        spawnTrusted(input.pgRestoreCommand, ["--list"], {
          env: input.env,
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
      const gpgClosed = childClose(gpg, "gpg archive process failed");
      const restoreClosed = childClose(
        restore,
        "pg_restore archive TOC failed",
      );
      const stop = () => {
        encrypted.unpipe(gpg.stdin!);
        encrypted.destroy();
        gpg.stdout!.unpipe(restore.stdin);
        gpg.stdin!.destroy();
        gpg.stdout!.destroy();
        restore.stdin.destroy();
        restore.stdout.destroy();
        if (gpg.exitCode === null && gpg.signalCode === null)
          gpg.kill("SIGTERM");
        if (restore.exitCode === null && restore.signalCode === null)
          restore.kill("SIGTERM");
      };
      const encryptedErrors = observeRecoveryStreamErrors(
        encrypted,
        "encrypted recovery archive read failed",
        [],
        stop,
      );
      const gpgInputErrors = observeRecoveryStreamErrors(
        gpg.stdin!,
        "gpg archive input failed",
        ["EPIPE"],
        stop,
      );
      const gpgOutputErrors = observeRecoveryStreamErrors(
        gpg.stdout!,
        "gpg archive output failed",
        ["EPIPE", "ECONNRESET"],
        stop,
      );
      const passphraseErrors = observeRecoveryStreamErrors(
        gpg.stdio[3] as NodeJS.WritableStream,
        "gpg passphrase input failed",
        ["EPIPE"],
        stop,
      );
      const chunks: Buffer[] = [];
      const restoreOutputErrors = observeRecoveryStreamErrors(
        restore.stdout,
        "pg_restore archive TOC output failed",
        [],
        stop,
      );
      const restoreStderrErrors = observeRecoveryStreamErrors(
        restore.stderr,
        "pg_restore archive TOC diagnostics failed",
        ["ECONNRESET"],
        stop,
      );
      const restoreInputErrors = observeRecoveryStreamErrors(
        restore.stdin,
        "pg_restore archive TOC input failed",
        ["EPIPE", "ECONNRESET"],
        stop,
      );
      const restoreOutputEnded = streamEnded(restore.stdout);
      restore.stdout.on("data", (chunk: Buffer) =>
        chunks.push(Buffer.from(chunk)),
      );
      restore.stderr.resume();
      encrypted.pipe(gpg.stdin!);
      gpg.stdout!.pipe(restore.stdin);
      (gpg.stdio[3] as NodeJS.WritableStream).end(`${input.passphrase}\n`);
      await settleRecoveryArchivePipeline({
        producer: gpg,
        producerClosed: gpgClosed,
        consumer: restore,
        consumerClosed: restoreClosed,
        consumerProgress: Promise.all([restoreClosed, restoreOutputEnded]).then(
          ([status]) => status,
        ),
        failures: [
          prematurePsqlExit,
          psqlInputFailed,
          ...outerFailures,
          encryptedErrors.failure,
          gpgInputErrors.failure,
          gpgOutputErrors.failure,
          passphraseErrors.failure,
          restoreOutputErrors.failure,
          restoreStderrErrors.failure,
          restoreInputErrors.failure,
        ],
        consumerFailureMessage: "pg_restore archive TOC failed",
        producerEarlyFailureMessage:
          "gpg archive failed before pg_restore completed",
        progressTimeoutMs: 30_000,
        progressTimeoutMessage: "pg_restore archive TOC timed out",
        stop,
        disconnect: () => {
          encrypted.unpipe(gpg.stdin!);
          encrypted.destroy();
          gpg.stdout!.unpipe(restore.stdin);
        },
      });
      const toc = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      return toc;
    };

    const tocBytes = await readArchiveToc();
    const archivePlan = planRecoveryArchiveToc(tocBytes);
    tocBytes.fill(0);
    await runArchive({
      args: ["--exit-on-error", "--file=-"],
      toc: archivePlan.schemas,
      output: psql.stdin,
      endOutput: false,
    });
    const extensionTransform = new RecoveryExtensionSqlTransform();
    extensionTransform.pipe(psql.stdin, { end: false });
    await runArchive({
      args: ["--exit-on-error", "--file=-"],
      toc: archivePlan.extensions,
      output: extensionTransform,
      endOutput: true,
    });
    await runArchive({
      args: ["--exit-on-error", "--file=-"],
      toc: archivePlan.remainder,
      output: psql.stdin,
      endOutput: false,
    });
    archivePlan.schemas.fill(0);
    archivePlan.extensions.fill(0);
    archivePlan.remainder.fill(0);
    psql.stdin.end("COMMIT;\n");
    const [psqlCode] = await Promise.race([
      psqlClosed,
      psqlInputFailed,
      ...outerFailures,
    ]);
    if (psqlCode !== 0) throw new Error("single-session restore failed");
    return {
      roles: input.rolesPlaintextSha256,
      adaptedRoles,
      database: verifiedDatabaseHash,
      extensions: {
        ...extensionTransform.proof(),
        archiveTocSha256: archivePlan.archiveTocSha256,
      },
    };
  } catch (error) {
    recoveryFailure = error;
    throw error;
  } finally {
    let cleanupFailed = false;
    try {
      await abortPipeline();
    } catch {
      cleanupFailed = true;
    }
    try {
      fs.rmSync(gpgHome, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed && recoveryFailure === undefined)
      throw new Error("recovery cleanup failed");
  }
}

async function decryptBuffer(
  copy: PrivateArtifactCopy,
  passphrase: string,
  gpgCommand: TrustedExecutable,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const gpgHome = fs.mkdtempSync(path.join(os.tmpdir(), "ot-recovery-gpg-"));
  fs.chmodSync(gpgHome, 0o700);
  let encrypted: ReturnType<typeof privateCopyReadStream> | undefined;
  let gpg: ChildProcess | undefined;
  let gpgClosed: Promise<[number | null, NodeJS.Signals | null]> | undefined;
  try {
    encrypted = privateCopyReadStream(copy);
    gpg = spawnTrusted(
      gpgCommand,
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
          GNUPGHOME: gpgHome,
        },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    gpgClosed = childClose(gpg, "gpg decrypt process failed");
    const stop = () => {
      encrypted!.unpipe(gpg!.stdin!);
      encrypted!.destroy();
      gpg!.stdin!.destroy();
      gpg!.stdout!.destroy();
      if (gpg!.exitCode === null && gpg!.signalCode === null)
        gpg!.kill("SIGTERM");
    };
    const encryptedErrors = observeRecoveryStreamErrors(
      encrypted,
      "encrypted recovery artifact read failed",
      [],
      stop,
    );
    const gpgInputErrors = observeRecoveryStreamErrors(
      gpg.stdin!,
      "gpg decrypt input failed",
      [],
      stop,
    );
    const gpgOutputErrors = observeRecoveryStreamErrors(
      gpg.stdout!,
      "gpg decrypt output failed",
      [],
      stop,
    );
    const passphraseErrors = observeRecoveryStreamErrors(
      gpg.stdio[3] as NodeJS.WritableStream,
      "gpg passphrase input failed",
      [],
      stop,
    );
    const gpgStderrErrors = observeRecoveryStreamErrors(
      gpg.stderr!,
      "gpg decrypt diagnostics failed",
      [],
      stop,
    );
    encrypted.pipe(gpg.stdin!);
    gpg.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
    gpg.stderr!.resume();
    (gpg.stdio[3] as NodeJS.WritableStream).end(`${passphrase}\n`);
    const [code] = await Promise.race([
      gpgClosed,
      encryptedErrors.failure,
      gpgInputErrors.failure,
      gpgOutputErrors.failure,
      passphraseErrors.failure,
      gpgStderrErrors.failure,
    ]);
    if (code !== 0) throw new Error("gpg decrypt failed");
    const plaintext = Buffer.concat(chunks);
    for (const chunk of chunks) chunk.fill(0);
    return plaintext;
  } finally {
    encrypted?.destroy();
    if (gpg && gpgClosed && gpg.exitCode === null && gpg.signalCode === null)
      await terminateChild(gpg, gpgClosed);
    for (const chunk of chunks) chunk.fill(0);
    fs.rmSync(gpgHome, { recursive: true, force: true });
  }
}

export async function rehearseNeutralProductionRecovery(
  input: {
    env?: NodeJS.ProcessEnv;
    writeStatus?: (message: string) => void;
    verifyInstalledFixture?: typeof assertManagedExtensionFixtureInstalled;
    resolveRuntimeExecutable?: (file: string) => TrustedExecutable;
  } = {},
): Promise<void> {
  const env = input.env ?? process.env;
  const verifyInstalledFixture =
    input.verifyInstalledFixture ?? assertManagedExtensionFixtureInstalled;
  const resolveRuntimeExecutable =
    input.resolveRuntimeExecutable ??
    ((file: string) =>
      resolveTrustedExecutable(file, { allowStickyAncestors: true }));
  const receiptPath = env.OT_NEUTRAL_PRODUCTION_RECOVERY_RECEIPT;
  const targetUrl = env.OT_NEUTRAL_RECOVERY_REHEARSAL_DATABASE_URL;
  const passphrase = env.OT_NEUTRAL_PRODUCTION_RECOVERY_PASSPHRASE;
  const authenticationKey = env.OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY;
  const sentinelPath = env.OT_NEUTRAL_RECOVERY_REHEARSAL_SENTINEL;
  const runtimeRoot = env[PRIVATE_RUNTIME_ROOT_VAR];
  const gpgPath = env[OT_PRODUCTION_RECOVERY_GPG_PATH_VAR];
  if (
    !receiptPath ||
    !targetUrl ||
    !passphrase ||
    !authenticationKey ||
    !sentinelPath ||
    !runtimeRoot ||
    !gpgPath
  )
    throw new Error(
      "Receipt, target, passphrase, authentication key and cluster sentinel are required",
    );
  const resolvedTarget = await resolveRecoveryTarget(targetUrl);
  const installedFixture = verifyInstalledFixture(runtimeRoot);
  const gpgCommand = resolveTrustedExecutable(gpgPath, {
    allowStickyAncestors: true,
  });
  const psqlCommand = resolveRuntimeExecutable(
    path.join(installedFixture.privateBinaryDirectory, "psql"),
  );
  const pgRestoreCommand = resolveRuntimeExecutable(
    path.join(installedFixture.privateBinaryDirectory, "pg_restore"),
  );
  const receiptBytes = readProtectedFile(receiptPath);
  const receipt = JSON.parse(
    receiptBytes.toString("utf8"),
  ) as ProductionRecoveryReceipt;
  assertRecoveryReceipt(receipt);
  assertReceiptAuthenticator(receipt, authenticationKey);
  const sentinel = JSON.parse(
    readProtectedFile(sentinelPath).toString("utf8"),
  ) as RehearsalClusterSentinel;
  if (sentinel.schema !== OT_PRODUCTION_REHEARSAL_SENTINEL_SCHEMA)
    throw new Error("Rehearsal cluster sentinel schema is invalid");
  assertReceiptAuthenticator(sentinel, authenticationKey);
  assertFreshRehearsalSentinelTimestamp(sentinel.createdAt);
  if (
    sentinel.managedExtensionFixture?.policy !==
      OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY ||
    canonicalJson(sentinel.managedExtensionFixture.filesSha256) !==
      canonicalJson(OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES) ||
    sentinel.managedExtensionFixture.privateSharedDirectory !==
      installedFixture.privateSharedDirectory ||
    sentinel.managedExtensionFixture.privateLibraryDirectory !==
      installedFixture.privateLibraryDirectory ||
    sentinel.managedExtensionFixture.postgresSha256 !==
      installedFixture.postgresSha256 ||
    sentinel.managedExtensionFixture.initdbSha256 !==
      installedFixture.initdbSha256 ||
    sentinel.managedExtensionFixture.privateBinaryTreeSha256 !==
      installedFixture.privateBinaryTreeSha256 ||
    sentinel.managedExtensionFixture.privateSharedTreeSha256 !==
      installedFixture.privateSharedTreeSha256 ||
    sentinel.managedExtensionFixture.privateLibraryTreeSha256 !==
      installedFixture.privateLibraryTreeSha256 ||
    sentinel.managedExtensionFixture.sourcePgConfigSha256 !==
      installedFixture.sourcePgConfigSha256 ||
    sentinel.managedExtensionFixture.sourceBinaryTreeSha256 !==
      installedFixture.sourceBinaryTreeSha256 ||
    sentinel.managedExtensionFixture.sourceSharedTreeSha256 !==
      installedFixture.sourceSharedTreeSha256 ||
    sentinel.managedExtensionFixture.sourceLibraryTreeSha256 !==
      installedFixture.sourceLibraryTreeSha256
  )
    throw new Error("Rehearsal managed extension fixture proof is invalid");

  const directory = path.dirname(path.resolve(receiptPath));
  const byFormat = Object.fromEntries(
    receipt.artifacts.map((artifact) => [artifact.format, artifact]),
  );
  const privateArtifacts = new Map<
    string,
    ReturnType<typeof materializePrivateCopy>
  >();
  let target: Client | undefined;
  let targetEnded = false;
  let pristineTargetManagedMembershipCount = -1;
  try {
    for (const artifact of receipt.artifacts) {
      const bytes = readProtectedFile(path.join(directory, artifact.file));
      if (
        bytes.byteLength !== artifact.ciphertextBytes ||
        sha256(bytes) !== artifact.ciphertextSha256
      )
        throw new Error(
          `Encrypted recovery artifact changed: ${artifact.file}`,
        );
      privateArtifacts.set(artifact.file, materializePrivateCopy(bytes));
    }
    const pgEnv = resolvedTarget.pgEnvironment;
    target = new Client(resolvedTarget.clientConfig);
    await target.connect();
    const identity = (
      await target.query(`select current_user username, current_setting('server_version_num')::int version,
      (pg_control_system()).system_identifier::text system_identifier, current_setting('data_directory') data_directory,
      (select setting from pg_config where name='SHAREDIR') shared_directory,
      (select setting from pg_config where name='PKGLIBDIR') library_directory,
      coalesce(shobj_description(oid,'pg_database'),'') database_comment from pg_database where datname=current_database()`)
    ).rows[0]!;
    const major = Math.floor(Number(identity.version) / 10_000);
    if (major !== 17 && major !== 18)
      throw new Error(`Restore target PostgreSQL ${major} is unsupported`);
    if (
      sentinel.targetServerMajor !== major ||
      installedFixture.major !== major ||
      String(identity.shared_directory) !==
        installedFixture.privateSharedDirectory ||
      String(identity.library_directory) !==
        installedFixture.privateLibraryDirectory ||
      sentinel.systemIdentifier !== String(identity.system_identifier) ||
      sentinel.dataDirectorySha256 !==
        sha256(String(identity.data_directory)) ||
      sentinel.databaseName !== resolvedTarget.database ||
      sentinel.temporarySuperuser !== String(identity.username) ||
      String(identity.database_comment) !== canonicalJson(sentinel)
    )
      throw new Error(
        "Rehearsal cluster sentinel does not match the live cluster",
      );
    const rolesBefore = (
      await target.query(
        "select rolname from pg_roles where rolname !~ '^pg_' order by 1",
      )
    ).rows.map((row) => String(row.rolname));
    const dbsBefore = (
      await target.query(
        "select datname from pg_database where not datistemplate order by 1",
      )
    ).rows.map((row) => String(row.datname));
    if (
      rolesBefore.length !== 1 ||
      rolesBefore[0] !== sentinel.temporarySuperuser
    )
      throw new Error(
        "Rehearsal cluster contains unexpected roles before globals restore",
      );
    if (
      dbsBefore.length !== 2 ||
      !dbsBefore.includes("postgres") ||
      !dbsBefore.includes(sentinel.databaseName)
    )
      throw new Error(
        "Rehearsal cluster contains unexpected databases before globals restore",
      );
    const emptiness = await target.query(
      "select count(*)::int objects from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'",
    );
    if (Number(emptiness.rows[0]!.objects) !== 0)
      throw new Error("Restore rehearsal target is not empty");
    const pristineTargetCatalog = (
      await target.query(OT_PRODUCTION_RECOVERY_CATALOG_SQL, [
        OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
        [sentinel.temporarySuperuser],
        [
          ...OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
          sentinel.temporarySuperuser,
        ],
      ])
    ).rows[0]!.snapshot;
    pristineTargetManagedMembershipCount = countNormalizedManagedMemberships(
      pristineTargetCatalog,
    );
    await target.end();
    targetEnded = true;

    // Deterministic adversarial integration hook only; never available in an
    // operator/Production process. It lets the suite replace a loopback
    // listener after the preliminary Node inspection and prove the psql guard
    // refuses that replacement before consuming restore SQL.
    const testHook = env.OT_TEST_RECOVERY_AFTER_NODE_VALIDATION_HOOK;
    if (env.NODE_ENV === "test" && testHook) {
      fs.writeFileSync(`${testHook}.ready`, "ready", {
        flag: "wx",
        mode: 0o600,
      });
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(`${testHook}.continue`)) {
        if (Date.now() > deadline)
          throw new Error("Recovery swap test hook timed out");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    const roles = byFormat["postgres-roles-sql"]!;
    const catalog = byFormat["catalog-json"]!;
    const rolesPlaintext = await decryptBuffer(
      privateArtifacts.get(roles.file)!,
      passphrase,
      gpgCommand,
    );
    if (sha256(rolesPlaintext) !== roles.plaintextSha256)
      throw new Error(
        `Decrypted recovery artifact checksum mismatch: ${roles.file}`,
      );
    const sourceCatalog = await decryptBuffer(
      privateArtifacts.get(catalog.file)!,
      passphrase,
      gpgCommand,
    );
    if (
      sha256(sourceCatalog) !== catalog.plaintextSha256 ||
      sha256(sourceCatalog) !== receipt.catalogDigest
    )
      throw new Error(
        `Decrypted recovery artifact checksum mismatch: ${catalog.file}`,
      );
    const sourceCatalogSnapshot = JSON.parse(
      sourceCatalog.toString("utf8"),
    ) as unknown;
    const sourceExtensionPortability = recoveryExtensionPortability(
      sourceCatalogSnapshot,
    );
    assertRecoveryExtensionPortability(
      receipt.extensionPortability,
      sourceCatalogSnapshot,
    );
    const normalizedSourceCount = countNormalizedManagedMemberships(
      sourceCatalogSnapshot,
    );
    const adaptedRoles = adaptManagedRoleMembershipGrantors(rolesPlaintext);
    assertManagedRoleMembershipPortabilityCounts({
      authenticatedSourceCount:
        receipt.roleMembershipPortability.managedMembershipCount,
      sourceCatalogCount: normalizedSourceCount,
      pristineTargetCount: pristineTargetManagedMembershipCount,
      adaptedStatementCount: adaptedRoles.managedMembershipCount,
    });

    const database = byFormat["postgres-custom"]!;
    verifyInstalledFixture(runtimeRoot);
    const restoredArtifactHashes = await decryptRestoreSingleSession({
      rolesSql: adaptedRoles.bytes,
      rolesPlaintextSha256: sha256(rolesPlaintext),
      databaseEncrypted: privateArtifacts.get(database.file)!,
      passphrase,
      env: pgEnv,
      sentinel,
      psqlCommand,
      pgRestoreCommand,
      gpgCommand,
      expectedDatabaseSha256: database.plaintextSha256,
    });
    const observed: Record<string, string> = {
      [roles.file]: restoredArtifactHashes.roles,
      [database.file]: restoredArtifactHashes.database,
    };
    observed[catalog.file] = sha256(sourceCatalog);
    for (const artifact of receipt.artifacts)
      if (observed[artifact.file] !== artifact.plaintextSha256)
        throw new Error(
          `Decrypted recovery artifact checksum mismatch: ${artifact.file}`,
        );

    const verifier = new Client(resolvedTarget.clientConfig);
    await verifier.connect();
    try {
      const restored = (
        await verifier.query(OT_PRODUCTION_RECOVERY_CATALOG_SQL, [
          OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
          [sentinel.temporarySuperuser],
          [
            ...OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
            sentinel.temporarySuperuser,
          ],
        ])
      ).rows[0]!.snapshot;
      const restoredDigest = sha256(canonicalJson(restored));
      const restoredExtensionPortability =
        recoveryExtensionPortability(restored);
      if (
        restoredDigest !== receipt.catalogDigest ||
        sha256(sourceCatalog) !== receipt.catalogDigest ||
        canonicalJson(restoredExtensionPortability) !==
          canonicalJson(sourceExtensionPortability)
      )
        throw new Error(
          `Restored catalog/role/ACL snapshot does not match the source receipt (sections=${
            [
              ...new Set([
                ...Object.keys(
                  sourceCatalogSnapshot as Record<string, unknown>,
                ),
                ...Object.keys(restored as Record<string, unknown>),
              ]),
            ]
              .filter(
                (key) =>
                  canonicalJson(
                    (sourceCatalogSnapshot as Record<string, unknown>)[key],
                  ) !==
                  canonicalJson((restored as Record<string, unknown>)[key]),
              )
              .sort()
              .join(",") || "unknown"
          })`,
        );
      const rehearsal: RestoreRehearsalReceipt = {
        schema: OT_PRODUCTION_RESTORE_SCHEMA,
        backupId: receipt.backupId,
        backupReceiptSha256: sha256(receiptBytes),
        targetServerMajor: major,
        restoredAt: new Date().toISOString(),
        artifactPlaintextSha256: observed,
        sourceCatalogDigest: receipt.catalogDigest,
        restoredCatalogDigest: restoredDigest,
        roleMembershipPortability: {
          policy: receipt.roleMembershipPortability.policy,
          authenticatedSourceCount:
            receipt.roleMembershipPortability.managedMembershipCount,
          pristineTargetCount: pristineTargetManagedMembershipCount,
          adaptedStatementCount: adaptedRoles.managedMembershipCount,
          adaptedRolesSha256: restoredArtifactHashes.adaptedRoles,
        },
        extensionPortability: {
          ...sourceExtensionPortability,
          ...restoredArtifactHashes.extensions,
        },
        verified: true,
        clusterSystemIdentifier: sentinel.systemIdentifier,
        clusterSentinelNonce: sentinel.nonce,
        authenticator: "",
      };
      rehearsal.authenticator = authenticateReceipt(
        rehearsal,
        authenticationKey,
      );
      const output = path.join(directory, `restore-rehearsal-pg${major}.json`);
      fs.writeFileSync(output, canonicalJson(rehearsal), {
        mode: 0o600,
        flag: "wx",
      });
      const descriptor = fs.openSync(output, "r");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      (input.writeStatus ?? ((message) => process.stdout.write(message)))(
        `neutral-report PRODUCTION recovery rehearsal: PASS backup_id=${receipt.backupId} target_pg=${major} catalog=verified artifacts=verified\n`,
      );
    } finally {
      await verifier.end();
    }
  } finally {
    if (target && !targetEnded) await target.end().catch(() => undefined);
    for (const artifact of privateArtifacts.values()) artifact.cleanup();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
)
  rehearseNeutralProductionRecovery().catch((error: unknown) => {
    process.stderr.write(
      `neutral-report PRODUCTION recovery rehearsal: FAIL\n${redactProductionDiagnostic(
        error,
        Object.values(process.env).filter((v): v is string => Boolean(v)),
      )}\n`,
    );
    process.exitCode = 1;
  });
