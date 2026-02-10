/**
 * Realie Property Data API client (free tier: 25 requests/month).
 * Used to enrich subject and comps when Cook County Improvement Chars are missing.
 * @see https://docs.realie.ai/api-reference/property/parcel-id-lookup
 */

const REALIE_BASE = "https://app.realie.ai/api/public/property/parcelId"
const FREE_TIER_MONTHLY_REQUESTS = 25

export type RealieEnrichment = {
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
}

/** In-memory cache by PIN (state:county:pin for consistency; we only use Cook County). */
const cache = new Map<string, RealieEnrichment>()

/** Requests made in current calendar month (resets when month changes). */
let requestsThisMonth = 0
let monthKey = new Date().toISOString().slice(0, 7) // "2025-01"

function getMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

function canMakeRequest(): boolean {
  const current = getMonthKey()
  if (current !== monthKey) {
    monthKey = current
    requestsThisMonth = 0
  }
  return requestsThisMonth < FREE_TIER_MONTHLY_REQUESTS
}

function recordRequest(): void {
  requestsThisMonth += 1
}

function cacheKey(pin: string): string {
  const normalized = pin.replace(/\D/g, "") || pin
  return `IL:Cook:${normalized}`
}

function parseEnrichment(property: Record<string, unknown> | null): RealieEnrichment | null {
  if (!property || typeof property !== "object") return null
  const num = (v: unknown): number | null => {
    if (v == null) return null
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }
  const livingArea = num(property.buildingArea)
  const yearBuilt = num(property.yearBuilt)
  const bedrooms = property.totalBedrooms != null ? Math.floor(Number(property.totalBedrooms)) : null
  const bathrooms = num(property.totalBathrooms)
  if (livingArea == null && yearBuilt == null && bedrooms == null && bathrooms == null) return null
  return {
    livingArea: livingArea ?? null,
    yearBuilt: yearBuilt ?? null,
    bedrooms: Number.isFinite(bedrooms) ? bedrooms! : null,
    bathrooms: bathrooms ?? null,
  }
}

/**
 * Fetch property by parcel ID from Realie. Returns enrichment fields only.
 * Uses in-memory cache and enforces 25 requests per calendar month (free tier).
 */
export async function fetchByParcelId(
  parcelId: string,
  options: { state?: string; county?: string } = {}
): Promise<RealieEnrichment | null> {
  const apiKey = process.env.REALIE_API_KEY
  if (!apiKey) return null

  const state = options.state ?? "IL"
  const county = options.county ?? "Cook"
  const pinNormalized = parcelId.replace(/\D/g, "") || parcelId

  const key = cacheKey(pinNormalized)
  const cached = cache.get(key)
  if (cached) return cached

  if (!canMakeRequest()) return null

  const params = new URLSearchParams({
    state,
    county,
    parcelId: pinNormalized,
  })
  const url = `${REALIE_BASE}?${params.toString()}`

  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      next: { revalidate: 0 },
    })
    recordRequest()
    if (!res.ok) return null
    const json = (await res.json()) as { property?: Record<string, unknown> }
    const enrichment = parseEnrichment(json.property ?? null)
    if (enrichment) cache.set(key, enrichment)
    return enrichment
  } catch {
    return null
  }
}

/**
 * Get enrichment for a PIN. Uses cache; only calls API on cache miss and if under monthly limit.
 */
export async function getEnrichmentByPin(pin: string): Promise<RealieEnrichment | null> {
  return fetchByParcelId(pin, { state: "IL", county: "Cook" })
}
