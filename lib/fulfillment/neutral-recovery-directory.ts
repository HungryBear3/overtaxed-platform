import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Open a recovery artifact without relying on the process umask.  The explicit
 * fchmod is intentional: open(2)'s mode is filtered by umask, and external
 * producers such as GnuPG are not required to choose the same defaults on
 * every platform.
 */
export function openPrivateRecoveryArtifact(file: string): number {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600
    )
      throw new Error("Could not create a private recovery artifact");
    return descriptor;
  } catch (error) {
    fs.closeSync(descriptor);
    fs.rmSync(file, { force: true });
    throw error;
  }
}

export function sealPrivateRecoveryArtifact(
  descriptor: number,
  file: string,
): void {
  fs.fchmodSync(descriptor, 0o400);
  fs.fsyncSync(descriptor);
  const stat = fs.fstatSync(descriptor);
  const pathStat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o400 ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    pathStat.dev !== stat.dev ||
    pathStat.ino !== stat.ino
  )
    throw new Error("Recovery artifact identity changed before sealing");
}

export async function withRecoveryDirectory<T>(
  outputRoot: string,
  work: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = path.resolve(
    outputRoot,
    `neutral-production-recovery-${Date.now()}-${randomUUID().replaceAll("-", "")}`,
  );
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  try {
    return await work(directory);
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
