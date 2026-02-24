/**
 * Realie Premium Comparables Search.
 * 1 API call returns up to 50 comps (vs 15+ for Cook County + per-PIN enrichment).
 * Requires latitude, longitude. Same API key and quota as Parcel Lookup (25 free/month).
 * @see https://docs.realie.ai/api-reference/premium/premium-comparables-search
 */

import { formatPIN } from "@/lib/cook-county"
import { normalizePin } from "./client"

const REALIE_PREMIUM_COMPARABLES_URL =
  "https://app.realie.ai/api/public/premium/comparables/"

export type RealieComparableRaw = {
  parcelId?: string
  parcel_id?: string
  pin?: string
  address?: string
  addressFull?: string
  streetAddress?: string
  city?: string
  zipCode?: string
  zip_code?: string
  latitude?: number
  longitude?: number
  buildingArea?: number
  building_area?: number
  yearBuilt?: number
  year_built?: number
  totalBedrooms?: number
  total_bedrooms?: number
  bedrooms?: number
  totalBathrooms?: number
  total_bathrooms?: number
  bathrooms?: number
  transferPrice?: number
  transfer_price?: number
  salePrice?: number
  sale_price?: number
  transferDate?: string
  transfer_date?: string
  transferDateObject?: string
  transfer_date_object?: string
  saleDate?: string
  sale_date?: string
  distance?: number
  [k: string]: unknown
}

/** Comp shape matching CountyCompBase for downstream enrichment/display. */
export type MappedRealieComp = {
  pin: string
  pinRaw: string
  address: string
  city: string
  zipCode: string
  neighborhood: string | null
  saleDate: string | null
  salePrice: number | null
  pricePerSqft: number | null
  buildingClass: string | null
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  dataSource: string
  distanceFromSubject: number | null
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function toDateISO(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`
    return v
  }
  return null
}

function mapOne(c: RealieComparableRaw): MappedRealieComp | null {
  const pin =
    c.parcelId ??
    c.parcel_id ??
    c.pin ??
    (typeof c === "object" && (c as Record<string, unknown>).parcelId)
  if (!pin) return null
  const pinRaw = normalizePin(String(pin))
  if (pinRaw.length !== 14) return null
  const salePrice =
    num(c.transferPrice) ??
    num(c.transfer_price) ??
    num(c.salePrice) ??
    num(c.sale_price) ??
    null
  const saleDate =
    toDateISO(c.transferDateObject) ??
    toDateISO(c.transfer_date_object) ??
    toDateISO(c.transferDate) ??
    toDateISO(c.transfer_date) ??
    toDateISO(c.saleDate) ??
    toDateISO(c.sale_date)
  const livingArea =
    num(c.buildingArea) ?? num(c.building_area) ?? null
  const yearBuilt = num(c.yearBuilt) ?? num(c.year_built) ?? null
  const bedrooms =
    num(c.totalBedrooms) ?? num(c.total_bedrooms) ?? num(c.bedrooms) ?? null
  const bathrooms =
    num(c.totalBathrooms) ?? num(c.total_bathrooms) ?? num(c.bathrooms) ?? null
  const pricePerSqft =
    livingArea != null &&
    livingArea > 0 &&
    salePrice != null &&
    salePrice > 0
      ? salePrice / livingArea
      : null
  const address =
    typeof c.addressFull === "string"
      ? c.addressFull
      : typeof c.address === "string"
        ? c.address
        : typeof c.streetAddress === "string"
          ? c.streetAddress
          : `PIN ${formatPIN(pinRaw)}`
  const city = typeof c.city === "string" ? c.city : ""
  const zipCode =
    typeof c.zipCode === "string" ? c.zipCode : typeof c.zip_code === "string" ? c.zip_code : ""
  const distanceFromSubject = num(c.distance) ?? null

  return {
    pin: formatPIN(pinRaw),
    pinRaw,
    address,
    city,
    zipCode,
    neighborhood: null,
    saleDate,
    salePrice,
    pricePerSqft,
    buildingClass: null,
    livingArea,
    yearBuilt,
    bedrooms,
    bathrooms,
    dataSource: "Realie Premium Comparables",
    distanceFromSubject,
  }
}

export type FetchRealieComparablesOptions = {
  latitude: number
  longitude: number
  radius?: number
  timeFrame?: number
  maxResults?: number
  subjectPin?: string
}

export type FetchRealieComparablesResult =
  | { success: true; comps: MappedRealieComp[] }
  | { success: false; error: string }

/**
 * Fetch comparables from Realie Premium API.
 * Returns mapped comps when API key is set and response is valid.
 * Skips comps without parcelId (Rule 15 requires Cook County PIN).
 */
export async function fetchRealieComparables(
  options: FetchRealieComparablesOptions
): Promise<FetchRealieComparablesResult> {
  const apiKey = process.env.REALIE_API_KEY
  if (!apiKey) {
    return { success: false, error: "REALIE_API_KEY not configured" }
  }

  const {
    latitude,
    longitude,
    radius = 1,
    timeFrame = 18,
    maxResults = 25,
    subjectPin,
  } = options

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    radius: String(radius),
    timeFrame: String(timeFrame),
    maxResults: String(Math.min(Math.max(maxResults, 1), 50)),
  })

  const url = `${REALIE_PREMIUM_COMPARABLES_URL}?${params.toString()}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      next: { revalidate: 0 },
    })

    if (res.status === 401) return { success: false, error: "Unauthorized" }
    if (res.status === 403) return { success: false, error: "Usage limit exceeded" }
    if (res.status === 404) return { success: true, comps: [] }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      return {
        success: false,
        error: err.error ?? `Realie API ${res.status}`,
      }
    }

    const json = (await res.json()) as {
      comparables?: RealieComparableRaw[]
      comparable?: RealieComparableRaw[]
    }
    const raw = json.comparables ?? json.comparable ?? []
    const normalizedSubject = subjectPin ? normalizePin(subjectPin) : ""

    const comps = (Array.isArray(raw) ? raw : [])
      .map((c) => mapOne(c as RealieComparableRaw))
      .filter((c): c is MappedRealieComp => c != null)
      .filter((c) => c.pinRaw !== normalizedSubject)

  return { success: true, comps }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  }
}
