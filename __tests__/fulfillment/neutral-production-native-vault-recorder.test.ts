/** @jest-environment node */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OT_PRODUCTION_RECOVERY_SCHEMA,
  OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS,
  OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
  OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
  OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS,
  OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_MEMBERS,
  OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_TRANSCRIPT_SCHEMA,
  OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
  OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256,
  OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256,
  OT_PRODUCTION_NATIVE_VAULT_APPROVED_PLATFORM_RECEIPT_SHA256,
  assertReceiptAuthenticator,
  authenticateReceipt,
  canonicalJson,
  recoveryExtensionPortability,
  sha256,
  type NativeVaultPlatformReceipt,
  type NativeVaultTranscript,
  type ProductionRecoveryReceipt,
} from "@/lib/fulfillment/neutral-production-recovery";
import {
  assertNativeVaultRecorderRuntime,
  prepareManagedExtensionRuntime,
} from "@/scripts/neutral-production-extension-fixture-files";
import { unitTestTrustedExecutablePolicy } from "@/scripts/trusted-executable";
import {
  nativeVaultPlatform,
  nativeVaultObjectDatabaseGitCommand,
  type NativeVaultCommandRequest,
  type NativeVaultCommandResult,
} from "@/scripts/record-neutral-production-native-vault-platform";

const AUTH = "unit-authentication-key-at-least-thirty-two-bytes";
const CANDIDATE_COMMIT = "b".repeat(40);
const CANDIDATE_MANIFEST = sha256("unit-native-vault-candidate-manifest");
const POLICY = unitTestTrustedExecutablePolicy(process.getuid!());
const NOW = new Date("2026-09-17T18:20:00.000Z");
/**
 * Every filename and platform expectation is derived from the runtime the suite
 * is actually executing on, so the recorder suite proves the same rules on
 * Linux CI as on a Darwin workstation. The darwin/linux mapping itself keeps
 * explicit unit coverage below.
 */
const PLATFORM = nativeVaultPlatform(process.platform);
const BASE_SQL = "-- unit upstream vault 0.3.0 base\n";
const UPGRADE_SQL = "-- unit upstream vault 0.3.0--0.3.1 upgrade\n";
const RECORDER_MODULE =
  "@/scripts/record-neutral-production-native-vault-platform";

const CATALOG_SNAPSHOT = {
  public_schema_owner: "pg_database_owner",
  public_schema_acl: "",
  roles: [],
  memberships: [],
  default_acls: [],
  relations: [],
  column_acls: [],
  policies: [],
  functions: [],
  triggers: [],
  constraints: [],
  types: [],
  extensions: OT_PRODUCTION_RECOVERY_SUPPORTED_EXTENSIONS.map(
    ({ portability: _ignored, ...extension }) => ({
      ...extension,
      owner_role:
        extension.extname === "supabase_vault"
          ? OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR
          : "postgres",
    }),
  ),
  managed_extension_members:
    OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_MEMBERS.map((row) => ({
      extname: "supabase_vault",
      ...row,
    })),
  managed_extension_schema: [
    { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
  ],
  managed_extension_relations: [
    { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
  ],
  managed_extension_columns: [],
  managed_extension_functions: [
    "crypto-decrypt",
    "crypto-encrypt",
    "crypto-noncegen",
    "create-secret",
    "update-secret",
  ].map((profile) => ({
    owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
    implementation_profile: `supabase-vault-v0.3.1:${profile}`,
  })),
  managed_extension_types: [
    { owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR },
  ],
  managed_extension_indexes: [],
  managed_extension_constraints: [],
  managed_extension_config: [],
  managed_extension_acls: [],
};

type Fixture = {
  root: string;
  evidence: string;
  repository: string;
  runtimeRoot: string;
  privateLibrary: string;
  privateShare: string;
  sodiumInclude: string;
  sodiumStaticLibrary: string;
  pgxsPath: string;
  receiptPath: string;
  backup: ProductionRecoveryReceipt;
  backupReceiptSha256: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
};

function writeExecutable(file: string): string {
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o500 });
  return file;
}

function fixture(): Fixture {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".ot-native-vault-"));
  fs.chmodSync(root, 0o700);
  const runtimeRoot = fs.realpathSync(
    (() => {
      const created = fs.mkdtempSync(path.join("/tmp", "otnv."));
      fs.chmodSync(created, 0o700);
      return created;
    })(),
  );
  const cleanup = () => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  };
  try {
    const evidence = path.join(root, "evidence");
    const repository = path.join(root, "vault-source");
    const tools = path.join(root, "tools");
    const sourceShare = path.join(root, "source-share");
    const sourceLibrary = path.join(root, "source-lib");
    const sourceBin = path.join(root, "source-bin");
    const sodiumInclude = path.join(root, "sodium", "include");
    const sodiumStaticLibrary = path.join(root, "sodium", "lib", "libsodium.a");
    for (const directory of [
      evidence,
      repository,
      path.join(repository, ".git", "objects", "info"),
      path.join(repository, ".git", "refs"),
      tools,
      path.join(sourceShare, "extension"),
      sourceLibrary,
      sourceBin,
      sodiumInclude,
      path.dirname(sodiumStaticLibrary),
    ])
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    // A synthetic PostgreSQL installation the private-runtime stager can
    // relocate: `postgres` and `initdb` carry a patchable compiled SHAREDIR.
    const compiledPostgres = Buffer.concat([
      Buffer.from("synthetic-postgresql-binary"),
      Buffer.from([0]),
      Buffer.from(sourceShare),
      Buffer.from([0]),
      Buffer.from(sourceLibrary),
      Buffer.from([0]),
      Buffer.from("tail"),
    ]);
    const compiledInitdb = Buffer.concat([
      Buffer.from("synthetic-postgresql-initdb"),
      Buffer.from([0]),
      Buffer.from(sourceShare),
      Buffer.from([0]),
      Buffer.from("tail"),
    ]);
    fs.writeFileSync(path.join(sourceBin, "postgres"), compiledPostgres, {
      mode: 0o500,
    });
    fs.writeFileSync(path.join(sourceBin, "initdb"), compiledInitdb, {
      mode: 0o500,
    });
    for (const name of ["pg_ctl", "psql"])
      writeExecutable(path.join(sourceBin, name));
    fs.writeFileSync(
      path.join(sourceLibrary, "dict_snowball.so"),
      "unit-standard-module",
      { mode: 0o500 },
    );
    const pgConfig = path.join(sourceBin, "pg_config");
    fs.writeFileSync(
      pgConfig,
      `#!/bin/sh\ncase "$1" in\n  --version) printf '%s\\n' 'PostgreSQL 17.6';;\n  --sharedir) printf '%s\\n' '${sourceShare}';;\n  --pkglibdir) printf '%s\\n' '${sourceLibrary}';;\n  *) exit 1;;\nesac\n`,
      { mode: 0o700 },
    );
    fs.writeFileSync(
      path.join(repository, ".git", "HEAD"),
      `${OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(repository, ".git", "config"),
      "[core]\n\trepositoryformatversion = 0\n",
      { mode: 0o600 },
    );
    for (const name of ["git", "tar", "make", "cc"])
      writeExecutable(path.join(tools, name));
    const pgxsPath = path.join(root, "pgxs", "src", "makefiles", "pgxs.mk");
    fs.mkdirSync(path.dirname(pgxsPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(pgxsPath, "# unit protected PGXS\n", { mode: 0o600 });
    fs.writeFileSync(
      path.join(sodiumInclude, "sodium.h"),
      "unit-sodium-header",
      {
        mode: 0o600,
      },
    );
    fs.writeFileSync(sodiumStaticLibrary, "unit-sodium-static-library", {
      mode: 0o600,
    });

    prepareManagedExtensionRuntime({
      runtimeRoot,
      sourcePgConfig: pgConfig,
      testOnlyOwnershipPolicy: POLICY,
    });

    const catalogBytes = Buffer.from(canonicalJson(CATALOG_SNAPSHOT));
    const backup: ProductionRecoveryReceipt = {
      schema: OT_PRODUCTION_RECOVERY_SCHEMA,
      backupId: "0f3a4c1e-5d62-4f88-9b0a-7c1d2e3f4a5b",
      createdAt: "2026-09-17T18:00:00.000Z",
      backupStartedAt: "2026-09-17T17:59:00.000Z",
      backupCompletedAt: "2026-09-17T18:00:00.000Z",
      projectRef: "kdvjiijzgflumgkndxsl",
      markerInstanceId: "6a5c0f2e-3b1d-4e7a-9c88-2f4b6d0a1e33",
      sourceServerMajor: 17,
      encryption: {
        implementation: "gpg-symmetric-aes256",
        plaintextAtRest: false,
      },
      artifacts: [
        ["database.dump.gpg", "postgres-custom"],
        ["roles.sql.gpg", "postgres-roles-sql"],
        ["catalog.json.gpg", "catalog-json"],
      ].map(([file, format]) => ({
        file: file as string,
        format: format as never,
        plaintextSha256: sha256(`plain-${file}`),
        ciphertextSha256: sha256(`cipher-${file}`),
        ciphertextBytes: 1024,
      })),
      catalogDigest: sha256(catalogBytes),
      roleMembershipPortability: {
        policy: OT_PRODUCTION_RECOVERY_ROLE_PORTABILITY_POLICY,
        sourceGrantors: [OT_PRODUCTION_RECOVERY_MANAGED_GRANTORS[0]],
        normalizedGrantor: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
        managedMembershipCount: 0,
      },
      extensionPortability: recoveryExtensionPortability(CATALOG_SNAPSHOT),
      authenticator: "",
    };
    backup.authenticator = authenticateReceipt(backup, AUTH);
    const receiptPath = path.join(evidence, "backup-receipt.json");
    fs.writeFileSync(receiptPath, canonicalJson(backup), { mode: 0o600 });

    return {
      root,
      evidence,
      repository,
      runtimeRoot,
      privateLibrary: path.join(runtimeRoot, "l"),
      privateShare: path.join(runtimeRoot, "s"),
      sodiumInclude,
      sodiumStaticLibrary,
      pgxsPath,
      receiptPath,
      backup,
      backupReceiptSha256: sha256(fs.readFileSync(receiptPath)),
      env: {
        NODE_ENV: "test",
        OT_NEUTRAL_PRODUCTION_RECOVERY_AUTH_KEY: AUTH,
        OT_NEUTRAL_PRODUCTION_RECOVERY_RECEIPT: receiptPath,
        OT_NEUTRAL_PRODUCTION_RECOVERY_CANDIDATE_COMMIT: CANDIDATE_COMMIT,
        OT_NEUTRAL_PRODUCTION_RECOVERY_CANDIDATE_MANIFEST: CANDIDATE_MANIFEST,
        OT_NEUTRAL_NATIVE_VAULT_SOURCE_REPOSITORY: repository,
        OT_NEUTRAL_NATIVE_VAULT_GIT_PATH: path.join(tools, "git"),
        OT_NEUTRAL_NATIVE_VAULT_TAR_PATH: path.join(tools, "tar"),
        OT_NEUTRAL_NATIVE_VAULT_MAKE_PATH: path.join(tools, "make"),
        OT_NEUTRAL_NATIVE_VAULT_CC_PATH: path.join(tools, "cc"),
        OT_NEUTRAL_NATIVE_VAULT_PG_CONFIG_PATH: pgConfig,
        OT_NEUTRAL_NATIVE_VAULT_DEPENDENCY_INCLUDE_DIRECTORY: sodiumInclude,
        OT_NEUTRAL_NATIVE_VAULT_SODIUM_STATIC_LIBRARY_PATH: sodiumStaticLibrary,
        OT_NEUTRAL_RECOVERY_REHEARSAL_RUNTIME_ROOT: runtimeRoot,
        OT_NEUTRAL_NATIVE_VAULT_EVIDENCE_DIRECTORY: evidence,
      },
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

type RunnerOverrides = Record<
  string,
  (request: NativeVaultCommandRequest) => NativeVaultCommandResult
>;

function ok(stdout = ""): NativeVaultCommandResult {
  return {
    status: 0,
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
  };
}

/**
 * A narrow in-process double for the trusted child-process boundary. It never
 * fabricates receipt fields: every value the recorder is allowed to keep has to
 * be observed here as command output or as a file this double actually writes.
 */
function runner(value: Fixture, overrides: RunnerOverrides = {}) {
  const calls: Array<{
    label: string;
    executable: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    cwd: string;
  }> = [];
  let createdValue = "";
  let updatedValue = "";
  const argumentAfter = (args: readonly string[], flag: string): string => {
    const index = args.indexOf(flag);
    if (index < 0 || !args[index + 1])
      throw new Error(`missing ${flag} argument`);
    return args[index + 1]!;
  };
  const defaults: RunnerOverrides = {
    "git-ls-tree": () => ok("100644 blob abc\tMakefile\n"),
    "git-archive": (request) => {
      // The private Git directory the recorder archives through must link to
      // the supplied repository by object database alone.
      expect(request.env.GIT_DIR).toBeDefined();
      expect(
        fs.readFileSync(
          path.join(request.env.GIT_DIR!, "objects", "info", "alternates"),
          "utf8",
        ),
      ).toBe(`${path.join(value.repository, ".git", "objects")}\n`);
      fs.writeFileSync(
        argumentAfter(request.args, "--output"),
        "unit-vault-source-archive",
        { mode: 0o600 },
      );
      return ok("");
    },
    "tar-extract": (request) => {
      const directory = argumentAfter(request.args, "--directory");
      fs.mkdirSync(path.join(directory, "sql"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "sql", "supabase_vault--0.3.0.sql"),
        BASE_SQL,
      );
      fs.writeFileSync(
        path.join(directory, "sql", "supabase_vault--0.3.0--0.3.1.sql"),
        UPGRADE_SQL,
      );
      fs.writeFileSync(path.join(directory, "Makefile"), "all:\n\t@true\n");
      return ok("");
    },
    "pg-config-version": () => ok("PostgreSQL 17.6\n"),
    "pg-config-pkglibdir": () => ok(`${value.root}/source-lib\n`),
    "pg-config-pgxs": () => ok(`${value.pgxsPath}\n`),
    "cc-version": () => ok("unit-cc (GCC) 14.2.0\nCopyright\n"),
    "make-build": () => ok("built\n"),
    "make-install": () => {
      fs.mkdirSync(value.privateLibrary, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(value.privateLibrary, "supabase_vault.so"),
        "unit-native-vault-library",
        { mode: 0o600 },
      );
      const extension = path.join(value.privateShare, "extension");
      for (const [name, body] of [
        ["supabase_vault.control", "default_version = '0.3.1'\n"],
        ["supabase_vault--0.3.0.sql", BASE_SQL],
        ["supabase_vault--0.3.0--0.3.1.sql", UPGRADE_SQL],
      ] as const)
        fs.writeFileSync(path.join(extension, name), body, { mode: 0o644 });
      return ok("installed\n");
    },
    initdb: (request) => {
      fs.mkdirSync(argumentAfter(request.args, "-D"), {
        recursive: true,
        mode: 0o700,
      });
      return ok("");
    },
    "pg-ctl-start": (request) => {
      const dataDirectory = argumentAfter(request.args, "-D");
      const config = fs.readFileSync(
        path.join(dataDirectory, "postgresql.conf"),
        "utf8",
      );
      expect(config).toContain("shared_preload_libraries = 'supabase_vault'");
      const getkey = /^vault\.getkey_script = '([^']+)'$/m.exec(config)?.[1];
      expect(getkey).toBeTruthy();
      const script = fs.readFileSync(getkey!, "utf8");
      expect(script).toContain("OT_NEUTRAL_NATIVE_VAULT_ROOT_KEY");
      expect(script).not.toMatch(/[0-9a-f]{64}/);
      expect(fs.statSync(getkey!).mode & 0o777).toBe(0o500);
      expect(request.env.OT_NEUTRAL_NATIVE_VAULT_ROOT_KEY).toMatch(
        /^[0-9a-f]{64}$/,
      );
      return ok("");
    },
    "pg-ctl-stop": () => ok(""),
    "psql-identity": () =>
      ok(
        `170006|${value.privateLibrary}|${value.privateShare}|supabase_vault|0.3.1|vault|t\n`,
      ),
    "psql-create-extension": () => ok(""),
    "psql-create-secret": (request) => {
      createdValue = /create_secret\('([0-9a-f]+)'/.exec(
        request.stdin?.toString("utf8") ?? "",
      )![1]!;
      return ok("7b3f1f24-6f4e-4a5a-8d63-0a1b2c3d4e5f\n");
    },
    "psql-read-decrypted-secret": () => ok(`${createdValue}\n`),
    "psql-update-secret": (request) => {
      updatedValue = /update_secret\('[^']+','([0-9a-f]+)'/.exec(
        request.stdin?.toString("utf8") ?? "",
      )![1]!;
      return ok("");
    },
    "psql-read-updated-secret": () => ok(`${updatedValue}\n`),
    "psql-drop-secret": () => ok("0|0\n"),
    "psql-catalog": () => ok(`${JSON.stringify(CATALOG_SNAPSHOT)}\n`),
  };
  const run = async (
    request: NativeVaultCommandRequest,
  ): Promise<NativeVaultCommandResult> => {
    calls.push({
      label: request.label,
      executable: request.executable.path,
      args: [...request.args],
      env: { ...request.env },
      cwd: request.cwd,
    });
    const handler = overrides[request.label] ?? defaults[request.label];
    if (!handler) throw new Error(`unexpected command label: ${request.label}`);
    return handler(request);
  };
  return { run, calls, labels: () => calls.map((call) => call.label) };
}

async function loadRecorder(pinnedSqlHashes?: {
  base: string;
  upgrade: string;
}) {
  jest.resetModules();
  if (pinnedSqlHashes)
    jest.doMock("@/lib/fulfillment/neutral-production-recovery", () => ({
      ...jest.requireActual("@/lib/fulfillment/neutral-production-recovery"),
      OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256: pinnedSqlHashes.base,
      OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256: pinnedSqlHashes.upgrade,
    }));
  return (await import(
    RECORDER_MODULE
  )) as typeof import("@/scripts/record-neutral-production-native-vault-platform");
}

/**
 * The upstream source bytes are not vendored in this repository, so the pinned
 * SQL digests are the one input a unit test cannot reproduce. Only the two
 * pinned constants are doubled; every other production rule stays real, and the
 * unmocked rejection test below proves the real constants are enforced.
 */
const pinnedForUnitSource = {
  base: sha256(BASE_SQL),
  upgrade: sha256(UPGRADE_SQL),
};

async function record(
  value: Fixture,
  options: {
    overrides?: RunnerOverrides;
    env?: Record<string, string>;
    now?: Date;
    pinnedSqlHashes?: { base: string; upgrade: string };
  } = {},
) {
  const recorder = await loadRecorder(
    options.pinnedSqlHashes === undefined
      ? pinnedForUnitSource
      : options.pinnedSqlHashes,
  );
  const double = runner(value, options.overrides);
  const result = await recorder.recordNeutralProductionNativeVaultPlatform({
    env: { ...value.env, ...options.env },
    now: options.now ?? NOW,
    writeStatus: () => {},
    testOnlyCommandRunner: double.run,
  });
  return { result, double };
}

function readEvidence<T>(value: Fixture, file: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(value.evidence, file), "utf8"),
  ) as T;
}

describe("native Supabase Vault platform recorder", () => {
  test("orchestrates build, install and the full secret lifecycle, deriving every receipt field from observed output", async () => {
    const value = fixture();
    try {
      const { result, double } = await record(value);
      expect(result.platform).toBe(process.platform);

      // Every required operation is orchestrated by the recorder itself.
      expect(double.labels()).toEqual([
        "git-ls-tree",
        "git-archive",
        "tar-extract",
        "pg-config-version",
        "pg-config-pkglibdir",
        "pg-config-pgxs",
        "cc-version",
        "make-build",
        "make-install",
        "initdb",
        "pg-ctl-start",
        "psql-identity",
        "psql-create-extension",
        "psql-create-secret",
        "psql-read-decrypted-secret",
        "psql-update-secret",
        "psql-read-updated-secret",
        "psql-drop-secret",
        "psql-catalog",
        "pg-ctl-stop",
      ]);

      // Every Git invocation disables repository, global and system
      // configuration and every optional helper, so a repository-controlled
      // core.fsmonitor has nothing to hook into.
      for (const call of double.calls.filter((entry) =>
        entry.label.startsWith("git-"),
      )) {
        expect(call.args.slice(0, 2)).toEqual(["-c", "core.fsmonitor=false"]);
        expect(call.args).toEqual(
          expect.arrayContaining(["-c", "core.hooksPath=/dev/null"]),
        );
        expect(call.env.GIT_CONFIG_NOSYSTEM).toBe("1");
        expect(call.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
        expect(call.env.GIT_CONFIG_SYSTEM).toBe("/dev/null");
        expect(call.args).not.toContain("-C");
      }

      // The archive is produced from the pinned object by the recorder, read
      // through a private Git directory that contributes no repository
      // configuration, and the build never runs inside the protected source
      // repository.
      const archive = double.calls.find(
        (call) => call.label === "git-archive",
      )!;
      expect(archive.args).toContain(
        OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
      );
      expect(archive.env.GIT_DIR).toBeDefined();
      expect(archive.env.GIT_DIR).not.toBe(path.join(value.repository, ".git"));
      expect(archive.env.GIT_WORK_TREE).toBeUndefined();
      const build = double.calls.find((call) => call.label === "make-build")!;
      expect(build.args.join(" ")).not.toContain(value.repository);
      expect(build.args).toContain(`PGXS=${value.pgxsPath}`);
      if (process.platform === "darwin")
        expect(build.env.SDKROOT).toBe(
          "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
        );
      else expect(build.env.SDKROOT).toBeUndefined();
      expect(build.args).toContain(
        "PG_CFLAGS=-std=c99 -Werror -Wno-declaration-after-statement -Wno-error=ignored-attributes",
      );
      expect(build.args).toContain(
        `PG_LDFLAGS=-L${path.dirname(value.sodiumStaticLibrary)}`,
      );
      expect(build.args.some((arg) => arg.startsWith("SHLIB_LINK="))).toBe(
        false,
      );
      if (process.platform === "darwin")
        expect(build.args).toContain("BE_DLLLIBS=-undefined dynamic_lookup");
      else
        expect(build.args.some((arg) => arg.startsWith("BE_DLLLIBS="))).toBe(
          false,
        );
      const install = double.calls.find(
        (call) => call.label === "make-install",
      )!;
      expect(install.args).toContain(`pkglibdir=${value.privateLibrary}`);
      expect(install.args).toContain(`datadir=${value.privateShare}`);
      expect(install.args).toContain(
        "PG_CFLAGS=-std=c99 -Werror -Wno-declaration-after-statement -Wno-error=ignored-attributes",
      );
      const initdb = double.calls.find((call) => call.label === "initdb")!;
      expect(initdb.args).toContain("--auth-local=trust");
      expect(initdb.args).toContain("--auth-host=reject");
      expect(initdb.args).not.toContain("--auth=reject");

      const receipt = readEvidence<NativeVaultPlatformReceipt>(
        value,
        `native-vault-platform-${PLATFORM}.json`,
      );
      assertReceiptAuthenticator(receipt, AUTH);
      expect(receipt.schema).toBe(
        OT_PRODUCTION_NATIVE_VAULT_PLATFORM_RECEIPT_SCHEMA,
      );
      expect(receipt.platform).toBe(PLATFORM);
      expect(receipt.backupId).toBe(value.backup.backupId);
      expect(receipt.backupReceiptSha256).toBe(value.backupReceiptSha256);
      expect(receipt.candidateCommit).toBe(CANDIDATE_COMMIT);
      expect(receipt.candidateManifestSha256).toBe(CANDIDATE_MANIFEST);
      expect(receipt.upstreamCommit).toBe(
        OT_PRODUCTION_NATIVE_VAULT_UPSTREAM_COMMIT,
      );
      expect(receipt.baseSqlSha256).toBe(pinnedForUnitSource.base);
      expect(receipt.upgradeSqlSha256).toBe(pinnedForUnitSource.upgrade);
      expect(receipt.toolchain.postgresVersion).toBe("PostgreSQL 17.6");
      expect(receipt.toolchain.compilerVersion).toBe("unit-cc (GCC) 14.2.0");
      expect(receipt.toolchain.pgxsTreeSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.toolchain.dependencyHeaderTreeSha256).toMatch(
        /^[0-9a-f]{64}$/,
      );
      expect(receipt.toolchain.sodiumStaticLibrarySha256).toBe(
        sha256(fs.readFileSync(value.sodiumStaticLibrary)),
      );
      expect(receipt.nativeSourceCatalogSha256).toBe(
        sha256(canonicalJson(CATALOG_SNAPSHOT)),
      );
      expect(Date.parse(receipt.verifiedAt)).toBe(NOW.getTime());

      // Evidence digests are computed from the bytes actually written.
      for (const reference of Object.values(receipt.evidence)) {
        expect(path.basename(reference.file)).toBe(reference.file);
        expect(reference.file.toLowerCase()).toContain(PLATFORM);
        const file = path.join(value.evidence, reference.file);
        expect(sha256(fs.readFileSync(file))).toBe(reference.sha256);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
      expect(
        new Set(
          Object.values(receipt.evidence).map((reference) => reference.file),
        ).size,
      ).toBe(3);
      expect(
        fs.readFileSync(
          path.join(value.evidence, receipt.evidence.nativeLibrary.file),
          "utf8",
        ),
      ).toBe("unit-native-vault-library");

      const transcript = readEvidence<NativeVaultTranscript>(
        value,
        receipt.evidence.transcript.file,
      );
      expect(transcript.schema).toBe(
        OT_PRODUCTION_NATIVE_VAULT_TRANSCRIPT_SCHEMA,
      );
      expect(transcript.operations).toEqual([
        "build",
        "install",
        "create_secret",
        "read_decrypted_secret",
        "update_secret",
        "read_updated_secret",
        "drop_secret",
      ]);
      expect(transcript.result).toBe("PASS");
      expect(transcript.sourceArchiveSha256).toBe(
        receipt.evidence.sourceArchive.sha256,
      );
      expect(transcript.nativeLibrarySha256).toBe(
        receipt.evidence.nativeLibrary.sha256,
      );
      expect(transcript.functionalSecretRoundTripSha256).toBe(
        receipt.functionalSecretRoundTripSha256,
      );
    } finally {
      value.cleanup();
    }
  });

  test("rejects an ambiguous sodium library directory before build", async () => {
    const value = fixture();
    try {
      fs.writeFileSync(
        path.join(path.dirname(value.sodiumStaticLibrary), "libsodium.dylib"),
        "unbound-dynamic-sodium",
        { mode: 0o600 },
      );
      await expect(record(value)).rejects.toThrow(
        /sodium library directory is ambiguous/,
      );
    } finally {
      value.cleanup();
    }
  });

  test("rejects an incomplete PostgreSQL build toolchain before compilation", async () => {
    const value = fixture();
    try {
      await expect(
        record(value, {
          overrides: {
            "pg-config-pgxs": () => ({
              status: 64,
              stdout: Buffer.alloc(0),
              stderr: Buffer.from("unsupported pg_config option"),
            }),
          },
        }),
      ).rejects.toThrow(/pgxs|toolchain/i);
      expect(fs.readdirSync(value.evidence)).toEqual(["backup-receipt.json"]);
    } finally {
      value.cleanup();
    }
  });

  test("rejects a source repository whose HEAD is not the pinned upstream object", async () => {
    const value = fixture();
    try {
      fs.writeFileSync(
        path.join(value.repository, ".git", "HEAD"),
        `${"c".repeat(40)}\n`,
      );
      await expect(record(value)).rejects.toThrow(/source/i);
      expect(fs.readdirSync(value.evidence)).toEqual(["backup-receipt.json"]);
    } finally {
      value.cleanup();
    }
  });

  test("rejects an attached HEAD or a pinned tree containing a gitlink", async () => {
    const attached = fixture();
    try {
      fs.writeFileSync(
        path.join(attached.repository, ".git", "HEAD"),
        "ref: refs/heads/main\n",
      );
      await expect(record(attached)).rejects.toThrow(/source/i);
    } finally {
      attached.cleanup();
    }
    const gitlink = fixture();
    try {
      await expect(
        record(gitlink, {
          overrides: {
            "git-ls-tree": () => ok("160000 commit abc\tvendor/pgsodium\n"),
          },
        }),
      ).rejects.toThrow(/gitlink/i);
    } finally {
      gitlink.cleanup();
    }
  });

  test("never evaluates repository filters or dirty working-tree bytes", async () => {
    const value = fixture();
    try {
      fs.mkdirSync(path.join(value.repository, ".git", "info"), {
        recursive: true,
      });
      fs.appendFileSync(
        path.join(value.repository, ".git", "config"),
        '[filter "attack"]\n\tclean = /bin/false\n',
      );
      fs.writeFileSync(
        path.join(value.repository, ".git", "info", "attributes"),
        "* filter=attack\n",
      );
      fs.writeFileSync(path.join(value.repository, "dirty.txt"), "ignored");
      const { double } = await record(value);
      expect(double.labels()).not.toContain("git-status");
      expect(double.labels()).not.toContain("git-diff");
      expect(
        double.calls.filter((call) => call.label.startsWith("git-")),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "git-ls-tree" }),
          expect.objectContaining({ label: "git-archive" }),
        ]),
      );
    } finally {
      value.cleanup();
    }
  });

  test("rejects a writable PGXS configuration tree before make", async () => {
    const value = fixture();
    try {
      fs.chmodSync(path.resolve(value.pgxsPath, "../../.."), 0o770);
      await expect(record(value)).rejects.toThrow(/tree directory is unsafe/i);
      expect(runner(value).labels()).not.toContain("make-build");
    } finally {
      value.cleanup();
    }
  });

  test("rejects extracted pinned SQL that does not match the released candidate constants", async () => {
    const value = fixture();
    try {
      await expect(
        record(value, {
          pinnedSqlHashes: {
            base: OT_PRODUCTION_NATIVE_VAULT_BASE_SQL_SHA256,
            upgrade: OT_PRODUCTION_NATIVE_VAULT_UPGRADE_SQL_SHA256,
          },
        }),
      ).rejects.toThrow(/source/i);
    } finally {
      value.cleanup();
    }
  });

  test("derives the platform from the running runtime and refuses unsupported platforms", async () => {
    const recorder = await loadRecorder();
    expect(recorder.nativeVaultPlatform("darwin")).toBe("darwin");
    expect(recorder.nativeVaultPlatform("linux")).toBe("linux");
    for (const platform of ["win32", "freebsd", "aix"] as NodeJS.Platform[])
      expect(() => recorder.nativeVaultPlatform(platform)).toThrow(/platform/i);

    const value = fixture();
    try {
      const { result } = await record(value, {
        env: {
          OT_NEUTRAL_NATIVE_VAULT_PLATFORM: "linux",
          npm_config_platform: "linux",
        },
      });
      expect(result.platform).toBe(process.platform);
      const source = fs.readFileSync(
        path.join(
          process.cwd(),
          "scripts/record-neutral-production-native-vault-platform.ts",
        ),
        "utf8",
      );
      expect(source).toContain("nativeVaultPlatform(process.platform)");
      expect(source).not.toMatch(/env\[?\.?[A-Za-z_"'\[\]]*PLATFORM/);
    } finally {
      value.cleanup();
    }
  });

  test("rejects a failed or omitted required operation", async () => {
    for (const override of [
      {
        "make-build": () => ({
          status: 2,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("compile failed"),
        }),
      },
      {
        "make-install": () => ok("installed\n"),
      },
      {
        "psql-read-decrypted-secret": () => ok(`${"f".repeat(32)}\n`),
      },
      {
        "psql-read-updated-secret": () => ok(`${"e".repeat(32)}\n`),
      },
      {
        "psql-drop-secret": () => ok("1|1\n"),
      },
    ] as RunnerOverrides[]) {
      const value = fixture();
      try {
        await expect(record(value, { overrides: override })).rejects.toThrow();
        expect(fs.readdirSync(value.evidence)).toEqual(["backup-receipt.json"]);
      } finally {
        value.cleanup();
      }
    }
  });

  test("rejects a native cluster whose catalog does not satisfy the candidate's extension portability contract", async () => {
    const value = fixture();
    try {
      await expect(
        record(value, {
          overrides: {
            "psql-catalog": () =>
              ok(
                `${JSON.stringify({
                  ...CATALOG_SNAPSHOT,
                  managed_extension_functions: [
                    {
                      owner_role: OT_PRODUCTION_RECOVERY_NORMALIZED_GRANTOR,
                      implementation_profile: "unsupported:c::inert",
                    },
                  ],
                })}\n`,
              ),
          },
        }),
      ).rejects.toThrow();
    } finally {
      value.cleanup();
    }
  });

  test("rejects a native cluster that is not the private disposable runtime", async () => {
    const value = fixture();
    try {
      await expect(
        record(value, {
          overrides: {
            "psql-identity": () =>
              ok(
                `170006|/opt/homebrew/lib/postgresql@17|${value.privateShare}|supabase_vault|0.3.1|vault|t\n`,
              ),
          },
        }),
      ).rejects.toThrow();
    } finally {
      value.cleanup();
    }
  });

  test("refuses to overwrite existing evidence and refuses an unbound backup receipt", async () => {
    const collision = fixture();
    try {
      fs.writeFileSync(
        path.join(collision.evidence, `native-vault-platform-${PLATFORM}.json`),
        "{}",
        { mode: 0o600 },
      );
      await expect(record(collision)).rejects.toThrow();
    } finally {
      collision.cleanup();
    }

    const tampered = fixture();
    try {
      const parsed = JSON.parse(
        fs.readFileSync(tampered.receiptPath, "utf8"),
      ) as ProductionRecoveryReceipt;
      parsed.backupId = "11111111-2222-4333-8444-555555555555";
      fs.writeFileSync(tampered.receiptPath, canonicalJson(parsed), {
        mode: 0o600,
      });
      await expect(record(tampered)).rejects.toThrow();
    } finally {
      tampered.cleanup();
    }

    const unbound = fixture();
    try {
      await expect(
        record(unbound, {
          env: { OT_NEUTRAL_PRODUCTION_RECOVERY_CANDIDATE_COMMIT: "nope" },
        }),
      ).rejects.toThrow();
      await expect(
        record(unbound, { now: new Date("2026-09-17T17:00:00.000Z") }),
      ).rejects.toThrow();
    } finally {
      unbound.cleanup();
    }
  });

  test("publishes no PASS evidence when the disposable cluster shutdown is not verified", async () => {
    const value = fixture();
    let disposable = "";
    try {
      await expect(
        record(value, {
          overrides: {
            "pg-ctl-stop": (request) => {
              disposable = request.cwd;
              return {
                status: 1,
                stdout: Buffer.alloc(0),
                stderr: Buffer.from("pg_ctl: could not stop server"),
              };
            },
          },
        }),
      ).rejects.toThrow(/shutdown/i);
      expect(fs.readdirSync(value.evidence)).toEqual(["backup-receipt.json"]);
      // Diagnostic and runtime material survives an uncertain shutdown instead
      // of being deleted underneath a still-running server.
      expect(disposable).not.toBe("");
      expect(fs.existsSync(disposable)).toBe(true);
    } finally {
      if (disposable) fs.rmSync(disposable, { recursive: true, force: true });
      value.cleanup();
    }
  });

  test("stops a cluster whose start command outcome was ambiguous", async () => {
    const value = fixture();
    const observed: string[] = [];
    try {
      await expect(
        record(value, {
          overrides: {
            "pg-ctl-start": () => {
              observed.push("pg-ctl-start");
              throw new Error("child process outcome was lost");
            },
            "pg-ctl-stop": () => {
              observed.push("pg-ctl-stop");
              return ok("");
            },
          },
        }),
      ).rejects.toThrow();
      expect(observed).toEqual(["pg-ctl-start", "pg-ctl-stop"]);
      expect(fs.readdirSync(value.evidence)).toEqual(["backup-receipt.json"]);
    } finally {
      value.cleanup();
    }
  });

  test("rejects PGXS, dependency header or static libsodium drift between compilation and publication", async () => {
    for (const tamper of [
      (value: Fixture) =>
        fs.writeFileSync(value.sodiumStaticLibrary, "swapped-libsodium", {
          mode: 0o600,
        }),
      (value: Fixture) =>
        fs.writeFileSync(
          path.join(value.sodiumInclude, "sodium.h"),
          "swapped-sodium-header",
          { mode: 0o600 },
        ),
      (value: Fixture) =>
        fs.writeFileSync(value.pgxsPath, "# swapped PGXS\n", { mode: 0o600 }),
    ]) {
      const value = fixture();
      try {
        await expect(
          record(value, {
            overrides: {
              "make-build": () => {
                tamper(value);
                return ok("built\n");
              },
            },
          }),
        ).rejects.toThrow(/dependenc|sodium|pgxs/i);
        expect(fs.readdirSync(value.evidence)).toEqual(["backup-receipt.json"]);
      } finally {
        value.cleanup();
      }
    }
  });

  test("keeps the production entrypoint free of injected executors and pins both reviewed receipts", async () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "scripts/record-neutral-production-native-vault-platform.ts",
      ),
      "utf8",
    );
    const entrypoint = source.slice(source.indexOf("process.argv[1]"));
    expect(entrypoint).not.toContain("testOnly");
    // The recorder derives its own ownership policy from the effective uid; no
    // caller can hand it a weaker one.
    expect(source).not.toContain("testOnlyOwnershipPolicy");
    expect(source).toContain("nonRootOperatorTrustedExecutablePolicy()");
    expect(source).not.toMatch(/shell:\s*true|execSync|\bexec\(|spawnSync/);
    expect(source).not.toMatch(/OT_NEUTRAL_NATIVE_VAULT_[A-Z_]*RUNNER/);
    expect(OT_PRODUCTION_NATIVE_VAULT_APPROVED_PLATFORM_RECEIPT_SHA256).toEqual(
      {
        darwin:
          "284bcccb451fca0887e9a049178e8693596d5798057c405772390a988622b824",
        linux:
          "e0071ccbc8cd4e44763c525da67b2ed2396448a18606955ce833e86123ea9f7b",
      },
    );
  });

  test("rejects an injected command runner outside the unit-test runtime", async () => {
    const value = fixture();
    try {
      const recorder = await loadRecorder();
      await expect(
        recorder.recordNeutralProductionNativeVaultPlatform({
          env: { ...value.env, NODE_ENV: "production" },
          writeStatus: () => {},
          testOnlyCommandRunner: runner(value).run,
        }),
      ).rejects.toThrow(/test-only command runner/i);
      expect(fs.readdirSync(value.evidence)).toEqual(["backup-receipt.json"]);
    } finally {
      value.cleanup();
    }
  });
});

describe("native Vault Git invocation hardening", () => {
  function realGitBinary(): string {
    for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!directory) continue;
      const candidate = path.join(directory, "git");
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    }
    throw new Error("a real git binary is required for this regression");
  }

  /**
   * A repository whose own `.git/config` names an executable `core.fsmonitor`
   * helper. Git runs that helper whenever it refreshes the index, so a
   * repository handed to the recorder by an operator can execute code inside
   * the recorder's process tree unless every Git invocation disables it.
   */
  function hostileRepository(): {
    repository: string;
    marker: string;
    commit: string;
    cleanup: () => void;
  } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-native-vault-git-"));
    fs.chmodSync(root, 0o700);
    const repository = path.join(root, "repo");
    const marker = path.join(root, "fsmonitor-executed");
    const hook = path.join(root, "fsmonitor-hook");
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      HOME: root,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "ot",
      GIT_AUTHOR_EMAIL: "ot@example.invalid",
      GIT_COMMITTER_NAME: "ot",
      GIT_COMMITTER_EMAIL: "ot@example.invalid",
    };
    const git = (...args: string[]): string =>
      execFileSync(realGitBinary(), args, {
        cwd: fs.existsSync(repository) ? repository : root,
        env,
        encoding: "utf8",
      });
    git("init", "--quiet", repository);
    fs.writeFileSync(path.join(repository, "Makefile"), "all:\n\t@true\n");
    git("add", "Makefile");
    git("commit", "--quiet", "--message", "pinned");
    fs.writeFileSync(
      hook,
      `#!/bin/sh\nprintf 'executed' > ${marker}\nprintf '/\\0'\nexit 0\n`,
      { mode: 0o700 },
    );
    git("config", "core.fsmonitor", hook);
    return {
      repository,
      marker,
      commit: git("rev-parse", "--verify", "HEAD").trim(),
      cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
  }

  test("reads the pinned object out of the supplied object database without the repository's own configuration", () => {
    const hostile = hostileRepository();
    try {
      const scratch = fs.mkdtempSync(
        path.join(os.tmpdir(), "ot-native-vault-objects-"),
      );
      const output = path.join(scratch, "source.tar");
      const command = nativeVaultObjectDatabaseGitCommand({
        repository: hostile.repository,
        scratchGitDirectory: path.join(scratch, "gitdir"),
        baseEnv: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          NODE_ENV: "production",
          HOME: scratch,
        },
        args: ["archive", "--format=tar", "--output", output, hostile.commit],
      });
      expect(command.env.GIT_DIR).toBe(path.join(scratch, "gitdir"));
      expect(command.env.GIT_WORK_TREE).toBeUndefined();
      fs.rmSync(hostile.marker, { force: true });
      execFileSync(realGitBinary(), command.args, {
        cwd: command.cwd,
        env: command.env,
        encoding: "utf8",
      });
      expect(fs.existsSync(hostile.marker)).toBe(false);
      expect(fs.statSync(output).size).toBeGreaterThan(0);
      fs.rmSync(scratch, { recursive: true, force: true });
    } finally {
      hostile.cleanup();
    }
  });
});

/**
 * The recorder is a disposable evidence builder: `initdb` refuses to run as
 * root, so the operator is a normal user and the private runtime it installs
 * into is that user's. The policy is derived from the effective uid inside the
 * recorder, never supplied by a caller.
 */
describe("native Vault recorder runtime ownership policy", () => {
  test("accepts the private runtime of the current non-root operator", () => {
    const value = fixture();
    try {
      expect(process.getuid!()).not.toBe(0);
      expect(
        assertNativeVaultRecorderRuntime(value.runtimeRoot, process.cwd())
          .privateLibraryDirectory,
      ).toBe(value.privateLibrary);
    } finally {
      value.cleanup();
    }
  });

  test("refuses to record as root", () => {
    const value = fixture();
    const getuid = jest.spyOn(process, "getuid").mockReturnValue(0);
    try {
      expect(() =>
        assertNativeVaultRecorderRuntime(value.runtimeRoot, process.cwd()),
      ).toThrow(/root/i);
    } finally {
      getuid.mockRestore();
      value.cleanup();
    }
  });

  test("refuses a private runtime owned by another user", () => {
    const value = fixture();
    const getuid = jest
      .spyOn(process, "getuid")
      .mockReturnValue(process.getuid!() + 1);
    try {
      expect(() =>
        assertNativeVaultRecorderRuntime(value.runtimeRoot, process.cwd()),
      ).toThrow(/unsafe/i);
    } finally {
      getuid.mockRestore();
      value.cleanup();
    }
  });

  test("refuses a group- or world-writable runtime root or tree", () => {
    for (const loosen of [
      (value: Fixture) => fs.chmodSync(value.runtimeRoot, 0o750),
      (value: Fixture) => fs.chmodSync(value.runtimeRoot, 0o707),
      (value: Fixture) => fs.chmodSync(value.privateLibrary, 0o777),
      (value: Fixture) =>
        fs.chmodSync(path.join(value.runtimeRoot, "b"), 0o727),
    ]) {
      const value = fixture();
      try {
        loosen(value);
        expect(() =>
          assertNativeVaultRecorderRuntime(value.runtimeRoot, process.cwd()),
        ).toThrow(/unsafe/i);
      } finally {
        value.cleanup();
      }
    }
  });

  test("refuses a symlinked private tree", () => {
    const value = fixture();
    try {
      const elsewhere = path.join(value.root, "elsewhere");
      fs.mkdirSync(elsewhere, { mode: 0o700 });
      fs.rmSync(value.privateLibrary, { recursive: true, force: true });
      fs.symlinkSync(elsewhere, value.privateLibrary);
      expect(() =>
        assertNativeVaultRecorderRuntime(value.runtimeRoot, process.cwd()),
      ).toThrow(/unsafe/i);
    } finally {
      value.cleanup();
    }
  });
});
