/** Token mint/verify: tamper-resistance + invalid-input handling. */

beforeAll(() => {
  process.env.OUTREACH_UNSUBSCRIBE_SECRET = "test-secret-xyz"
})

import {
  mintUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/outreach/unsubscribe"

describe("unsubscribe token", () => {
  it("mints an opaque token that verifies back to the same payload", () => {
    const token = mintUnsubscribeToken({
      email: "board@example.com",
      campaignId: "c_123",
    })
    expect(Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).not.toContain("board@example.com")
    const parsed = verifyUnsubscribeToken(token)
    expect(parsed).toEqual({ email: "board@example.com", campaignId: "c_123" })
  })

  it("verifies tokens with null campaignId", () => {
    const token = mintUnsubscribeToken({ email: "a@b.com", campaignId: null })
    const parsed = verifyUnsubscribeToken(token)
    expect(parsed).toEqual({ email: "a@b.com", campaignId: null })
  })

  it("rejects tampered tokens", () => {
    const token = mintUnsubscribeToken({ email: "a@b.com", campaignId: null })
    const tampered = token.slice(0, -2) + (token.slice(-2) === "AA" ? "BB" : "AA")
    expect(verifyUnsubscribeToken(tampered)).toBeNull()
  })

  it("rejects random garbage without throwing", () => {
    expect(verifyUnsubscribeToken("not-a-real-token")).toBeNull()
    expect(verifyUnsubscribeToken("")).toBeNull()
    expect(verifyUnsubscribeToken("###")).toBeNull()
  })

  it("rejects tokens signed under a different secret", () => {
    const originalSecret = process.env.OUTREACH_UNSUBSCRIBE_SECRET
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "secret-A"
    jest.resetModules()
    const modA = require("@/lib/outreach/unsubscribe") as typeof import("@/lib/outreach/unsubscribe")
    const token = modA.mintUnsubscribeToken({ email: "a@b.com", campaignId: null })

    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "secret-B"
    jest.resetModules()
    const modB = require("@/lib/outreach/unsubscribe") as typeof import("@/lib/outreach/unsubscribe")
    expect(modB.verifyUnsubscribeToken(token)).toBeNull()

    process.env.OUTREACH_UNSUBSCRIBE_SECRET = originalSecret
  })
})
