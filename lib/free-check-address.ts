/**
 * Address handling for the free check.
 *
 * Two jobs live here, and they are deliberately separate:
 *
 *  1. **Parsing** a homeowner's free-text input into the pieces Cook County's
 *     datasets actually store — house number, directional, street name, suffix,
 *     unit, city, ZIP — plus an ordered list of progressively wider `LIKE`
 *     fragments to query with.
 *  2. **Ranking** the records that come back against that parse, with explicit
 *     rules, so a caller can tell a confident single match from a building with
 *     forty parcels behind one street address.
 *
 * Neither job invents a property. Every rule below either rejects a candidate
 * or scores one; nothing here fabricates a PIN, a unit, or a match.
 *
 * Why it exists: the address flow used to send the user's raw string straight
 * into `upper(property_address) like upper('%…%')` and take `data[0]`. A
 * substring match against one column fails on every difference the county does
 * not care about — "Street" against a stored "ST", "North" against "N", a
 * trailing "Apt 3", a period after an abbreviation — and when it did return
 * rows, the first one won with no rule behind it. Valid Cook County addresses
 * fell through to "enter your 14-digit PIN", and multi-parcel buildings were
 * resolved by array order.
 *
 * Known limitation, not handled here: spelling variants inside the street name
 * itself ("Mc Kinley" / "McKinley", "St Louis" / "Saint Louis"). Those need a
 * name index this repository does not carry, and guessing at them is how a
 * lookup returns the wrong parcel.
 */

/** Directional words → the form the county's address columns store. */
const DIRECTIONALS: Record<string, string> = {
  N: "N", NORTH: "N",
  S: "S", SOUTH: "S",
  E: "E", EAST: "E",
  W: "W", WEST: "W",
  NE: "NE", NORTHEAST: "NE",
  NW: "NW", NORTHWEST: "NW",
  SE: "SE", SOUTHEAST: "SE",
  SW: "SW", SOUTHWEST: "SW",
}

/**
 * Street-suffix variants → the USPS abbreviation Cook County stores.
 *
 * Every abbreviation maps to itself as well as from its long form, so the table
 * can be applied to the user's input and to a county record with one lookup and
 * the two sides land on the same token.
 */
const SUFFIXES: Record<string, string> = {
  ST: "ST", STR: "ST", STREET: "ST",
  AVE: "AVE", AV: "AVE", AVEN: "AVE", AVENUE: "AVE",
  BLVD: "BLVD", BLV: "BLVD", BOUL: "BLVD", BOULEVARD: "BLVD",
  DR: "DR", DRV: "DR", DRIVE: "DR",
  RD: "RD", ROAD: "RD",
  PL: "PL", PLACE: "PL",
  CT: "CT", CRT: "CT", COURT: "CT",
  LN: "LN", LANE: "LN",
  TER: "TER", TERR: "TER", TERRACE: "TER",
  PKWY: "PKWY", PKY: "PKWY", PARKWAY: "PKWY", PKWAY: "PKWY",
  CIR: "CIR", CIRCLE: "CIR",
  WAY: "WAY", WY: "WAY",
  SQ: "SQ", SQUARE: "SQ",
  HWY: "HWY", HIGHWAY: "HWY",
  TRL: "TRL", TRAIL: "TRL",
  PT: "PT", POINT: "PT",
  PLZ: "PLZ", PLAZA: "PLZ",
  RDG: "RDG", RIDGE: "RDG",
  CRES: "CRES", CRESCENT: "CRES",
  ROW: "ROW",
  PATH: "PATH",
  LOOP: "LOOP",
  RUN: "RUN",
  WALK: "WALK",
  BEND: "BEND",
  PARK: "PARK",
  GRV: "GRV", GROVE: "GRV",
}

/** Unit designators. `#` is handled separately because it is not a word. */
const UNIT_DESIGNATORS = [
  "APT", "APARTMENT", "UNIT", "STE", "SUITE", "FL", "FLR", "FLOOR",
  "RM", "ROOM", "BLDG", "BUILDING",
]

/**
 * Assessor address-index markers that describe the parcel type, not a unit.
 * `HSE` appears on archived single-family rows while the current address index
 * exposes the same PIN without it. Treating it as street identity makes the
 * second authoritative lookup reject its own candidate.
 */
const COUNTY_NON_UNIT_TERMINALS = new Set(["HSE"])

/**
 * The shape of a bare condo/unit token as the archived Parcel Universe appends
 * it to a street line, with no designator in front of it: `… ST C23`, `… ST
 * 4B`, `… ST PH2`. Two to six characters, letters and digits only, and it has
 * to carry **both** at least one letter and at least one digit.
 *
 * Both halves of that requirement are load-bearing, and each rules out a
 * different way a street's own identity ends in something unit-shaped:
 *
 *  - **a digit is required** because Chicago has street names whose final token
 *    sits after a suffix word — `S AVENUE O`, `N AVENUE L`. A rule that took a
 *    bare letter would read those as apartments.
 *  - **a letter is required** because an all-numeric ending is how the county
 *    writes a *numbered route* — `US HIGHWAY 20`, `OLD ROAD 66`,
 *    `COUNTY ROAD 12`. Reading `20` as a unit corroborates two different roads
 *    as one address, which an exact PIN match does not license: the PIN proves
 *    the parcel was not swapped, it says nothing about whether the addresses
 *    agree.
 *
 * A numeric unit is still perfectly reachable — with a designator in front of
 * it (`APT 20`, `UNIT 66`, `#20`), which [[parseFreeCheckAddress]] handles and
 * this constant never sees. The requirement is only on the *undesignated* case,
 * where the token's meaning has to be inferred from its shape alone.
 */
const COUNTY_BARE_UNIT_PATTERN = /^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{2,6}$/

const UNIT_PATTERN = new RegExp(
  String.raw`(?:#\s*|\b(?:${UNIT_DESIGNATORS.join("|")})\b\.?\s*)([A-Z0-9][A-Z0-9-]*)`,
  "i",
)

/** House number: digits, optionally with a fraction or a trailing letter. */
const HOUSE_NUMBER_PATTERN = /^(\d+(?:\s+\d\/\d)?[A-Z]?)$/

export interface ParsedFreeCheckAddress {
  /** Whitespace-collapsed input, unchanged otherwise. Never sent to a query. */
  raw: string
  /** Canonical street line: house number, directional, name, suffix. Uppercase. */
  street: string
  /**
   * The same street line with the caller's own casing and spelling intact.
   *
   * Comparison and querying both use the uppercase [[street]]; this exists so a
   * surface can echo what the homeowner typed rather than shouting it back.
   */
  streetDisplay: string
  houseNumber: string | null
  /** Single- or double-letter directional, or null when the input carried none. */
  directional: string | null
  /** Street name with directional, suffix and punctuation removed. Uppercase. */
  streetName: string
  /** USPS suffix abbreviation, or null when the input carried none. */
  suffix: string | null
  /** Unit / apartment designator value, uppercase, or null. */
  unit: string | null
  city: string
  zip: string | null
  /**
   * Ordered `LIKE` fragments, narrowest first. `%` inside a fragment is an
   * intentional wildcard; the caller wraps the whole fragment in `%…%`.
   */
  queryFragments: string[]
}

/**
 * Strip the punctuation the county does not store and collapse whitespace.
 *
 * Case is preserved here and folded only at comparison time, so a parse can
 * still echo the homeowner's own spelling back to them.
 */
function scrub(value: string): string {
  return value
    .replace(/[.,]/g, " ")
    .replace(/[^A-Za-z0-9#/\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Drop an ordinal ending from a numeric street name so "53RD" and "53" are the
 * same token. Applied to both sides of every comparison, so it widens matching
 * without asserting anything about either.
 */
function normalizeOrdinal(token: string): string {
  const ordinal = token.match(/^(\d+)(ST|ND|RD|TH)$/)
  return ordinal ? ordinal[1] : token
}

/** Only characters that are safe inside a Socrata `LIKE` literal survive. */
function fragmentSafe(value: string): string {
  return value.replace(/[^A-Z0-9 %]/g, " ").replace(/\s+/g, " ").trim()
}

/**
 * Parse a free-text address, plus an optional explicit city field.
 *
 * Deterministic and conservative: a token is only claimed as a directional, a
 * suffix or a unit when it is unambiguously one. Anything unrecognized stays in
 * the street name, where it narrows rather than widens the match.
 */
export function parseFreeCheckAddress(
  address: string,
  city: string = "",
): ParsedFreeCheckAddress {
  const raw = address.trim().replace(/\s+/g, " ")
  let cityPart = city.trim().replace(/\s+/g, " ")

  // ── Split street from the locality tail ──────────────────────────────────
  let streetPart = raw
  if (raw.includes(",")) {
    const [street, ...rest] = raw.split(",").map((part) => part.trim()).filter(Boolean)
    streetPart = street || raw
    if (!cityPart && rest.length > 0) {
      cityPart = rest
        .join(" ")
        .replace(/\b(?:IL|ILLINOIS)\b\.?/gi, " ")
        .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    }
  }

  // ── ZIP, taken from anywhere in the input, then removed ──────────────────
  const zipMatch = raw.match(/\b(\d{5})(?:-\d{4})?\b(?![^,]*\d{5})/)
  const zip = zipMatch ? zipMatch[1] : null
  streetPart = streetPart
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
    .replace(/\b(?:IL|Illinois)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim()

  // ── Unit, taken before tokenizing so its digits are not read as a house number ──
  let unit: string | null = null
  const unitMatch = streetPart.match(UNIT_PATTERN)
  if (unitMatch) {
    unit = unitMatch[1].toUpperCase()
    streetPart = (streetPart.slice(0, unitMatch.index ?? 0) + " " + streetPart.slice((unitMatch.index ?? 0) + unitMatch[0].length))
      .replace(/\s+/g, " ")
      .trim()
  }

  // ── "… Chicago" with no comma ────────────────────────────────────────────
  if (!cityPart) {
    const suffixCity = streetPart.match(/^(.*)\s+(CHICAGO)$/i)
    if (suffixCity?.[1]) {
      streetPart = suffixCity[1].trim()
      cityPart = "Chicago"
    }
  }

  // Tokens are carried in two parallel forms: `tokens` folded to uppercase for
  // every lookup and comparison, `display` exactly as typed. Both are consumed
  // by the same shift/pop decisions, so they cannot drift apart.
  const display = scrub(streetPart).split(" ").filter(Boolean)
  const tokens = display.map((token) => token.toUpperCase())
  const take = (from: "front" | "back") => {
    if (from === "front") { display.shift(); return tokens.shift() ?? null }
    display.pop(); return tokens.pop() ?? null
  }

  if (tokens.length > 0 && COUNTY_NON_UNIT_TERMINALS.has(tokens[tokens.length - 1])) {
    take("back")
  }

  let houseNumber: string | null = null
  let houseNumberDisplay: string | null = null
  if (tokens.length > 0 && HOUSE_NUMBER_PATTERN.test(tokens[0])) {
    houseNumberDisplay = display[0]
    houseNumber = take("front")
  }

  let directional: string | null = null
  let directionalDisplay: string | null = null
  let directionalWasTrailing = false
  if (tokens.length > 1 && DIRECTIONALS[tokens[0]]) {
    directional = DIRECTIONALS[tokens[0]]
    directionalDisplay = display[0]
    take("front")
  }

  let suffix: string | null = null
  let suffixDisplay: string | null = null
  if (!directional && tokens.length > 2) {
    const trailingDirectional = tokens[tokens.length - 1]
    const trailingSuffix = tokens[tokens.length - 2]
    if (DIRECTIONALS[trailingDirectional] && SUFFIXES[trailingSuffix]) {
      directional = DIRECTIONALS[trailingDirectional]
      directionalDisplay = display[display.length - 1]
      directionalWasTrailing = true
      take("back")
      suffix = SUFFIXES[tokens[tokens.length - 1]]
      suffixDisplay = display[display.length - 1]
      take("back")
    }
  }

  if (!suffix && tokens.length > 1 && SUFFIXES[tokens[tokens.length - 1]]) {
    suffix = SUFFIXES[tokens[tokens.length - 1]]
    suffixDisplay = display[display.length - 1]
    take("back")
  }

  // A post-directional ("MAIN N") is claimed only when no pre-directional was
  // found. Otherwise a contradictory trailing token stays in the street name,
  // which narrows matching instead of silently overwriting the earlier parse.
  if (!directional && tokens.length > 1 && DIRECTIONALS[tokens[tokens.length - 1]]) {
    directional = DIRECTIONALS[tokens[tokens.length - 1]]
    directionalDisplay = display[display.length - 1]
    directionalWasTrailing = true
    take("back")
  }

  const streetName = tokens.map(normalizeOrdinal).join(" ")
  const street = [houseNumber, directional, streetName, suffix].filter(Boolean).join(" ")
  const streetDisplay = directionalWasTrailing
    ? [houseNumberDisplay, display.join(" ") || null, suffixDisplay, directionalDisplay]
        .filter(Boolean).join(" ")
    : [houseNumberDisplay, directionalDisplay, display.join(" ") || null, suffixDisplay]
        .filter(Boolean).join(" ")

  return {
    raw,
    street,
    streetDisplay,
    houseNumber,
    directional,
    streetName,
    suffix,
    unit,
    city: cityPart,
    zip,
    queryFragments: buildQueryFragments({ houseNumber, directional, streetName, suffix }),
  }
}

/**
 * Progressively wider `LIKE` fragments for one parsed address.
 *
 * Narrowest first, and the caller stops at the first fragment that returns
 * rows, so widening never costs precision it did not already fail to get. The
 * widest fragment drops the directional and the suffix — the two tokens the
 * county writes differently from every homeowner — and relies on the ranker to
 * reject the extra rows that lets through.
 */
function buildQueryFragments(parts: {
  houseNumber: string | null
  directional: string | null
  streetName: string
  suffix: string | null
}): string[] {
  const { houseNumber, directional, streetName, suffix } = parts
  if (!streetName) return []

  const fragments: string[] = []
  const push = (value: string) => {
    const safe = fragmentSafe(value)
    if (safe && !fragments.includes(safe)) fragments.push(safe)
  }

  push([houseNumber, directional, streetName, suffix].filter(Boolean).join(" "))
  push([houseNumber, directional, streetName].filter(Boolean).join(" "))
  if (houseNumber) {
    // House number and street name with a wildcard between them: matches a
    // stored directional the user omitted, and a stored suffix they spelled out.
    push(`${houseNumber}%${streetName}`)
  } else {
    push(streetName)
  }
  return fragments
}

/**
 * The legacy two-field normalizer, unchanged in behaviour and still the shape
 * `app/api/checkout/session` passes to `searchPropertiesByAddress`.
 *
 * It is now derived from [[parseFreeCheckAddress]] so the two cannot disagree
 * about where the city ends and the street begins.
 */
export function normalizeFreeCheckSearchInput(address: string, city: string = "") {
  const parsed = parseFreeCheckAddress(address, city)
  const searchAddress = parsed.streetDisplay || address.trim().replace(/\s+/g, " ")
  return { address: searchAddress, city: parsed.city }
}

/**
 * Parse a *county record* address, which may carry a condo unit the generic
 * parser cannot see.
 *
 * Cook County's current PIN Address Index stores `100 W RANDOLPH ST` with no
 * apartment value, while the archived Parcel Universe stores the same PIN as
 * `100 W RANDOLPH ST C23`. There is no designator on that `C23`, so
 * [[parseFreeCheckAddress]] — which will not guess — keeps it as street
 * identity, and the two datasets then describe two different streets for one
 * parcel.
 *
 * This recognizes that one shape, and only where removing the token still
 * leaves a complete street line behind. All of these must hold:
 *
 *  - the generic parse found no designated unit and claimed no suffix — the
 *    terminal token is sitting in the position the suffix would occupy;
 *  - it found a house number;
 *  - the street name carries at least three tokens, so the token before the
 *    terminal one is a recognized USPS suffix *and* a street name of its own
 *    still stands in front of that suffix;
 *  - the terminal token matches [[COUNTY_BARE_UNIT_PATTERN]].
 *
 * Anything else is returned exactly as the generic parser read it. This is for
 * county records only; homeowner input goes through [[parseFreeCheckAddress]]
 * and is not widened by any of it.
 */
export function parseCountyRecordAddress(
  address: string,
  city: string = "",
): ParsedFreeCheckAddress {
  const parsed = parseFreeCheckAddress(address, city)
  if (parsed.unit || parsed.suffix || !parsed.houseNumber) return parsed

  const tokens = parsed.streetName.split(" ").filter(Boolean)
  if (tokens.length < 3) return parsed

  const unit = tokens[tokens.length - 1]
  const suffix = SUFFIXES[tokens[tokens.length - 2]]
  if (!suffix || !COUNTY_BARE_UNIT_PATTERN.test(unit)) return parsed

  const streetName = tokens.slice(0, -2).join(" ")
  // A trailing directional is never claimed when the last token is this shape,
  // so the display line ends on the same token the uppercase one does.
  const streetDisplay = parsed.streetDisplay.split(" ").filter(Boolean).slice(0, -1).join(" ")

  return {
    ...parsed,
    street: [parsed.houseNumber, parsed.directional, streetName, suffix].filter(Boolean).join(" "),
    streetDisplay,
    streetName,
    suffix,
    unit,
    queryFragments: buildQueryFragments({
      houseNumber: parsed.houseNumber,
      directional: parsed.directional,
      streetName,
      suffix,
    }),
  }
}

/* ── Candidate ranking ────────────────────────────────────────────────────── */

/** One row as it comes back from a Cook County address dataset. */
export interface AddressCandidateRecord {
  pin: string
  address: string
  city: string
  zip: string
}

export interface RankedAddressCandidate extends AddressCandidateRecord {
  /** Unit parsed out of the county's own address string, or null. */
  unit: string | null
  houseNumber: string | null
  directional: string | null
  streetName: string
  suffix: string | null
  buildingIdentity: string
  /** Higher is a closer match. Composed only of the rules listed below. */
  score: number
  /** Which rules contributed, in order. Written to the response for audit. */
  matchedOn: string[]
}

/**
 * `selectable` is the set a posted `selectedPin` may be honored from — the
 * parcels this lookup is willing to offer for selection, capped exactly like
 * the offered list so a repeat request can never resolve to a parcel this one
 * would not have shown. On an ambiguous result it is the offered list itself;
 * on a unique one it is the rest of the ranked field that the resolver merely
 * outscored, which is where a parcel the reader already chose will be found.
 */
export type AddressResolution =
  | { kind: "unique"; candidate: RankedAddressCandidate; selectable: RankedAddressCandidate[] }
  | { kind: "ambiguous"; candidates: RankedAddressCandidate[]; total: number; selectable: RankedAddressCandidate[] }
  | { kind: "none" }

/**
 * Score and filter county records against a parsed input.
 *
 * The hard rejects come first and are all of the form "these are different
 * streets". The scores that follow only order the survivors; they never rescue
 * a rejected row.
 */
export function rankAddressCandidates(
  parsed: ParsedFreeCheckAddress,
  candidates: AddressCandidateRecord[],
): RankedAddressCandidate[] {
  const seen = new Set<string>()
  const ranked: RankedAddressCandidate[] = []

  for (const candidate of candidates) {
    const pin = String(candidate.pin ?? "").replace(/\D/g, "")
    if (pin.length !== 14 || seen.has(pin)) continue

    const record = parseFreeCheckAddress(candidate.address ?? "", candidate.city ?? "")

    // ── Hard rejects ──────────────────────────────────────────────────────
    if (!record.streetName || !parsed.streetName) continue
    if (record.streetName !== parsed.streetName) continue
    if (parsed.houseNumber) {
      if (!record.houseNumber || record.houseNumber !== parsed.houseNumber) continue
    }
    if (parsed.directional && record.directional && parsed.directional !== record.directional) continue
    if (parsed.suffix && record.suffix && parsed.suffix !== record.suffix) continue
    if (parsed.unit && record.unit && parsed.unit !== record.unit) continue

    // ── Scores ────────────────────────────────────────────────────────────
    const candidateCity = (candidate.city ?? "").trim().toUpperCase()
    const parsedCity = parsed.city.trim().toUpperCase()
    const candidateZip = (candidate.zip ?? "").trim().slice(0, 5)

    let score = 0
    const matchedOn: string[] = ["street_name"]
    if (parsed.houseNumber) matchedOn.push("house_number")
    if (parsed.directional && record.directional === parsed.directional) { score += 3; matchedOn.push("directional") }
    if (parsed.suffix && record.suffix === parsed.suffix) { score += 2; matchedOn.push("suffix") }
    if (parsed.unit && record.unit === parsed.unit) { score += 4; matchedOn.push("unit") }
    if (parsedCity && candidateCity) {
      if (parsedCity === candidateCity) { score += 3; matchedOn.push("city") }
      else score -= 3
    }
    if (parsed.zip && candidateZip) {
      if (parsed.zip === candidateZip) { score += 2; matchedOn.push("zip") }
      else score -= 1
    }

    seen.add(pin)
    ranked.push({
      pin,
      address: (candidate.address ?? "").trim(),
      city: (candidate.city ?? "").trim(),
      zip: candidateZip,
      unit: record.unit,
      houseNumber: record.houseNumber,
      directional: record.directional,
      streetName: record.streetName,
      suffix: record.suffix,
      buildingIdentity: [record.houseNumber, record.directional, record.streetName, record.suffix]
        .filter(Boolean).join("|"),
      score,
      matchedOn,
    })
  }

  // Stable: score descending, then PIN, so the same inputs always order the
  // same way and an ambiguity verdict cannot depend on dataset row order.
  return ranked.sort((a, b) => (b.score - a.score) || a.pin.localeCompare(b.pin))
}

/**
 * Decide whether the survivors identify one property.
 *
 * Ambiguity is the default. A single match wins only when nothing else survived,
 * when the user named the unit that separates it, or when it strictly outscores
 * every other survivor *and* no two survivors sit unit-less behind the same
 * street address — which is what a condo building looks like from here, and is
 * precisely the case that must never be resolved by picking the first row.
 */
export function resolveAddressCandidates(
  parsed: ParsedFreeCheckAddress,
  candidates: AddressCandidateRecord[],
  options: { maxCandidates?: number } = {},
): AddressResolution {
  const maxCandidates = options.maxCandidates ?? 8
  const survivors = rankAddressCandidates(parsed, candidates)
  if (survivors.length === 0) return { kind: "none" }

  if (parsed.unit) {
    const exact = survivors.filter((c) => c.unit === parsed.unit)
    // A typed unit narrows what may be selected: the parcels carrying some
    // other unit were never on offer and stay off it on the repeat request.
    const selectable = exact.slice(0, maxCandidates)
    if (exact.length === 1) return { kind: "unique", candidate: exact[0], selectable }
    if (exact.length > 1) {
      return { kind: "ambiguous", candidates: selectable, total: exact.length, selectable }
    }
  }

  const selectable = survivors.slice(0, maxCandidates)

  if (survivors.length === 1) return { kind: "unique", candidate: survivors[0], selectable }

  if (!parsed.unit) {
    const unitBearingCounts = new Map<string, number>()
    const unitlessCounts = new Map<string, number>()
    for (const survivor of survivors) {
      if (!survivor.buildingIdentity) continue
      const counts = survivor.unit ? unitBearingCounts : unitlessCounts
      counts.set(survivor.buildingIdentity, (counts.get(survivor.buildingIdentity) ?? 0) + 1)
    }
    // Conflicting locality fields cannot select between two explicit units or
    // between two unitless parcels at one street identity. A mixed standalone
    // parcel and a unit in a genuinely different locality may still be resolved
    // by the city/ZIP score below.
    if (
      Array.from(unitBearingCounts.values()).some((count) => count > 1) ||
      Array.from(unitlessCounts.values()).some((count) => count > 1)
    ) {
      return { kind: "ambiguous", candidates: selectable, total: survivors.length, selectable }
    }
  }

  if (survivors[0].score > survivors[1].score) {
    return { kind: "unique", candidate: survivors[0], selectable }
  }

  return { kind: "ambiguous", candidates: selectable, total: survivors.length, selectable }
}

/**
 * The field-by-field comparison behind [[recordCorroboratesAddress]], against
 * one reading of the record address.
 *
 * Every check here rejects; none of them scores, and none of them can rescue a
 * row another one turned down.
 */
function readingCorroboratesAddress(
  parsed: ParsedFreeCheckAddress,
  selected: Pick<
    RankedAddressCandidate,
    "houseNumber" | "directional" | "streetName" | "suffix" | "unit"
  >,
  record: ParsedFreeCheckAddress,
): boolean {
  if (!record.streetName || !parsed.streetName) return false
  if (record.streetName !== selected.streetName) return false
  if (selected.houseNumber && record.houseNumber !== selected.houseNumber) return false
  if (selected.directional && record.directional !== selected.directional) return false
  if (selected.suffix && record.suffix !== selected.suffix) return false
  if (selected.unit && record.unit !== selected.unit) return false
  if (parsed.houseNumber && record.houseNumber !== parsed.houseNumber) return false
  if (parsed.directional && record.directional && parsed.directional !== record.directional) return false
  if (parsed.suffix && record.suffix && parsed.suffix !== record.suffix) return false
  if (parsed.unit && record.unit !== parsed.unit) return false
  return true
}

/**
 * Does the record we finally loaded still describe the address that was asked
 * for? Called after `getPropertyByPIN`, because the PIN travels through a
 * second dataset lookup between the candidate and the answer.
 *
 * Fails closed: an unparseable or empty record address is not corroboration.
 *
 * The PIN is checked first and is not negotiable — corroboration only ever
 * confirms or rejects the parcel that was already chosen, and can never move
 * the answer to another one.
 *
 * The address is then read twice, and the second reading is a fallback the
 * first one cannot lose by. [[parseFreeCheckAddress]] is asked first, so every
 * record that corroborated before this fallback existed still does.
 * [[parseCountyRecordAddress]] is asked only when that failed, and only its own
 * narrow shape — a bare terminal condo unit on a street line that is otherwise
 * complete — can be the difference. A record that survives on the second
 * reading has still cleared house number, directional, street name, suffix,
 * selected-candidate lineage and any unit the homeowner actually typed.
 */
export function recordCorroboratesAddress(
  parsed: ParsedFreeCheckAddress,
  selected: Pick<
    RankedAddressCandidate,
    "pin" | "houseNumber" | "directional" | "streetName" | "suffix" | "unit"
  >,
  recordPin: string | null | undefined,
  recordAddress: string,
  recordCity: string = "",
): boolean {
  const normalizedRecordPin = String(recordPin ?? "").replace(/\D/g, "")
  if (normalizedRecordPin.length !== 14 || normalizedRecordPin !== selected.pin) return false

  const record = parseFreeCheckAddress(recordAddress ?? "", recordCity ?? "")
  if (readingCorroboratesAddress(parsed, selected, record)) return true

  const countyRecord = parseCountyRecordAddress(recordAddress ?? "", recordCity ?? "")
  // Nothing was recognized, so the second reading is the first one and the
  // rejection above stands.
  if (countyRecord.unit === record.unit) return false
  return readingCorroboratesAddress(parsed, selected, countyRecord)
}
