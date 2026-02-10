/**
 * Single process flow: merge Cook County comps with Realie data.
 * - Prioritize comps that appear in both sources (county + Realie).
 * - When both exist, surface both datasets so UI/PDF can show "County / Realie" where they differ.
 */

import type { RealiePropertyFull } from "@/lib/realie"
import { getFullPropertyByPin } from "@/lib/realie"

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

const REALE_CONCURRENCY = 3

/**
 * Enrich comps with Realie (1 API call per PIN, cached). Merge data, mark inBothSources, sort so comps with Realie come first.
 */
export async function enrichCompsWithRealie<T extends CountyCompBase>(
  comps: T[],
  options?: { maxRealie?: number }
): Promise<EnrichedComp<T>[]> {
  const maxRealie = options?.maxRealie ?? 20
  const pinList = comps.map((c) => c.pinRaw ?? c.pin.replace(/\D/g, "") || c.pin)
  const realieByPin = new Map<string, RealiePropertyFull | null>()

  for (let i = 0; i < Math.min(pinList.length, maxRealie); i += REALE_CONCURRENCY) {
    const batch = pinList.slice(i, i + REALE_CONCURRENCY)
    const results = await Promise.all(batch.map((pin) => getFullPropertyByPin(pin)))
    batch.forEach((pin, j) => {
      const r = results[j]
      realieByPin.set(pin, r ?? null)
    })
  }

  const enriched: EnrichedComp<T>[] = comps.map((c) => {
    const pinRaw = c.pinRaw ?? c.pin.replace(/\D/g, "") || c.pin
    const realie = realieByPin.get(pinRaw) ?? null
    const inBothSources = realie != null

    const livingAreaRealie = realie?.livingArea ?? null
    const yearBuiltRealie = realie?.yearBuilt ?? null
    const bedroomsRealie = realie?.bedrooms ?? null
    const bathroomsRealie = realie?.bathrooms ?? null

    return {
      ...c,
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
    } as EnrichedComp<T>)
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
