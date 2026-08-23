/**
 * @jest-environment node
 *
 * Address-to-PIN resolution for the free check.
 *
 * Every PIN, parcel and homeowner input in this file is synthetic. One public,
 * non-residential Loop street address — 100 W Randolph St — is reproduced
 * verbatim, because the county record shape it carries is the exact one the
 * corroboration block at the bottom has to pin down.
 *
 * Against the released parent (`1f2d7aae`) none of this existed: the flow
 * normalized whitespace, dropped the ZIP, and handed the remainder to a single
 * `like '%…%'` substring query whose first row won. The cases below are the ones
 * that produced "No Cook County property found for this address" for addresses
 * that are on file, and the ones that resolved a forty-parcel building to
 * whichever row the dataset happened to return first.
 */
import {
  parseFreeCheckAddress,
  parseCountyRecordAddress,
  rankAddressCandidates,
  resolveAddressCandidates,
  recordCorroboratesAddress,
  normalizeFreeCheckSearchInput,
  type AddressCandidateRecord,
} from "@/lib/free-check-address"

const pinAt = (n: number) => `1806214${String(n).padStart(3, "0")}0000`

function record(over: Partial<AddressCandidateRecord> & { pin: string }): AddressCandidateRecord {
  return { address: "1234 N SAMPLE ST", city: "Chicago", zip: "60600", ...over }
}

describe("parseFreeCheckAddress", () => {
  it("splits a fully spelled-out address into county-shaped parts", () => {
    const parsed = parseFreeCheckAddress("1234 North Sample Street, Chicago, IL 60600")
    expect(parsed.houseNumber).toBe("1234")
    expect(parsed.directional).toBe("N")
    expect(parsed.streetName).toBe("SAMPLE")
    expect(parsed.suffix).toBe("ST")
    expect(parsed.city).toBe("Chicago")
    expect(parsed.zip).toBe("60600")
    expect(parsed.street).toBe("1234 N SAMPLE ST")
  })

  it("normalizes punctuation and abbreviation variants onto the same parse", () => {
    const variants = [
      "1234 N. Sample St.",
      "1234 North Sample Street",
      "1234 n sample str",
      "  1234   N  Sample   ST  ",
    ]
    for (const variant of variants) {
      expect(parseFreeCheckAddress(variant).street).toBe("1234 N SAMPLE ST")
    }
  })

  it("keeps a unit designator out of the street line and out of the house number", () => {
    for (const input of ["1234 N Sample St Apt 3B", "1234 N Sample St #3B", "1234 N Sample St Unit 3b"]) {
      const parsed = parseFreeCheckAddress(input)
      expect(parsed.unit).toBe("3B")
      expect(parsed.houseNumber).toBe("1234")
      expect(parsed.street).toBe("1234 N SAMPLE ST")
    }
  })

  it("drops the Assessor's HSE house marker without treating it as a unit", () => {
    const parsed = parseFreeCheckAddress("1234 N Sample St HSE, Chicago IL 60600")
    expect(parsed.street).toBe("1234 N SAMPLE ST")
    expect(parsed.unit).toBeNull()
  })

  it("folds an ordinal street name onto its bare number", () => {
    expect(parseFreeCheckAddress("1234 W 53rd St").streetName).toBe("53")
    expect(parseFreeCheckAddress("1234 W 53 St").streetName).toBe("53")
  })

  it("reads a post-directional without overwriting a leading one", () => {
    expect(parseFreeCheckAddress("1234 Sample St NW").street).toBe("1234 NW SAMPLE ST")
    expect(parseFreeCheckAddress("1234 NW Sample St").street).toBe("1234 NW SAMPLE ST")
    expect(parseFreeCheckAddress("1234 Sample St NW").directional).toBe("NW")
    expect(parseFreeCheckAddress("1234 Sample St NW").streetName).toBe("SAMPLE")
    expect(parseFreeCheckAddress("1234 Sample St NW").suffix).toBe("ST")
  })

  it("reports the complete parsed identity for directional, unit, display, and fragments", () => {
    const parsed = parseFreeCheckAddress("1234 Sample St NW Apt 3B, Chicago IL 60600")
    expect(parsed.houseNumber).toBe("1234")
    expect(parsed.directional).toBe("NW")
    expect(parsed.streetName).toBe("SAMPLE")
    expect(parsed.suffix).toBe("ST")
    expect(parsed.unit).toBe("3B")
    expect(parsed.streetDisplay).toBe("1234 Sample St NW")
    expect(parsed.queryFragments).toEqual(["1234 NW SAMPLE ST", "1234 NW SAMPLE", "1234%SAMPLE"])
  })

  it("widens the query fragments from exact to house-number-plus-name", () => {
    const parsed = parseFreeCheckAddress("1234 N Sample St")
    expect(parsed.queryFragments).toEqual(["1234 N SAMPLE ST", "1234 N SAMPLE", "1234%SAMPLE"])
  })

  it("emits no fragment carrying a quote or other query metacharacter", () => {
    const parsed = parseFreeCheckAddress("1234 O'Sample St'; DROP TABLE--")
    for (const fragment of parsed.queryFragments) {
      expect(fragment).toMatch(/^[A-Z0-9 %]+$/)
    }
  })

  it("leaves the legacy normalizer's contract and casing intact", () => {
    expect(normalizeFreeCheckSearchInput("100 W Randolph St, Chicago IL 60601", "")).toEqual({
      address: "100 W Randolph St",
      city: "Chicago",
    })
  })
})

describe("rankAddressCandidates", () => {
  const parsed = parseFreeCheckAddress("1234 N Sample St, Chicago IL 60600")

  it("rejects a different house number the substring query let through", () => {
    const ranked = rankAddressCandidates(parsed, [
      record({ pin: pinAt(1), address: "51234 N SAMPLE ST" }),
      record({ pin: pinAt(2), address: "1234 N SAMPLE ST" }),
    ])
    expect(ranked.map((c) => c.pin)).toEqual([pinAt(2)])
  })

  it("rejects a conflicting directional and a conflicting suffix", () => {
    const ranked = rankAddressCandidates(parsed, [
      record({ pin: pinAt(3), address: "1234 S SAMPLE ST" }),
      record({ pin: pinAt(4), address: "1234 N SAMPLE AVE" }),
    ])
    expect(ranked).toHaveLength(0)
  })

  it("accepts a record whose directional the user omitted", () => {
    const noDirectional = parseFreeCheckAddress("1234 Sample St, Chicago")
    const ranked = rankAddressCandidates(noDirectional, [record({ pin: pinAt(5) })])
    expect(ranked.map((c) => c.pin)).toEqual([pinAt(5)])
  })

  it("scores a city and ZIP agreement above a city disagreement", () => {
    const ranked = rankAddressCandidates(parsed, [
      record({ pin: pinAt(6), city: "Evanston", zip: "60201" }),
      record({ pin: pinAt(7), city: "Chicago", zip: "60600" }),
    ])
    expect(ranked[0].pin).toBe(pinAt(7))
    expect(ranked[0].matchedOn).toEqual(expect.arrayContaining(["city", "zip", "directional", "suffix"]))
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it("orders identically regardless of the order the dataset returned rows in", () => {
    const rows = [
      record({ pin: pinAt(8), city: "Evanston" }),
      record({ pin: pinAt(9) }),
      record({ pin: pinAt(10) }),
    ]
    const forward = rankAddressCandidates(parsed, rows).map((c) => c.pin)
    const reverse = rankAddressCandidates(parsed, [...rows].reverse()).map((c) => c.pin)
    expect(forward).toEqual(reverse)
  })

  it("drops a duplicate PIN and a malformed PIN", () => {
    const ranked = rankAddressCandidates(parsed, [
      record({ pin: pinAt(11) }),
      record({ pin: pinAt(11) }),
      record({ pin: "12345" }),
    ])
    expect(ranked).toHaveLength(1)
  })
})

describe("resolveAddressCandidates", () => {
  const parsed = parseFreeCheckAddress("1234 N Sample St, Chicago IL 60600")

  it("resolves a single surviving candidate automatically", () => {
    const resolution = resolveAddressCandidates(parsed, [record({ pin: pinAt(20) })])
    expect(resolution.kind).toBe("unique")
  })

  it("never silently collapses a unit-less multi-parcel building", () => {
    const building = Array.from({ length: 12 }, (_, i) => record({ pin: pinAt(30 + i) }))
    const resolution = resolveAddressCandidates(parsed, building)
    expect(resolution.kind).toBe("ambiguous")
    if (resolution.kind !== "ambiguous") throw new Error("unreachable")
    expect(resolution.total).toBe(12)
    expect(resolution.candidates).toHaveLength(8)
  })

  it("never auto-selects between united parcels when the input omitted a unit", () => {
    const resolution = resolveAddressCandidates(parsed, [
      record({ pin: pinAt(40), address: "1234 N SAMPLE ST APT 3B", city: "Chicago", zip: "60600" }),
      record({ pin: pinAt(41), address: "1234 N SAMPLE ST APT 4A", city: "Evanston", zip: "60201" }),
    ])
    expect(resolution.kind).toBe("ambiguous")
  })

  it("does not let a stray city or ZIP score break a same-building tie", () => {
    const resolution = resolveAddressCandidates(parsed, [
      record({ pin: pinAt(50), zip: "60600" }),
      record({ pin: pinAt(51), zip: "" }),
    ])
    expect(resolution.kind).toBe("ambiguous")
  })

  it("resolves when the user named the unit that separates the parcels", () => {
    const withUnit = parseFreeCheckAddress("1234 N Sample St Apt 3B, Chicago IL 60600")
    const resolution = resolveAddressCandidates(withUnit, [
      record({ pin: pinAt(60), address: "1234 N SAMPLE ST APT 3B" }),
      record({ pin: pinAt(61), address: "1234 N SAMPLE ST APT 4A" }),
      record({ pin: pinAt(62), address: "1234 N SAMPLE ST APT 5C" }),
    ])
    expect(resolution.kind).toBe("unique")
    if (resolution.kind !== "unique") throw new Error("unreachable")
    expect(resolution.candidate.pin).toBe(pinAt(60))
  })

  it("stays ambiguous when the named unit itself matches more than one parcel", () => {
    const withUnit = parseFreeCheckAddress("1234 N Sample St Unit 2, Chicago")
    const resolution = resolveAddressCandidates(withUnit, [
      record({ pin: pinAt(70), address: "1234 N SAMPLE ST UNIT 2" }),
      record({ pin: pinAt(71), address: "1234 N SAMPLE ST UNIT 2" }),
    ])
    expect(resolution.kind).toBe("ambiguous")
  })

  it("resolves a strict score winner across genuinely different localities", () => {
    const resolution = resolveAddressCandidates(parsed, [
      record({ pin: pinAt(80), city: "Chicago", zip: "60600" }),
      record({ pin: pinAt(81), address: "1234 N SAMPLE ST APT 9", city: "Evanston", zip: "60201" }),
    ])
    expect(resolution.kind).toBe("unique")
    if (resolution.kind !== "unique") throw new Error("unreachable")
    expect(resolution.candidate.pin).toBe(pinAt(80))
  })

  it("reports no match rather than a guess when nothing survives", () => {
    expect(resolveAddressCandidates(parsed, [record({ pin: pinAt(90), address: "77 OTHER RD" })]))
      .toEqual({ kind: "none" })
  })
})

describe("recordCorroboratesAddress", () => {
  const parsed = parseFreeCheckAddress("1234 N Sample St, Chicago")
  const selected = {
    pin: pinAt(95),
    houseNumber: "1234",
    directional: "N",
    streetName: "SAMPLE",
    suffix: "ST",
    unit: "3B",
  }

  it("accepts the record the candidate promised", () => {
    expect(recordCorroboratesAddress(parsed, selected, pinAt(95), "1234 N SAMPLE ST APT 3B", "Chicago")).toBe(true)
  })

  it("accepts the same single-family parcel when the archived address adds HSE", () => {
    const singleFamily = { ...selected, unit: null }
    expect(recordCorroboratesAddress(parsed, singleFamily, pinAt(95), "1234 N SAMPLE ST HSE", "Chicago")).toBe(true)
  })

  it("refuses a record the second lookup returned for a different parcel", () => {
    expect(recordCorroboratesAddress(parsed, selected, pinAt(95), "9876 S OTHER AVE", "Chicago")).toBe(false)
  })

  it("refuses a record whose unit disagrees with the selected candidate", () => {
    expect(recordCorroboratesAddress(parsed, selected, pinAt(95), "1234 N SAMPLE ST APT 4A", "Chicago")).toBe(false)
  })

  it("refuses a record whose returned pin breaks the selected lineage", () => {
    expect(recordCorroboratesAddress(parsed, selected, pinAt(96), "1234 N SAMPLE ST APT 3B", "Chicago")).toBe(false)
  })

  it("fails closed on an empty or unparseable record address", () => {
    expect(recordCorroboratesAddress(parsed, selected, pinAt(95), "", "")).toBe(false)
    expect(recordCorroboratesAddress(parsed, selected, pinAt(95), "   ", "Chicago")).toBe(false)
  })
})

describe("parseCountyRecordAddress", () => {
  it("reads the bare terminal condo unit the archived Parcel Universe appends", () => {
    const record = parseCountyRecordAddress("100 W RANDOLPH ST C23", "Chicago")
    expect(record.unit).toBe("C23")
    expect(record.houseNumber).toBe("100")
    expect(record.directional).toBe("W")
    expect(record.streetName).toBe("RANDOLPH")
    expect(record.suffix).toBe("ST")
    expect(record.street).toBe("100 W RANDOLPH ST")
  })

  it("reads an all-digit bare terminal unit the same way", () => {
    expect(parseCountyRecordAddress("100 W RANDOLPH ST 2701").unit).toBe("2701")
    expect(parseCountyRecordAddress("100 W RANDOLPH ST 2701").streetName).toBe("RANDOLPH")
  })

  it("leaves a legitimate trailing street-name token in the street name", () => {
    const leftAlone = [
      // Real Chicago street names whose final token sits after a suffix word.
      "13200 S AVENUE O",
      "13200 N AVENUE L",
      // Digits, but no street name of its own in front of the suffix.
      "1234 W HIGHWAY 20",
      // A name of its own in front of the suffix, but no digit in the terminal.
      "1234 N PARK PLACE TOWER",
      // No suffix at all: what would be left is a truncated street name.
      "1234 N SAMPLE C23",
      // Nothing terminal to claim.
      "1234 N SAMPLE ST",
    ]
    for (const address of leftAlone) {
      expect([address, parseCountyRecordAddress(address).unit]).toEqual([address, null])
    }
  })

  it("keeps HSE a non-unit county marker", () => {
    const record = parseCountyRecordAddress("1234 N SAMPLE ST HSE")
    expect(record.unit).toBeNull()
    expect(record.street).toBe("1234 N SAMPLE ST")
  })

  it("leaves a designated unit exactly where the generic parser put it", () => {
    const record = parseCountyRecordAddress("1234 N SAMPLE ST APT 3B")
    expect(record.unit).toBe("3B")
    expect(record.streetName).toBe("SAMPLE")
    expect(record.suffix).toBe("ST")
  })

  it("does not widen the parser homeowner input goes through", () => {
    expect(parseFreeCheckAddress("100 W RANDOLPH ST C23").unit).toBeNull()
    expect(parseFreeCheckAddress("100 W RANDOLPH ST C23").streetName).toBe("RANDOLPH ST C23")
  })
})

describe("recordCorroboratesAddress — bare terminal condo unit on the county record", () => {
  // The current PIN Address Index carries this parcel with no unit; the
  // archived Parcel Universe carries the same PIN as "… ST C23". At fc8ea95
  // that disagreement rejected six of the eight parcels the Preview offered.
  const parsed = parseFreeCheckAddress("100 W Randolph St, Chicago IL 60601")
  const offered = {
    pin: pinAt(1),
    houseNumber: "100",
    directional: "W",
    streetName: "RANDOLPH",
    suffix: "ST",
    unit: null,
  }

  it("corroborates the offered PIN when only a bare terminal unit differs", () => {
    expect(recordCorroboratesAddress(parsed, offered, pinAt(1), "100 W RANDOLPH ST C23", "Chicago")).toBe(true)
  })

  it("still requires the record to carry the selected PIN", () => {
    expect(recordCorroboratesAddress(parsed, offered, pinAt(2), "100 W RANDOLPH ST C23", "Chicago")).toBe(false)
    expect(recordCorroboratesAddress(parsed, offered, "123", "100 W RANDOLPH ST C23", "Chicago")).toBe(false)
  })

  it("still requires house number, directional and suffix to agree", () => {
    for (const address of [
      "200 W RANDOLPH ST C23",
      "100 E RANDOLPH ST C23",
      "100 W RANDOLPH AVE C23",
      "100 W OTHER ST C23",
    ]) {
      expect([address, recordCorroboratesAddress(parsed, offered, pinAt(1), address, "Chicago")])
        .toEqual([address, false])
    }
  })

  it("refuses a record whose bare terminal unit contradicts a typed unit", () => {
    const typedOtherUnit = parseFreeCheckAddress("100 W Randolph St Unit C24, Chicago IL 60601")
    expect(recordCorroboratesAddress(typedOtherUnit, offered, pinAt(1), "100 W RANDOLPH ST C23", "Chicago")).toBe(false)
  })

  it("accepts a record whose bare terminal unit is the unit that was typed", () => {
    const typedSameUnit = parseFreeCheckAddress("100 W Randolph St Unit C23, Chicago IL 60601")
    expect(recordCorroboratesAddress(typedSameUnit, offered, pinAt(1), "100 W RANDOLPH ST C23", "Chicago")).toBe(true)
  })

  it("refuses a record whose bare terminal unit contradicts the selected candidate unit", () => {
    const offeredWithUnit = { ...offered, unit: "C24" }
    expect(recordCorroboratesAddress(parsed, offeredWithUnit, pinAt(1), "100 W RANDOLPH ST C23", "Chicago")).toBe(false)
  })

  it("does not rescue a record whose trailing token is street identity", () => {
    const avenueO = parseFreeCheckAddress("13200 S Avenue O, Chicago")
    const truncated = {
      pin: pinAt(1),
      houseNumber: "13200",
      directional: "S",
      streetName: "AVENUE",
      suffix: null,
      unit: null,
    }
    expect(recordCorroboratesAddress(avenueO, truncated, pinAt(1), "13200 S AVENUE O", "Chicago")).toBe(false)
  })
})
