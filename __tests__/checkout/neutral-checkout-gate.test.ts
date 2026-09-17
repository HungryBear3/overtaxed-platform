import { evaluateNeutralCheckout } from "@/lib/commerce/neutral-checkout-gate"
import type { CheckoutWindowSnapshot } from "@/lib/checkout/window-gate-token"

const pin = "14000000000000"
const property = { pin, class: "203", year: "2026", pin_num_cards: "1", nbhd: "12", char_bldg_sf: "1200", char_yrblt: "1950", char_type_resd: "1 Story", mailed_tot: "30000" }
const snapshot: CheckoutWindowSnapshot = { pin, townshipKey: "lake", township: "Lake", stage: "assessor", status: "open", openDate: "2026-09-01", closeDate: "2026-09-24", sourceUrl: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines", retrievedAt: "2026-09-15T14:00:00.000Z", freshnessExpiresAt: "2026-09-15T16:00:00.000Z", pendingReason: null, allowCheckout: false, policyVersion: null }
const now = new Date("2026-09-15T15:00:00.000Z")

test("neutral commerce is exact-flag default-off and does not require strict policy", () => {
  expect(evaluateNeutralCheckout({ property, snapshot, now, env: {} })).toEqual({ allowed: false, blocker: "NEUTRAL_CHECKOUT_DISABLED" })
  expect(evaluateNeutralCheckout({ property, snapshot, now, env: { OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "1" } })).toEqual({ allowed: false, blocker: "NEUTRAL_CHECKOUT_DISABLED" })
  expect(evaluateNeutralCheckout({ property, snapshot, now, env: { OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true" } })).toEqual({ allowed: true, policyVersion: "ot-neutral-records-report/2026-09-15", pin })
})

test.each([
  [{ pin_num_cards: "2" }, "NEUTRAL_PROPERTY_UNSUPPORTED"],
  [{ class: "299" }, "NEUTRAL_PROPERTY_UNSUPPORTED"],
  [{ year: "2025" }, "NEUTRAL_OFFICIAL_FIELDS_INCOMPLETE"],
  [{ char_bldg_sf: null }, "NEUTRAL_OFFICIAL_FIELDS_INCOMPLETE"],
] as const)("fails closed for unsupported/incomplete official property %#", (patch, blocker) => {
  expect(evaluateNeutralCheckout({ property: { ...property, ...patch }, snapshot, now, env: { OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true" } })).toEqual({ allowed: false, blocker })
})

test("requires a fresh, open, matching Assessor window with three business days", () => {
  const env = { OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true" }
  expect(evaluateNeutralCheckout({ property, snapshot: { ...snapshot, status: "closed" }, now, env })).toEqual({ allowed: false, blocker: "NEUTRAL_WINDOW_UNVERIFIED" })
  expect(evaluateNeutralCheckout({ property, snapshot: { ...snapshot, pin: "14000000000001" }, now, env })).toEqual({ allowed: false, blocker: "NEUTRAL_WINDOW_UNVERIFIED" })
  expect(evaluateNeutralCheckout({ property, snapshot: { ...snapshot, closeDate: "2026-09-16" }, now, env })).toEqual({ allowed: false, blocker: "NEUTRAL_WINDOW_CLOSING_TOO_SOON" })
})
