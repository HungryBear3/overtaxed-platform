/**
 * Realie Property Data API client (free tier: 25 requests/month).
 * Used to enrich subject and comps when Cook County Improvement Chars are missing.
 * We persist results in DB (RealieEnrichmentCache) so we only call the API once per PIN ever.
 * @see https://docs.realie.ai/api-reference/property/parcel-id-lookup
 */

import { prisma } from "@/lib/db"

const REALIE_BASE = "https://app.realie.ai/api/public/property/parcelId"
const FREE_TIER_MONTHLY_REQUESTS = 25

export type RealieEnrichment = {
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
}

/** In-memory cache by normalized PIN (avoids repeated DB reads in same process). */
const memoryCache = new Map<string, RealieEnrichment>()

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

export function normalizePin(pin: string): string {
  return pin.replace(/\D/g, "") || pin
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

function rowToEnrichment(row: {
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: unknown
}): RealieEnrichment {
  const bathrooms = row.bathrooms != null ? Number(row.bathrooms) : null
  return {
    livingArea: row.livingArea ?? null,
    yearBuilt: row.yearBuilt ?? null,
    bedrooms: row.bedrooms ?? null,
    bathrooms: Number.isFinite(bathrooms) ? bathrooms : null,
  }
}

/**
 * Fetch property by parcel ID from Realie. Returns enrichment fields only.
 * Uses: 1) in-memory cache, 2) DB cache (RealieEnrichmentCache), 3) API (then save to DB).
 * So we make at most one API call per PIN across all requests and serverless instances.
 */
export async function fetchByParcelId(
  parcelId: string,
  options: { state?: string; county?: string } = {}
): Promise<RealieEnrichment | null> {
  const apiKey = process.env.REALIE_API_KEY
  const pinNormalized = normalizePin(parcelId)
  if (!pinNormalized) return null

  // 1) In-memory (same process)
  const memCached = memoryCache.get(pinNormalized)
  if (memCached) return memCached

  // 2) DB cache (persistent across requests/instances)
  try {
    const row = await prisma.realieEnrichmentCache.findUnique({
      where: { pin: pinNormalized },
    })
    if (row) {
      const enrichment = rowToEnrichment(row)
      memoryCache.set(pinNormalized, enrichment)
      return enrichment
    }
  } catch {
    // DB unavailable or table missing; fall through to API
  }

  if (!apiKey) return null
  if (!canMakeRequest()) return null

  const state = options.state ?? "IL"
  const county = options.county ?? "Cook"
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
    if (enrichment) {
      memoryCache.set(pinNormalized, enrichment)
      try {
        await prisma.realieEnrichmentCache.upsert({
          where: { pin: pinNormalized },
          create: {
            pin: pinNormalized,
            livingArea: enrichment.livingArea,
            yearBuilt: enrichment.yearBuilt,
            bedrooms: enrichment.bedrooms,
            bathrooms: enrichment.bathrooms != null ? enrichment.bathrooms : null,
          },
          update: {
            livingArea: enrichment.livingArea,
            yearBuilt: enrichment.yearBuilt,
            bedrooms: enrichment.bedrooms,
            bathrooms: enrichment.bathrooms != null ? enrichment.bathrooms : null,
            fetchedAt: new Date(),
          },
        })
      } catch {
        // non-fatal: we still return enrichment and have in-memory cache
      }
    }
    return enrichment
  } catch {
    return null
  }
}

/**
 * Get enrichment for a PIN. Uses in-memory + DB cache first; only calls API once per PIN ever.
 */
export async function getEnrichmentByPin(pin: string): Promise<RealieEnrichment | null> {
  return fetchByParcelId(pin, { state: "IL", county: "Cook" })
}
