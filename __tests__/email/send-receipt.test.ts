/** @jest-environment node */

/**
 * Structured-receipt seam on lib/email/send.ts.
 *
 * The seam must (a) surface the provider message id and a bounded non-PII
 * error class, and (b) leave every existing boolean caller's behavior exactly
 * as it was — sendEmail / sendOrderConfirmation keep their signatures.
 */

const resendSendMock = jest.fn()

jest.mock("@/lib/email/resend", () => ({
  resend: { emails: { send: (...args: unknown[]) => resendSendMock(...args) } },
  FROM_EMAIL: "noreply@overtaxed-il.com",
}))

jest.mock("@/lib/products/held", () => ({
  isHeldProduct: (id: string) => id === "T3_DFY",
}))

import {
  sendEmail,
  sendEmailWithReceipt,
  sendOrderConfirmation,
  sendOrderConfirmationWithReceipt,
} from "@/lib/email/send"

const baseEmail = {
  to: "buyer@example.com",
  subject: "s",
  text: "t",
  html: "<p>t</p>",
}

const baseOrder = {
  tier: "T2",
  customerEmail: "buyer@example.com",
  customerName: "Buyer",
  amountPaid: 69,
}

beforeEach(() => {
  jest.clearAllMocks()
  resendSendMock.mockResolvedValue({ data: { id: "re_abc123" }, error: null })
})

describe("sendEmailWithReceipt", () => {
  it("returns the provider message id on success", async () => {
    await expect(sendEmailWithReceipt(baseEmail)).resolves.toEqual({
      ok: true,
      providerMessageId: "re_abc123",
    })
  })

  it("returns a bounded PROVIDER_ERROR class when the provider reports an error", async () => {
    resendSendMock.mockResolvedValue({ data: null, error: { message: "boom buyer@example.com" } })
    await expect(sendEmailWithReceipt(baseEmail)).resolves.toEqual({
      ok: false,
      errorClass: "PROVIDER_ERROR",
    })
  })

  it("returns a bounded SEND_EXCEPTION class when the provider throws", async () => {
    resendSendMock.mockRejectedValue(new Error("socket hang up"))
    await expect(sendEmailWithReceipt(baseEmail)).resolves.toEqual({
      ok: false,
      errorClass: "SEND_EXCEPTION",
    })
  })
})

describe("existing boolean callers are preserved", () => {
  it("sendEmail still resolves true on success", async () => {
    await expect(sendEmail(baseEmail)).resolves.toBe(true)
    expect(resendSendMock).toHaveBeenCalledTimes(1)
  })

  it("sendEmail still resolves false on provider error", async () => {
    resendSendMock.mockResolvedValue({ data: null, error: { message: "boom" } })
    await expect(sendEmail(baseEmail)).resolves.toBe(false)
  })

  it("sendOrderConfirmation still resolves a boolean and sends to the customer", async () => {
    await expect(sendOrderConfirmation(baseOrder)).resolves.toBe(true)
    const payload = resendSendMock.mock.calls[0][0] as { to: string }
    expect(payload.to).toBe("buyer@example.com")
  })
})

describe("sendOrderConfirmationWithReceipt", () => {
  it("returns the provider message id for a normal tier", async () => {
    await expect(sendOrderConfirmationWithReceipt(baseOrder)).resolves.toEqual({
      ok: true,
      providerMessageId: "re_abc123",
    })
  })

  it("refuses held tiers with a bounded class and never calls the provider", async () => {
    await expect(sendOrderConfirmationWithReceipt({ ...baseOrder, tier: "T3" })).resolves.toEqual({
      ok: false,
      errorClass: "HELD_TIER_REFUSED",
    })
    expect(resendSendMock).not.toHaveBeenCalled()
  })
})
