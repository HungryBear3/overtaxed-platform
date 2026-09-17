import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES,
  sha256,
} from "../lib/fulfillment/neutral-production-recovery";

const FIXTURE_ROOT = path.join("fixtures", "postgresql");

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

export function assertManagedExtensionFixtureSource(cwd = process.cwd()): void {
  for (const fixture of recoveryExtensionFixturePaths(cwd)) {
    const stat = fs.lstatSync(fixture.source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error(
        `Managed extension fixture source is unsafe: ${fixture.name}`,
      );
    if (
      sha256(fs.readFileSync(fixture.source)) !==
      OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES[fixture.name]
    )
      throw new Error(
        `Managed extension fixture source changed: ${fixture.name}`,
      );
  }
}

export function postgresSharedExtensionDirectory(pgConfig = "pg_config"): {
  directory: string;
  major: 17 | 18;
} {
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    LANG: "C",
    LC_ALL: "C",
  };
  const version = execFileSync(pgConfig, ["--version"], {
    encoding: "utf8",
    env: childEnv,
  }).trim();
  const match = /^PostgreSQL (17|18)\./.exec(version);
  if (!match)
    throw new Error(
      `Managed extension fixture PostgreSQL is unsupported: ${version}`,
    );
  const shared = execFileSync(pgConfig, ["--sharedir"], {
    encoding: "utf8",
    env: childEnv,
  }).trim();
  const directory = path.resolve(shared, "extension");
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync(directory) !== directory
  )
    throw new Error("PostgreSQL extension directory is unsafe");
  return { directory, major: Number(match[1]) as 17 | 18 };
}

export function assertManagedExtensionFixtureInstalled(
  pgConfig = "pg_config",
  cwd = process.cwd(),
): { major: 17 | 18; directory: string } {
  assertManagedExtensionFixtureSource(cwd);
  const target = postgresSharedExtensionDirectory(pgConfig);
  for (const fixture of recoveryExtensionFixturePaths(cwd)) {
    const installed = path.join(target.directory, fixture.name);
    const stat = fs.lstatSync(installed);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o222) !== 0 ||
      sha256(fs.readFileSync(installed)) !==
        OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES[fixture.name]
    )
      throw new Error(
        `Installed managed extension fixture is unsafe or mismatched: ${fixture.name}`,
      );
  }
  return target;
}

export function stageManagedExtensionFixture(input: {
  action: "install" | "remove";
  pgConfig?: string;
  cwd?: string;
}): { major: 17 | 18; directory: string } {
  const cwd = input.cwd ?? process.cwd();
  assertManagedExtensionFixtureSource(cwd);
  const target = postgresSharedExtensionDirectory(input.pgConfig);
  const created: string[] = [];
  const fixtureTargets = recoveryExtensionFixturePaths(cwd).map((fixture) => ({
    ...fixture,
    installed: path.join(target.directory, fixture.name),
  }));
  if (input.action === "remove") {
    for (const fixture of fixtureTargets) {
      const stat = fs.lstatSync(fixture.installed);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        sha256(fs.readFileSync(fixture.installed)) !==
          OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES[fixture.name]
      )
        throw new Error(
          `Refusing to remove mismatched managed extension fixture: ${fixture.name}`,
        );
    }
    for (const fixture of fixtureTargets) fs.unlinkSync(fixture.installed);
    fsyncDirectory(target.directory);
    return target;
  }
  try {
    for (const fixture of fixtureTargets) {
      const bytes = fs.readFileSync(fixture.source);
      const descriptor = fs.openSync(fixture.installed, "wx", 0o444);
      created.push(fixture.installed);
      try {
        fs.writeFileSync(descriptor, bytes);
        fs.fchmodSync(descriptor, 0o444);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    fsyncDirectory(target.directory);
    assertManagedExtensionFixtureInstalled(input.pgConfig, cwd);
    return target;
  } catch (error) {
    for (const installed of created.reverse()) {
      try {
        const name = path.basename(
          installed,
        ) as keyof typeof OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES;
        if (
          sha256(fs.readFileSync(installed)) ===
          OT_PRODUCTION_RECOVERY_MANAGED_EXTENSION_FIXTURE_FILES[name]
        )
          fs.unlinkSync(installed);
      } catch {}
    }
    throw error;
  }
}

function fsyncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
