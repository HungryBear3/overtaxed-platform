/**
 * The closed vocabulary for a checkout intent that did not reach Stripe.
 *
 * One checkout intent (components/ot-design/CheckoutPage) ends in exactly one
 * of two browser events: `begin_checkout`, when the server returned a hosted
 * checkout URL, or `checkout_blocked`, when it did not. Their sum is the number
 * of checkout attempts; `checkout_blocked` by reason is where they stopped.
 *
 * The reason is a lookup, never a copy. The server's `code` is used only as a
 * key into the table below (own keys only), and the HTTP status only to tell an
 * unavailable service from anything else. Neither is forwarded. The server's
 * `error` sentence, the gate's window and candidate list, and anything the
 * reader typed have no field to live in.
 *
 * Pure: no I/O, no framework.
 */

export const CHECKOUT_BLOCKED_REASONS = [
  "acknowledgment_required",
  "address_ambiguous",
  "property_not_found",
  "window_blocked",
  "notice_review_required",
  "invalid_input",
  "already_started",
  "rate_limited",
  "unavailable",
  "network_error",
  "unknown",
] as const
export type CheckoutBlockedReason = (typeof CHECKOUT_BLOCKED_REASONS)[number]

/** Server `code` → reason. A code missing here is `unknown`, never passed through. */
const REASON_FOR_CODE: Readonly<Record<string, CheckoutBlockedReason>> = Object.freeze({
  T2_ACKNOWLEDGMENT_REQUIRED: "acknowledgment_required",
  ADDRESS_AMBIGUOUS: "address_ambiguous",
  PROPERTY_SELECTION_INVALID: "address_ambiguous",
  PROPERTY_NOT_FOUND: "property_not_found",
  PROPERTY_LOOKUP_FAILED: "property_not_found",
  T3_WINDOW_BLOCKED: "window_blocked",
  CHECKOUT_ELIGIBILITY_CLOSED: "window_blocked",
  CHECKOUT_WINDOW_CLOSING_TOO_SOON: "window_blocked",
  NOTICE_REVIEW_REQUIRED: "notice_review_required",
  INVALID_CHECKOUT_INPUT: "invalid_input",
  CHECKOUT_BODY_TOO_LARGE: "invalid_input",
  INVALID_ATTRIBUTION_CODE: "invalid_input",
  CHECKOUT_TIER_UNAVAILABLE: "invalid_input",
  CHECKOUT_ALREADY_STARTED: "already_started",
  CHECKOUT_KEY_CONFLICT: "already_started",
  CHECKOUT_STATE_UNRESOLVED: "already_started",
  ORDER_ALREADY_PAID: "already_started",
  CHECKOUT_RATE_LIMITED: "rate_limited",
  CHECKOUT_NOT_CONFIGURED: "unavailable",
  CHECKOUT_PRICE_UNAVAILABLE: "unavailable",
  ATTRIBUTION_BINDING_UNAVAILABLE: "unavailable",
})

export function isCheckoutBlockedReason(value: unknown): value is CheckoutBlockedReason {
  return typeof value === "string" && (CHECKOUT_BLOCKED_REASONS as readonly string[]).includes(value)
}

/**
 * The reason for a refused checkout response. `code` and `status` are whatever
 * the response carried; only a known code or a 5xx status selects anything
 * other than `unknown`.
 */
export function checkoutBlockedReasonForResponse(code: unknown, status: unknown): CheckoutBlockedReason {
  if (typeof code === "string" && Object.prototype.hasOwnProperty.call(REASON_FOR_CODE, code)) {
    return REASON_FOR_CODE[code]
  }
  if (typeof status === "number" && Number.isInteger(status) && status >= 500 && status <= 599) return "unavailable"
  return "unknown"
}
