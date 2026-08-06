/**
 * @jest-environment node
 *
 * Matrix row 11: invalid SHA, byte size, provider id, timestamps, or reason codes
 * all fail closed.
 */
import {
  isValidArtifactSha256,
  isValidByteSize,
  isValidProviderMessageId,
  isValidProviderEventId,
  isValidProviderName,
  isValidReasonCode,
  validateTimestampChain,
  MAX_ARTIFACT_BYTES,
} from "@/lib/fulfillment/validation"

describe("isValidArtifactSha256 — lowercase 64-hex only", () => {
  it("accepts a lowercase 64-hex digest", () => {
    expect(isValidArtifactSha256("a".repeat(64))).toBe(true)
    expect(isValidArtifactSha256("0123456789abcdef".repeat(4))).toBe(true)
  })
  it("rejects uppercase, wrong length, non-hex and non-strings", () => {
    expect(isValidArtifactSha256("A".repeat(64))).toBe(false)
    expect(isValidArtifactSha256("a".repeat(63))).toBe(false)
    expect(isValidArtifactSha256("a".repeat(65))).toBe(false)
    expect(isValidArtifactSha256("g".repeat(64))).toBe(false)
    expect(isValidArtifactSha256(123 as unknown as string)).toBe(false)
    expect(isValidArtifactSha256("")).toBe(false)
  })
})

describe("isValidByteSize — positive bounded integer", () => {
  it("accepts a positive integer within the bound", () => {
    expect(isValidByteSize(1)).toBe(true)
    expect(isValidByteSize(MAX_ARTIFACT_BYTES)).toBe(true)
  })
  it("rejects zero, negatives, floats, NaN, over-bound and non-numbers", () => {
    expect(isValidByteSize(0)).toBe(false)
    expect(isValidByteSize(-1)).toBe(false)
    expect(isValidByteSize(1.5)).toBe(false)
    expect(isValidByteSize(Number.NaN)).toBe(false)
    expect(isValidByteSize(MAX_ARTIFACT_BYTES + 1)).toBe(false)
    expect(isValidByteSize("100" as unknown as number)).toBe(false)
  })
})

describe("isValidProviderMessageId / isValidProviderEventId — bounded opaque token", () => {
  it("accepts a bounded opaque id", () => {
    expect(isValidProviderMessageId("re_12345abcDEF")).toBe(true)
    expect(isValidProviderEventId("evt_ext_998")).toBe(true)
  })
  it("rejects empty, whitespace-only, newline-bearing, over-long and non-strings", () => {
    expect(isValidProviderMessageId("")).toBe(false)
    expect(isValidProviderMessageId("   ")).toBe(false)
    expect(isValidProviderMessageId("has\nnewline")).toBe(false)
    expect(isValidProviderMessageId("x".repeat(256))).toBe(false)
    expect(isValidProviderMessageId(null as unknown as string)).toBe(false)
    expect(isValidProviderEventId("")).toBe(false)
  })
})

describe("isValidProviderName — bounded, single-line, delimiter-free", () => {
  it("accepts a normal provider name", () => {
    expect(isValidProviderName("resend")).toBe(true)
    expect(isValidProviderName("postmark-eu")).toBe(true)
  })
  it("rejects empty, whitespace, over-long and non-strings", () => {
    expect(isValidProviderName("")).toBe(false)
    expect(isValidProviderName("  ")).toBe(false)
    expect(isValidProviderName("has space")).toBe(false)
    expect(isValidProviderName("x".repeat(65))).toBe(false)
    expect(isValidProviderName(null as unknown as string)).toBe(false)
  })
})

describe("isValidReasonCode — bounded non-PII allowlist", () => {
  it("accepts codes on the allowlist", () => {
    expect(isValidReasonCode("HARD_BOUNCE")).toBe(true)
    expect(isValidReasonCode("SPAM_COMPLAINT")).toBe(true)
    expect(isValidReasonCode("INCOMPLETE_INPUT")).toBe(true)
  })
  it("rejects unknown / free-form / lowercase strings (fail closed)", () => {
    expect(isValidReasonCode("user bob@example.com bounced")).toBe(false)
    expect(isValidReasonCode("hard_bounce")).toBe(false)
    expect(isValidReasonCode("WHATEVER")).toBe(false)
    expect(isValidReasonCode("")).toBe(false)
  })
})

describe("validateTimestampChain — monotonic and valid", () => {
  it("accepts a well-ordered chain", () => {
    expect(
      validateTimestampChain({
        createdAt: "2026-08-06T10:00:00.000Z",
        requestedAt: "2026-08-06T10:01:00.000Z",
        providerAcceptedAt: "2026-08-06T10:02:00.000Z",
        deliveredAt: "2026-08-06T10:03:00.000Z",
      })
    ).toBeNull()
  })
  it("rejects an out-of-order chain (delivered before accepted)", () => {
    expect(
      validateTimestampChain({
        createdAt: "2026-08-06T10:00:00.000Z",
        providerAcceptedAt: "2026-08-06T10:03:00.000Z",
        deliveredAt: "2026-08-06T10:02:00.000Z",
      })
    ).not.toBeNull()
  })
  it("rejects an unparseable timestamp", () => {
    expect(validateTimestampChain({ createdAt: "not-a-date" })).not.toBeNull()
  })
})
