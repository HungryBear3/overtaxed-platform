import "server-only"

import { NEUTRAL_REPORT_COMMERCE_POLICY } from "@/lib/commerce/neutral-report-policy"
import type { CheckoutWindowSnapshot } from "@/lib/checkout/window-gate-token"
import { evaluateCheckoutBusinessDayCutoff } from "@/lib/checkout/business-days"
import { normalizePIN } from "@/lib/cook-county"

export const NEUTRAL_CHECKOUT_FLAG = "OT_NEUTRAL_REPORT_CHECKOUT_ENABLED"

export type NeutralCheckoutBlocker =
  | "NEUTRAL_CHECKOUT_DISABLED"
  | "NEUTRAL_POLICY_MISMATCH"
  | "NEUTRAL_PROPERTY_UNSUPPORTED"
  | "NEUTRAL_OFFICIAL_FIELDS_INCOMPLETE"
  | "NEUTRAL_WINDOW_UNVERIFIED"
  | "NEUTRAL_WINDOW_CLOSING_TOO_SOON"

export type NeutralCheckoutDecision =
  | { allowed: true; policyVersion: string; pin: string }
  | { allowed: false; blocker: NeutralCheckoutBlocker }

function first(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key]
  return null
}

/** Pure, narrow pre-payment admission. It never evaluates appeal merits. */
export function evaluateNeutralCheckout(input: {
  property: Record<string, unknown>
  snapshot: CheckoutWindowSnapshot
  now?: Date
  env?: Readonly<Record<string, string | undefined>>
}): NeutralCheckoutDecision {
  const env = input.env ?? process.env
  if (env[NEUTRAL_CHECKOUT_FLAG] !== "true") return { allowed: false, blocker: "NEUTRAL_CHECKOUT_DISABLED" }
  if (NEUTRAL_REPORT_COMMERCE_POLICY.strictQualificationAuthorized !== false ||
      NEUTRAL_REPORT_COMMERCE_POLICY.version !== "ot-neutral-records-report/2026-09-15")
    return { allowed: false, blocker: "NEUTRAL_POLICY_MISMATCH" }

  const pin = normalizePIN(String(first(input.property, ["pin"]) ?? ""))
  const propertyClass = String(first(input.property, ["class", "property_class", "propertyClass"]) ?? "").trim()
  const year = Number(first(input.property, ["year", "tax_year", "taxYear"]))
  const cards = Number(first(input.property, ["pin_num_cards", "pinNumCards", "card_count"]))
  if (!/^\d{14}$/.test(pin) || !/^2\d{2}$/.test(propertyClass) || propertyClass === "299" || cards !== 1)
    return { allowed: false, blocker: "NEUTRAL_PROPERTY_UNSUPPORTED" }

  const neighborhood = String(first(input.property, ["nbhd", "nbhd_code", "neighborhood_code"]) ?? "").trim()
  const sqft = Number(first(input.property, ["char_bldg_sf", "building_sqft", "buildingSqft"]))
  const yearBuilt = Number(first(input.property, ["char_yrblt", "year_built", "yearBuilt"]))
  const subtype = String(first(input.property, ["char_type_resd", "residential_subtype", "residentialSubtype"]) ?? "").trim()
  const assessed = Number(first(input.property, ["mailed_tot", "assessed_total_value", "assessedTotalValue"]))
  if (year !== 2026 || !neighborhood || !subtype || !Number.isFinite(sqft) || sqft <= 0 ||
      !Number.isSafeInteger(yearBuilt) || yearBuilt <= 1700 || yearBuilt > 2026 ||
      !Number.isFinite(assessed) || assessed <= 0)
    return { allowed: false, blocker: "NEUTRAL_OFFICIAL_FIELDS_INCOMPLETE" }

  const snapshot = input.snapshot
  const nowMs = (input.now ?? new Date()).getTime()
  const retrievedMs = Date.parse(snapshot.retrievedAt ?? "")
  const expiresMs = Date.parse(snapshot.freshnessExpiresAt ?? "")
  if (snapshot.pin !== pin || snapshot.status !== "open" || snapshot.stage !== "assessor" ||
      !snapshot.townshipKey || !snapshot.closeDate || !snapshot.sourceUrl || !snapshot.retrievedAt ||
      !snapshot.freshnessExpiresAt || !Number.isFinite(retrievedMs) || !Number.isFinite(expiresMs) ||
      new Date(retrievedMs).getUTCFullYear() !== 2026 || retrievedMs > nowMs || expiresMs < nowMs || expiresMs < retrievedMs)
    return { allowed: false, blocker: "NEUTRAL_WINDOW_UNVERIFIED" }

  if (!evaluateCheckoutBusinessDayCutoff({ closeDate: snapshot.closeDate, now: input.now ?? new Date() }).allowed)
    return { allowed: false, blocker: "NEUTRAL_WINDOW_CLOSING_TOO_SOON" }
  return { allowed: true, policyVersion: NEUTRAL_REPORT_COMMERCE_POLICY.version, pin }
}

export function authorizeNeutralSnapshot(snapshot: CheckoutWindowSnapshot): CheckoutWindowSnapshot {
  return { ...snapshot, allowCheckout: true, policyVersion: NEUTRAL_REPORT_COMMERCE_POLICY.version }
}
