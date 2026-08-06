/**
 * @jest-environment node
 *
 * Matrix rows 12 & 13: the default-off feature flag must be OFF when the env var
 * is absent, false, or malformed, and reading it must never mutate anything.
 */
import {
  OT_T2_FULFILLMENT_EVIDENCE_FLAG,
  t2FulfillmentEvidenceWritesEnabled,
} from "@/lib/fulfillment/flag"

// The project augments NodeJS.ProcessEnv with required keys, so a synthetic env
// is built via unknown (matching the house pattern of injecting a partial env).
function mkEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as unknown as NodeJS.ProcessEnv
}

describe("OT T2 fulfillment-evidence feature flag", () => {
  it("names the env var with the OT house convention (default-off gate)", () => {
    expect(OT_T2_FULFILLMENT_EVIDENCE_FLAG).toBe("OT_T2_FULFILLMENT_EVIDENCE_ENABLED")
  })

  it("is OFF when the env var is absent", () => {
    expect(t2FulfillmentEvidenceWritesEnabled(mkEnv({}))).toBe(false)
  })

  it("is OFF for every non-exact-true value (malformed / unrecognized)", () => {
    for (const raw of ["false", "0", "1", "yes", "TRUE", "True", " true", "true ", "on", "enabled", ""]) {
      expect(t2FulfillmentEvidenceWritesEnabled(mkEnv({ [OT_T2_FULFILLMENT_EVIDENCE_FLAG]: raw }))).toBe(false)
    }
  })

  it("is ON only for the exact string \"true\"", () => {
    expect(t2FulfillmentEvidenceWritesEnabled(mkEnv({ [OT_T2_FULFILLMENT_EVIDENCE_FLAG]: "true" }))).toBe(true)
  })

  it("reading the flag does not mutate the passed env object", () => {
    const env = mkEnv({ [OT_T2_FULFILLMENT_EVIDENCE_FLAG]: "false" })
    const snapshot = JSON.stringify(env)
    t2FulfillmentEvidenceWritesEnabled(env)
    expect(JSON.stringify(env)).toBe(snapshot)
  })
})
