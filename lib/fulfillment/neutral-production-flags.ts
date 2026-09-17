import { NEUTRAL_RUNTIME_FEATURE_ACTIVATORS } from "./neutral-preview-migration-entrypoint";

/**
 * Every environment variable whose exact value would ACTIVATE neutral-report or
 * T2 delivery behaviour, paired with the value that does it.
 *
 * The neutral set is imported rather than re-listed: it already exists as the
 * Preview migration entrypoint's refusal list, and a second copy would be a
 * second thing to keep in step. The T2 set is added here because the Production
 * baseline materializes the T2 delivery-evidence tables too, and a migration is
 * not allowed to land into an environment that is one deploy away from using
 * them.
 *
 * Nothing in this file turns anything on. There is no enabling path.
 */
export const NEUTRAL_PRODUCTION_FEATURE_ACTIVATORS: ReadonlyArray<
  readonly [string, string]
> = [
  ...NEUTRAL_RUNTIME_FEATURE_ACTIVATORS,
  ["OT_T2_FULFILLMENT_EVIDENCE_ENABLED", "true"],
  ["OT_T2_EVIDENCE_CONSOLE_ENABLED", "true"],
  ["OT_T2_MANUAL_REVIEW_CONTROL_ENABLED", "true"],
  ["OT_T2_ARTIFACT_BINDING_ENABLED", "true"],
  ["OT_T2_ARTIFACT_ORCHESTRATION_ENABLED", "true"],
  ["OT_T2_PACKET_DOWNLOAD_ENABLED", "true"],
  ["OT_T2_DELIVERY_ENABLED", "true"],
  ["OT_T2_DELIVERY_ADAPTER_ENABLED", "true"],
  ["OT_T2_DELIVERY_CALLBACK_ENABLED", "true"],
  ["OT_T2_DELIVERY_RECOVERY_ENABLED", "true"],
];

export const NEUTRAL_PRODUCTION_FEATURE_FLAG_NAMES =
  NEUTRAL_PRODUCTION_FEATURE_ACTIVATORS.map(([name]) => name);

/** The first flag observed in its activating state, or `null`. */
export function findActiveNeutralFeatureFlag(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const active = NEUTRAL_PRODUCTION_FEATURE_ACTIVATORS.find(
    ([name, activeValue]) => env[name] === activeValue,
  );
  return active ? active[0] : null;
}

/**
 * Schema and activation are separate reviewed steps, in that order. A baseline
 * that landed while a flag was already on would make the two one step.
 */
export function assertNeutralFeatureFlagsOff(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const active = findActiveNeutralFeatureFlag(env);
  if (active)
    throw new Error(
      `Neutral feature flag ${active} is active; the Production baseline requires every neutral feature off`,
    );
}
