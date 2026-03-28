/**
 * Single process flow: merge Cook County comps with Realie data.
 * - Prioritize comps that appear in both sources (county + Realie).
 * - When both exist, surface both datasets so UI/PDF can show "County / Realie" where they differ.
 *
 * QUOTA RULE: This function only reads from the DB/in-memory cache — it never makes a fresh
 * Realie API call. The subject-property Realie call is the only proactive API call we make
 * (1 per property, in the comps route). Per-comp enrichment here is purely cache-read.
 */

import type { RealiePropertyFull } from "@/lib/realie"
import { prisma } from "@/lib/db"
import { normalizePin } from "@/lib/realie/client"

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Reconstruct a RealiePropertyFull from a cached rawResponse row (no API call). */
function _parseFullFromRaw(
  raw: Record<string, unknown>,
  row: { livingArea: number | null; yearBuilt: number | null; bedrooms: number | null; bathrooms: unknown }
): RealiePropertyFull {
  const assessmentsRaw = raw.assessments
  const assessments = Array.isArray(assessmentsRaw)
    ? (assessmentsRaw as Record<string, unknown>[])
        .map((a) => {
          const ay = num(a.assessedYear)
          const av = num(a.totalAssessedValue)
          const mv = num(a.totalMarketValue)
          const tv = num(a.taxValue)
          const ty = num(a.taxYear)
          if (ay == null && av == null) return null
          return { assessedYear: ay ?? 0, totalAssessedValue: av ?? 0, totalMarketValue: mv ?? 0, taxValue: tv ?? 0, taxYear: ty ?? 0 }
        })
        .filter((a): a is NonNullable<typeof a> => a != null)
    : []
  return {
    livingArea: row.livingArea ?? num(raw.buildingArea),
    yearBuilt: row.yearBuilt ?? num(raw.yearBuilt),
    bedrooms: row.bedrooms ?? (raw.totalBedrooms != null ? Math.floor(Number(raw.totalBedrooms)) : null),
    bathrooms: row.bathrooms != null ? Number(row.bathrooms) : num(raw.totalBathrooms),
    addressFull: typeof raw.addressFull === "string" ? raw.addressFull : null,
    landArea: num(raw.landArea),
    acres: num(raw.acres),
    totalAssessedValue: num(raw.totalAssessedValue),
    totalLandValue: num(raw.totalLandValue),
    totalBuildingValue: num(raw.totalBuildingValue),
    totalMarketValue: num(raw.totalMarketValue),
    taxValue: num(raw.taxValue),
    taxYear: num(raw.taxYear),
    assessedYear: num(raw.assessedYear),
    garage: raw.garage === true || raw.garage === false ? raw.garage : null,
    garageCount: num(raw.garageCount),
    fireplace: raw.fireplace === true || raw.fireplace === false ? raw.fireplace : null,
    basementType: typeof raw.basementType === "string" ? raw.basementType : null,
    roofType: typeof raw.roofType === "string" ? raw.roofType : null,
    subdivision: typeof raw.subdivision === "string" ? raw.subdivision : null,
    neighborhood: typeof raw.neighborhood === "string" ? raw.neighborhood : null,
    latitude: num(raw.latitude),
    longitude: num(raw.longitude),
    modelValue: num(raw.modelValue),
    assessments,
  }
}

/** County-sourced comp (Cook County or from appeal's compsUsed). */
export type CountyCompBase = {
  pin: string
  pinRaw?: string
  address: string
  city?: string
  zipCode?: string
  neighborhood?: string | null
  buildingClass?: string | null
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  salePrice: number | null
  saleDate?: string | null
  pricePerSqft: number | null
  assessedMarketValue?: number | null
  assessedMarketValuePerSqft?: number | null
  distanceFromSubject?: number | null
  compType?: string
  [k: string]: unknown
}

/** Enriched comp: county + optional Realie. inBothSources = true when we have Realie data (higher priority). */
export type EnrichedComp<T extends CountyCompBase = CountyCompBase> = T & {
  /** Present when we have Realie data for this PIN (prioritize these comps). */
  inBothSources: boolean
  /** Realie living area (when different from county, show both). */
  livingAreaRealie?: number | null
  /** Realie year built. */
  yearBuiltRealie?: number | null
  /** Realie bedrooms. */
  bedroomsRealie?: number | null
  /** Realie bathrooms. */
  bathroomsRealie?: number | null
  /** Realie land area, assessed value, etc. for richer narrative. */
  realieData?: {
    landArea?: number | null
    totalAssessedValue?: number | null
    totalMarketValue?: number | null
    taxValue?: number | null
    taxYear?: number | null
    subdivision?: string | null
    neighborhood?: string | null
  } | null
}

/**
 * Enrich comps with Realie data — reads from DB cache only, never calls the API.
 * Per-comp API calls would burn quota fast; only the subject property gets a proactive call.
 * Comps that have a cached rawResponse get `inBothSources=true` and rich `realieData`.
 */
export async function enrichCompsWithRealie<T extends CountyCompBase>(
  comps: T[],
  options?: { maxRealie?: number }
): Promise<EnrichedComp<T>[]> {
  const maxRealie = options?.maxRealie ?? 20
  const pinList = comps
    .slice(0, maxRealie)
    .map((c) => (c.pinRaw ?? c.pin.replace(/\D/g, "")) || c.pin)
    .map(normalizePin)
  const realieByPin = new Map<string, RealiePropertyFull | null>()

  // Batch DB read — one query for all comp PINs (zero API calls)
  try {
    const rows = await prisma.realieEnrichmentCache.findMany({
      where: { pin: { in: pinList } },
      select: {
        pin: true,
        livingArea: true,
        yearBuilt: true,
        bedrooms: true,
        bathrooms: true,
        rawResponse: true,
      },
    })
    for (const row of rows) {
      const raw = row.rawResponse as Record<string, unknown> | null | undefined
      if (raw && typeof raw === "object") {
        // Parse full property from cached rawResponse (no API call)
        const full = _parseFullFromRaw(raw, row)
        realieByPin.set(row.pin, full)
      } else if (row.livingArea != null || row.yearBuilt != null) {
        // Partial cache hit — enrichment only, no realieData
        realieByPin.set(row.pin, {
          livingArea: row.livingArea,
          yearBuilt: row.yearBuilt,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
          addressFull: null,
          landArea: null,
          acres: null,
          totalAssessedValue: null,
          totalLandValue: null,
          totalBuildingValue: null,
          totalMarketValue: null,
          taxValue: null,
          taxYear: null,
          assessedYear: null,
          garage: null,
          garageCount: null,
          fireplace: null,
          basementType: null,
          roofType: null,
          subdivision: null,
          neighborhood: null,
          latitude: null,
          longitude: null,
          modelValue: null,
          assessments: [],
        })
      }
    }
  } catch {
    // DB unavailable — proceed with no enrichment
  }

  const enriched: EnrichedComp<T>[] = comps.map((c) => {
    const pinRaw = (c.pinRaw ?? c.pin.replace(/\D/g, "")) || c.pin
    const realie = realieByPin.get(pinRaw) ?? null
    const inBothSources = realie != null

    const livingAreaRealie = realie?.livingArea ?? null
    const yearBuiltRealie = realie?.yearBuilt ?? null
    const bedroomsRealie = realie?.bedrooms ?? null
    const bathroomsRealie = realie?.bathrooms ?? null

    // Merge Realie into primary fields when County has null so UI displays sqft/beds/baths
    const livingArea = c.livingArea ?? livingAreaRealie ?? null
    const yearBuilt = c.yearBuilt ?? yearBuiltRealie ?? null
    const bedrooms = c.bedrooms ?? bedroomsRealie ?? null
    const bathrooms = c.bathrooms ?? bathroomsRealie ?? null

    return {
      ...c,
      livingArea,
      yearBuilt,
      bedrooms,
      bathrooms,
      inBothSources,
      ...(inBothSources
        ? {
            livingAreaRealie,
            yearBuiltRealie,
            bedroomsRealie,
            bathroomsRealie,
            realieData: realie
              ? {
                  landArea: realie.landArea,
                  totalAssessedValue: realie.totalAssessedValue,
                  totalMarketValue: realie.totalMarketValue,
                  taxValue: realie.taxValue,
                  taxYear: realie.taxYear,
                  subdivision: realie.subdivision,
                  neighborhood: realie.neighborhood,
                }
              : null,
          }
        : {}),
    } as EnrichedComp<T>
  })

  // Higher priority: comps that have Realie data (in both sources) first
  enriched.sort((a, b) => (a.inBothSources === b.inBothSources ? 0 : a.inBothSources ? -1 : 1))
  return enriched
}

/** Helper: should we show both values (County / Realie) for a field? */
export function hasDiscrepancy(
  countyVal: number | null | undefined,
  realieVal: number | null | undefined
): boolean {
  if (countyVal == null && realieVal == null) return false
  if (countyVal == null || realieVal == null) return true
  return countyVal !== realieVal
}
