import {
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

  test.each([
    ["OT_NEUTRAL_REPORT_CHECKOUT_ENABLED", "true"],
    ["OT_NEUTRAL_DELIVERY_ENABLED", "1"],
    ["OT_NEUTRAL_REFUND_QUEUE_ENABLED", "true"],
  ])("fails closed when feature %s is %s", (name, value) => {
    const run = jest.fn(() => ({ status: 0 }));
    expect(() =>
      runNeutralPreviewMigrationEntrypoint(
        { ...previewEnv(), [name]: value },
        run,
      ),
    ).toThrow("requires disabled features");
    expect(run).not.toHaveBeenCalled();
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
