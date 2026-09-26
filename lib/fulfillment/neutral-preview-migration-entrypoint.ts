export type MigrationCommand = {
  command: string;
  args: readonly string[];
};

export type MigrationCommandResult = {
  status: number | null;
  error?: Error;
};

export type MigrationCommandRunner = (
  command: MigrationCommand,
) => MigrationCommandResult;

export type PreviewMigrationEnvironment = Record<string, string | undefined>;

export const PRE_MIGRATION_COMMAND: MigrationCommand = {
  command: "npm",
  args: ["run", "neutral-report:pre-migration-identity-preflight"],
};

export const PRISMA_MIGRATE_DEPLOY_COMMAND: MigrationCommand = {
  command: "npx",
  args: ["prisma", "migrate", "deploy"],
};

export const NEUTRAL_RUNTIME_FEATURE_ACTIVATORS = [
  ["OT_NEUTRAL_REPORT_CHECKOUT_ENABLED", "true"],
  ["OT_NEUTRAL_REPORT_PRODUCTION_ENABLED", "true"],
  ["OT_NEUTRAL_REPORT_RECOVERY_ENABLED", "true"],
  ["OT_NEUTRAL_QA_ENABLED", "true"],
  ["OT_NEUTRAL_DELIVERY_ENABLED", "true"],
  ["OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED", "true"],
  ["OT_NEUTRAL_REFUND_QUEUE_ENABLED", "true"],
  ["OT_NEUTRAL_REFUND_VERIFICATION_ENABLED", "true"],
  ["OT_NEUTRAL_CUSTOMER_ZIP_STORAGE_ENABLED", "true"],
  ["OT_NEUTRAL_CUSTOMER_ZIP_PROMOTION_ENABLED", "true"],
  ["OT_NEUTRAL_CHECKOUT_RECONCILIATION_ENABLED", "1"],
  ["OT_NEUTRAL_REPORT_ACTIVE", "1"],
  // Slice 1 operator ledgers. Registered here so the migration entrypoint, the
  // Production baseline, and the rehearsal all refuse while any of them is on.
  ["OT_NEUTRAL_OPERATOR_QUEUE_ENABLED", "true"],
  ["OT_NEUTRAL_OPERATOR_READ_ENABLED", "true"],
  ["OT_NEUTRAL_MANUAL_DELIVERY_ENABLED", "true"],
] as const;

function succeeded(result: MigrationCommandResult): boolean {
  return !result.error && result.status === 0;
}

export function runNeutralPreviewMigrationEntrypoint(
  env: PreviewMigrationEnvironment,
  run: MigrationCommandRunner,
): void {
  if (env.VERCEL_ENV !== "preview") {
    throw new Error("Neutral migration entrypoint is restricted to Preview");
  }

  const enabledFlag = NEUTRAL_RUNTIME_FEATURE_ACTIVATORS.find(
    ([name, activeValue]) => env[name] === activeValue,
  );
  if (enabledFlag) {
    throw new Error("Neutral migration entrypoint requires disabled features");
  }

  const preflight = run(PRE_MIGRATION_COMMAND);
  if (!succeeded(preflight)) {
    throw new Error("PRE-MIGRATION identity proof failed");
  }

  const migration = run(PRISMA_MIGRATE_DEPLOY_COMMAND);
  if (!succeeded(migration)) {
    throw new Error("Prisma migrate deploy failed");
  }
}
