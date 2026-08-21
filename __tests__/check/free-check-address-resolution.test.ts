/**
 * @jest-environment node
 *
 * Address-to-PIN resolution for the free check.
 *
 * Every address in this file is synthetic. No real homeowner input, PIN or
 * parcel appears here or in any fixture it loads.
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

  it("folds an ordinal street name onto its bare number", () => {
    expect(parseFreeCheckAddress("1234 W 53rd St").streetName).toBe("53")
    expect(parseFreeCheckAddress("1234 W 53 St").streetName).toBe("53")
  })

  it("reads a post-directional without overwriting a leading one", () => {
    expect(parseFreeCheckAddress("1234 Sample St NW").directional).toBe("NW")
    expect(parseFreeCheckAddress("1234 N Sample St").directional).toBe("N")
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

  it("accepts the record the candidate promised", () => {
    expect(recordCorroboratesAddress(parsed, "1234 N SAMPLE ST", "Chicago")).toBe(true)
  })

  it("refuses a record the second lookup returned for a different parcel", () => {
    expect(recordCorroboratesAddress(parsed, "9876 S OTHER AVE", "Chicago")).toBe(false)
  })

  it("fails closed on an empty or unparseable record address", () => {
    expect(recordCorroboratesAddress(parsed, "", "")).toBe(false)
    expect(recordCorroboratesAddress(parsed, "   ", "Chicago")).toBe(false)
  })
})
