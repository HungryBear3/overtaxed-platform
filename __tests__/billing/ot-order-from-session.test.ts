import { otOrderFromPaidSession } from "@/lib/billing/ot-order-from-session"

const paidSession = {
  id: "cs_live_example",
  livemode: true,
  status: "complete",
  payment_status: "paid",
  amount_total: 6900,
  metadata: {
    tier: "T2",
    customerName: "Rory OBrien",
    customerAddress: "2834 W Henderson Chicago IL 60618 United States",
    propertyPin: "",
  },
  customer_details: {
    email: "RORY@example.com",
    name: "Rory OBrien",
    phone: null,
  },
}

describe("otOrderFromPaidSession", () => {
  it("maps a paid live Checkout Session into an OTOrder", () => {
    expect(otOrderFromPaidSession(paidSession)).toEqual({
      stripeSessionId: "cs_live_example",
      tier: "T2",
      email: "rory@example.com",
      name: "Rory OBrien",
      phone: null,
      propertyAddress: "2834 W Henderson Chicago IL 60618 United States",
      propertyPin: null,
      amountPaid: 69,
      status: "PAID",
    })
  })

  it.each([
    [{ ...paidSession, livemode: false }, "live"],
    [{ ...paidSession, payment_status: "unpaid" }, "complete, paid"],
    [{ ...paidSession, metadata: { tier: "UNKNOWN" } }, "supported OT tier"],
  ])("rejects unsafe recovery input", (session, message) => {
    expect(() => otOrderFromPaidSession(session)).toThrow(message)
  })
})
