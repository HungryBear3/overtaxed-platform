/** @jest-environment node */

/**
 * What may establish which township a homeowner is in.
 *
 * The branch resolved this from whatever was at hand: a neighborhood string on
 * the parcel API response, the slug in a /township/... marketing URL, a city
 * label, a free-text form selection. Each of those is a plausible guess and
 * none is proof — Cook County neighborhoods cross township lines, and a URL
 * says what page someone is reading, not where they live.
 *
 * A wrong township is a wrong deadline, and a wrong deadline is a homeowner who
 * files after their window shut. So these tests fix one rule: only an official
 * property record may establish eligibility, and every other path must fail
 * closed with a reason rather than return a township it inferred.
 */

import {
  RESOLUTION_SOURCE,
  normalizePin,
  townshipKeyFromName,
  resolveTownship,
  isEligibleIdentity,
  informationalTownship,
  type OfficialPropertyRecord,
} from "@/lib/deadlines/township-resolution"

const RESOLVED_AT = "2026-06-25T17:00:00.000Z"
const PIN = "10361040340000"

const record = (over: Partial<OfficialPropertyRecord> = {}): OfficialPropertyRecord => ({
  pin: PIN,
  township: "Rogers Park",
  address: "1234 W Example Ave, Chicago, IL 60626",
  ...over,
})

const lookup = (value: OfficialPropertyRecord | null) => jest.fn(async () => value)

describe("normalizePin", () => {
  it("accepts the county's formatting variants and reduces them to 14 digits", () => {
    for (const raw of [PIN, "10-36-104-034-0000", "10 36 104 034 0000", " 10-36-104-034-0000 "]) {
      expect(normalizePin(raw)).toBe(PIN)
    }
  })

  it("rejects anything that is not exactly 14 digits rather than padding it", () => {
    // A 10-digit PIN is a real thing a homeowner might type — the parcel number
    // without the sub-parcel suffix. Guessing the missing four digits would
    // resolve to a neighbour's parcel, so it is refused instead.
    for (const raw of ["1036104034", "103610403400001", "", "not a pin", "10-36-104-034-000A"]) {
      expect(normalizePin(raw)).toBeNull()
    }
  })
})

describe("townshipKeyFromName", () => {
  it("maps the county's printed names onto stable slugs", () => {
    expect(townshipKeyFromName("Rogers Park")).toBe("rogers-park")
    expect(townshipKeyFromName("  NORTH CHICAGO  ")).toBe("north-chicago")
    expect(townshipKeyFromName("Oak Park")).toBe("oak-park")
  })
})

describe("isEligibleIdentity", () => {
  it("admits a resolved record and refuses everything else", async () => {
    const resolved = await resolveTownship({
      pin: PIN,
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord: lookup(record()),
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    expect(isEligibleIdentity(resolved.resolution)).toBe(true)
    expect(isEligibleIdentity(informationalTownship("rogers-park", "Rogers Park"))).toBe(false)
    expect(isEligibleIdentity(null)).toBe(false)
    expect(isEligibleIdentity(undefined)).toBe(false)
  })

  it("does not admit an identity that merely claims the right source string", () => {
    // The guard reads the discriminant, so a hand-built object asserting the
    // official source does pass — which is why the only place that string is
    // ever written is inside resolveTownship, after the parity check.
    const forged = { townshipKey: "x", townshipName: "X", resolutionSource: "slug" } as never
    expect(isEligibleIdentity(forged)).toBe(false)
  })
})

describe("resolveTownship", () => {
  it("resolves a PIN through the official record and stamps the source", async () => {
    const lookupPropertyRecord = lookup(record())

    const result = await resolveTownship({
      pin: "10-36-104-034-0000",
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(lookupPropertyRecord).toHaveBeenCalledWith(PIN)
    expect(result.resolution).toMatchObject({
      inputKind: "pin",
      normalizedPin: PIN,
      townshipKey: "rogers-park",
      townshipName: "Rogers Park",
      resolutionSource: RESOLUTION_SOURCE,
      resolvedAt: RESOLVED_AT,
    })
  })

  it("resolves an address only by first turning it into a PIN", async () => {
    const lookupPinForAddress = jest.fn(async () => "10-36-104-034-0000")
    const lookupPropertyRecord = lookup(record())

    const result = await resolveTownship({
      address: "  1234 W Example Ave  ",
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord,
      lookupPinForAddress,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(lookupPinForAddress).toHaveBeenCalledWith("1234 W Example Ave")
    expect(lookupPropertyRecord).toHaveBeenCalledWith(PIN)
    expect(result.resolution.inputKind).toBe("address")
    expect(result.resolution.normalizedAddress).toBe("1234 W Example Ave")
    expect(result.resolution.resolutionSource).toBe(RESOLUTION_SOURCE)
  })

  it("carries no resolution source other than the official property record", async () => {
    // The type admits exactly one value, so this is a guard against someone
    // widening it later to re-admit slug or neighborhood inference.
    expect(RESOLUTION_SOURCE).toBe("official_property_record")

    const result = await resolveTownship({
      pin: PIN,
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord: lookup(record()),
    })

    expect(result.ok && result.resolution.resolutionSource).toBe("official_property_record")
  })

  it("fails closed when given neither a PIN nor an address", async () => {
    const lookupPropertyRecord = lookup(record())

    for (const input of [{}, { pin: "" }, { address: "   " }, { pin: null, address: null }]) {
      const result = await resolveTownship({
        ...input,
        resolvedAt: RESOLVED_AT,
        lookupPropertyRecord,
      })

      expect(result).toMatchObject({ ok: false, failure: { reason: "no_input" } })
    }

    expect(lookupPropertyRecord).not.toHaveBeenCalled()
  })

  it("fails closed on a malformed PIN without calling the county", async () => {
    const lookupPropertyRecord = lookup(record())

    const result = await resolveTownship({
      pin: "1036104034",
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord,
    })

    expect(result).toMatchObject({ ok: false, failure: { reason: "pin_invalid" } })
    expect(lookupPropertyRecord).not.toHaveBeenCalled()
  })

  it("fails closed on an address that no PIN lookup was supplied for", async () => {
    // An address with no geocoder is the shape the old free-check took: accept
    // the string, infer a township from the city or ZIP, proceed. There is no
    // inference path here, so it stops.
    const lookupPropertyRecord = lookup(record())

    const result = await resolveTownship({
      address: "1234 W Example Ave",
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord,
    })

    expect(result).toMatchObject({ ok: false, failure: { reason: "address_unresolved" } })
    expect(lookupPropertyRecord).not.toHaveBeenCalled()
  })

  it("fails closed when the address matches no parcel", async () => {
    const result = await resolveTownship({
      address: "999 Nowhere Rd",
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord: lookup(record()),
      lookupPinForAddress: jest.fn(async () => null),
    })

    expect(result).toMatchObject({ ok: false, failure: { reason: "address_unresolved" } })
  })

  it("fails closed when the record lookup returns nothing", async () => {
    const result = await resolveTownship({
      pin: PIN,
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord: lookup(null),
    })

    expect(result).toMatchObject({ ok: false, failure: { reason: "record_unavailable" } })
  })

  it("fails closed when the record carries no township", async () => {
    for (const township of [null, "", "   "]) {
      const result = await resolveTownship({
        pin: PIN,
        resolvedAt: RESOLVED_AT,
        lookupPropertyRecord: lookup(record({ township })),
      })

      expect(result).toMatchObject({
        ok: false,
        failure: { reason: "record_missing_township" },
      })
    }
  })

  it("fails closed when the record returned is for a different parcel", async () => {
    // A lookup that quietly falls back to a nearby or default parcel would
    // otherwise hand back someone else's township with full confidence, and it
    // would be indistinguishable downstream from a correct resolution.
    const result = await resolveTownship({
      pin: PIN,
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord: lookup(record({ pin: "17061040340000", township: "West Chicago" })),
    })

    expect(result).toMatchObject({ ok: false, failure: { reason: "pin_parity_mismatch" } })
  })

  it("accepts a parity match that is merely formatted differently", async () => {
    const result = await resolveTownship({
      pin: PIN,
      resolvedAt: RESOLVED_AT,
      lookupPropertyRecord: lookup(record({ pin: "10-36-104-034-0000" })),
    })

    expect(result.ok).toBe(true)
  })

  it("never carries a township on a failure", async () => {
    const failures = await Promise.all([
      resolveTownship({ resolvedAt: RESOLVED_AT, lookupPropertyRecord: lookup(record()) }),
      resolveTownship({
        pin: "bad",
        resolvedAt: RESOLVED_AT,
        lookupPropertyRecord: lookup(record()),
      }),
      resolveTownship({ pin: PIN, resolvedAt: RESOLVED_AT, lookupPropertyRecord: lookup(null) }),
      resolveTownship({
        pin: PIN,
        resolvedAt: RESOLVED_AT,
        lookupPropertyRecord: lookup(record({ pin: "17061040340000" })),
      }),
    ])

    for (const result of failures) {
      expect(result.ok).toBe(false)
      const json = JSON.stringify(result)
      expect(json).not.toContain("Rogers Park")
      expect(json).not.toContain("rogers-park")
      expect(json).not.toContain(RESOLUTION_SOURCE)
    }
  })
})

export {}
