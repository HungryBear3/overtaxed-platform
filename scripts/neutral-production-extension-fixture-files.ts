import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY,
  OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  canonicalJson,
  sha256,
} from "../lib/fulfillment/neutral-production-recovery";
import {
  assertProtectedAncestors,
  assertTrustedExecutable,
  resolveTrustedExecutable,
  type TrustedExecutableOwnershipPolicy,
} from "./trusted-executable";

const FIXTURE_ROOT = path.join("fixtures", "postgresql");
const RUNTIME_SCHEMA = "ot.neutral-recovery-postgres-runtime.v1" as const;
const MANIFEST = "recovery-postgres-runtime.json";

export type RuntimeManifest = {
  schema: typeof RUNTIME_SCHEMA;
  policy: typeof OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY;
  major: 17 | 18;
  sourceSharedDirectory: string;
  privateSharedDirectory: string;
  privateBinaryDirectory: string;
  postgresSha256: string;
  initdbSha256: string;
  privateBinaryTreeSha256: string;
  privateSharedTreeSha256: string;
  sourcePgConfigSha256: string;
  sourceBinaryTreeSha256: string;
  sourceSharedTreeSha256: string;
  fixtureFilesSha256: Record<string, string>;
};

function assertRuntimeRoot(
  runtimeRoot: string,
  allowedOwners: readonly number[],
  ownerOnly: boolean,
): void {
  const absolute = path.resolve(runtimeRoot);
  const stat = fs.lstatSync(absolute);
  if (
    absolute !== runtimeRoot ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !allowedOwners.includes(stat.uid) ||
    (ownerOnly ? (stat.mode & 0o077) !== 0 : (stat.mode & 0o022) !== 0) ||
    fs.realpathSync(absolute) !== absolute
  )
    throw new Error("Recovery PostgreSQL runtime root is unsafe");
}

function readVerifiedFile(file: string, expectedSha256?: string): Buffer {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    throw new Error(
      `Recovery fixture source is unsafe: ${path.basename(file)}`,
    );
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error(
        `Recovery fixture source identity changed: ${path.basename(file)}`,
      );
    const bytes = fs.readFileSync(descriptor);
    if (expectedSha256 && sha256(bytes) !== expectedSha256)
      throw new Error(
        `Recovery fixture source changed: ${path.basename(file)}`,
      );
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function strictTreeSha256(
  root: string,
  allowedOwners: ReadonlySet<number>,
  includeOwner = true,
): string {
  const rows: Array<{
    path: string;
    type: "directory" | "file";
    owner: number;
    mode: number;
    sha256?: string;
  }> = [];
  const walk = (directory: string, relative = ""): void => {
    const directoryStat = fs.lstatSync(directory);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      !allowedOwners.has(directoryStat.uid) ||
      (directoryStat.mode & 0o022) !== 0
    )
      throw new Error("Recovery PostgreSQL tree directory is unsafe");
    if (relative)
      rows.push({
        path: relative,
        type: "directory",
        owner: includeOwner ? directoryStat.uid : 0,
        mode: directoryStat.mode & 0o777,
      });
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const child = relative ? path.join(relative, name) : name;
      const target = fs.lstatSync(file);
      if (
        target.isSymbolicLink() ||
        !allowedOwners.has(target.uid) ||
        (target.mode & 0o022) !== 0
      )
        throw new Error(`Recovery PostgreSQL tree entry is unsafe: ${child}`);
      if (target.isDirectory()) {
        walk(file, child);
        continue;
      }
      if (!target.isFile() || target.nlink !== 1)
        throw new Error(
          `Recovery PostgreSQL tree has unsupported entry: ${child}`,
        );
      const before = fs.lstatSync(file);
      const bytes = readVerifiedFile(file);
      const after = fs.lstatSync(file);
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      )
        throw new Error(
          `Recovery PostgreSQL source changed while hashing: ${child}`,
        );
      rows.push({
        path: child,
        type: "file",
        owner: includeOwner ? target.uid : 0,
        mode: target.mode & 0o777,
        sha256: sha256(bytes),
      });
      bytes.fill(0);
    }
  };
  walk(root);
  return sha256(canonicalJson(rows));
}

export function recoveryExtensionFixturePaths(cwd = process.cwd()): Array<{
  name: keyof typeof OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES;
  source: string;
}> {
  return Object.keys(
    OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  ).map((name) => ({
    name: name as keyof typeof OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
    source: path.resolve(cwd, FIXTURE_ROOT, name),
  }));
}

function verifiedFixtureSources(cwd = process.cwd()): Array<{
  name: keyof typeof OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES;
  bytes: Buffer;
}> {
  return recoveryExtensionFixturePaths(cwd).map(({ name, source }) => ({
    name,
    bytes: readVerifiedFile(
      source,
      OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES[name],
    ),
  }));
}

export function assertManagedExtensionFixtureSource(cwd = process.cwd()): void {
  const fixtures = verifiedFixtureSources(cwd);
  for (const fixture of fixtures) fixture.bytes.fill(0);
}

function sourcePostgresInstallation(
  pgConfig: string,
  ownershipPolicy?: TrustedExecutableOwnershipPolicy,
): {
  major: 17 | 18;
  bin: string;
  share: string;
  pgConfigSha256: string;
} {
  const absolutePgConfig = path.resolve(pgConfig);
  if (absolutePgConfig !== pgConfig)
    throw new Error("Recovery source pg_config must be an absolute path");
  const trustedPgConfig = resolveTrustedExecutable(absolutePgConfig, {
    ownershipPolicy,
  });
  const childEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    NODE_ENV: "production",
    LANG: "C",
    LC_ALL: "C",
  };
  assertTrustedExecutable(trustedPgConfig);
  const version = execFileSync(trustedPgConfig.path, ["--version"], {
    encoding: "utf8",
    env: childEnv,
  }).trim();
  const match = /^PostgreSQL (17|18)\./.exec(version);
  if (!match)
    throw new Error(`Recovery fixture PostgreSQL is unsupported: ${version}`);
  assertTrustedExecutable(trustedPgConfig);
  const share = path.resolve(
    execFileSync(trustedPgConfig.path, ["--sharedir"], {
      encoding: "utf8",
      env: childEnv,
    }).trim(),
  );
  const bin = path.dirname(trustedPgConfig.path);
  const allowUnsafeSourceDirectory =
    trustedPgConfig.ownershipPolicy.name === "unit-test-explicit" &&
    trustedPgConfig.ownershipPolicy.allowUnsafeAncestors === true;
  for (const [label, directory] of [
    ["binary", bin],
    ["shared", share],
  ] as const) {
    const stat = fs.lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (!allowUnsafeSourceDirectory &&
        (!trustedPgConfig.ownershipPolicy.allowedOwners.includes(stat.uid) ||
          (stat.mode & 0o022) !== 0))
    )
      throw new Error(
        `Recovery source PostgreSQL ${label} directory is unsafe`,
      );
    assertProtectedAncestors(directory, false, trustedPgConfig.ownershipPolicy);
  }
  for (const fixture of Object.keys(
    OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  ))
    if (fs.existsSync(path.join(share, "extension", fixture)))
      throw new Error(
        `Recovery source PostgreSQL unexpectedly already provides ${fixture}`,
      );
  return {
    major: Number(match[1]) as 17 | 18,
    bin,
    share,
    pgConfigSha256: trustedPgConfig.sha256,
  };
}

function patchCompiledSharedDirectory(input: {
  file: string;
  sourceSharedDirectory: string;
  privateSharedDirectory: string;
}): string {
  const before = fs.lstatSync(input.file);
  const bytes = readVerifiedFile(input.file);
  const source = Buffer.from(`\u0000${input.sourceSharedDirectory}\u0000`);
  const replacementPath = Buffer.from(input.privateSharedDirectory);
  if (replacementPath.length > Buffer.byteLength(input.sourceSharedDirectory))
    throw new Error(
      "Private recovery PostgreSQL shared directory path is too long",
    );
  const replacement = Buffer.concat([
    Buffer.from([0]),
    replacementPath,
    Buffer.alloc(
      Buffer.byteLength(input.sourceSharedDirectory) - replacementPath.length,
    ),
    Buffer.from([0]),
  ]);
  let found = 0;
  for (let offset = bytes.indexOf(source); offset >= 0; ) {
    replacement.copy(bytes, offset);
    found += 1;
    offset = bytes.indexOf(source, offset + replacement.length);
  }
  if (found !== 1)
    throw new Error(
      `Recovery PostgreSQL binary has ${found} compiled shared-directory fields`,
    );
  const mode = before.mode & 0o777;
  const identityDescriptor = fs.openSync(
    input.file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(identityDescriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error(
        "Recovery PostgreSQL binary identity changed before patch",
      );
    fs.fchmodSync(identityDescriptor, mode | 0o200);
    const descriptor = fs.openSync(
      input.file,
      fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0),
    );
    try {
      const writable = fs.fstatSync(descriptor);
      if (writable.dev !== opened.dev || writable.ino !== opened.ino)
        throw new Error(
          "Recovery PostgreSQL binary changed while opening for patch",
        );
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
      fs.fchmodSync(descriptor, mode & ~0o222);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } finally {
    fs.closeSync(identityDescriptor);
    bytes.fill(0);
  }
  const magic = readVerifiedFile(input.file).subarray(0, 4).toString("hex");
  if (
    process.platform === "darwin" &&
    [
      "feedface",
      "feedfacf",
      "cefaedfe",
      "cffaedfe",
      "cafebabe",
      "bebafeca",
    ].includes(magic)
  )
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", input.file], {
      stdio: "ignore",
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        NODE_ENV: "production",
        LANG: "C",
        LC_ALL: "C",
      },
    });
  return sha256(readVerifiedFile(input.file));
}

function applySourceTreeModes(source: string, destination: string): void {
  const sourceStat = fs.lstatSync(source);
  const destinationStat = fs.lstatSync(destination);
  if (
    sourceStat.isSymbolicLink() ||
    destinationStat.isSymbolicLink() ||
    sourceStat.isDirectory() !== destinationStat.isDirectory() ||
    sourceStat.isFile() !== destinationStat.isFile()
  )
    throw new Error("Recovery PostgreSQL copied tree type is unsafe");
  if (sourceStat.isDirectory()) {
    const sourceNames = fs.readdirSync(source).sort();
    const destinationNames = fs.readdirSync(destination).sort();
    if (canonicalJson(sourceNames) !== canonicalJson(destinationNames))
      throw new Error("Recovery PostgreSQL copied tree entries differ");
    for (const name of sourceNames)
      applySourceTreeModes(
        path.join(source, name),
        path.join(destination, name),
      );
  }
  fs.chmodSync(destination, sourceStat.mode & 0o777);
}

function fsyncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function prepareManagedExtensionRuntime(input: {
  runtimeRoot: string;
  sourcePgConfig: string;
  cwd?: string;
  testOnlyOwnershipPolicy?: TrustedExecutableOwnershipPolicy;
}): RuntimeManifest {
  if (path.resolve(input.runtimeRoot) !== input.runtimeRoot)
    throw new Error("Recovery PostgreSQL runtime root must be absolute");
  const runtimeRoot = fs.realpathSync(input.runtimeRoot);
  assertRuntimeRoot(runtimeRoot, [process.getuid!()], true);
  const runtimeOwner = fs.lstatSync(runtimeRoot).uid;
  const sourceOwners = new Set<number>(
    input.testOnlyOwnershipPolicy?.allowedOwners ?? [0],
  );
  const privateOwners = new Set<number>([0, runtimeOwner]);
  if (fs.readdirSync(runtimeRoot).length !== 0)
    throw new Error("Recovery PostgreSQL runtime root must be empty");
  const source = sourcePostgresInstallation(
    input.sourcePgConfig,
    input.testOnlyOwnershipPolicy,
  );
  const fixtures = verifiedFixtureSources(input.cwd);
  const sourceBinaryTreeBefore = strictTreeSha256(
    source.bin,
    sourceOwners,
    false,
  );
  const sourceSharedTreeBefore = strictTreeSha256(
    source.share,
    sourceOwners,
    false,
  );
  const privateBin = path.join(runtimeRoot, "b");
  const privateShare = path.join(runtimeRoot, "s");
  try {
    fs.cpSync(source.bin, privateBin, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    fs.cpSync(source.share, privateShare, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    applySourceTreeModes(source.bin, privateBin);
    applySourceTreeModes(source.share, privateShare);
    if (
      strictTreeSha256(source.bin, sourceOwners, false) !==
        sourceBinaryTreeBefore ||
      strictTreeSha256(source.share, sourceOwners, false) !==
        sourceSharedTreeBefore ||
      strictTreeSha256(privateBin, privateOwners, false) !==
        strictTreeSha256(source.bin, sourceOwners, false) ||
      strictTreeSha256(privateShare, privateOwners, false) !==
        strictTreeSha256(source.share, sourceOwners, false)
    )
      throw new Error("Recovery PostgreSQL source changed while copying");
    const extensionDirectory = path.join(privateShare, "extension");
    for (const fixture of fixtures) {
      if (
        sha256(fixture.bytes) !==
        OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES[fixture.name]
      )
        throw new Error("Recovery fixture changed before private installation");
      const installed = path.join(extensionDirectory, fixture.name);
      const descriptor = fs.openSync(installed, "wx", 0o444);
      try {
        fs.writeFileSync(descriptor, fixture.bytes);
        fs.fchmodSync(descriptor, 0o444);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    fsyncDirectory(extensionDirectory);
    const postgresSha256 = patchCompiledSharedDirectory({
      file: path.join(privateBin, "postgres"),
      sourceSharedDirectory: source.share,
      privateSharedDirectory: privateShare,
    });
    const initdbSha256 = patchCompiledSharedDirectory({
      file: path.join(privateBin, "initdb"),
      sourceSharedDirectory: source.share,
      privateSharedDirectory: privateShare,
    });
    const privateBinaryTreeSha256 = strictTreeSha256(
      privateBin,
      privateOwners,
      false,
    );
    const privateSharedTreeSha256 = strictTreeSha256(
      privateShare,
      privateOwners,
      false,
    );
    const manifest: RuntimeManifest = {
      schema: RUNTIME_SCHEMA,
      policy: OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY,
      major: source.major,
      sourceSharedDirectory: source.share,
      privateSharedDirectory: privateShare,
      privateBinaryDirectory: privateBin,
      postgresSha256,
      initdbSha256,
      privateBinaryTreeSha256,
      privateSharedTreeSha256,
      sourcePgConfigSha256: source.pgConfigSha256,
      sourceBinaryTreeSha256: sourceBinaryTreeBefore,
      sourceSharedTreeSha256: sourceSharedTreeBefore,
      fixtureFilesSha256: {
        ...OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
      },
    };
    const manifestPath = path.join(runtimeRoot, MANIFEST);
    const descriptor = fs.openSync(manifestPath, "wx", 0o400);
    try {
      fs.writeFileSync(descriptor, canonicalJson(manifest));
      fs.fchmodSync(descriptor, 0o400);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fsyncDirectory(runtimeRoot);
    return assertManagedExtensionFixtureInstalled(
      runtimeRoot,
      input.cwd,
      input.testOnlyOwnershipPolicy ?? {
        name: "preparation-observed",
        allowedOwners: [0, runtimeOwner],
      },
    );
  } catch (error) {
    for (const entry of fs.readdirSync(runtimeRoot))
      fs.rmSync(path.join(runtimeRoot, entry), {
        recursive: true,
        force: true,
      });
    throw error;
  } finally {
    for (const fixture of fixtures) fixture.bytes.fill(0);
  }
}

export function assertManagedExtensionFixtureInstalled(
  runtimeRootInput: string,
  cwd = process.cwd(),
  testOnlyOwnershipPolicy?: TrustedExecutableOwnershipPolicy,
): RuntimeManifest {
  if (path.resolve(runtimeRootInput) !== runtimeRootInput)
    throw new Error("Recovery PostgreSQL runtime root must be absolute");
  const runtimeRoot = fs.realpathSync(runtimeRootInput);
  assertRuntimeRoot(
    runtimeRoot,
    testOnlyOwnershipPolicy?.allowedOwners ?? [0],
    testOnlyOwnershipPolicy !== undefined,
  );
  assertManagedExtensionFixtureSource(cwd);
  const manifest = JSON.parse(
    readVerifiedFile(path.join(runtimeRoot, MANIFEST)).toString("utf8"),
  ) as RuntimeManifest;
  if (
    manifest.schema !== RUNTIME_SCHEMA ||
    manifest.policy !== OT_PRODUCTION_RECOVERY_EXTENSION_PORTABILITY_POLICY ||
    (manifest.major !== 17 && manifest.major !== 18) ||
    manifest.privateSharedDirectory !== path.join(runtimeRoot, "s") ||
    manifest.privateBinaryDirectory !== path.join(runtimeRoot, "b") ||
    !/^[0-9a-f]{64}$/.test(manifest.privateBinaryTreeSha256) ||
    !/^[0-9a-f]{64}$/.test(manifest.privateSharedTreeSha256) ||
    !/^[0-9a-f]{64}$/.test(manifest.sourcePgConfigSha256) ||
    !/^[0-9a-f]{64}$/.test(manifest.sourceBinaryTreeSha256) ||
    !/^[0-9a-f]{64}$/.test(manifest.sourceSharedTreeSha256) ||
    canonicalJson(manifest.fixtureFilesSha256) !==
      canonicalJson(OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES)
  )
    throw new Error("Recovery PostgreSQL runtime manifest is invalid");
  if (
    strictTreeSha256(
      manifest.privateBinaryDirectory,
      new Set([0, fs.lstatSync(runtimeRoot).uid]),
      false,
    ) !== manifest.privateBinaryTreeSha256 ||
    strictTreeSha256(
      manifest.privateSharedDirectory,
      new Set([0, fs.lstatSync(runtimeRoot).uid]),
      false,
    ) !== manifest.privateSharedTreeSha256
  )
    throw new Error("Private recovery PostgreSQL runtime tree changed");
  for (const [name, expected] of Object.entries(
    OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  )) {
    const installed = path.join(
      manifest.privateSharedDirectory,
      "extension",
      name,
    );
    const stat = fs.lstatSync(installed);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o222) !== 0 ||
      sha256(readVerifiedFile(installed)) !== expected
    )
      throw new Error(`Private managed extension fixture is invalid: ${name}`);
  }
  for (const [name, expected] of [
    ["postgres", manifest.postgresSha256],
    ["initdb", manifest.initdbSha256],
  ] as const) {
    const executable = path.join(manifest.privateBinaryDirectory, name);
    if (sha256(readVerifiedFile(executable)) !== expected)
      throw new Error(`Private recovery PostgreSQL ${name} changed`);
  }
  return manifest;
}

export const PRIVATE_RUNTIME_ROOT_VAR =
  "OT_NEUTRAL_RECOVERY_REHEARSAL_RUNTIME_ROOT" as const;
