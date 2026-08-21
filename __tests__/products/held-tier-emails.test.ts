/** @jest-environment node */

/**
 * Transactional email is a consumer surface.
 *
 * The T3 order-confirmation branch promised "an authorization form to sign
 * before we file" — BL-A1 ("we file"), BL-A3 ("sign the authorization") and
 * BL-A4 ("on your behalf") in a single sentence, delivered to a paying
 * customer's inbox where no disclaimer on the site can reach it.
 *
 * The route into T3 is closed, so today nothing calls this with tier "T3". That
 * is exactly why the assertion belongs here rather than at the route: the
 * template survives the route, and an email helper that will happily render a
 * held product's fulfilment promise is a fail-open boundary waiting for the
 * next caller. It fails closed instead — no send, no label, no promise.
 */

type ResendPayload = { subject: string; text: string; html: string }
const send = jest.fn(async (_payload: ResendPayload) => true)
jest.mock("@/lib/email/resend", () => ({
  __esModule: true,
  FROM_EMAIL: "test@example.com",
  resend: { emails: { send } },
}))

// Imported lazily: a hoisted `import` would require lib/email/send — and so
// run the mock factory — before `send` above is initialised.
const loadSend = () =>
  require("@/lib/email/send") as typeof import("@/lib/email/send")

beforeEach(() => jest.clearAllMocks())

describe("held tiers in transactional email", () => {
  it("sends no order confirmation for the held Done-For-You tier", async () => {
    const sent = await loadSend().sendOrderConfirmation({
      tier: "T3",
      customerEmail: "buyer@example.com",
      customerName: "Buyer",
      amountPaid: 97,
    })

    expect(sent).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it("sends no ops order alert for the held Done-For-You tier", async () => {
    const sent = await loadSend().sendNewOrderAlert({
      tier: "T3",
      customerEmail: "buyer@example.com",
      amountPaid: 97,
      sessionId: "cs_test_1",
    })

    expect(sent).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it("still confirms the one offered tier, and promises only preparation", async () => {
    const sent = await loadSend().sendOrderConfirmation({
      tier: "T2",
      customerEmail: "buyer@example.com",
      customerName: "Buyer",
      amountPaid: 69,
    })

    expect(sent).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)

    const payload = send.mock.calls[0][0]
    const body = `${payload.subject}\n${payload.text}\n${payload.html}`

    expect(body).toMatch(/DIY Appeal Packet/)
    expect(body).not.toMatch(/Done-For-You/i)
    expect(body).not.toMatch(/authorization form/i)
    expect(body).not.toMatch(/before we file/i)
    expect(body).not.toMatch(/on your behalf/i)
  })
})
