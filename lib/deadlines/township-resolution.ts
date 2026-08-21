/**
 * Township identity, and what may establish it.
 *
 * A homeowner's filing deadline depends on which township their property is in.
 * The platform previously inferred that from whatever was to hand — a
 * neighborhood name returned by the parcel API, a marketing route slug, a city
 * label, a free-text selection on a form. Those are all plausible and none of
 * them is proof: Cook County neighborhoods cross township lines, and a
 * /township/rogers-park URL says what page a visitor is reading, not where they
 * live.
 *
 * The distinction matters because the wrong township produces the wrong
 * deadline, and the wrong deadline produces a homeowner who files after their
 * window closed. So eligibility — a countdown, a reminder, a CTA, a checkout —
 * may only be established by resolving to an official property record. A slug
 * may still choose which informational page to render.
 */

/** The one resolution path that may establish eligibility. */
export const RESOLUTION_SOURCE = "official_property_record" as const

export type TownshipResolution = {
  inputKind: "pin" | "address"
  /** 14-digit Cook County PIN, digits only. */
  normalizedPin: string
  normalizedAddress: string | null
  townshipKey: string
  townshipName: string
  resolutionSource: typeof RESOLUTION_SOURCE
  resolvedAt: string
}

/**
 * A township identified by the page being rendered rather than by a property
 * record — `/township/rogers-park` says Rogers Park.
 *
 * This is enough to decide which township's published calendar to *describe*.
 * It is not enough to tell a visitor when *their* appeal is due, because the
 * page they opened is not evidence of where they live. So this identity renders
 * dates and status and nothing else: no countdown, no reminder, no filing CTA,
 * no checkout. Those need [[resolveTownship]].
 */
export type InformationalTownship = {
  townshipKey: string
  townshipName: string
  resolutionSource: "page_slug"
}

export type TownshipIdentity = TownshipResolution | InformationalTownship

export function informationalTownship(
  townshipKey: string,
  townshipName: string,
): InformationalTownship {
  return { townshipKey, townshipName, resolutionSource: "page_slug" }
}

/** Whether this identity may establish eligibility, not merely describe a township. */
export function isEligibleIdentity(
  identity: TownshipIdentity | null | undefined,
): identity is TownshipResolution {
  return identity?.resolutionSource === RESOLUTION_SOURCE
}

export type TownshipResolutionFailure = {
  reason:
    | "no_input"
    | "pin_invalid"
    | "address_unresolved"
    | "record_unavailable"
    | "record_missing_township"
    | "pin_parity_mismatch"
}

export type TownshipResolutionResult =
  | { ok: true; resolution: TownshipResolution }
  | { ok: false; failure: TownshipResolutionFailure }

/**
 * An official property record, as returned by the county parcel lookup.
 *
 * `township` here is the township printed on the record. A neighborhood field,
 * if the upstream response carries one, is deliberately not part of this type:
 * making it unrepresentable is cheaper than remembering not to read it.
 */
export type OfficialPropertyRecord = {
  pin: string
  township: string | null
  address: string | null
}

export type PropertyRecordLookup = (pin: string) => Promise<OfficialPropertyRecord | null>
export type AddressToPinLookup = (address: string) => Promise<string | null>

/** Digits only, exactly 14 — Cook County's PIN format. */
export function normalizePin(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  return digits.length === 14 ? digits : null
}

export function townshipKeyFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Resolve a PIN or address to a township via the official property record.
 *
 * `resolvedAt` is injected rather than read from the clock so that callers —
 * and tests — evaluate freshness against a single instant. A resolution that
 * stamps itself is a resolution whose age cannot be reasoned about.
 */
export async function resolveTownship(input: {
  pin?: string | null
  address?: string | null
  resolvedAt: string
  lookupPropertyRecord: PropertyRecordLookup
  lookupPinForAddress?: AddressToPinLookup
}): Promise<TownshipResolutionResult> {
  const { pin, address, resolvedAt, lookupPropertyRecord, lookupPinForAddress } = input

  const hasPin = typeof pin === "string" && pin.trim() !== ""
  const hasAddress = typeof address === "string" && address.trim() !== ""
  if (!hasPin && !hasAddress) return { ok: false, failure: { reason: "no_input" } }

  let normalizedPin: string | null = null
  let inputKind: "pin" | "address" = "pin"

  if (hasPin) {
    normalizedPin = normalizePin(pin as string)
    if (!normalizedPin) return { ok: false, failure: { reason: "pin_invalid" } }
  } else {
    inputKind = "address"
    if (!lookupPinForAddress) return { ok: false, failure: { reason: "address_unresolved" } }
    const found = await lookupPinForAddress((address as string).trim())
    normalizedPin = found ? normalizePin(found) : null
    if (!normalizedPin) return { ok: false, failure: { reason: "address_unresolved" } }
  }

  const record = await lookupPropertyRecord(normalizedPin)
  if (!record) return { ok: false, failure: { reason: "record_unavailable" } }

  // Parity: the record we got back must be the parcel we asked about. Without
  // this, a lookup that silently falls back to a nearby or default parcel would
  // hand back someone else's township with full confidence.
  if (normalizePin(record.pin) !== normalizedPin) {
    return { ok: false, failure: { reason: "pin_parity_mismatch" } }
  }

  const townshipName = record.township?.trim()
  if (!townshipName) return { ok: false, failure: { reason: "record_missing_township" } }

  return {
    ok: true,
    resolution: {
      inputKind,
      normalizedPin,
      normalizedAddress: hasAddress ? (address as string).trim() : null,
      townshipKey: townshipKeyFromName(townshipName),
      townshipName,
      resolutionSource: RESOLUTION_SOURCE,
      resolvedAt,
    },
  }
}
