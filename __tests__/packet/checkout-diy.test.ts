/** @jest-environment node */

import { POST } from "@/app/api/billing/checkout-diy/route"

describe("POST /api/billing/checkout-diy", () => {
  it("fails closed and routes legacy callers into the filing-window intake", async () => {
    const res = await POST()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: "Property eligibility must be confirmed before checkout.",
      code: "CHECKOUT_INTAKE_REQUIRED",
      url: "/checkout?plan=diy",
    })
  })
})
