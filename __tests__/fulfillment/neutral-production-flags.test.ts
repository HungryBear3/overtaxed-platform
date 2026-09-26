import fs from "node:fs";
import path from "node:path";
import {
  NEUTRAL_PRODUCTION_FEATURE_ACTIVATORS,
  NEUTRAL_PRODUCTION_FEATURE_FLAG_NAMES,
  assertNeutralFeatureFlagsOff,
  findActiveNeutralFeatureFlag,
} from "@/lib/fulfillment/neutral-production-flags";
import { NEUTRAL_RUNTIME_FEATURE_ACTIVATORS } from "@/lib/fulfillment/neutral-preview-migration-entrypoint";

describe("neutral Production feature flags", () => {
  test("include every Preview neutral activator without restating it", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/fulfillment/neutral-production-flags.ts"),
      "utf8",
    );
    for (const [name] of NEUTRAL_RUNTIME_FEATURE_ACTIVATORS) {
      expect(NEUTRAL_PRODUCTION_FEATURE_FLAG_NAMES).toContain(name);
      expect(source).not.toContain(`"${name}"`);
    }
  });

  test("add the T2 delivery-evidence gates the baseline also materializes", () => {
    for (const name of [
      "OT_T2_FULFILLMENT_EVIDENCE_ENABLED",
      "OT_T2_PACKET_DOWNLOAD_ENABLED",
      "OT_T2_DELIVERY_CALLBACK_ENABLED",
      "OT_T2_DELIVERY_RECOVERY_ENABLED",
    ])
      expect(NEUTRAL_PRODUCTION_FEATURE_FLAG_NAMES).toContain(name);
  });

  test("list no flag twice", () => {
    expect(new Set(NEUTRAL_PRODUCTION_FEATURE_FLAG_NAMES).size).toBe(
      NEUTRAL_PRODUCTION_FEATURE_FLAG_NAMES.length,
    );
  });

  test("pass when every flag is absent", () => {
    expect(findActiveNeutralFeatureFlag({})).toBeNull();
    expect(() => assertNeutralFeatureFlagsOff({})).not.toThrow();
  });

  test("match only the exact activating value", () => {
    for (const [name, activeValue] of NEUTRAL_PRODUCTION_FEATURE_ACTIVATORS) {
      expect(findActiveNeutralFeatureFlag({ [name]: activeValue })).toBe(name);
      expect(findActiveNeutralFeatureFlag({ [name]: "false" })).toBeNull();
      expect(findActiveNeutralFeatureFlag({ [name]: `${activeValue} ` })).toBeNull();
      expect(findActiveNeutralFeatureFlag({ [name]: activeValue.toUpperCase() })).toBe(
        activeValue.toUpperCase() === activeValue ? name : null,
      );
    }
  });

  test("name the offending flag when refusing", () => {
    expect(() =>
      assertNeutralFeatureFlagsOff({ OT_NEUTRAL_REPORT_ACTIVE: "1" }),
    ).toThrow(/OT_NEUTRAL_REPORT_ACTIVE/);
  });

  test("expose no way to turn anything on", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/fulfillment/neutral-production-flags.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/process\.env\[[^\]]+\]\s*=/);
    expect(source).not.toMatch(/\benable\w*\s*\(/i);
  });
});

/**
 * T-12: the three Slice 1 flags are registered activators, so the migration
 * entrypoint, the Production baseline, and the rehearsal all refuse while any
 * of them is on — and all three are absent by default.
 */
describe("Slice 1 operator ledger flags", () => {
  const SLICE_1_FLAGS = [
    "OT_NEUTRAL_OPERATOR_QUEUE_ENABLED",
    "OT_NEUTRAL_OPERATOR_READ_ENABLED",
    "OT_NEUTRAL_MANUAL_DELIVERY_ENABLED",
  ] as const;

  test.each(SLICE_1_FLAGS)("%s is a registered runtime activator", (flag) => {
    expect(
      NEUTRAL_RUNTIME_FEATURE_ACTIVATORS.map(([name]) => name),
    ).toContain(flag);
    expect(NEUTRAL_PRODUCTION_FEATURE_FLAG_NAMES).toContain(flag);
  });

  test.each(SLICE_1_FLAGS)("%s activates only on the exact string true", (flag) => {
    expect(findActiveNeutralFeatureFlag({ [flag]: "true" })).toBe(flag);
    for (const value of ["1", "TRUE", "True", "true ", " true", "yes", ""])
      expect(findActiveNeutralFeatureFlag({ [flag]: value })).toBeNull();
  });

  test.each(SLICE_1_FLAGS)("assertNeutralFeatureFlagsOff throws on %s", (flag) => {
    expect(() => assertNeutralFeatureFlagsOff({ [flag]: "true" })).toThrow(flag);
  });

  test("all three are absent in this process", () => {
    for (const flag of SLICE_1_FLAGS) expect(process.env[flag]).toBeUndefined();
    expect(findActiveNeutralFeatureFlag(process.env)).toBeNull();
  });
});
