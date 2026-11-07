/**
 * @jest-environment node
 *
 * The free check's own per-parcel rule. The proration cases are the combinations
 * the county publishes: `card_proration_rate` is `COALESCE(external_propct, 0)/100`
 * and `tieback_proration_rate` is 1.0 when no tie-back percent exists, so 1.0 / 0.0
 * is the unprorated pattern. See docs/ops/ot-free-check-proration-semantics-20261106.md.
 */
import {
  FREE_EXCLUSION_REASONS,
  classifyFreeParcel,
  type FreeParcelInput,
} from "@/lib/fulfillment-runtime/free-eligibility"
import { parcelJoinRefusal } from "@/lib/fulfillment-runtime/t2-county-gateway"

const pin = "14000000000001"
const universe = { pin, year: "2026", class: "203", township_code: "70", township_name: "Lake", nbhd_code: "12" }
const characteristics = {
  pin,
  year: "2026",
  card: "1",
  class: "203",
  township_code: "70",
  pin_num_cards: "1.0",
  pin_is_multiland: false,
  pin_num_landlines: "1.0",
  tieback_proration_rate: "1.0",
  card_proration_rate: "0.0",
  char_bldg_sf: "1200.0",
  char_yrblt: "1950",
  char_type_resd: "1 Story",
}
const assessed = { pin, year: "2026", class: "203", township_code: "70", nbhd: "12", mailed_tot: "30000", mailed_land: "5000", mailed_bldg: "25000" }
const address = { pin, year: "2026", prop_address_full: "1 TEST ST", prop_address_city_name: "CHICAGO", prop_address_state: "IL" }
const base: FreeParcelInput = { universe, characteristics: [characteristics], assessed, address }
const chars = (change: Record<string, unknown>) => ({ ...base, characteristics: [{ ...characteristics, ...change }] })

describe("classifyFreeParcel", () => {
  it("accepts the county's published unprorated pattern, which the paid rule refuses", () => {
    expect(classifyFreeParcel(base)).toMatchObject({
      kind: "eligible",
      attributes: { pin, propertyClass: "203", residentialSubtype: "1 Story", buildingSqft: 1200, yearBuilt: 1950 },
      assessedValue: 30000,
      address: "1 TEST ST",
      city: "CHICAGO",
    })
    expect(
      parcelJoinRefusal(pin, { characteristics: [characteristics], assessed: [assessed], address: [address] }, "203", { neighborhoodCode: "12", townshipCode: "70" }),
    ).toBe("CANDIDATE_CHARACTERISTICS_AMBIGUOUS")
  })

  it.each([
    ["a whole card percent", { card_proration_rate: "1.0" }],
    ["a tie-back key naming the parcel itself", { tieback_key_pin: pin }],
  ])("accepts %s", (_name, change) => {
    expect(classifyFreeParcel(chars(change)).kind).toBe("eligible")
  })

  it.each<[string, Record<string, unknown>]>([
    ["a share of the building on both rates", { tieback_proration_rate: "0.5", card_proration_rate: "0.5" }],
    ["a card share alone", { card_proration_rate: "0.5" }],
    ["a tie-back share with the card default", { tieback_proration_rate: "0.5" }],
    ["a zero tie-back rate, which is a stored percent and not the default", { tieback_proration_rate: "0.0" }],
    ["a rate above one", { card_proration_rate: "1.5" }],
    ["a blank tie-back rate, which the view never produces", { tieback_proration_rate: null }],
    ["a blank card rate, which the view never produces", { card_proration_rate: "" }],
    ["unparseable rate text", { card_proration_rate: "n/a" }],
    ["a tie-back key naming another parcel", { tieback_key_pin: "14000000000099" }],
  ])("excludes %s as prorated", (_name, change) => {
    expect(classifyFreeParcel(chars(change))).toMatchObject({ kind: "excluded", reason: "prorated_or_tied_back" })
  })

  it.each<[string, FreeParcelInput, string]>([
    ["no improvement row (vacant style)", { ...base, characteristics: [] }, "no_characteristics_record"],
    ["two cards", { ...base, characteristics: [characteristics, { ...characteristics, card: "2" }] }, "multi_card"],
    ["one row that says two cards", chars({ pin_num_cards: "2.0" }), "multi_card"],
    ["no card count", chars({ pin_num_cards: null }), "multi_card"],
    ["a multi-land marker", chars({ pin_is_multiland: true }), "multi_land"],
    ["two landlines", chars({ pin_num_landlines: "2.0" }), "multi_land"],
    ["no landline count", chars({ pin_num_landlines: null }), "multi_land"],
    ["no multi-land marker", chars({ pin_is_multiland: null }), "multi_land"],
    ["a class disagreement with the universe", chars({ class: "204" }), "class_conflict"],
    ["a class disagreement on the assessed row", { ...base, assessed: { ...assessed, class: "204" } }, "class_conflict"],
    ["zero building area", chars({ char_bldg_sf: "0" }), "invalid_characteristics"],
    ["a future year built", chars({ char_yrblt: "2027" }), "invalid_characteristics"],
    ["no residence type", chars({ char_type_resd: null }), "invalid_characteristics"],
    ["no mailed figures at all", { ...base, assessed: { ...assessed, mailed_tot: null, mailed_land: null, mailed_bldg: null } }, "no_mailed_value"],
    ["a zero mailed total", { ...base, assessed: { ...assessed, mailed_tot: "0", mailed_land: "0", mailed_bldg: "0" } }, "no_mailed_value"],
    ["no street", { ...base, address: { ...address, prop_address_full: null } }, "incomplete_address"],
    ["no city", { ...base, address: { ...address, prop_address_city_name: null } }, "incomplete_address"],
    ["no state", { ...base, address: { ...address, prop_address_state: null } }, "incomplete_address"],
    ["another state", { ...base, address: { ...address, prop_address_state: "IN" } }, "incomplete_address"],
  ])("excludes %s", (_name, input, reason) => {
    const out = classifyFreeParcel(input)
    expect(out).toMatchObject({ kind: "excluded", reason })
    expect(FREE_EXCLUSION_REASONS).toContain(reason)
  })

  it.each<[string, FreeParcelInput, string]>([
    ["a mailed total that is not land plus building", { ...base, assessed: { ...assessed, mailed_land: "1" } }, "FREE_MAILED_INTEGRITY_CONFLICT"],
    ["a partly published mailed record", { ...base, assessed: { ...assessed, mailed_tot: null } }, "FREE_MAILED_INTEGRITY_CONFLICT"],
    ["a mailed figure that is not a number", { ...base, assessed: { ...assessed, mailed_tot: "abc" } }, "FREE_MAILED_INTEGRITY_CONFLICT"],
    ["a negative mailed figure", { ...base, assessed: { ...assessed, mailed_land: "-5000", mailed_bldg: "35000" } }, "FREE_MAILED_INTEGRITY_CONFLICT"],
    ["characteristics from another township", chars({ township_code: "71" }), "FREE_LOCALITY_CONFLICT"],
    ["an assessed row from another township", { ...base, assessed: { ...assessed, township_code: "71" } }, "FREE_LOCALITY_CONFLICT"],
    ["an assessed row from another neighborhood", { ...base, assessed: { ...assessed, nbhd: "13" } }, "FREE_LOCALITY_CONFLICT"],
  ])("treats %s as a source conflict, never a quiet exclusion", (_name, input, blocker) => {
    expect(classifyFreeParcel(input)).toEqual({ kind: "conflict", blocker })
  })

  it("reports the conflict even on a parcel another rule would have excluded", () => {
    expect(classifyFreeParcel({ ...base, characteristics: [], assessed: { ...assessed, mailed_land: "1" } })).toEqual({
      kind: "conflict",
      blocker: "FREE_MAILED_INTEGRITY_CONFLICT",
    })
  })

  it("does not read the size of the assessed value when it decides", () => {
    const low = classifyFreeParcel({ ...base, assessed: { ...assessed, mailed_tot: "6000", mailed_land: "5000", mailed_bldg: "1000" } })
    const high = classifyFreeParcel({ ...base, assessed: { ...assessed, mailed_tot: "900000", mailed_land: "5000", mailed_bldg: "895000" } })
    expect(low.kind).toBe("eligible")
    expect(high.kind).toBe("eligible")
  })
})
