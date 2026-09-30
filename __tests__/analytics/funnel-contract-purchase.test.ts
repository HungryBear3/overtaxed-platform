/** @jest-environment node */

/**
 * The server purchase half of the decision-grade funnel contract.
 *
 * A purchase is written only by the signed webhook, after exact settlement and
 * the durable PAID transition, through the Measurement Protocol. Its payload is
 * closed: one purchase event, the anonymous GA identifiers the checkout
 * forwarded, the Stripe Checkout Session id as the deterministic transaction
 * id, and the tier. No customer, property, order or payment-intent field has a
 * place in it.
 */
import { validateServerPurchasePayload } from "@/lib/analytics/funnel-contract"

function payload(overrides: { top?: Record<string, unknown>; params?: Record<string, unknown>; item?: Record<string, unknown> } = {}) {
  const item = {
    item_name: "T2",
    item_category: "ot_checkout",
    item_variant: "T2",
    price: 69,
    quantity: 1,
    ...overrides.item,
  }
  return {
    client_id: "1234567890.1724102400",
    events: [
      {
        name: "purchase",
        params: {
          currency: "USD",
          value: 69,
          transaction_id: "cs_test_synthetic0000000001",
          item_name: "T2",
          item_category: "ot_checkout",
          item_variant: "T2",
          price: 69,
          quantity: 1,
          ga_session_id: 1724102400,
          ga_session_number: 4,
          items: [item],
          ...overrides.params,
        },
      },
    ],
    ...overrides.top,
  }
}

describe("server purchase payload contract", () => {
  it("accepts the closed Measurement Protocol purchase", () => {
    expect(validateServerPurchasePayload(payload())).toEqual({ ok: true })
  })

  it("accepts a purchase without the optional session fields", () => {
    const body = payload()
    const params = body.events[0].params as Record<string, unknown>
    delete params.ga_session_id
    delete params.ga_session_number

    expect(validateServerPurchasePayload(body)).toEqual({ ok: true })
  })

  it.each([
    ["a lowercase currency", { params: { currency: "usd" } }, "INVALID_VALUE:currency"],
    ["a non-USD currency", { params: { currency: "EUR" } }, "INVALID_VALUE:currency"],
    ["a payment intent as the transaction id", { params: { transaction_id: "pi_3Nabcdefghijklmn" } }, "INVALID_VALUE:transaction_id"],
    ["an order id as the transaction id", { params: { transaction_id: "ord_t2" } }, "INVALID_VALUE:transaction_id"],
    ["a transaction id carrying URL syntax", { params: { transaction_id: "cs_test_abc?x=1" } }, "INVALID_VALUE:transaction_id"],
    ["an email parameter", { params: { email: "buyer@example.com" } }, "UNKNOWN_PARAM:email"],
    ["a PIN parameter", { params: { property_pin: "13243140450000" } }, "UNKNOWN_PARAM:property_pin"],
    ["a page_location parameter", { params: { page_location: "https://www.overtaxed-il.com/checkout" } }, "UNKNOWN_PARAM:page_location"],
    ["an unknown tier", { params: { item_variant: "T9" } }, "INVALID_VALUE:item_variant"],
    ["a value that is not the item price", { params: { value: 70 } }, "INCONSISTENT_AMOUNT"],
    ["a fractional-cent value", { params: { value: 69.001, price: 69.001 }, item: { price: 69.001 } }, "INVALID_VALUE:value"],
    ["an implausible value", { params: { value: 20_000, price: 20_000 }, item: { price: 20_000 } }, "INVALID_VALUE:value"],
    ["a quantity other than one", { params: { quantity: 2 } }, "INVALID_VALUE:quantity"],
    ["an item carrying an extra field", { item: { item_id: "prod_t2" } }, "UNKNOWN_ITEM_PARAM:item_id"],
    ["an item that disagrees with the event", { item: { item_variant: "T3", item_name: "T3" } }, "INCONSISTENT_ITEM"],
    ["user data for matching", { top: { user_data: { sha256_email_address: "abc" } } }, "UNKNOWN_FIELD:user_data"],
    ["a user id", { top: { user_id: "user_1" } }, "UNKNOWN_FIELD:user_id"],
    ["user properties", { top: { user_properties: { township: { value: "Jefferson" } } } }, "UNKNOWN_FIELD:user_properties"],
    ["a malformed client id", { top: { client_id: "1.2" } }, "INVALID_VALUE:client_id"],
    ["a session id that is not an epoch-seconds start", { params: { ga_session_id: 724102400 } }, "INVALID_VALUE:ga_session_id"],
  ])("rejects %s", (_label, overrides, violation) => {
    const result = validateServerPurchasePayload(payload(overrides as never))

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.violations).toContain(violation)
  })

  /** An own, enumerable key — what JSON.parse produces for `"__proto__"` too. */
  function withOwnKey<T extends object>(target: T, key: string, value: unknown): T {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
    return target
  }

  it.each(["constructor", "__proto__", "toString"])("rejects a purchase or item parameter named after an inherited member: %s", (key) => {
    const atEvent = payload()
    withOwnKey(atEvent.events[0].params, key, "jane-doe-123-main-st")
    const atItem = payload()
    withOwnKey((atItem.events[0].params.items as object[])[0], key, "ord_t2")

    expect(validateServerPurchasePayload(atEvent)).toEqual({ ok: false, violations: [`UNKNOWN_PARAM:${key}`] })
    expect(validateServerPurchasePayload(atItem)).toEqual({ ok: false, violations: [`UNKNOWN_ITEM_PARAM:${key}`] })
  })

  it("rejects anything other than exactly one purchase event", () => {
    const two = payload()
    two.events.push(two.events[0])
    const renamed = payload()
    ;(renamed.events[0] as { name: string }).name = "refund"

    expect(validateServerPurchasePayload(two)).toEqual({ ok: false, violations: ["EVENT_COUNT"] })
    expect(validateServerPurchasePayload(renamed)).toEqual({ ok: false, violations: ["EVENT_NAME"] })
    expect(validateServerPurchasePayload(null)).toEqual({ ok: false, violations: ["NOT_AN_OBJECT"] })
  })
})
