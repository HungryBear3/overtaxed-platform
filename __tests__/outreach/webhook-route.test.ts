/** @jest-environment node */
/** Route safety: require webhook secret outside dev/test and reject bad signatures. */

const ingestResendEvent = jest.fn()
const extractProviderEventId = jest.fn(() => "evt_1")
const getOutreachWebhookSecret = jest.fn()
const shouldRequireOutreachWebhookSecret = jest.fn()
const verifyResendSignature = jest.fn()

jest.mock("@/lib/outreach/webhooks", () => ({
  extractProviderEventId: (...args: unknown[]) => extractProviderEventId(...args),
  ingestResendEvent: (...args: unknown[]) => ingestResendEvent(...args),
  getOutreachWebhookSecret: () => getOutreachWebhookSecret(),
  shouldRequireOutreachWebhookSecret: () => shouldRequireOutreachWebhookSecret(),
  verifyResendSignature: (...args: unknown[]) => verifyResendSignature(...args),
}))

import { POST } from "@/app/api/outreach/webhooks/resend/route"

beforeEach(() => {
  jest.clearAllMocks()
  getOutreachWebhookSecret.mockReturnValue("secret")
  shouldRequireOutreachWebhookSecret.mockReturnValue(true)
  verifyResendSignature.mockReturnValue(true)
  ingestResendEvent.mockResolvedValue({
    duplicate: false,
    suppressed: false,
    campaignHalted: false,
  })
})

describe("POST /api/outreach/webhooks/resend", () => {
  it("returns 503 when secret is required but missing", async () => {
    getOutreachWebhookSecret.mockReturnValue(null)
    shouldRequireOutreachWebhookSecret.mockReturnValue(true)

    const res = await POST(
      new Request("https://example.com/api/outreach/webhooks/resend", {
        method: "POST",
        body: JSON.stringify({ type: "email.delivered", data: {} }),
      }),
    )

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "Webhook not configured" })
    expect(verifyResendSignature).not.toHaveBeenCalled()
    expect(ingestResendEvent).not.toHaveBeenCalled()
  })

  it("allows missing secret only when route says it is not required", async () => {
    getOutreachWebhookSecret.mockReturnValue(null)
    shouldRequireOutreachWebhookSecret.mockReturnValue(false)

    const body = JSON.stringify({ type: "email.delivered", data: {} })
    const res = await POST(
      new Request("https://example.com/api/outreach/webhooks/resend", {
        method: "POST",
        body,
      }),
    )

    expect(res.status).toBe(200)
    expect(verifyResendSignature).toHaveBeenCalledWith(
      body,
      {
        "resend-signature": null,
        "svix-id": null,
        "svix-signature": null,
        "svix-timestamp": null,
        "webhook-id": null,
        "webhook-signature": null,
        "webhook-timestamp": null,
      },
      null,
    )
    expect(ingestResendEvent).toHaveBeenCalledWith({
      providerEventId: "evt_1",
      event: { type: "email.delivered", data: {} },
    })
  })

  it("returns 401 on invalid signature", async () => {
    verifyResendSignature.mockReturnValue(false)

    const res = await POST(
      new Request("https://example.com/api/outreach/webhooks/resend", {
        method: "POST",
        headers: { "resend-signature": "bad" },
        body: JSON.stringify({ type: "email.delivered", data: {} }),
      }),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Invalid signature" })
    expect(ingestResendEvent).not.toHaveBeenCalled()
  })
})
