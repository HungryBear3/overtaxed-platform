/**
 * Realie Address Lookup — geocode by address + optional unit.
 * Returns lat/long for use with Premium Comparables when Parcel Universe has no coords.
 * Same API key and quota as Parcel Lookup (25 free/month).
 * @see https://docs.realie.ai/api-reference/property/address-lookup
 */

const REALIE_ADDRESS_URL = "https://app.realie.ai/api/public/property/address/"

/** Unit patterns: APT 2B, UNIT 101, #3, STE 4, etc. */
const UNIT_PATTERN = /\b(?:APT|UNIT|STE|SUITE|#)\s*([A-Z0-9\-]+)\s*$/i

/**
 * Extract unit number from address (e.g. "123 MAIN ST APT 2B" → "2B").
 * Realie expects unit without prefix (unitNumberStripped).
 */
export function parseUnitFromAddress(address: string): string | null {
  if (!address?.trim()) return null
  const m = address.trim().match(UNIT_PATTERN)
  return m ? m[1].trim() : null
}

/**
 * Remove trailing ", CITY, STATE ZIP" and unit suffixes to get street line 1 only.
 * Realie address param = street only, no city/state/zip.
 */
export function parseStreetFromAddress(address: string): string {
  if (!address?.trim()) return ""
  let s = address.trim()
  // Remove unit suffix first (APT 2B, UNIT 101, etc.)
  s = s.replace(UNIT_PATTERN, "").trim()
  // Remove trailing ", CITY, STATE ZIP" or ", CITY ZIP"
  s = s.replace(/\s*,\s*[A-Za-z\s]+\s*,?\s*(?:[A-Z]{2}\s+)?\d{5}(-\d{4})?\s*$/i, "").trim()
  return s || address.trim()
}

export type FetchRealieAddressLookupOptions = {
  state: string
  address: string
  unitNumberStripped?: string | null
  city?: string | null
  county?: string | null
}

export type FetchRealieAddressLookupResult =
  | { success: true; latitude: number; longitude: number }
  | { success: false; error: string }

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Fetch lat/long from Realie Address Lookup.
 * Use when Parcel Universe has no coordinates (enables Premium Comparables).
 */
export async function fetchRealieAddressLookup(
  options: FetchRealieAddressLookupOptions
): Promise<FetchRealieAddressLookupResult> {
  const apiKey = process.env.REALIE_API_KEY
  if (!apiKey) {
    return { success: false, error: "REALIE_API_KEY not configured" }
  }

  const { state, address, unitNumberStripped, city, county } = options
  const streetAddress = parseStreetFromAddress(address)
  if (!streetAddress) {
    return { success: false, error: "Address is required" }
  }

  const params = new URLSearchParams({
    state,
    address: streetAddress,
  })
  if (unitNumberStripped?.trim()) {
    params.set("unitNumberStripped", unitNumberStripped.trim())
  }
  if (city?.trim() && county?.trim()) {
    params.set("city", city.trim())
    params.set("county", county.trim())
  }

  const url = `${REALIE_ADDRESS_URL}?${params.toString()}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      next: { revalidate: 0 },
    })

    if (res.status === 401) return { success: false, error: "Unauthorized" }
    if (res.status === 403) return { success: false, error: "Usage limit exceeded" }
    if (res.status === 404) return { success: false, error: "Address not found" }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      return { success: false, error: err.error ?? `Realie API ${res.status}` }
    }

    const json = (await res.json()) as { property?: Record<string, unknown> }
    const prop = json.property
    const lat = num(prop?.latitude)
    const lon = num(prop?.longitude)
    if (lat == null || lon == null) {
      return { success: false, error: "No coordinates in response" }
    }
    return { success: true, latitude: lat, longitude: lon }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  }
}
