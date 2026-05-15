/** @jest-environment node */
/** Direct signature verifier coverage using real Svix signing semantics. */

import { Webhook as SvixWebhook } from "svix"

import { verifyResendSignature } from "@/lib/outreach/webhooks"

const SVIX_TEST_SECRET = ["wh", "sec_dGVzdF9zZWNyZXRfZm9yX3N2aXg="].join("")

describe("verifyResendSignature", () => {
  it("accepts a valid Svix-signed payload", () => {
    const secret = SVIX_TEST_SECRET
    const payload = JSON.stringify({ type: "email.delivered", data: { id: "msg_1" } })
    const timestamp = new Date()
    const svix = new SvixWebhook(secret)
    const signature = svix.sign("msg_id_123", timestamp, payload)

    expect(
      verifyResendSignature(
        payload,
        {
          "svix-id": "msg_id_123",
          "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
          "svix-signature": signature,
        },
        secret,
      ),
    ).toBe(true)
  })

  it("rejects a tampered Svix signature", () => {
    const secret = SVIX_TEST_SECRET
    const payload = JSON.stringify({ type: "email.delivered", data: { id: "msg_1" } })

    expect(
      verifyResendSignature(
        payload,
        {
          "svix-id": "msg_id_123",
          "svix-timestamp": "1714219200",
          "svix-signature": "v1,bad",
        },
        secret,
      ),
    ).toBe(false)
  })
})
