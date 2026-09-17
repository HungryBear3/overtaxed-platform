import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
