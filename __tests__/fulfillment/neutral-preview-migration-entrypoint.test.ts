import fs from "node:fs";
import path from "node:path";

import {
  NEUTRAL_RUNTIME_FEATURE_ACTIVATORS,
  PRE_MIGRATION_COMMAND,
  PRISMA_MIGRATE_DEPLOY_COMMAND,
  runNeutralPreviewMigrationEntrypoint,
  type MigrationCommand,
  type MigrationCommandRunner,
  type PreviewMigrationEnvironment,
} from "@/lib/fulfillment/neutral-preview-migration-entrypoint";

function previewEnv(): PreviewMigrationEnvironment {
  return { VERCEL_ENV: "preview" };
}

describe("neutral Preview migration entrypoint", () => {
  test("runs the identity proof first and then the exact safe migration", () => {
    const commands: MigrationCommand[] = [];
    const run: MigrationCommandRunner = (command) => {
      commands.push(command);
      return { status: 0 };
    };

    expect(() =>
      runNeutralPreviewMigrationEntrypoint(previewEnv(), run),
    ).not.toThrow();
    expect(commands).toEqual([
      PRE_MIGRATION_COMMAND,
      PRISMA_MIGRATE_DEPLOY_COMMAND,
    ]);
    expect(PRISMA_MIGRATE_DEPLOY_COMMAND).toEqual({
      command: "npx",
      args: ["prisma", "migrate", "deploy"],
    });
  });

  test.each([
    { status: 1 },
    { status: null },
    { status: 0, error: new Error() },
  ])("never invokes migration when preflight returns %p", (preflightResult) => {
    const commands: MigrationCommand[] = [];
    const run: MigrationCommandRunner = (command) => {
      commands.push(command);
      return preflightResult;
    };

    expect(() =>
      runNeutralPreviewMigrationEntrypoint(previewEnv(), run),
    ).toThrow("PRE-MIGRATION identity proof failed");
    expect(commands).toEqual([PRE_MIGRATION_COMMAND]);
  });

  test.each([undefined, "production", "development"])(
    "fails closed outside Preview (%p) without spawning a command",
    (vercelEnv) => {
      const run = jest.fn(() => ({ status: 0 }));
      expect(() =>
        runNeutralPreviewMigrationEntrypoint({ VERCEL_ENV: vercelEnv }, run),
      ).toThrow("restricted to Preview");
      expect(run).not.toHaveBeenCalled();
    },
  );

  test.each(NEUTRAL_RUNTIME_FEATURE_ACTIVATORS)(
    "fails closed when feature %s has its runtime-active value %s",
    (name, value) => {
      const run = jest.fn(() => ({ status: 0 }));
      expect(() =>
        runNeutralPreviewMigrationEntrypoint(
          { ...previewEnv(), [name]: value },
          run,
        ),
      ).toThrow("requires disabled features");
      expect(run).not.toHaveBeenCalled();
    },
  );

  test("guard registry covers every runtime neutral feature switch", () => {
    const runtimeRoots = ["app", "lib"];
    const sourceFiles: string[] = [];
    const visit = (entry: string) => {
      for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
        const childPath = path.join(entry, child.name);
        if (child.isDirectory()) visit(childPath);
        else if (/\.(?:ts|tsx)$/.test(child.name)) sourceFiles.push(childPath);
      }
    };
    runtimeRoots.forEach(visit);

    const discovered = new Set<string>();
    for (const file of sourceFiles) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /OT_NEUTRAL_[A-Z0-9_]+(?:ENABLED|ACTIVE)/g,
      )) {
        discovered.add(match[0]);
      }
    }

    expect([...discovered].sort()).toEqual(
      NEUTRAL_RUNTIME_FEATURE_ACTIVATORS.map(([name]) => name).sort(),
    );
  });

  test("stops after a failed migration", () => {
    const commands: MigrationCommand[] = [];
    const run: MigrationCommandRunner = (command) => {
      commands.push(command);
      return { status: commands.length === 1 ? 0 : 1 };
    };
    expect(() =>
      runNeutralPreviewMigrationEntrypoint(previewEnv(), run),
    ).toThrow("Prisma migrate deploy failed");
    expect(commands).toEqual([
      PRE_MIGRATION_COMMAND,
      PRISMA_MIGRATE_DEPLOY_COMMAND,
    ]);
  });
});

describe("Slice 1 operator ledger flags block the migration entrypoint (T-12)", () => {
  const { runNeutralPreviewMigrationEntrypoint: run } =
    require("@/lib/fulfillment/neutral-preview-migration-entrypoint") as typeof import("@/lib/fulfillment/neutral-preview-migration-entrypoint");

  test.each([
    "OT_NEUTRAL_OPERATOR_QUEUE_ENABLED",
    "OT_NEUTRAL_OPERATOR_READ_ENABLED",
    "OT_NEUTRAL_MANUAL_DELIVERY_ENABLED",
  ])("refuses to migrate while %s is true", (flag) => {
    const runner = jest.fn(() => ({ status: 0 }));
    expect(() =>
      run({ VERCEL_ENV: "preview", [flag]: "true" }, runner),
    ).toThrow(/requires disabled features/);
    expect(runner).not.toHaveBeenCalled();
  });
});
