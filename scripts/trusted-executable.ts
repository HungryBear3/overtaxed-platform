import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
} from "node:child_process";

export type TrustedExecutable = {
  path: string;
  sha256: string;
  device: number;
  inode: number;
  size: number;
  owner: number;
  mode: number;
  allowStickyAncestors: boolean;
  ownershipPolicy: TrustedExecutableOwnershipPolicy;
};

export type TrustedExecutableOwnershipPolicy = Readonly<{
  name: "root-only" | "unit-test-explicit" | "preparation-observed";
  allowedOwners: readonly number[];
}>;

const ROOT_ONLY_POLICY: TrustedExecutableOwnershipPolicy = Object.freeze({
  name: "root-only",
  allowedOwners: Object.freeze([0]),
});

export function unitTestTrustedExecutablePolicy(
  uid: number,
): TrustedExecutableOwnershipPolicy {
  if (!Number.isSafeInteger(uid) || uid < 0)
    throw new Error("Unit-test executable owner is invalid");
  return Object.freeze({
    name: "unit-test-explicit",
    allowedOwners: Object.freeze([0, uid]),
  });
}

function allowedOwner(
  uid: number,
  policy: TrustedExecutableOwnershipPolicy,
): boolean {
  return policy.allowedOwners.includes(uid);
}

export function assertProtectedAncestors(
  file: string,
  allowStickyAncestors = false,
  ownershipPolicy: TrustedExecutableOwnershipPolicy = ROOT_ONLY_POLICY,
): void {
  let current = path.dirname(file);
  for (;;) {
    const stat = fs.lstatSync(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !allowedOwner(stat.uid, ownershipPolicy) ||
      ((stat.mode & 0o022) !== 0 &&
        !(allowStickyAncestors && stat.uid === 0 && (stat.mode & 0o1000) !== 0))
    )
      throw new Error("Trusted executable ancestry is unsafe");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function inspect(
  file: string,
  allowStickyAncestors: boolean,
  ownershipPolicy: TrustedExecutableOwnershipPolicy,
): TrustedExecutable {
  if (!path.isAbsolute(file))
    throw new Error("Trusted executable path must be absolute");
  const resolved = fs.realpathSync(file);
  assertProtectedAncestors(resolved, allowStickyAncestors, ownershipPolicy);
  const before = fs.lstatSync(resolved);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    !allowedOwner(before.uid, ownershipPolicy) ||
    (before.mode & 0o022) !== 0 ||
    (before.mode & 0o111) === 0
  )
    throw new Error("Trusted executable identity is unsafe");
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.uid !== before.uid ||
      opened.mode !== before.mode
    )
      throw new Error("Trusted executable changed while opening");
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
      position += count;
    }
    buffer.fill(0);
    return {
      path: resolved,
      sha256: digest.digest("hex"),
      device: opened.dev,
      inode: opened.ino,
      size: opened.size,
      owner: opened.uid,
      mode: opened.mode,
      allowStickyAncestors,
      ownershipPolicy,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function resolveTrustedExecutable(
  file: string,
  options: {
    allowStickyAncestors?: boolean;
    ownershipPolicy?: TrustedExecutableOwnershipPolicy;
  } = {},
): TrustedExecutable {
  return inspect(
    file,
    options.allowStickyAncestors === true,
    options.ownershipPolicy ?? ROOT_ONLY_POLICY,
  );
}

export function assertTrustedExecutable(executable: TrustedExecutable): void {
  const current = inspect(
    executable.path,
    executable.allowStickyAncestors,
    executable.ownershipPolicy,
  );
  if (
    current.sha256 !== executable.sha256 ||
    current.device !== executable.device ||
    current.inode !== executable.inode ||
    current.size !== executable.size ||
    current.owner !== executable.owner ||
    current.mode !== executable.mode
  )
    throw new Error("Trusted executable changed before spawn");
}

export function spawnTrusted(
  executable: TrustedExecutable,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  assertTrustedExecutable(executable);
  return spawn(executable.path, [...args], {
    ...options,
    shell: false,
  }) as ChildProcessWithoutNullStreams;
}
