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

  it("stops at the attempt ceiling", () => {
    expect(decideDeliverySend({ status: "DELAYED", attemptCount: 3, maxAttempts: 3 })).toEqual({
      send: false,
      reason: "MAX_ATTEMPTS",
    })
  })

  // ---- Remediation blocker E: malformed counters fail closed ----
  it.each([Number.NaN, -1, 1.5, undefined as unknown as number])(
    "malformed attemptCount %p returns send:false (never authorizes attempt 1)",
    (attemptCount) => {
      expect(decideDeliverySend({ status: "ARTIFACT_READY", attemptCount, maxAttempts: 3 })).toEqual({
        send: false,
        reason: "INVALID_ATTEMPT_COUNT",
      })
    }
  )

  it.each([Number.NaN, 0, -1, 1.5, undefined as unknown as number])(
    "malformed maxAttempts %p returns send:false",
    (maxAttempts) => {
      expect(decideDeliverySend({ status: "ARTIFACT_READY", attemptCount: 0, maxAttempts })).toEqual({
        send: false,
        reason: "INVALID_MAX_ATTEMPTS",
      })
    }
  )
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

  // ---- Remediation blocker F: fail-closed versioning + status allowlist ----
  it("does not silently regenerate from DELIVERED", () => {
    const d = decideRegeneration({ status: "DELIVERED", hasArtifact: true, artifactValid: true, currentArtifactVersion: 2, explicitRequest: true })
    expect(d).toEqual({ regenerate: false, reason: "STATUS_NOT_REGENERABLE" })
  })

  it("rejects mid-send / not-yet-started statuses", () => {
    for (const status of ["DELIVERY_PENDING", "PROVIDER_ACCEPTED", "NOT_STARTED"] as const) {
      expect(
        decideRegeneration({ status, hasArtifact: false, artifactValid: false, currentArtifactVersion: 0, explicitRequest: true }).regenerate
      ).toBe(false)
    }
  })

  it.each([Number.NaN, -1, 1.5])("malformed current version %p fails closed", (currentArtifactVersion) => {
    expect(
      decideRegeneration({ status: "ARTIFACT_READY", hasArtifact: true, artifactValid: false, currentArtifactVersion, explicitRequest: false })
    ).toEqual({ regenerate: false, reason: "INVALID_ARTIFACT_VERSION" })
  })

  it("rejects inconsistent artifact-presence/version combinations", () => {
    // hasArtifact but no positive version
    expect(
      decideRegeneration({ status: "ARTIFACT_READY", hasArtifact: true, artifactValid: false, currentArtifactVersion: 0, explicitRequest: true }).regenerate
    ).toBe(false)
    // no artifact but version claims > 0
    expect(
      decideRegeneration({ status: "ARTIFACT_PENDING", hasArtifact: false, artifactValid: false, currentArtifactVersion: 2, explicitRequest: true }).regenerate
    ).toBe(false)
  })

  it("regeneration issues strictly the next version, never an existing/lower one", () => {
    const d = decideRegeneration({ status: "ARTIFACT_READY", hasArtifact: true, artifactValid: false, currentArtifactVersion: 5, explicitRequest: false })
    expect(d).toEqual({ regenerate: true, nextArtifactVersion: 6, createsDeliveryAttempt: false })
  })
})
