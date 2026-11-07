import { OFFICIAL_TAX_YEAR } from "@/lib/fulfillment-runtime/t2-county-gateway"
import type { ComparableMatchAttributes } from "@/lib/fulfillment/t2-comparables"

/**
 * Whether one parcel can stand in the free check's comparison, decided from what
 * the county published about it. Pure: no network, no clock.
 *
 * Free only. The paid report keeps `parcelJoinRefusal`, which this neither calls
 * nor loosens, because the free check answers a narrower question: which parcels
 * in the whole pool can be compared, with the rest counted, rather than whether
 * every parcel in the pool is fit to appear in a filed packet.
 *
 * Three outcomes, and the difference between the last two is the point of this
 * file. `excluded` means the record describes a parcel that cannot be compared:
 * it stays in the pool's accounting and out of the median. `conflict` means the
 * record contradicts itself or the read, so nothing from this read is trusted.
 *
 * Proration. `x54s-btds` is `default.vw_card_res_char`, which computes
 * `tieback_proration_rate` as `tiebldgpct / 100` else 1.0 and, from tax year 2024,
 * `card_proration_rate` as `COALESCE(external_propct, 0) / 100`. So 1.0 and 0.0 are
 * the view's defaults for "no percent recorded": 0.0 here is not a zero share. The
 * only rates read as whole are therefore tie-back 1 with card 0 or 1, and a blank
 * rate, which that view cannot produce, is unknown rather than whole. See
 * docs/ops/ot-free-check-proration-semantics-20261106.md.
 *
 * Value blindness. Assessed figures are read only to test that they exist and
 * reconcile. Nothing here compares their size to anything but zero.
 */

export const FREE_EXCLUSION_REASONS = [
  "no_characteristics_record",
  "multi_card",
  "multi_land",
  "prorated_or_tied_back",
  "class_conflict",
  "invalid_characteristics",
  "no_mailed_value",
  "incomplete_address",
] as const

export type FreeExclusionReason = (typeof FREE_EXCLUSION_REASONS)[number]

export type FreeConflictBlocker = "FREE_LOCALITY_CONFLICT" | "FREE_MAILED_INTEGRITY_CONFLICT"

type Row = Record<string, unknown>

export type FreeParcelInput = {
  universe: Row
  /** Every row the county published for the parcel. Vacant parcels have none. */
  characteristics: ReadonlyArray<Row>
  /** The published row. A row that is absent refuses the read before this runs. */
  assessed: Row
  /** The published row. A row that is absent refuses the read before this runs. */
  address: Row
}

export type FreeParcelClass =
  | {
      kind: "eligible"
      attributes: ComparableMatchAttributes
      assessedValue: number
      address: string
      city: string
    }
  | { kind: "excluded"; reason: FreeExclusionReason }
  | { kind: "conflict"; blocker: FreeConflictBlocker }

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : ""
const blank = (value: unknown): boolean => text(value) === "" && typeof value !== "boolean"

function decimal(value: unknown): number | null {
  const out = text(value)
  if (!/^-?\d+(?:\.\d+)?$/.test(out)) return null
  const parsed = Number(out)
  return Number.isFinite(parsed) ? parsed : null
}

function wholeNumber(value: unknown): number | null {
  const out = text(value)
  if (!/^-?\d+(?:\.0+)?$/.test(out)) return null
  const parsed = Number(out)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function explicitlyFalse(value: unknown): boolean {
  if (typeof value === "boolean") return !value
  return typeof value === "string" && ["false", "f", "0", "no"].includes(value.trim().toLowerCase())
}

/** Cents, so the sum is exact. Null for anything that is not a non-negative number. */
function mailedCents(value: unknown): number | null {
  const parsed = decimal(value)
  return parsed === null || parsed < 0 ? null : Math.round(parsed * 100)
}

function mailedConflict(assessed: Row): boolean {
  const fields = [assessed.mailed_tot, assessed.mailed_land, assessed.mailed_bldg]
  if (fields.every(blank)) return false
  const [total, land, building] = fields.map(mailedCents)
  return total === null || land === null || building === null || total !== land + building
}

function wholeBuilding(row: Row, pin: string): boolean {
  const tieback = text(row.tieback_key_pin).replace(/-/g, "")
  if (tieback !== "" && tieback !== pin) return false
  const pinRate = decimal(row.tieback_proration_rate)
  const cardRate = decimal(row.card_proration_rate)
  return pinRate === 1 && (cardRate === 0 || cardRate === 1)
}

export function classifyFreeParcel(input: FreeParcelInput): FreeParcelClass {
  const { universe, characteristics, assessed, address } = input
  const pin = text(universe.pin)
  const propertyClass = text(universe.class)
  const townshipCode = text(universe.township_code)
  const neighborhoodCode = text(universe.nbhd_code)

  // First, so a parcel that would also be excluded cannot hide a contradiction.
  if (characteristics.some((row) => text(row.township_code) !== townshipCode)) {
    return { kind: "conflict", blocker: "FREE_LOCALITY_CONFLICT" }
  }
  if (text(assessed.township_code) !== townshipCode || text(assessed.nbhd) !== neighborhoodCode) {
    return { kind: "conflict", blocker: "FREE_LOCALITY_CONFLICT" }
  }
  if (mailedConflict(assessed)) return { kind: "conflict", blocker: "FREE_MAILED_INTEGRITY_CONFLICT" }

  const excluded = (reason: FreeExclusionReason): FreeParcelClass => ({ kind: "excluded", reason })

  if (characteristics.length === 0) return excluded("no_characteristics_record")
  if (characteristics.length > 1) return excluded("multi_card")
  const row = characteristics[0]
  if (wholeNumber(row.pin_num_cards) !== 1) return excluded("multi_card")
  if (wholeNumber(row.pin_num_landlines) !== 1 || !explicitlyFalse(row.pin_is_multiland)) return excluded("multi_land")
  if (!wholeBuilding(row, pin)) return excluded("prorated_or_tied_back")
  if (text(row.class) !== propertyClass || text(assessed.class) !== propertyClass) {
    return excluded("class_conflict")
  }

  const buildingSqft = decimal(row.char_bldg_sf)
  const yearBuilt = wholeNumber(row.char_yrblt)
  const residentialSubtype = text(row.char_type_resd)
  if (
    buildingSqft === null ||
    buildingSqft <= 0 ||
    yearBuilt === null ||
    yearBuilt <= 1700 ||
    yearBuilt > OFFICIAL_TAX_YEAR ||
    typeof row.char_type_resd !== "string" ||
    residentialSubtype === ""
  ) {
    return excluded("invalid_characteristics")
  }

  const assessedValue = decimal(assessed.mailed_tot)
  if (assessedValue === null || assessedValue <= 0) return excluded("no_mailed_value")

  const street = text(address.prop_address_full)
  const city = text(address.prop_address_city_name)
  if (!street || !city || text(address.prop_address_state).toUpperCase() !== "IL") {
    return excluded("incomplete_address")
  }

  return {
    kind: "eligible",
    attributes: { pin, neighborhoodCode, propertyClass, residentialSubtype, buildingSqft, yearBuilt },
    assessedValue,
    address: street,
    city,
  }
}
