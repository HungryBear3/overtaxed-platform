import { once } from "node:events";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_TRANSCRIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
  OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256,
  OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256,
  OT_PRODUCTION_RECOVERY_AUTH_KEY_VAR,
  OT_PRODUCTION_RECOVERY_CANDIDATE_COMMIT_VAR,
  OT_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST_VAR,
  OT_PRODUCTION_RECOVERY_CATALOG_SQL,
  OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
  OT_PRODUCTION_RECOVERY_RECEIPT_VAR,
  OT_PRODUCTION_RECOVERY_RELEVANT_ROLES,
  assertReceiptAuthenticator,
  assertRecoveryReceipt,
  authenticateReceipt,
  canonicalJson,
  recoveryExtensionPortability,
  sha256,
  type NativeVaultPlatformReceipt,
  type NativeVaultTranscript,
  type ProductionRecoveryReceipt,
} from "../lib/fulfillment/neutral-production-recovery";
import {
  assertNativeVaultRecorderRuntime,
  PRIVATE_RUNTIME_ROOT_VAR,
  strictTreeSha256,
} from "./neutral-production-extension-fixture-files";
import { readProtectedFile } from "./neutral-production-recovery-gate";
import {
  assertProtectedAncestors,
  nonRootOperatorTrustedExecutablePolicy,
  resolveTrustedExecutable,
  spawnTrusted,
  type TrustedExecutable,
} from "./trusted-executable";
import { redactProductionDiagnostic } from "../lib/fulfillment/neutral-production-verifier";

export const OT_NATIVE_VAULT_SOURCE_REPOSITORY_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_SOURCE_REPOSITORY" as const;
export const OT_NATIVE_VAULT_GIT_PATH_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_GIT_PATH" as const;
export const OT_NATIVE_VAULT_TAR_PATH_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_TAR_PATH" as const;
export const OT_NATIVE_VAULT_MAKE_PATH_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_MAKE_PATH" as const;
export const OT_NATIVE_VAULT_CC_PATH_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_CC_PATH" as const;
export const OT_NATIVE_VAULT_PG_CONFIG_PATH_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_PG_CONFIG_PATH" as const;
export const OT_NATIVE_VAULT_DEPENDENCY_INCLUDE_DIRECTORY_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_DEPENDENCY_INCLUDE_DIRECTORY" as const;
export const OT_NATIVE_VAULT_SODIUM_STATIC_LIBRARY_PATH_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_SODIUM_STATIC_LIBRARY_PATH" as const;
export const OT_NATIVE_VAULT_EVIDENCE_DIRECTORY_VAR =
  "OT_NEUTRAL_NATIVE_VAULT_EVIDENCE_DIRECTORY" as const;

/**
 * The exact sequence the gate's transcript schema requires. The recorder has to
 * observe every one of these itself; a caller-supplied transcript is not
 * evidence of anything.
 */
export const OT_NATIVE_VAULT_REQUIRED_OPERATIONS = [
  "build",
  "install",
  "create_secret",
  "read_decrypted_secret",
  "update_secret",
  "read_updated_secret",
  "drop_secret",
] as const;

/**
 * The exact paths upstream ships at
 * {@link OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT}. The pinned SHA-256
 * constants are digests of these files, so a wrong path here cannot be
 * compensated for anywhere downstream: the recorder would simply never read the
 * bytes the release pins.
 */
export const OT_NATIVE_VAULT_PINNED_SOURCE_FILES = [
  { file: "sql/supabase_vault--0.3.0.sql", digest: "base" },
  { file: "sql/supabase_vault--0.3.0--0.3.1.sql", digest: "upgrade" },
] as const;

/**
 * Command-line `-c` overrides beat every configuration file, including the
 * supplied repository's own `.git/config`, which is the only configuration
 * source `GIT_CONFIG_NOSYSTEM`/`GIT_CONFIG_GLOBAL` cannot switch off. Anything
 * a repository could use to make Git execute a helper on its behalf is named
 * here explicitly; `core.fsmonitor` is the one that runs on a plain
 * `git status`.
 */
export const OT_NATIVE_VAULT_GIT_HARDENING = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.pager=cat",
  "-c",
  "core.editor=false",
  "-c",
  "core.askPass=",
  "-c",
  "core.sshCommand=false",
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "diff.external=",
  "-c",
  "protocol.file.allow=never",
  "-c",
  "protocol.ext.allow=never",
  "-c",
  "uploadpack.packObjectsHook=",
  "--no-pager",
  "--no-replace-objects",
  "--literal-pathspecs",
] as const;

function hardenedGitEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GIT_ALLOW_PROTOCOL: "",
    ...overrides,
  };
  for (const name of Object.keys(env))
    if (env[name] === undefined) delete env[name];
  return env;
}

function repositoryGitDirectory(repository: string): string {
  const gitDirectory = path.join(repository, ".git");
  const stat = fs.lstatSync(gitDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      "Native Vault source repository does not expose a plain object database",
    );
  return gitDirectory;
}

/**
 * A Git invocation that reads the supplied repository's object database through
 * a private, recorder-created Git directory. The repository contributes objects
 * and nothing else: no configuration, no index, no working tree, so the bytes
 * the build is produced from cannot pass through a repository-controlled
 * helper.
 */
export function nativeVaultObjectDatabaseGitCommand(input: {
  repository: string;
  scratchGitDirectory: string;
  baseEnv: NodeJS.ProcessEnv;
  args: readonly string[];
}): { args: string[]; env: NodeJS.ProcessEnv; cwd: string } {
  const objects = path.join(
    repositoryGitDirectory(input.repository),
    "objects",
  );
  const scratch = input.scratchGitDirectory;
  if (!fs.existsSync(scratch)) {
    fs.mkdirSync(path.join(scratch, "objects", "info"), {
      recursive: true,
      mode: 0o700,
    });
    fs.mkdirSync(path.join(scratch, "refs"), { mode: 0o700 });
    fs.writeFileSync(
      path.join(scratch, "HEAD"),
      `${OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(scratch, "config"),
      "[core]\n\trepositoryformatversion = 0\n\tbare = true\n",
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(scratch, "objects", "info", "alternates"),
      `${objects}\n`,
      { mode: 0o600 },
    );
  }
  return {
    args: [...OT_NATIVE_VAULT_GIT_HARDENING, ...input.args],
    env: hardenedGitEnvironment(input.baseEnv, {
      GIT_DIR: scratch,
      GIT_WORK_TREE: undefined,
    }),
    cwd: scratch,
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const UUID_TEXT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ROLE = /^[a-z_][a-z0-9_]*$/;
const SAFE_BUILD_PATH = /^\/[A-Za-z0-9._/-]+$/;
const SYNTHETIC_VALUE = /^[0-9a-f]{64}$/;
const PRIVATE_SUPERUSER = "ot_native_vault_recorder";
const PRIVATE_DATABASE = "postgres";
const PRIVATE_PORT = "5432";
const MAX_CAPTURED_BYTES = 8 * 1024 * 1024;

export type NativeVaultCommandRequest = {
  label: string;
  executable: TrustedExecutable;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: Buffer;
};

export type NativeVaultCommandResult = {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
};

export type NativeVaultCommandRunner = (
  request: NativeVaultCommandRequest,
) => Promise<NativeVaultCommandResult>;

export type NativeVaultPlatformRecording = {
  platform: "darwin" | "linux";
  receipt: { file: string; sha256: string };
  evidence: NativeVaultPlatformReceipt["evidence"];
};

export function nativeVaultPlatform(
  platform: NodeJS.Platform,
): "darwin" | "linux" {
  if (platform !== "darwin" && platform !== "linux")
    throw new Error("Native Vault recorder platform is unsupported");
  return platform;
}

const trustedChildProcessRunner: NativeVaultCommandRunner = async (request) => {
  const child = spawnTrusted(request.executable, request.args, {
    cwd: request.cwd,
    env: request.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const collect = (stream: NodeJS.ReadableStream): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_CAPTURED_BYTES) {
          child.kill("SIGKILL");
          reject(new Error("Native Vault command output is too large"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  child.stdin.on("error", () => {});
  child.stdin.end(request.stdin ?? Buffer.alloc(0));
  const [closed] = await Promise.all([
    once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>,
    stdout,
    stderr,
  ]);
  const [code, signal] = closed;
  return {
    status: signal !== null ? 128 : (code ?? 1),
    stdout: await stdout,
    stderr: await stderr,
  };
};

function assertOperatorOwnedDirectory(
  directory: string,
  label: string,
): string {
  const absolute = path.resolve(directory);
  if (absolute !== directory)
    throw new Error(`Native Vault ${label} must be an absolute path`);
  const resolved = fs.realpathSync(absolute);
  const stat = fs.lstatSync(resolved);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== uid ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error(
      `Native Vault ${label} ownership or permissions are unsafe`,
    );
  return resolved;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error("Native Vault recorder input is incomplete");
  return value;
}

function assertSafeBuildPath(value: string, label: string): string {
  if (path.resolve(value) !== value || !SAFE_BUILD_PATH.test(value))
    throw new Error(`Native Vault ${label} path is unsafe for the build`);
  return value;
}

function sqlTextArray(values: readonly string[]): string {
  for (const value of values)
    if (!SAFE_ROLE.test(value))
      throw new Error("Native Vault catalog role name is unsupported");
  return `'{${values.map((value) => `"${value}"`).join(",")}}'`;
}

function writeProtectedEvidence(
  directory: string,
  file: string,
  bytes: Buffer,
): { file: string; sha256: string } {
  if (path.basename(file) !== file)
    throw new Error("Native Vault evidence basename is unsafe");
  const descriptor = fs.openSync(path.join(directory, file), "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return { file, sha256: sha256(bytes) };
}

export async function recordNeutralProductionNativeVaultPlatform(
  input: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    writeStatus?: (message: string) => void;
    testOnlyCommandRunner?: NativeVaultCommandRunner;
  } = {},
): Promise<NativeVaultPlatformRecording> {
  const platform = nativeVaultPlatform(process.platform);
  const env = input.env ?? process.env;
  if (input.testOnlyCommandRunner && env.NODE_ENV !== "test")
    throw new Error(
      "Native Vault test-only command runner requires the unit-test runtime",
    );
  const now = input.now ?? new Date();
  const run = input.testOnlyCommandRunner ?? trustedChildProcessRunner;
  // Derived here, from the effective uid, and refused outright for uid 0. The
  // recorder installs into a private runtime the operator owns, which is the
  // only arrangement `initdb` will actually run under.
  const ownershipPolicy = nonRootOperatorTrustedExecutablePolicy();

  const authenticationKey = requiredEnv(
    env,
    OT_PRODUCTION_RECOVERY_AUTH_KEY_VAR,
  );
  const candidateCommit = requiredEnv(
    env,
    OT_PRODUCTION_RECOVERY_CANDIDATE_COMMIT_VAR,
  );
  const candidateManifestSha256 = requiredEnv(
    env,
    OT_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST_VAR,
  );
  if (!HEX40.test(candidateCommit) || !HEX64.test(candidateManifestSha256))
    throw new Error("Released candidate identity is invalid");

  const backupBytes = readProtectedFile(
    requiredEnv(env, OT_PRODUCTION_RECOVERY_RECEIPT_VAR),
  );
  const backup = JSON.parse(
    backupBytes.toString("utf8"),
  ) as ProductionRecoveryReceipt;
  assertRecoveryReceipt(backup);
  assertReceiptAuthenticator(backup, authenticationKey);
  const backupReceiptSha256 = sha256(backupBytes);
  const backupCreatedAt = Date.parse(backup.createdAt);
  if (!Number.isFinite(now.getTime()) || now.getTime() < backupCreatedAt)
    throw new Error("Native Vault verification time is out of bounds");

  const evidenceDirectory = assertOperatorOwnedDirectory(
    requiredEnv(env, OT_NATIVE_VAULT_EVIDENCE_DIRECTORY_VAR),
    "evidence directory",
  );
  const repository = assertOperatorOwnedDirectory(
    requiredEnv(env, OT_NATIVE_VAULT_SOURCE_REPOSITORY_VAR),
    "source repository",
  );
  const dependencyIncludeDirectory = assertSafeBuildPath(
    assertOperatorOwnedDirectory(
      requiredEnv(env, OT_NATIVE_VAULT_DEPENDENCY_INCLUDE_DIRECTORY_VAR),
      "dependency include directory",
    ),
    "dependency include directory",
  );
  const sodiumStaticLibraryPath = assertSafeBuildPath(
    requiredEnv(env, OT_NATIVE_VAULT_SODIUM_STATIC_LIBRARY_PATH_VAR),
    "sodium static library",
  );
  const sodiumLibraryDirectory = assertSafeBuildPath(
    assertOperatorOwnedDirectory(
      path.dirname(sodiumStaticLibraryPath),
      "sodium library directory",
    ),
    "sodium library directory",
  );
  if (
    sodiumStaticLibraryPath !==
      path.join(sodiumLibraryDirectory, "libsodium.a") ||
    fs.readdirSync(sodiumLibraryDirectory).join("\n") !== "libsodium.a"
  )
    throw new Error("Native Vault sodium library directory is ambiguous");
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const dependencyHeaderTreeSha256 = strictTreeSha256(
    dependencyIncludeDirectory,
    new Set([uid]),
  );
  const sodiumStaticLibraryBytes = readProtectedFile(sodiumStaticLibraryPath);
  if (sodiumStaticLibraryBytes.length === 0)
    throw new Error("Native Vault sodium static library is empty");
  const sodiumStaticLibrarySha256 = sha256(sodiumStaticLibraryBytes);
  sodiumStaticLibraryBytes.fill(0);

  const runtime = assertNativeVaultRecorderRuntime(
    fs.realpathSync(requiredEnv(env, PRIVATE_RUNTIME_ROOT_VAR)),
    process.cwd(),
  );
  const runtimeRoot = path.dirname(runtime.privateSharedDirectory);
  const privateLibrary = runtime.privateLibraryDirectory;

  const trusted = (name: string, allowStickyAncestors = false) =>
    resolveTrustedExecutable(name, { allowStickyAncestors, ownershipPolicy });
  const git = trusted(requiredEnv(env, OT_NATIVE_VAULT_GIT_PATH_VAR));
  const tar = trusted(requiredEnv(env, OT_NATIVE_VAULT_TAR_PATH_VAR));
  const make = trusted(requiredEnv(env, OT_NATIVE_VAULT_MAKE_PATH_VAR));
  const compiler = trusted(requiredEnv(env, OT_NATIVE_VAULT_CC_PATH_VAR));
  const pgConfig = trusted(
    requiredEnv(env, OT_NATIVE_VAULT_PG_CONFIG_PATH_VAR),
  );
  const initdb = trusted(
    path.join(runtime.privateBinaryDirectory, "initdb"),
    true,
  );
  const pgCtl = trusted(
    path.join(runtime.privateBinaryDirectory, "pg_ctl"),
    true,
  );
  const psql = trusted(path.join(runtime.privateBinaryDirectory, "psql"), true);

  const nativeVaultRootKey = randomBytes(32).toString("hex");
  if (!SYNTHETIC_VALUE.test(nativeVaultRootKey))
    throw new Error("Native Vault synthetic root key is invalid");
  const childEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    NODE_ENV: "production",
    LANG: "C",
    LC_ALL: "C",
    HOME: runtimeRoot,
    TMPDIR: runtimeRoot,
    ...(platform === "darwin"
      ? { SDKROOT: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk" }
      : {}),
    OT_NEUTRAL_NATIVE_VAULT_ROOT_KEY: nativeVaultRootKey,
  };

  const disposable = fs.mkdtempSync(
    path.join(os.tmpdir(), "ot-native-vault-src-"),
  );
  fs.chmodSync(disposable, 0o700);
  // `clusterMayBeRunning` is set before the start command is issued, not after
  // it returns, so a server that came up despite an ambiguous command outcome
  // is still tracked and still stopped.
  let clusterMayBeRunning = false;
  let shutdownUncertain = false;
  const dataDirectory = path.join(disposable, "data");
  const socketDirectory = path.join(disposable, "sock");
  const getkeyScript = assertSafeBuildPath(
    path.join(disposable, "pgsodium_getkey"),
    "getkey script",
  );
  const getkeyDescriptor = fs.openSync(getkeyScript, "wx", 0o500);
  try {
    fs.writeFileSync(
      getkeyDescriptor,
      "#!/bin/sh\nexec /usr/bin/printenv OT_NEUTRAL_NATIVE_VAULT_ROOT_KEY\n",
    );
    fs.fchmodSync(getkeyDescriptor, 0o500);
    fs.fsyncSync(getkeyDescriptor);
  } finally {
    fs.closeSync(getkeyDescriptor);
  }

  /**
   * A verified shutdown. A nonzero `pg_ctl stop`, or a runner that could not
   * report an outcome at all, is a failure: the recorder must not publish a
   * PASS receipt or transcript while a server may still own the runtime, and
   * the disposable tree is kept for diagnosis instead of being deleted
   * underneath it.
   */
  const stopCluster = async (): Promise<void> => {
    if (!clusterMayBeRunning) return;
    clusterMayBeRunning = false;
    let status = 1;
    try {
      status = (
        await run({
          label: "pg-ctl-stop",
          executable: pgCtl,
          args: ["-D", dataDirectory, "-m", "immediate", "-w", "stop"],
          cwd: disposable,
          env: childEnv,
        })
      ).status;
    } catch {
      status = 1;
    }
    if (status !== 0) {
      shutdownUncertain = true;
      throw new Error(
        "Native Vault disposable cluster shutdown could not be verified",
      );
    }
  };

  try {
    const execute = async (
      label: string,
      executable: TrustedExecutable,
      args: readonly string[],
      options: {
        stdin?: Buffer;
        allowFailure?: boolean;
        cwd?: string;
        env?: NodeJS.ProcessEnv;
      } = {},
    ): Promise<{ status: number; stdout: string }> => {
      const result = await run({
        label,
        executable,
        args,
        cwd: options.cwd ?? disposable,
        env: options.env ?? childEnv,
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      });
      if (!options.allowFailure && result.status !== 0)
        throw new Error(`Native Vault step did not succeed: ${label}`);
      return { status: result.status, stdout: result.stdout.toString("utf8") };
    };

    // ---- Protected Git source, verified before any byte is used ------------
    // The supplied working tree, index and repository configuration are never
    // consulted. The recorder reads a plain detached HEAD file, then reaches
    // the pinned object only through a private bare Git directory. Dirty or
    // attribute-filtered working-tree bytes therefore cannot execute a helper
    // or influence the archive.
    const gitDirectory = repositoryGitDirectory(repository);
    const headFile = path.join(gitDirectory, "HEAD");
    if (
      readProtectedFile(headFile).toString("utf8").trim() !==
      OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT
    )
      throw new Error(
        "Native Vault source repository HEAD is not detached and pinned",
      );

    const scratchGitDirectory = path.join(disposable, "objects");
    const runObjectGit = async (
      label: string,
      args: readonly string[],
    ): Promise<{ status: number; stdout: string }> => {
      const command = nativeVaultObjectDatabaseGitCommand({
        repository,
        scratchGitDirectory,
        baseEnv: childEnv,
        args,
      });
      return execute(label, git, command.args, {
        cwd: command.cwd,
        env: command.env,
      });
    };
    const tree = await runObjectGit("git-ls-tree", [
      "ls-tree",
      "-r",
      OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
    ]);
    if (/(^|\n)160000\s/.test(tree.stdout))
      throw new Error("Native Vault source repository contains a gitlink");

    // The archive is produced by the recorder from the pinned object, never
    // accepted from a caller, and everything downstream builds from a private
    // extraction rather than from the supplied working tree.
    const archivePath = path.join(disposable, "vault-source.tar");
    const archiveCommand = nativeVaultObjectDatabaseGitCommand({
      repository,
      scratchGitDirectory,
      baseEnv: childEnv,
      args: [
        "archive",
        "--format=tar",
        "--output",
        archivePath,
        OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
      ],
    });
    await execute("git-archive", git, archiveCommand.args, {
      cwd: archiveCommand.cwd,
      env: archiveCommand.env,
    });
    const sourceArchiveBytes = fs.readFileSync(archivePath);
    if (sourceArchiveBytes.length === 0)
      throw new Error("Native Vault source archive is empty");

    const extraction = path.join(disposable, "src");
    fs.mkdirSync(extraction, { mode: 0o700 });
    await execute("tar-extract", tar, [
      "--extract",
      "--file",
      archivePath,
      "--directory",
      extraction,
    ]);
    const pinnedDigests = {
      base: OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256 as string,
      upgrade: OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256 as string,
    };
    for (const pinned of OT_NATIVE_VAULT_PINNED_SOURCE_FILES) {
      const extracted = path.join(extraction, pinned.file);
      const stat = fs.lstatSync(extracted);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Native Vault pinned source file is unsafe");
      if (sha256(fs.readFileSync(extracted)) !== pinnedDigests[pinned.digest])
        throw new Error(
          "Native Vault pinned source file digest does not match",
        );
    }

    // ---- Toolchain identity, observed rather than declared -----------------
    const postgresVersion = (
      await execute("pg-config-version", pgConfig, ["--version"])
    ).stdout.trim();
    if (!/^PostgreSQL (17|18)\./.test(postgresVersion))
      throw new Error("Native Vault PostgreSQL toolchain is unsupported");
    const sourcePkglibdir = (
      await execute("pg-config-pkglibdir", pgConfig, ["--pkglibdir"])
    ).stdout.trim();
    if (!path.isAbsolute(sourcePkglibdir) || sourcePkglibdir === privateLibrary)
      throw new Error("Native Vault source library directory is unsafe");
    const pgxsPath = (
      await execute("pg-config-pgxs", pgConfig, ["--pgxs"])
    ).stdout.trim();
    const pgxsRoot = path.resolve(pgxsPath, "../../..");
    if (
      !path.isAbsolute(pgxsPath) ||
      fs.realpathSync(pgxsPath) !== pgxsPath ||
      path.relative(pgxsRoot, pgxsPath) !==
        path.join("src", "makefiles", "pgxs.mk")
    )
      throw new Error(
        "Native Vault PostgreSQL build toolchain has no PGXS makefile",
      );
    assertProtectedAncestors(pgxsRoot, true, ownershipPolicy);
    const pgxsTreeSha256 = strictTreeSha256(pgxsRoot, new Set([uid]));
    const compilerVersion = (
      await execute("cc-version", compiler, ["--version"])
    ).stdout
      .split("\n")[0]!
      .trim();
    if (!compilerVersion)
      throw new Error("Native Vault compiler identity is unavailable");

    // ---- build + install, only into the private disposable runtime --------
    const makeVariables = [
      `PG_CONFIG=${pgConfig.path}`,
      `PGXS=${pgxsPath}`,
      `CC=${compiler.path}`,
      `CPPFLAGS=-I${dependencyIncludeDirectory}`,
      `PG_LDFLAGS=-L${sodiumLibraryDirectory}`,
      "PG_CFLAGS=-std=c99 -Werror -Wno-declaration-after-statement -Wno-error=ignored-attributes",
      ...(platform === "darwin"
        ? ["BE_DLLLIBS=-undefined dynamic_lookup"]
        : []),
    ];
    await execute("make-build", make, [
      "-C",
      extraction,
      ...makeVariables,
      "all",
    ]);
    fs.mkdirSync(privateLibrary, { recursive: true, mode: 0o700 });
    if (
      fs
        .readdirSync(privateLibrary)
        .some((name) => /^supabase_vault(?:\.|$)/.test(name))
    )
      throw new Error(
        "Native Vault private library directory already contains the managed module",
      );
    const privateExtensionDirectory = path.join(
      runtime.privateSharedDirectory,
      "extension",
    );
    for (const name of Object.keys(
      OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
    ))
      fs.rmSync(path.join(privateExtensionDirectory, name), { force: true });
    await execute("make-install", make, [
      "-C",
      extraction,
      ...makeVariables,
      `pkglibdir=${privateLibrary}`,
      `datadir=${runtime.privateSharedDirectory}`,
      "install",
    ]);
    const builtModules = fs
      .readdirSync(privateLibrary)
      .filter((name) => name.startsWith("supabase_vault."));
    if (builtModules.length !== 1)
      throw new Error("Native Vault build did not install exactly one module");
    const nativeLibraryBytes = fs.readFileSync(
      path.join(privateLibrary, builtModules[0]!),
    );
    if (nativeLibraryBytes.length === 0)
      throw new Error("Native Vault native library is empty");
    const installedExtensionFiles = fs.readdirSync(privateExtensionDirectory);
    if (
      !installedExtensionFiles.includes("supabase_vault.control") ||
      !installedExtensionFiles.some((name) =>
        /^supabase_vault--.*\.sql$/.test(name),
      )
    )
      throw new Error("Native Vault install did not provide the extension");

    // ---- private disposable cluster ---------------------------------------
    fs.mkdirSync(socketDirectory, { mode: 0o700 });
    await execute("initdb", initdb, [
      "-D",
      dataDirectory,
      "--username",
      PRIVATE_SUPERUSER,
      "--auth-local=trust",
      "--auth-host=reject",
      "--no-sync",
      "--encoding=UTF8",
      "--locale=C",
    ]);
    fs.appendFileSync(
      path.join(dataDirectory, "postgresql.conf"),
      `listen_addresses = ''\nunix_socket_directories = '${socketDirectory}'\nport = ${PRIVATE_PORT}\nfsync = off\nshared_preload_libraries = 'supabase_vault'\nvault.getkey_script = '${getkeyScript}'\n`,
      { mode: 0o600 },
    );
    clusterMayBeRunning = true;
    await execute("pg-ctl-start", pgCtl, [
      "-D",
      dataDirectory,
      "-l",
      path.join(disposable, "cluster.log"),
      "-w",
      "start",
    ]);

    const query = async (label: string, sql: string): Promise<string> =>
      (
        await execute(
          label,
          psql,
          [
            "--no-psqlrc",
            "--set=ON_ERROR_STOP=1",
            "--quiet",
            "--no-align",
            "--tuples-only",
            "--host",
            socketDirectory,
            "--port",
            PRIVATE_PORT,
            "--username",
            PRIVATE_SUPERUSER,
            "--dbname",
            PRIVATE_DATABASE,
            "--file",
            "-",
          ],
          { stdin: Buffer.from(sql, "utf8") },
        )
      ).stdout;

    const identity = (
      await query(
        "psql-identity",
        `select current_setting('server_version_num'),
       (select setting from pg_config where name='PKGLIBDIR'),
       (select setting from pg_config where name='SHAREDIR'),
       v.name, v.version, v.schema,
       (select rolsuper from pg_roles where rolname=current_user)
from pg_available_extension_versions v
where v.name='supabase_vault' and v.version='0.3.1';\n`,
      )
    )
      .trim()
      .split("|");
    const major = Math.floor(Number(identity[0]) / 10_000);
    if (
      identity.length !== 7 ||
      (major !== 17 && major !== 18) ||
      identity[1] !== privateLibrary ||
      identity[2] !== runtime.privateSharedDirectory ||
      identity[3] !== "supabase_vault" ||
      identity[4] !== "0.3.1" ||
      identity[5] !== "vault" ||
      identity[6] !== "t"
    )
      throw new Error(
        "Native Vault cluster is not the private runtime or does not offer the built extension",
      );

    await query(
      "psql-create-extension",
      `create role ${OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS[0]} superuser;
set role ${OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS[0]};
create schema extensions;
create extension pg_stat_statements version '1.11' schema extensions;
create extension pgcrypto version '1.3' schema extensions;
create extension "uuid-ossp" version '1.1' schema extensions;
create extension supabase_vault version '0.3.1';
reset role;\n`,
    );

    // ---- functional secret lifecycle, observed end to end ------------------
    const createdValue = randomBytes(32).toString("hex");
    const updatedValue = randomBytes(32).toString("hex");
    const secretName = randomBytes(16).toString("hex");
    for (const value of [createdValue, updatedValue])
      if (!SYNTHETIC_VALUE.test(value))
        throw new Error("Native Vault synthetic value is invalid");
    const secretId = (
      await query(
        "psql-create-secret",
        `select vault.create_secret('${createdValue}','${secretName}','ot-native-vault-recorder');\n`,
      )
    ).trim();
    if (!UUID_TEXT.test(secretId))
      throw new Error("Native Vault create_secret did not return a secret id");
    const decrypted = (
      await query(
        "psql-read-decrypted-secret",
        `select decrypted_secret from vault.decrypted_secrets where id='${secretId}';\n`,
      )
    ).trim();
    if (decrypted !== createdValue)
      throw new Error(
        "Native Vault decrypted secret does not match the expected synthetic value",
      );
    await query(
      "psql-update-secret",
      `select vault.update_secret('${secretId}','${updatedValue}');\n`,
    );
    const updatedDecrypted = (
      await query(
        "psql-read-updated-secret",
        `select decrypted_secret from vault.decrypted_secrets where id='${secretId}';\n`,
      )
    ).trim();
    if (updatedDecrypted !== updatedValue)
      throw new Error(
        "Native Vault updated secret does not match the expected synthetic value",
      );
    const remaining = (
      await query(
        "psql-drop-secret",
        `delete from vault.secrets where id='${secretId}';
select (select count(*) from vault.secrets)::text || '|' ||
       (select count(*) from vault.decrypted_secrets)::text;\n`,
      )
    )
      .trim()
      .split("|");
    if (remaining.length !== 2 || remaining[0] !== "0" || remaining[1] !== "0")
      throw new Error("Native Vault secret deletion was not observed");

    const roundTrip = {
      operations: [...OT_NATIVE_VAULT_REQUIRED_OPERATIONS],
      platform,
      secretIdSha256: sha256(secretId),
      createdValueSha256: sha256(createdValue),
      decryptedValueSha256: sha256(decrypted),
      updatedValueSha256: sha256(updatedValue),
      updatedDecryptedValueSha256: sha256(updatedDecrypted),
      remainingSecretRows: 0,
      remainingDecryptedRows: 0,
    };
    if (
      roundTrip.createdValueSha256 !== roundTrip.decryptedValueSha256 ||
      roundTrip.updatedValueSha256 !== roundTrip.updatedDecryptedValueSha256
    )
      throw new Error("Native Vault secret round trip is inconsistent");
    const functionalSecretRoundTripSha256 = sha256(canonicalJson(roundTrip));

    // ---- native source catalog, measured with the candidate's own SQL ------
    const snapshot = JSON.parse(
      (
        await query(
          "psql-catalog",
          `prepare ot_native_vault_catalog(text[],text[],text[]) as ${OT_PRODUCTION_RECOVERY_CATALOG_SQL};
execute ot_native_vault_catalog(${sqlTextArray(OT_PRODUCTION_RECOVERY_RELEVANT_ROLES)},${sqlTextArray(OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS)},${sqlTextArray(OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS)});\n`,
        )
      ).trim(),
    ) as unknown;
    recoveryExtensionPortability(snapshot);
    const nativeSourceCatalogSha256 = sha256(canonicalJson(snapshot));

    // ---- verified shutdown, before a single byte of PASS evidence ---------
    await stopCluster();

    // ---- dependency identity re-measured after compilation ----------------
    // The header tree and static libsodium were measured before the build. A
    // swap in between would otherwise be described by a receipt that no longer
    // matches what was linked, so both are re-measured here and any drift
    // refuses publication.
    if (
      strictTreeSha256(dependencyIncludeDirectory, new Set([uid])) !==
      dependencyHeaderTreeSha256
    )
      throw new Error(
        "Native Vault dependency header tree changed during compilation",
      );
    if (strictTreeSha256(pgxsRoot, new Set([uid])) !== pgxsTreeSha256)
      throw new Error("Native Vault PGXS tree changed during compilation");
    const republishedSodiumBytes = readProtectedFile(sodiumStaticLibraryPath);
    const republishedSodiumSha256 = sha256(republishedSodiumBytes);
    republishedSodiumBytes.fill(0);
    if (republishedSodiumSha256 !== sodiumStaticLibrarySha256)
      throw new Error(
        "Native Vault static libsodium changed during compilation",
      );

    // ---- protected, platform-qualified evidence ---------------------------
    const sourceArchive = writeProtectedEvidence(
      evidenceDirectory,
      `vault-source-${platform}.tar`,
      sourceArchiveBytes,
    );
    const nativeLibrary = writeProtectedEvidence(
      evidenceDirectory,
      `supabase_vault-${platform}.bin`,
      nativeLibraryBytes,
    );
    const transcript: NativeVaultTranscript = {
      schema: OT_PRODUCTION_NATIVE_VAULT_TRANSCRIPT_SCHEMA,
      platform,
      backupId: backup.backupId,
      backupReceiptSha256,
      candidateCommit,
      candidateManifestSha256,
      upstreamCommit: OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
      sourceArchiveSha256: sourceArchive.sha256,
      nativeLibrarySha256: nativeLibrary.sha256,
      nativeSourceCatalogSha256,
      functionalSecretRoundTripSha256,
      operations: [...OT_NATIVE_VAULT_REQUIRED_OPERATIONS],
      result: "PASS",
    };
    const transcriptReference = writeProtectedEvidence(
      evidenceDirectory,
      `native-vault-transcript-${platform}.json`,
      Buffer.from(canonicalJson(transcript)),
    );
    const receipt: NativeVaultPlatformReceipt = {
      schema: OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA,
      platform,
      backupId: backup.backupId,
      backupReceiptSha256,
      candidateCommit,
      candidateManifestSha256,
      upstreamCommit: OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
      baseSqlSha256:
        pinnedDigests.base as typeof OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256,
      upgradeSqlSha256:
        pinnedDigests.upgrade as typeof OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256,
      toolchain: {
        postgresVersion,
        pgConfigSha256: pgConfig.sha256,
        compilerVersion,
        compilerSha256: compiler.sha256,
        pgxsTreeSha256,
        dependencyHeaderTreeSha256,
        sodiumStaticLibrarySha256,
      },
      evidence: {
        sourceArchive,
        nativeLibrary,
        transcript: transcriptReference,
      },
      nativeSourceCatalogSha256,
      functionalSecretRoundTripSha256,
      verifiedAt: new Date(now.getTime()).toISOString(),
      authenticator: "",
    };
    const basenames = new Set([
      sourceArchive.file,
      nativeLibrary.file,
      transcriptReference.file,
    ]);
    if (
      basenames.size !== 3 ||
      [...basenames].some((file) => !file.toLowerCase().includes(platform))
    )
      throw new Error(
        "Native Vault evidence basenames are not platform-unique",
      );
    receipt.authenticator = authenticateReceipt(receipt, authenticationKey);
    const receiptReference = writeProtectedEvidence(
      evidenceDirectory,
      `native-vault-platform-${platform}.json`,
      Buffer.from(canonicalJson(receipt)),
    );

    (input.writeStatus ?? ((message) => process.stdout.write(message)))(
      `neutral-report native Vault platform record: PASS platform=${platform} pg=${major} operations=${OT_NATIVE_VAULT_REQUIRED_OPERATIONS.length}\n`,
    );
    return {
      platform,
      receipt: receiptReference,
      evidence: receipt.evidence,
    };
  } finally {
    await stopCluster().catch(() => undefined);
    delete childEnv.OT_NEUTRAL_NATIVE_VAULT_ROOT_KEY;
    if (shutdownUncertain)
      (input.writeStatus ?? ((message) => process.stdout.write(message)))(
        `neutral-report native Vault platform record: RETAINED shutdown=unverified runtime=${disposable}\n`,
      );
    else fs.rmSync(disposable, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(
      process.cwd(),
      "scripts/record-neutral-production-native-vault-platform.ts",
    )
)
  recordNeutralProductionNativeVaultPlatform().catch((error: unknown) => {
    process.stderr.write(
      `neutral-report native Vault platform record: FAIL\n${redactProductionDiagnostic(
        error,
        Object.values(process.env).filter((value): value is string =>
          Boolean(value),
        ),
      )}\n`,
    );
    process.exitCode = 1;
  });
