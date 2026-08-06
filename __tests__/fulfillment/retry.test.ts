/**
 * @jest-environment node
 *
 * Matrix rows 7 & 8: a delivery retry reuses the current artifact and never
 * regenerates; a regeneration never creates or sends a delivery attempt.
 * Unresolved sends fail closed (duplicate-send caution).
 */
import { decideDeliverySend, decideRegeneration } from "@/lib/fulfillment/retry"

describe("decideDeliverySend — a retry never regenerates (row 7)", () => {
  it("permits an initial send from ARTIFACT_READY with regenerate:false", () => {
    const d = decideDeliverySend({ status: "ARTIFACT_READY", attemptCount: 0, maxAttempts: 3 })
    expect(d).toEqual({ send: true, attemptNumber: 1, regenerate: false })
  })

  it("permits a retry after a transient DELAYED, reusing the artifact (regenerate:false)", () => {
    const d = decideDeliverySend({ status: "DELAYED", attemptCount: 1, maxAttempts: 3 })
    expect(d).toEqual({ send: true, attemptNumber: 2, regenerate: false })
  })

  it("fails closed on an unresolved in-flight send (duplicate-send caution)", () => {
    expect(decideDeliverySend({ status: "DELIVERY_PENDING", attemptCount: 1, maxAttempts: 3 })).toEqual({
      send: false,
      reason: "UNRESOLVED_SEND",
    })
    expect(decideDeliverySend({ status: "PROVIDER_ACCEPTED", attemptCount: 1, maxAttempts: 3 })).toEqual({
      send: false,
      reason: "UNRESOLVED_SEND",
    })
  })

  it("never re-sends a delivered order", () => {
    expect(decideDeliverySend({ status: "DELIVERED", attemptCount: 1, maxAttempts: 3 })).toEqual({
      send: false,
      reason: "ALREADY_DELIVERED",
    })
  })

  it("never auto-retries terminal failure states", () => {
    for (const status of ["BOUNCED", "COMPLAINED", "CANCELLED", "FAILED", "INELIGIBLE"] as const) {
      const d = decideDeliverySend({ status, attemptCount: 1, maxAttempts: 3 })
      expect(d.send).toBe(false)
    }
  })

  it("stops at the attempt ceiling", () => {
    expect(decideDeliverySend({ status: "DELAYED", attemptCount: 3, maxAttempts: 3 })).toEqual({
      send: false,
      reason: "MAX_ATTEMPTS",
    })
  })

  it("fails closed on a malformed attempt ceiling rather than sending", () => {
    expect(decideDeliverySend({ status: "DELAYED", attemptCount: 0, maxAttempts: Number.NaN })).toEqual({
      send: false,
      reason: "MAX_ATTEMPTS",
    })
    expect(
      decideDeliverySend({ status: "DELAYED", attemptCount: 0, maxAttempts: undefined as unknown as number })
    ).toEqual({ send: false, reason: "MAX_ATTEMPTS" })
    expect(decideDeliverySend({ status: "DELAYED", attemptCount: 0, maxAttempts: 0 })).toEqual({
      send: false,
      reason: "MAX_ATTEMPTS",
    })
  })
})

describe("decideRegeneration — regeneration never sends (row 8)", () => {
  it("regenerates a missing artifact and never creates a delivery attempt", () => {
    const d = decideRegeneration({ status: "ARTIFACT_PENDING", hasArtifact: false, artifactValid: false, currentArtifactVersion: 0, explicitRequest: false })
    expect(d).toEqual({ regenerate: true, nextArtifactVersion: 1, createsDeliveryAttempt: false })
  })

  it("regenerates an invalid artifact to the next version", () => {
    const d = decideRegeneration({ status: "ARTIFACT_READY", hasArtifact: true, artifactValid: false, currentArtifactVersion: 2, explicitRequest: false })
    expect(d).toEqual({ regenerate: true, nextArtifactVersion: 3, createsDeliveryAttempt: false })
  })

  it("honors an explicit (modeled) admin regenerate request without sending", () => {
    const d = decideRegeneration({ status: "DELAYED", hasArtifact: true, artifactValid: true, currentArtifactVersion: 1, explicitRequest: true })
    expect(d).toEqual({ regenerate: true, nextArtifactVersion: 2, createsDeliveryAttempt: false })
  })

  it("does not regenerate a valid artifact with no request", () => {
    expect(
      decideRegeneration({ status: "ARTIFACT_READY", hasArtifact: true, artifactValid: true, currentArtifactVersion: 1, explicitRequest: false })
    ).toEqual({ regenerate: false, reason: "NOT_NEEDED" })
  })

  it("never regenerates into a terminal state", () => {
    for (const status of ["BOUNCED", "COMPLAINED", "CANCELLED", "FAILED", "INELIGIBLE"] as const) {
      const d = decideRegeneration({ status, hasArtifact: false, artifactValid: false, currentArtifactVersion: 0, explicitRequest: true })
      expect(d.regenerate).toBe(false)
    }
  })
})
