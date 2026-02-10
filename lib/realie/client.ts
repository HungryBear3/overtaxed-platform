/**
 * Realie Property Data API client (free tier: 25 requests/month).
 * We use 1 API call per subject property only (not for comps). Full response is cached so we get rich data from that single call.
 * @see https://docs.realie.ai/api-reference/property/parcel-id-lookup
 * @see https://docs.realie.ai/api-reference/property-data-schema
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

/** Richer property data from same Parcel ID Lookup (1 call). Use for subject property only. */
export type RealiePropertyFull = RealieEnrichment & {
  addressFull: string | null
  landArea: number | null
  acres: number | null
  totalAssessedValue: number | null
  totalLandValue: number | null
  totalBuildingValue: number | null
  totalMarketValue: number | null
  taxValue: number | null
  taxYear: number | null
  assessedYear: number | null
  garage: boolean | null
  garageCount: number | null
  fireplace: boolean | null
  basementType: string | null
  roofType: string | null
  subdivision: string | null
  neighborhood: string | null
  latitude: number | null
  longitude: number | null
  modelValue: number | null
  /** Previous years' assessments */
  assessments: Array<{ assessedYear: number; totalAssessedValue: number; totalMarketValue: number; taxValue: number; taxYear: number }>
}

/** In-memory cache by normalized PIN (avoids repeated DB reads in same process). */
const memoryCache = new Map<string, RealieEnrichment>()
/** In-memory cache for full property (subject only). */
const memoryCacheFull = new Map<string, RealiePropertyFull>()

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

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function parseEnrichment(property: Record<string, unknown> | null): RealieEnrichment | null {
  if (!property || typeof property !== "object") return null
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

/** Parse full property object from API/rawResponse into RealiePropertyFull. */
function parseFullProperty(property: Record<string, unknown> | null): RealiePropertyFull | null {
  if (!property || typeof property !== "object") return null
  const base = parseEnrichment(property)
  if (!base) return null
  const assessmentsRaw = property.assessments
  const assessments = Array.isArray(assessmentsRaw)
    ? (assessmentsRaw as Record<string, unknown>[])
        .map((a) => {
          const ay = num(a.assessedYear)
          const av = num(a.totalAssessedValue)
          const mv = num(a.totalMarketValue)
          const tv = num(a.taxValue)
          const ty = num(a.taxYear)
          if (ay == null && av == null) return null
          return {
            assessedYear: ay ?? 0,
            totalAssessedValue: av ?? 0,
            totalMarketValue: mv ?? 0,
            taxValue: tv ?? 0,
            taxYear: ty ?? 0,
          }
        })
        .filter((a): a is NonNullable<typeof a> => a != null)
    : []
  return {
    ...base,
    addressFull: typeof property.addressFull === "string" ? property.addressFull : null,
    landArea: num(property.landArea),
    acres: num(property.acres),
    totalAssessedValue: num(property.totalAssessedValue),
    totalLandValue: num(property.totalLandValue),
    totalBuildingValue: num(property.totalBuildingValue),
    totalMarketValue: num(property.totalMarketValue),
    taxValue: num(property.taxValue),
    taxYear: num(property.taxYear),
    assessedYear: num(property.assessedYear),
    garage: property.garage === true || property.garage === false ? property.garage : null,
    garageCount: num(property.garageCount),
    fireplace: property.fireplace === true || property.fireplace === false ? property.fireplace : null,
    basementType: typeof property.basementType === "string" ? property.basementType : null,
    roofType: typeof property.roofType === "string" ? property.roofType : null,
    subdivision: typeof property.subdivision === "string" ? property.subdivision : null,
    neighborhood: typeof property.neighborhood === "string" ? property.neighborhood : null,
    latitude: num(property.latitude),
    longitude: num(property.longitude),
    modelValue: num(property.modelValue),
    assessments,
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
    const prop = json.property ?? null
    const enrichment = parseEnrichment(prop as Record<string, unknown> | null)
    if (enrichment) {
      memoryCache.set(pinNormalized, enrichment)
      const full = parseFullProperty(prop as Record<string, unknown> | null)
      if (full) memoryCacheFull.set(pinNormalized, full)
      try {
        await prisma.realieEnrichmentCache.upsert({
          where: { pin: pinNormalized },
          create: {
            pin: pinNormalized,
            livingArea: enrichment.livingArea,
            yearBuilt: enrichment.yearBuilt,
            bedrooms: enrichment.bedrooms,
            bathrooms: enrichment.bathrooms != null ? enrichment.bathrooms : null,
            rawResponse: prop != null ? (prop as object) : undefined,
          },
          update: {
            livingArea: enrichment.livingArea,
            yearBuilt: enrichment.yearBuilt,
            bedrooms: enrichment.bedrooms,
            bathrooms: enrichment.bathrooms != null ? enrichment.bathrooms : null,
            rawResponse: prop != null ? (prop as object) : undefined,
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

/**
 * Get full (rich) property data from Realie. Same 1 API call per PIN (cached).
 * Use for the subject/assessed property only; do not call for comps.
 * If we have a cache row without rawResponse, we call the API once to backfill full data.
 */
export async function getFullPropertyByPin(pin: string): Promise<RealiePropertyFull | null> {
  const pinNormalized = normalizePin(pin)
  if (!pinNormalized) return null
  if (!process.env.REALIE_API_KEY) return null

  const memFull = memoryCacheFull.get(pinNormalized)
  if (memFull) return memFull

  try {
    const row = await prisma.realieEnrichmentCache.findUnique({
      where: { pin: pinNormalized },
    })
    const raw = row?.rawResponse as Record<string, unknown> | null | undefined
    if (raw && typeof raw === "object") {
      const full = parseFullProperty(raw)
      if (full) {
        memoryCacheFull.set(pinNormalized, full)
        return full
      }
    }
    if (row && !raw && canMakeRequest()) {
      const url = `${REALIE_BASE}?${new URLSearchParams({ state: "IL", county: "Cook", parcelId: pinNormalized }).toString()}`
      const res = await fetch(url, { headers: { Authorization: process.env.REALIE_API_KEY }, next: { revalidate: 0 } })
      recordRequest()
      if (res.ok) {
        const json = (await res.json()) as { property?: Record<string, unknown> }
        const prop = json.property ?? null
        const full = parseFullProperty(prop as Record<string, unknown> | null)
        if (full) {
          memoryCacheFull.set(pinNormalized, full)
          try {
            await prisma.realieEnrichmentCache.update({
              where: { pin: pinNormalized },
              data: { rawResponse: prop != null ? (prop as object) : undefined, fetchedAt: new Date() },
            })
          } catch {
            // ignore
          }
          return full
        }
      }
    }
  } catch {
    // DB or network error
  }

  await fetchByParcelId(pin, { state: "IL", county: "Cook" })
  const after = memoryCacheFull.get(pinNormalized) ?? null
  if (after) return after
  try {
    const row = await prisma.realieEnrichmentCache.findUnique({ where: { pin: pinNormalized } })
    const raw = row?.rawResponse as Record<string, unknown> | null | undefined
    if (raw && typeof raw === "object") {
      const full = parseFullProperty(raw)
      if (full) {
        memoryCacheFull.set(pinNormalized, full)
        return full
      }
    }
  } catch {
    // ignore
  }
  return null
}
