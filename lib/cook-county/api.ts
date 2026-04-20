// Cook County Open Data API Client
// Uses Socrata Open Data API (SODA)
// Documentation: https://dev.socrata.com/docs/queries/

import type {
  PropertyData,
  ParcelUniverseRecord,
  ImprovementCharacteristicsRecord,
  ParcelSalesRecord,
  SalesRecord,
  EquityRecord,
  CookCountyApiResponse,
  PIN,
  AssessmentHistoryRecord,
} from './types'

// Dataset IDs from Cook County Open Data Portal
const DATASETS = {
  // Parcel Universe - Property locations, PINs, addresses (archived; some endpoints may use current)
  PARCEL_UNIVERSE: 'tx2p-k2g9',
  // PIN lookup / address index (c49d-89sn) - smaller dataset, fast LIKE queries, property_address / property_city columns
  PIN_ADDRESS_INDEX: 'c49d-89sn',
  // Parcel Universe Current Year - use for equity comps (has nbhd_code, township_code)
  PARCEL_UNIVERSE_CURRENT: 'pabr-t5kh',
  // Assessed Values - Land, building, and total assessed values (mailed, certified, board)
  ASSESSED_VALUES: 'uzyt-m557',
  // Single-Family Improvement Characteristics
  SINGLE_FAMILY_CHARS: 'bcnq-qi2z',
  // Multi-Family Improvement Characteristics (deprecated 2025 - returns dataset.missing)
  MULTI_FAMILY_CHARS: 'n6jx-6jqg',
  // Combined Single+Multi-Family (preferred when multi-family dataset is missing)
  IMPROVEMENT_CHARS_COMBINED: 'x54s-btds',
  // Parcel Sales
  PARCEL_SALES: 'wvhk-k5uv',
  // Neighborhoods
  NEIGHBORHOODS: 'pcdw-pxtg',
  // Cook County Clerk - Tax Rates by Tax Code
  TAX_RATES: '9sqg-vznj',
} as const

// State Equalization Factor (multiplier) for Cook County
// Set annually by Illinois Dept of Revenue. 2024 final: 3.0355 (https://tax.illinois.gov/research/news/2024-cook-county-final-multiplier.html)
const STATE_EQUALIZER_BY_YEAR: Record<number, number> = {
  2024: 3.0355,
  2023: 2.9160,
  2022: 2.9160, // approximate; use 2023 if needed
}
const DEFAULT_STATE_EQUALIZER = 3.0355

const BASE_URL = 'https://datacatalog.cookcountyil.gov/resource'
/** Fallback when primary returns 404 (e.g. some network/routing scenarios) */
const BASE_URL_FALLBACK = 'https://cookcounty.socrata.com/resource'

// Socrata API limits
const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 50000

/**
 * Normalize PIN to 14-digit format without dashes
 * Cook County PINs are 14 digits: Volume-Township-Range-Section-Block-Parcel
 */
export function normalizePIN(pin: string): string {
  // Remove any dashes, spaces, or other characters
  return pin.replace(/[^0-9]/g, '')
}

/**
 * Format PIN with dashes for display
 * Format: XX-XX-XXX-XXX-XXXX (14 digits total)
 */
export function formatPIN(pin: string): string {
  const normalized = normalizePIN(pin)
  if (normalized.length !== 14) {
    return pin // Return as-is if not valid
  }
  return `${normalized.slice(0, 2)}-${normalized.slice(2, 4)}-${normalized.slice(4, 7)}-${normalized.slice(7, 10)}-${normalized.slice(10, 14)}`
}

/**
 * Validate PIN format
 */
export function isValidPIN(pin: string): boolean {
  const normalized = normalizePIN(pin)
  return /^\d{14}$/.test(normalized)
}

/**
 * Fetch data from Socrata API.
 * Retries with cookcounty.socrata.com if primary (datacatalog.cookcountyil.gov) returns 404.
 */
async function fetchSocrataData<T>(
  datasetId: string,
  query: string,
  timeoutMs = 8000
): Promise<T[]> {
  const urls = [`${BASE_URL}/${datasetId}.json?${query}`, `${BASE_URL_FALLBACK}/${datasetId}.json?${query}`]
  let lastError: Error | null = null

  for (const url of urls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 3600 },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (response.ok) return response.json()

    const errorBody = await response.text()
    console.error('Socrata API error:', { status: response.status, datasetId, url, body: errorBody.slice(0, 500) })

    if (response.status === 404 && url.startsWith(BASE_URL)) {
      lastError = new Error(`Socrata API error: ${response.status} ${response.statusText}`)
      continue
    }

    throw new Error(`Socrata API error: ${response.status} ${response.statusText}`)
  }

  throw lastError ?? new Error('Socrata API error: 404 Not Found')
}

/**
 * Get township_code for a neighborhood from NEIGHBORHOODS dataset.
 * Used for broader geographic fallback when neighborhood returns few comps.
 */
async function getTownshipForNeighborhood(nbhd: string): Promise<string | null> {
  try {
    const query = `$where=${encodeURIComponent(`nbhd='${nbhd}'`)}&$limit=1`
    const results = await fetchSocrataData<Record<string, unknown>>(DATASETS.NEIGHBORHOODS, query)
    const townshipCode = results[0]?.township_code ?? (results[0] as Record<string, unknown>)?.town_code
    return townshipCode != null ? String(townshipCode) : null
  } catch {
    return null
  }
}

/**
 * Look up property by PIN in Parcel Universe.
 * Tries current dataset first (pabr-t5kh), then archived (tx2p-k2g9).
 */
async function getParcelUniverseByPIN(
  pin: PIN
): Promise<ParcelUniverseRecord | null> {
  const normalizedPIN = normalizePIN(pin)
  const query = `$where=${encodeURIComponent(`pin='${normalizedPIN}'`)}&$limit=1`

  let currentRecord: ParcelUniverseRecord | null = null
  let archivedRecord: ParcelUniverseRecord | null = null

  try {
    const results = await fetchSocrataData<ParcelUniverseRecord>(DATASETS.PARCEL_UNIVERSE_CURRENT, query)
    if (results[0]) currentRecord = results[0]
  } catch { /* continue */ }

  // Current dataset (pabr-t5kh) does not contain address fields (property_address, property_city).
  // Fetch archived dataset (tx2p-k2g9) to get address fields and merge them in.
  const currentHasAddress = currentRecord && currentRecord.property_address
  if (!currentHasAddress) {
    try {
      const results = await fetchSocrataData<ParcelUniverseRecord>(DATASETS.PARCEL_UNIVERSE, query)
      if (results[0]) archivedRecord = results[0]
    } catch { /* continue */ }
  }

  if (currentRecord && archivedRecord) {
    // Merge: current record wins for non-address fields; archived fills in the address.
    // IMPORTANT: archived dataset (tx2p-k2g9) stores address as prop_address_full / prop_address_city_name /
    // prop_address_zipcode_1 — NOT as property_address. Spreading currentRecord over archivedRecord would
    // silently delete these prop_address_* fields (they don't exist in pabr-t5kh). Preserve them explicitly.
    const arch = archivedRecord as unknown as Record<string, unknown>
    return {
      ...archivedRecord,
      ...currentRecord,
      // Archived prop_address_* fields (override any undefined from current spread)
      prop_address_full: (arch.prop_address_full as string | undefined) || undefined,
      prop_address_city_name: (arch.prop_address_city_name as string | undefined) || undefined,
      prop_address_zipcode_1: (arch.prop_address_zipcode_1 as string | undefined) || undefined,
      prop_address_state: (arch.prop_address_state as string | undefined) || undefined,
      // Fallback property_address / property_city columns (used by some API consumers)
      property_address: archivedRecord.property_address || currentRecord.property_address || (arch.prop_address_full as string | undefined),
      property_city: archivedRecord.property_city || currentRecord.property_city || (arch.prop_address_city_name as string | undefined),
      property_zip: archivedRecord.property_zip || currentRecord.property_zip || (arch.prop_address_zipcode_1 as string | undefined),
    }
  }

  return currentRecord ?? archivedRecord
}

/**
 * Look up property characteristics (Single-Family)
 */
async function getSingleFamilyCharsByPIN(
  pin: PIN
): Promise<ImprovementCharacteristicsRecord | null> {
  const normalizedPIN = normalizePIN(pin)
  const query = `$where=${encodeURIComponent(`pin='${normalizedPIN}'`)}&$limit=1&$order=${encodeURIComponent('tax_year DESC')}`
  
  const results = await fetchSocrataData<ImprovementCharacteristicsRecord>(
    DATASETS.SINGLE_FAMILY_CHARS,
    query
  )
  
  return results[0] || null
}

/**
 * Look up property characteristics (Multi-Family).
 * Dataset n6jx-6jqg was deprecated by Cook County (returns dataset.missing).
 * @deprecated Use getImprovementCharsFromCombinedByPIN instead.
 */
async function getMultiFamilyCharsByPIN(
  pin: PIN
): Promise<ImprovementCharacteristicsRecord | null> {
  try {
    const normalizedPIN = normalizePIN(pin)
    const query = `$where=${encodeURIComponent(`pin='${normalizedPIN}'`)}&$limit=1&$order=${encodeURIComponent('tax_year DESC')}`
    const results = await fetchSocrataData<ImprovementCharacteristicsRecord>(
      DATASETS.MULTI_FAMILY_CHARS,
      query
    )
    return results[0] || null
  } catch {
    return null
  }
}

/**
 * Look up improvement characteristics from combined Single+Multi-Family dataset (x54s-btds).
 * Use this instead of Single+Multi separately — n6jx-6jqg was deprecated.
 */
async function getImprovementCharsFromCombinedByPIN(pin: PIN): Promise<Record<string, unknown> | null> {
  const normalizedPIN = normalizePIN(pin)
  if (normalizedPIN.length !== 14) return null
  const dashedPIN = formatPIN(normalizedPIN)
  // x54s-btds has only pin (14-digit), not pin10
  for (const { col, val } of [
    { col: 'pin', val: normalizedPIN },
    { col: 'pin', val: dashedPIN },
  ]) {
    if (!val) continue
    try {
      const query = `$where=${encodeURIComponent(`${col}='${val}'`)}&$limit=1&$order=${encodeURIComponent('year DESC')}`
      const results = await fetchSocrataData<Record<string, unknown>>(
        DATASETS.IMPROVEMENT_CHARS_COMBINED,
        query
      )
      if (results[0]) return results[0]
    } catch {
      continue
    }
  }
  return null
}

/**
 * Look up assessed values by PIN
 * Returns mailed, certified, and board values for land, building, and total
 * Tries pin (14-digit, dashed) and pin10 columns (Cook County datasets may use either)
 */
async function getAssessedValuesByPIN(
  pin: PIN
): Promise<Record<string, unknown> | null> {
  const normalizedPIN = normalizePIN(pin)
  if (normalizedPIN.length !== 14) return null
  const dashedPIN = formatPIN(normalizedPIN)
  const pin10 = normalizedPIN.slice(4) // last 10 digits
  const pin10Dashed = pin10.length >= 10 ? `${pin10.slice(0, 2)}-${pin10.slice(2, 5)}-${pin10.slice(5, 8)}-${pin10.slice(8)}` : ''
  for (const { col, val } of [
    { col: 'pin', val: normalizedPIN },
    { col: 'pin', val: dashedPIN },
    { col: 'pin10', val: pin10 },
    { col: 'pin10', val: pin10Dashed },
  ]) {
    if (!val) continue
    try {
      // Filter mailed_tot > 0 to skip placeholder rows (e.g. future-year rows with no values yet)
      const query = `$where=${encodeURIComponent(`${col}='${val}' AND mailed_tot > 0`)}&$limit=1&$order=${encodeURIComponent('year DESC')}`
      const results = await fetchSocrataData<Record<string, unknown>>(
        DATASETS.ASSESSED_VALUES,
        query
      )
      if (results[0]) return results[0]
    } catch {
      continue
    }
  }
  return null
}

/**
 * Look up historical assessed values by PIN
 * Returns all available years of assessment data (1999-present)
 */
async function getAssessmentHistoryByPIN(
  pin: PIN,
  limit: number = 20
): Promise<AssessmentHistoryRecord[]> {
  const normalizedPIN = normalizePIN(pin)
  // Get all available years, ordered most recent first
  const query = `$where=${encodeURIComponent(`pin='${normalizedPIN}'`)}&$limit=${limit}&$order=${encodeURIComponent('year DESC')}`
  
  const results = await fetchSocrataData<Record<string, unknown>>(
    DATASETS.ASSESSED_VALUES,
    query
  )
  
  // Transform to AssessmentHistoryRecord format
  return results.map((record) => {
    // Determine which stage has values (prefer board > certified > mailed)
    let stage: 'mailed' | 'certified' | 'board' = 'mailed'
    let landValue = parseAssessedValue(record.mailed_land)
    let bldgValue = parseAssessedValue(record.mailed_bldg)
    let totalValue = parseAssessedValue(record.mailed_tot)
    
    if (record.certified_tot) {
      stage = 'certified'
      landValue = parseAssessedValue(record.certified_land) || landValue
      bldgValue = parseAssessedValue(record.certified_bldg) || bldgValue
      totalValue = parseAssessedValue(record.certified_tot) || totalValue
    }
    
    if (record.board_tot) {
      stage = 'board'
      landValue = parseAssessedValue(record.board_land) || landValue
      bldgValue = parseAssessedValue(record.board_bldg) || bldgValue
      totalValue = parseAssessedValue(record.board_tot) || totalValue
    }
    
    return {
      year: parseInt(String(record.year), 10),
      assessedLandValue: landValue,
      assessedBuildingValue: bldgValue,
      assessedTotalValue: totalValue,
      marketValue: totalValue ? totalValue * 10 : null,
      stage,
    }
  }).filter((record) => !isNaN(record.year))  // Filter out invalid years
}

/**
 * Tax Rate Record from Cook County Clerk dataset
 */
/**
 * Tax Rate Record from Cook County Clerk dataset (9sqg-vznj).
 * tax_code_rate = total composite rate as % (e.g. 5.525 = 5.525%). Dataset has data through 2013.
 */
interface TaxRateRecord {
  tax_year: string
  tax_code: string
  agency_name?: string
  agency_rate?: string
  tax_code_rate: string
}

/**
 * Get the total tax rate for a given tax code (decimal, e.g. 0.05525 for 5.525%).
 * Uses tax_code_rate. Tries years 2024 down to 2013 (dataset has through 2013).
 */
async function getTaxRateByCode(
  taxCode: string,
  taxYearHint?: number
): Promise<number | null> {
  try {
    const startYear = taxYearHint ?? new Date().getFullYear() - 1
    // Cap at 4 attempts: dataset only has data through ~2013, so trying 14 years wastes 13 sequential 8s calls
    const yearsToTry = Array.from({ length: 4 }, (_, i) => startYear - i).filter((y) => y >= 2006 && y <= startYear)

    for (const year of yearsToTry) {
      const query = `$where=${encodeURIComponent(`tax_code='${taxCode}' AND tax_year='${year}'`)}&$limit=1`
      const results = await fetchSocrataData<TaxRateRecord>(DATASETS.TAX_RATES, query)

      if (results.length > 0 && results[0].tax_code_rate) {
        const pct = parseFloat(results[0].tax_code_rate)
        if (!Number.isNaN(pct)) return pct / 100
      }
    }
    return null
  } catch (error) {
    console.error('Error fetching tax rate:', error)
    return null
  }
}

/**
 * Get property data by PIN (combines Parcel Universe + Characteristics)
 */
export async function getPropertyByPIN(
  pin: PIN
): Promise<CookCountyApiResponse<PropertyData>> {
  try {
    if (!isValidPIN(pin)) {
      return {
        success: false,
        data: null,
        error: 'Invalid PIN format. Cook County PINs should be 14 digits.',
        source: 'validation',
      }
    }
    
    const normalizedPIN = normalizePIN(pin)
    
    // Fetch parcel universe data (location, address)
    const parcelData = await getParcelUniverseByPIN(normalizedPIN)
    
    if (!parcelData) {
      return {
        success: false,
        data: null,
        error: `Property not found for PIN: ${formatPIN(normalizedPIN)}`,
        source: 'Cook County Open Data',
      }
    }
    
    // Fetch improvement characteristics (combined dataset first, then single-family fallback)
    let charData: Record<string, unknown> | null = await getImprovementCharsFromCombinedByPIN(normalizedPIN)
    if (!charData) {
      charData = (await getSingleFamilyCharsByPIN(normalizedPIN)) as Record<string, unknown> | null
    }
    
    // Get tax code from parcel (try common field names; Socrata column may vary)
    const parcel = parcelData as unknown as Record<string, unknown>
    const taxCode = (
      (parcel.tax_code ?? parcel.taxcode ?? parcel.tax_code_display) as string | null
    )?.trim() || null

    // Fetch assessed values, assessment history, and tax rate in parallel
    const [assessedData, assessmentHistory, taxRate] = await Promise.all([
      getAssessedValuesByPIN(normalizedPIN),
      getAssessmentHistoryByPIN(normalizedPIN, 15),  // Get up to 15 years of history
      taxCode ? getTaxRateByCode(taxCode) : Promise.resolve(null)
    ])
    
    // Combine data - using actual API field names
    // Parcel Universe: prop_address_full, prop_address_city_name, prop_address_zipcode_1, lat, lon, nbhd_code, tax_code
    // Single Family chars: bldg_sf, beds, fbath, hbath
    // Assessed Values: mailed_land, mailed_bldg, mailed_tot, certified_*, board_*
    const chars = charData as Record<string, unknown> | null
    const assessed = assessedData as Record<string, unknown> | null
    
    const propertyData: PropertyData = {
      pin: normalizedPIN,
      // Address fields - try multiple possible field names
      address: (parcel.prop_address_full || parcel.property_address || '') as string,
      city: (parcel.prop_address_city_name || parcel.property_city || parcel.cook_municipality_name || '') as string,
      state: 'IL',
      zipCode: (parcel.prop_address_zipcode_1 || parcel.property_zip || parcel.zip_code || '') as string,
      county: 'Cook',
      
      // Location
      neighborhood: (parcel.nbhd_code || parcel.nbhd || chars?.nbhd || null) as string | null,
      township: (parcel.township_name || null) as string | null,
      latitude: parcel.lat ? parseFloat(parcel.lat as string) : (parcel.latitude ? parseFloat(parcel.latitude as string) : null),
      longitude: parcel.lon ? parseFloat(parcel.lon as string) : (parcel.longitude ? parseFloat(parcel.longitude as string) : null),
      
      // Property characteristics (from improvement characteristics if available)
      // Try both with and without char_ prefix; parcel may have bldg_sf in some views
      buildingClass: (parcel.class || chars?.class || null) as string | null,
      cdu: (chars?.cnst_qlty || chars?.char_cnst_qlty || chars?.condition_desirability_and_utility || null) as string | null,
      livingArea: parseIntSafe(
        chars?.bldg_sf || chars?.char_bldg_sf || chars?.total_bldg_sf || parcel.bldg_sf || parcel.char_bldg_sf
      ),
      landSize: parseIntSafe(chars?.land_sf || chars?.char_land_sf || parcel.land_sf || parcel.char_land_sf),
      yearBuilt: parseIntSafe(chars?.yrblt || chars?.char_yrblt),
      bedrooms: parseIntSafe(chars?.beds || chars?.char_beds),
      bathrooms: chars ? 
        ((parseIntSafe(chars.fbath || chars.char_fbath) || 0) + 0.5 * (parseIntSafe(chars.hbath || chars.char_hbath) || 0)) || null 
        : null,
      exteriorWall: (chars?.ext_wall || chars?.char_ext_wall || null) as string | null,
      roofType: (chars?.roof_cnst || chars?.char_roof_cnst || null) as string | null,
      basement: (chars?.bsmt || chars?.char_bsmt || null) as string | null,
      airConditioning: (chars?.air || chars?.char_air || null) as string | null,
      garage: (chars?.gar1_size || chars?.char_gar1_size || null) as string | null,
      
      // Assessment values - prioritize Assessed Values dataset (board > certified > mailed)
      assessedLandValue: parseAssessedValue(
        assessed?.board_land || assessed?.certified_land || assessed?.mailed_land ||
        parcel.board_land || parcel.certified_land || parcel.mailed_land ||
        chars?.av_land || chars?.pri_est_land
      ),
      assessedBuildingValue: parseAssessedValue(
        assessed?.board_bldg || assessed?.certified_bldg || assessed?.mailed_bldg ||
        parcel.board_bldg || parcel.certified_bldg || parcel.mailed_bldg ||
        chars?.av_bldg || chars?.pri_est_bldg
      ),
      assessedTotalValue: parseAssessedValue(
        assessed?.board_tot || assessed?.certified_tot || assessed?.mailed_tot ||
        parcel.board_tot || parcel.certified_tot || parcel.mailed_tot ||
        chars?.tot_val
      ),
      marketValue: null, // Calculated below
      
      // Tax information
      taxCode: taxCode,
      taxRate: taxRate, // Total tax rate as decimal (e.g., 0.05525 for 5.525%)
      stateEqualizer: (() => {
        const latestYear = assessmentHistory[0]?.year ?? new Date().getFullYear()
        return STATE_EQUALIZER_BY_YEAR[latestYear] ?? DEFAULT_STATE_EQUALIZER
      })(),
      
      // Assessment history (multiple years)
      assessmentHistory: assessmentHistory,
      
      dataSource: 'Cook County Open Data',
      lastUpdated: new Date(),
    }
    
    // Calculate market value (assessment × 10 for Cook County residential)
    if (propertyData.assessedTotalValue) {
      propertyData.marketValue = propertyData.assessedTotalValue * 10
    }
    
    return {
      success: true,
      data: propertyData,
      error: null,
      source: 'Cook County Open Data',
    }
  } catch (error) {
    console.error('Error fetching property data:', error)
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : 'Failed to fetch property data',
      source: 'Cook County Open Data',
    }
  }
}

/**
 * Search properties by address.
 *
 * Strategy:
 *  1. PIN_ADDRESS_INDEX (c49d-89sn) — fast, has property_address / property_city columns.
 *  2. If 0 results, fall back to archived Parcel Universe (tx2p-k2g9) which stores address
 *     in prop_address_full / prop_address_city_name. Dedupes by PIN (dataset has one row per
 *     tax year so the same PIN can appear multiple times).
 *
 * Both datasets include a `pin` (14-digit) field used by the caller to drive getPropertyByPIN.
 */
export async function searchPropertiesByAddress(
  address: string,
  city?: string,
  limit: number = 10
): Promise<CookCountyApiResponse<ParcelUniverseRecord[]>> {
  try {
    const addrSafe = address.trim().replace(/'/g, "''")
    const citySafe = city?.trim().replace(/'/g, "''") ?? ""

    // ── Primary: PIN_ADDRESS_INDEX (c49d-89sn) ──────────────────────────────
    // Columns: property_address, property_city, property_zip, pin, latitude, longitude, township_name, nbhd
    let whereClause = `upper(property_address) like upper('%${addrSafe}%')`
    if (citySafe) {
      whereClause += ` AND upper(property_city) like upper('%${citySafe}%')`
    }
    const query = `$where=${encodeURIComponent(whereClause)}&$limit=${limit}`

    let results: ParcelUniverseRecord[] = []
    let source = 'Cook County Open Data - PIN Address Index'
    try {
      results = await fetchSocrataData<ParcelUniverseRecord>(DATASETS.PIN_ADDRESS_INDEX, query, 7000)
    } catch (err) {
      console.warn('[searchPropertiesByAddress] PIN_ADDRESS_INDEX failed, will try archived dataset', err)
    }

    // ── Fallback: archived Parcel Universe (tx2p-k2g9) ──────────────────────
    // Used when primary returns 0 results (e.g. user omitted directional like "N"/"S").
    // Address column here is prop_address_full; city is prop_address_city_name.
    // Normalize results so callers always see property_address / property_city.
    if (results.length === 0) {
      const archWhereClause = citySafe
        ? `upper(prop_address_full) like upper('%${addrSafe}%') AND upper(prop_address_city_name) like upper('%${citySafe}%')`
        : `upper(prop_address_full) like upper('%${addrSafe}%')`
      const archQuery = `$where=${encodeURIComponent(archWhereClause)}&$limit=${limit * 3}&$order=year DESC`
      try {
        const archResults = await fetchSocrataData<Record<string, unknown>>(
          DATASETS.PARCEL_UNIVERSE,
          archQuery,
          8000
        )
        // Dedupe by PIN (multiple rows per PIN across years — keep most recent)
        const seenPins = new Set<string>()
        const dedupedArch: ParcelUniverseRecord[] = []
        for (const r of archResults) {
          const pin = String(r.pin ?? '').replace(/\D/g, '')
          if (!pin || seenPins.has(pin)) continue
          seenPins.add(pin)
          // Normalize to ParcelUniverseRecord shape so callers work uniformly
          dedupedArch.push({
            ...(r as unknown as ParcelUniverseRecord),
            // Map archived address columns → standard address columns
            property_address: (r.prop_address_full as string | undefined) || (r.property_address as string | undefined) || '',
            property_city: (r.prop_address_city_name as string | undefined) || (r.property_city as string | undefined) || '',
            property_zip: (r.prop_address_zipcode_1 as string | undefined) || (r.property_zip as string | undefined) || '',
          })
          if (dedupedArch.length >= limit) break
        }
        if (dedupedArch.length > 0) {
          results = dedupedArch
          source = 'Cook County Open Data - Parcel Universe (archived)'
        }
      } catch (archErr) {
        console.warn('[searchPropertiesByAddress] archived Parcel Universe fallback failed', archErr)
      }
    }

    return {
      success: true,
      data: results,
      error: null,
      source,
    }
  } catch (error) {
    console.error('Error searching properties:', error)
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : 'Failed to search properties',
      source: 'Cook County Open Data',
    }
  }
}

/**
 * Fetch address (and city, zip, lat/lon, buildingClass) by PIN from Parcel Universe. Used to enrich comps list and compute distance.
 */
export async function getAddressByPIN(pin: PIN): Promise<{
  address: string
  city: string
  zipCode: string
  latitude: number | null
  longitude: number | null
  buildingClass: string | null
} | null> {
  const parcel = await getParcelUniverseByPIN(pin)
  if (!parcel) return null
  const p = parcel as unknown as Record<string, unknown>
  const address =
    (p.prop_address_full ?? p.property_address ?? p.addr ?? "") as string
  const city = (p.prop_address_city_name ?? p.property_city ?? p.cook_municipality_name ?? "") as string
  const zipCode = (p.prop_address_zipcode_1 ?? p.property_zip ?? p.zip_code ?? "") as string
  const lat = p.lat != null ? parseFloat(String(p.lat)) : (p.latitude != null ? parseFloat(String(p.latitude)) : null)
  const lon = p.lon != null ? parseFloat(String(p.lon)) : (p.longitude != null ? parseFloat(String(p.longitude)) : null)
  const latitude = lat != null && !Number.isNaN(lat) ? lat : null
  const longitude = lon != null && !Number.isNaN(lon) ? lon : null
  const buildingClass =
    (p.class ?? p.char_class) != null ? (String(p.class ?? p.char_class ?? '').trim() || null) : null
  if (!address && !city) return null
  return { address: address || `PIN ${formatPIN(String(p.pin ?? pin))}`, city, zipCode, latitude, longitude, buildingClass }
}

/**
 * Haversine distance in miles between two (lat, lon) points.
 */
export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959 // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Fetch improvement characteristics (living area, year built, etc.) by PIN.
 * Uses combined dataset (x54s-btds) to avoid deprecated Multi-Family dataset (n6jx-6jqg).
 */
async function getImprovementCharsForPIN(pin: PIN): Promise<{
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
} | null> {
  let c = await getImprovementCharsFromCombinedByPIN(pin)
  if (!c) c = (await getSingleFamilyCharsByPIN(pin)) as Record<string, unknown> | null
  if (!c) return null
  const bldgSf = c?.bldg_sf ?? c?.char_bldg_sf ?? c?.total_bldg_sf
  const yrblt = c?.yrblt ?? c?.char_yrblt
  const beds = c?.beds ?? c?.char_beds
  const fbath = c?.fbath ?? c?.char_fbath
  const hbath = c?.hbath ?? c?.char_hbath
  const livingArea = bldgSf != null ? parseIntSafe(bldgSf) : null
  const yearBuilt = yrblt != null ? parseIntSafe(yrblt) : null
  const bedrooms = beds != null ? parseIntSafe(beds) : null
  const bathrooms =
    fbath != null || hbath != null
      ? (parseIntSafe(fbath) ?? 0) + 0.5 * (parseIntSafe(hbath) ?? 0)
      : null
  return { livingArea, yearBuilt, bedrooms, bathrooms }
}

/**
 * Internal: fetch comparable sales with given filters.
 */
async function fetchComparableSalesWithFilters(
  propertyPin: string,
  filters: string[],
  limit: number
): Promise<SalesRecord[]> {
  const query = `$where=${encodeURIComponent(filters.join(' AND '))}&$limit=${limit}&$order=sale_date DESC`
  const results = await fetchSocrataData<Record<string, unknown>>(
    DATASETS.PARCEL_SALES,
    query
  )
  return buildSalesRecordsFromRaw(results, propertyPin)
}

/**
 * Build SalesRecord[] from raw Parcel Sales API results.
 */
async function buildSalesRecordsFromRaw(
  rawRecords: Array<Record<string, unknown>>,
  excludePin: string
): Promise<SalesRecord[]> {
  const uniquePins = [...new Set(rawRecords.map((r) => String(r.pin ?? '')))].filter(Boolean).filter((p) => p !== excludePin).slice(0, 20)
  const charsByPin = new Map<string, Awaited<ReturnType<typeof getImprovementCharsForPIN>>>()
  await Promise.all(
    uniquePins.map(async (pin) => {
      const chars = await getImprovementCharsForPIN(pin)
      if (chars) charsByPin.set(pin, chars)
    })
  )

  const assessedByPin = new Map<string, number | null>()
  const ASSESSED_CONCURRENCY = 3
  for (let i = 0; i < uniquePins.length; i += ASSESSED_CONCURRENCY) {
    const batch = uniquePins.slice(i, i + ASSESSED_CONCURRENCY)
    const assessedResults = await Promise.all(batch.map((pin) => getAssessedValuesByPIN(pin)))
    batch.forEach((pin, j) => {
      const av = assessedResults[j] as Record<string, unknown> | null
      const tot = av?.board_tot ?? av?.certified_tot ?? av?.mailed_tot
      assessedByPin.set(pin, tot != null ? parseAssessedValue(tot) : null)
    })
  }

  return rawRecords
    .filter((r) => String(r.pin ?? '').replace(/[^0-9]/g, '') !== excludePin.replace(/[^0-9]/g, ''))
    .map((record) => {
      const pin = String(record.pin ?? '')
      const salePrice = parseFloat(String(record.sale_price ?? 0)) || 0
      const chars = charsByPin.get(pin) ?? null
      const assessedTotal = assessedByPin.get(pin) ?? null
      const livingArea =
        chars?.livingArea ??
        (record.char_bldg_sf != null ? parseIntSafe(record.char_bldg_sf) : null) ??
        (record.bldg_sf != null ? parseIntSafe(record.bldg_sf) : null)
      const yearBuilt =
        chars?.yearBuilt ??
        (record.char_yrblt != null ? parseIntSafe(record.char_yrblt) : null) ??
        (record.yrblt != null ? parseIntSafe(record.yrblt) : null)
      const bedrooms = chars?.bedrooms ?? (record.char_beds != null ? parseIntSafe(record.char_beds) : null)
      const bathrooms = chars?.bathrooms ?? (record.char_fbath != null ? parseIntSafe(record.char_fbath) : null)
      const pricePerSqft =
        livingArea != null && livingArea > 0 && salePrice > 0 ? salePrice / livingArea : null
      const assessedMarketValue = assessedTotal != null ? assessedTotal * 10 : null
      const assessedMarketValuePerSqft =
        livingArea != null && livingArea > 0 && assessedMarketValue != null ? assessedMarketValue / livingArea : null
      return {
        pin,
        address: '',
        city: '',
        zipCode: '',
        neighborhood: String(record.nbhd ?? ''),
        saleDate: new Date(String(record.sale_date)),
        salePrice,
        pricePerSqft,
        buildingClass: String(record.class ?? ''),
        livingArea,
        yearBuilt,
        bedrooms,
        bathrooms,
        dataSource: 'Cook County Open Data - Parcel Sales',
        assessedMarketValue,
        assessedMarketValuePerSqft,
      }
    })
}

/**
 * Get comparable sales for a property
 * Rule 15: 3+ sales comps, similar size/class/location
 * Enriches each sale with living area etc. from Improvement Characteristics when Parcel Sales has no chars.
 * Uses ASSESSED_VALUES for validation context. Fallback: if few results, retries with relaxed filters (no building class, then broader date range).
 */
export async function getComparableSales(
  property: PropertyData,
  options: {
    maxDistanceMiles?: number
    livingAreaTolerancePercent?: number
    yearBuiltTolerance?: number
    limit?: number
    saleDateAfter?: Date
  } = {}
): Promise<CookCountyApiResponse<SalesRecord[]>> {
  try {
    const {
      limit = 20,
      saleDateAfter = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000), // 2 years
      yearBuiltTolerance = 10,
    } = options

    const MIN_COMPS_FOR_FALLBACK = 5
    const saleDateStr = saleDateAfter.toISOString().split('T')[0]
    const propertyPin = normalizePIN(property.pin)

    const buildFilters = (opts: { includeNeighborhood: boolean; includeBuildingClass: boolean }) => {
      const f: string[] = []
      if (opts.includeNeighborhood && property.neighborhood) f.push(`nbhd='${property.neighborhood}'`)
      if (opts.includeBuildingClass && property.buildingClass) f.push(`class='${property.buildingClass}'`)
      f.push(`sale_date >= '${saleDateStr}'`)
      f.push(`pin != '${propertyPin}'`)
      return f
    }

    let results: SalesRecord[] = []
    let source = 'Cook County Open Data - Parcel Sales'

    const filters1 = buildFilters({ includeNeighborhood: true, includeBuildingClass: true })
    if (filters1.length >= 2) {
      results = await fetchComparableSalesWithFilters(propertyPin, filters1, limit)
    }

    if (results.length < MIN_COMPS_FOR_FALLBACK && property.buildingClass && property.neighborhood) {
      const filters2 = buildFilters({ includeNeighborhood: true, includeBuildingClass: false })
      if (filters2.length >= 2) {
        const fallbackResults = await fetchComparableSalesWithFilters(propertyPin, filters2, limit)
        if (fallbackResults.length > results.length) {
          results = fallbackResults
          source = 'Cook County Open Data - Parcel Sales (relaxed class filter)'
        }
      }
    }

    if (results.length < MIN_COMPS_FOR_FALLBACK && property.neighborhood) {
      const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000)
      const saleDateStr3 = threeYearsAgo.toISOString().split('T')[0]
      const filters3 = [
        `nbhd='${property.neighborhood}'`,
        `sale_date >= '${saleDateStr3}'`,
        `pin != '${propertyPin}'`,
      ]
      const fallbackResults = await buildSalesRecordsFromRaw(
        await fetchSocrataData<Record<string, unknown>>(
          DATASETS.PARCEL_SALES,
          `$where=${encodeURIComponent(filters3.join(' AND '))}&$limit=${limit}&$order=sale_date DESC`
        ),
        propertyPin
      )
      if (fallbackResults.length > results.length) {
        results = fallbackResults
        source = 'Cook County Open Data - Parcel Sales (3-year window)'
      }
    }

    if (results.length < MIN_COMPS_FOR_FALLBACK && property.neighborhood) {
      const townshipCode = await getTownshipForNeighborhood(property.neighborhood)
      if (townshipCode) {
        const filters4 = [
          `township_code='${townshipCode}'`,
          `sale_date >= '${saleDateStr}'`,
          `pin != '${propertyPin}'`,
        ]
        const fallbackResults = await buildSalesRecordsFromRaw(
          await fetchSocrataData<Record<string, unknown>>(
            DATASETS.PARCEL_SALES,
            `$where=${encodeURIComponent(filters4.join(' AND '))}&$limit=${limit}&$order=sale_date DESC`
          ),
          propertyPin
        )
        if (fallbackResults.length > results.length) {
          results = fallbackResults
          source = 'Cook County Open Data - Parcel Sales (township)'
        }
      }
    }

    // Filter by year built when subject has it (Assessor: classification/age matching is key)
    const subjectYear = property.yearBuilt
    if (subjectYear != null && yearBuiltTolerance >= 0 && results.length > 0) {
      const filtered = results.filter((r) => {
        if (r.yearBuilt == null) return true
        return Math.abs(r.yearBuilt - subjectYear) <= yearBuiltTolerance
      })
      if (filtered.length > 0) {
        results = filtered
      }
    }

    return {
      success: true,
      data: results,
      error: null,
      source,
    }
  } catch (error) {
    console.error('Error fetching comparable sales:', error)
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : 'Failed to fetch comparable sales',
      source: 'Cook County Open Data - Parcel Sales',
    }
  }
}

/**
 * Get comparable equity comps for a property (assessed values, no sale).
 * Rule 15 recommends 5+ equity comps. Uses Parcel Universe + ASSESSED_VALUES + Improvement Chars.
 * Returns properties in same neighborhood with similar living area, sorted by assessed $/sqft (lower = more supportive).
 * Fallbacks: (1) when property has no neighborhood, fetch from Parcel Universe by PIN; (2) when neighborhood returns 0, try township_code.
 */
export type EquityDebugInfo = {
  nbhd: string | null
  nbhdFromParcel: boolean
  parcelsCount: number
  uniquePinsCount: number
  resultsBeforeLimit: number
  subjectLivingArea: number
  townshipFallbackUsed: boolean
  /** First 3 sample PINs: raw from parcel, normalized, assessed found, chars found */
  sampleLookups?: Array<{ pinRaw: unknown; pinNorm: string; assessed: boolean; chars: boolean; assessedTotal: number | null; avKeys?: string[] }>
}

export async function getComparableEquity(
  property: PropertyData,
  options: {
    livingAreaTolerancePercent?: number
    yearBuiltTolerance?: number
    limit?: number
    debug?: boolean
  } = {}
): Promise<CookCountyApiResponse<EquityRecord[]> & { _debug?: EquityDebugInfo }> {
  try {
    const { limit = 10, livingAreaTolerancePercent = 25, yearBuiltTolerance = 10, debug: wantDebug = false } = options
    const propertyPin = normalizePIN(property.pin)
    let nbhd = property.neighborhood?.trim()
    let nbhdFromParcel = false

    // Fallback: when property has no neighborhood in DB, fetch from Parcel Universe by subject PIN
    let subjectParcel: ParcelUniverseRecord | null = null
    if (!nbhd) {
      subjectParcel = await getParcelUniverseByPIN(propertyPin)
      if (subjectParcel) {
        const p = subjectParcel as unknown as Record<string, unknown>
        nbhd = (p.nbhd ?? p.nbhd_code) != null ? String(p.nbhd ?? p.nbhd_code).trim() : ''
        nbhdFromParcel = !!nbhd
      }
    }

    // Use current Parcel Universe (pabr-t5kh) - has nbhd_code, township_code
    const parcelDataset = DATASETS.PARCEL_UNIVERSE_CURRENT
    let parcels: Array<Record<string, unknown>> = []
    let townshipFallbackUsed = false
    if (nbhd) {
      const filters = [`nbhd_code='${nbhd}'`, `pin != '${propertyPin}'`]
      const query = `$where=${encodeURIComponent(filters.join(' AND '))}&$limit=150`
      try {
        parcels = await fetchSocrataData<Record<string, unknown>>(parcelDataset, query)
      } catch (err) {
        console.error('[comps-equity] nbhd query failed', { nbhd, err })
        parcels = []
      }
    }

    // Fallback: when neighborhood returns 0, try township_code from subject parcel
    if (parcels.length === 0) {
      const parcel = subjectParcel ?? (await getParcelUniverseByPIN(propertyPin))
      const townshipCode = parcel ? String((parcel as unknown as Record<string, unknown>).township_code ?? '').trim() : ''
      if (townshipCode) {
        townshipFallbackUsed = true
        const filters = [`township_code='${townshipCode}'`, `pin != '${propertyPin}'`]
        const query = `$where=${encodeURIComponent(filters.join(' AND '))}&$limit=150`
        try {
          parcels = await fetchSocrataData<Record<string, unknown>>(parcelDataset, query)
        } catch (err) {
          console.error('[comps-equity] township query failed', { townshipCode, err })
          parcels = []
        }
      }
    }

    // Fallback: when township returns 0, try zip_code (property or subject parcel)
    if (parcels.length === 0) {
      const parcel = subjectParcel ?? (await getParcelUniverseByPIN(propertyPin))
      const p = parcel as unknown as Record<string, unknown>
      const zipFromParcel = [p?.prop_address_zipcode_1, p?.property_zip, p?.zip_code]
        .find((v) => v != null && String(v).trim().length >= 5)
      const zip = (zipFromParcel ? String(zipFromParcel).trim() : (property.zipCode ?? '').replace(/\D/g, '')).slice(0, 5)
      if (zip.length >= 5) {
        townshipFallbackUsed = true
        for (const zipCol of ['prop_address_zipcode_1', 'property_zip', 'zip_code']) {
          try {
            const filters = [`${zipCol} like '${zip}%'`, `pin != '${propertyPin}'`]
            const query = `$where=${encodeURIComponent(filters.join(' AND '))}&$limit=150`
            parcels = await fetchSocrataData<Record<string, unknown>>(parcelDataset, query)
            if (parcels.length > 0) {
              console.log('[comps-equity] Zip fallback succeeded', { zip, column: zipCol, count: parcels.length })
              break
            }
          } catch {
            continue
          }
        }
      }
    }

    if (parcels.length === 0) {
      console.log('[comps-equity] No parcels found', { propertyPin, nbhd: nbhd || '(none)', source: 'neighborhood+township' })
      const emptyResp: CookCountyApiResponse<EquityRecord[]> & { _debug?: EquityDebugInfo } = {
        success: true,
        data: [],
        error: null,
        source: 'Cook County Open Data - Equity (no neighborhood/township)',
      }
      if (wantDebug) {
        emptyResp._debug = {
          nbhd: nbhd || null,
          nbhdFromParcel,
          parcelsCount: 0,
          uniquePinsCount: 0,
          resultsBeforeLimit: 0,
          subjectLivingArea: property.livingArea ?? 0,
          townshipFallbackUsed,
        }
      }
      return emptyResp
    }

    const nbhdForRecords = nbhd || 'same township'
    const subjectParcelRec = (subjectParcel ?? (await getParcelUniverseByPIN(propertyPin))) as Record<string, unknown> | null
    const township = subjectParcelRec ? String(subjectParcelRec.township_code ?? subjectParcelRec.township ?? '').trim() : ''

    const subjectLivingArea = property.livingArea ?? 0
    const lo = subjectLivingArea > 0 ? subjectLivingArea * (1 - livingAreaTolerancePercent / 100) : 0
    const hi = subjectLivingArea > 0 ? subjectLivingArea * (1 + livingAreaTolerancePercent / 100) : Infinity

    const toPin = (v: unknown) => {
      const raw = String(v ?? '').replace(/\D/g, '')
      if (raw.length >= 14) return raw.slice(0, 14)
      if (raw.length > 0) return raw.padStart(14, '0')
      return ''
    }
    const uniquePins = [...new Set(parcels.map((p) => toPin(p.pin)))].filter(Boolean).filter((p) => p !== propertyPin)
    const parcelByPin = new Map(parcels.map((p) => [toPin(p.pin), p]))

    const sampleLookups: EquityDebugInfo['sampleLookups'] = wantDebug
      ? await Promise.all(
          uniquePins.slice(0, 3).map(async (pinNorm) => {
            const parcel = parcelByPin.get(pinNorm)
            const pinRaw = parcel ? (parcel as Record<string, unknown>).pin : null
            const [av, chars] = await Promise.all([
              getAssessedValuesByPIN(pinNorm),
              getImprovementCharsForPIN(pinNorm),
            ])
            const assessedTotal = getAssessedTotalFromRecord(av)
            return {
              pinRaw,
              pinNorm,
              assessed: av != null,
              chars: chars != null,
              assessedTotal,
              avKeys: av ? Object.keys(av) : undefined,
            }
          })
        )
      : undefined

    let results: EquityRecord[] = []
    const BATCH_SIZE = 5

    for (let i = 0; i < uniquePins.length; i += BATCH_SIZE) {
      const batch = uniquePins.slice(i, i + BATCH_SIZE)
      const [assessedResults, charsResults] = await Promise.all([
        Promise.all(batch.map((pin) => getAssessedValuesByPIN(pin))),
        Promise.all(batch.map((pin) => getImprovementCharsForPIN(pin))),
      ])

      batch.forEach((pin, j) => {
        const av = assessedResults[j] as Record<string, unknown> | null
        const assessedTotal = getAssessedTotalFromRecord(av)
        const chars = charsResults[j]
        const parcel = parcelByPin.get(pin) as Record<string, unknown> | undefined
        const livingAreaFromParcel = parcel
          ? parseIntSafe(parcel.bldg_sf ?? parcel.char_bldg_sf ?? parcel.prop_bldg_sf)
          : null
        const livingArea = chars?.livingArea ?? livingAreaFromParcel ?? null

        if (assessedTotal == null || assessedTotal <= 0) return
        // When subject has living area, require comp living area for $/sqft; when subject has none, accept comps with or without
        if (subjectLivingArea > 0) {
          if (livingArea == null || livingArea <= 0) return
          if (livingArea < lo || livingArea > hi) return
        }

        // Filter by building class when subject has it (Assessor: identical classification is key)
        const compBuildingClass = parcel
          ? (String(parcel.class ?? parcel.char_class ?? '').trim() || null)
          : null
        if (property.buildingClass?.trim() && compBuildingClass && compBuildingClass !== property.buildingClass.trim()) {
          return
        }

        const assessedMarketValue = assessedTotal * 10
        const assessedMarketValuePerSqft = livingArea != null && livingArea > 0 ? assessedMarketValue / livingArea : null

        results.push({
          pin,
          address: '',
          city: '',
          zipCode: '',
          neighborhood: nbhdForRecords,
          assessedMarketValue,
          assessedMarketValuePerSqft,
          buildingClass: compBuildingClass,
          livingArea,
          yearBuilt: chars?.yearBuilt ?? null,
          bedrooms: chars?.bedrooms ?? null,
          bathrooms: chars?.bathrooms ?? null,
          dataSource: 'Cook County Open Data - Equity (Assessed Values)',
        })
      })
    }

    // Filter by year built when subject has it (Assessor: classification/age matching is key)
    const subjectYear = property.yearBuilt
    if (subjectYear != null && yearBuiltTolerance >= 0 && results.length > 0) {
      const filtered = results.filter((r) => {
        if (r.yearBuilt == null) return true
        return Math.abs(r.yearBuilt - subjectYear) <= yearBuiltTolerance
      })
      if (filtered.length > 0) results = filtered
    }

    // Sort by assessed $/sqft ascending (lower = more supportive for lack of uniformity)
    results.sort((a, b) => {
      const aVal = a.assessedMarketValuePerSqft ?? Infinity
      const bVal = b.assessedMarketValuePerSqft ?? Infinity
      return aVal - bVal
    })

    // Fallback: when Parcel Universe + per-PIN lookup yields 0, query ASSESSED_VALUES directly by township
    let finalResults = results
    if (results.length === 0 && township && townshipFallbackUsed) {
      const currentYear = new Date().getFullYear()
      for (const year of [currentYear, currentYear - 1]) {
        for (const tcCol of ['township_code', 'township']) {
          try {
            const query = `$where=${encodeURIComponent(`${tcCol}='${township}' AND year='${year}'`)}&$limit=150`
            const avRecords = await fetchSocrataData<Record<string, unknown>>(DATASETS.ASSESSED_VALUES, query)
            if (avRecords.length === 0) continue
            const avByPin = new Map<string, Record<string, unknown>>()
            for (const r of avRecords) {
              const p = String(r.pin ?? '').replace(/\D/g, '')
              if (p.length >= 14 && p !== propertyPin) {
                const pin = p.length > 14 ? p.slice(0, 14) : p.padStart(14, '0')
                if (!avByPin.has(pin)) avByPin.set(pin, r)
              }
            }
            const avPins = [...avByPin.keys()].slice(0, 50)
            for (let i = 0; i < avPins.length; i += 5) {
              const batch = avPins.slice(i, i + 5)
              const charsResults = await Promise.all(batch.map((pin) => getImprovementCharsForPIN(pin)))
              batch.forEach((pin, j) => {
                const av = avByPin.get(pin)!
                const assessedTotal = getAssessedTotalFromRecord(av)
                if (assessedTotal == null || assessedTotal <= 0) return
                const chars = charsResults[j]
                const livingArea = chars?.livingArea ?? null
                if (subjectLivingArea > 0 && (livingArea == null || livingArea <= 0)) return
                const lo = subjectLivingArea > 0 ? subjectLivingArea * 0.75 : 0
                const hi = subjectLivingArea > 0 ? subjectLivingArea * 1.25 : Infinity
                if (subjectLivingArea > 0 && livingArea != null && (livingArea < lo || livingArea > hi)) return
                finalResults.push({
                  pin,
                  address: '',
                  city: '',
                  zipCode: '',
                  neighborhood: nbhdForRecords,
                  assessedMarketValue: assessedTotal * 10,
                  assessedMarketValuePerSqft: livingArea != null && livingArea > 0 ? (assessedTotal * 10) / livingArea : null,
                  buildingClass: null,
                  livingArea,
                  yearBuilt: chars?.yearBuilt ?? null,
                  bedrooms: chars?.bedrooms ?? null,
                  bathrooms: chars?.bathrooms ?? null,
                  dataSource: 'Cook County Open Data - Equity (Assessed Values)',
                })
              })
            }
            if (finalResults.length > 0) {
              if (subjectYear != null && yearBuiltTolerance >= 0) {
                const filtered = finalResults.filter((r) => {
                  if (r.yearBuilt == null) return true
                  return Math.abs(r.yearBuilt - subjectYear) <= yearBuiltTolerance
                })
                if (filtered.length > 0) finalResults = filtered
              }
              console.log('[comps-equity] ASSESSED_VALUES direct fallback succeeded', { township, year, count: finalResults.length })
              break
            }
          } catch (err) {
            console.error('[comps-equity] ASSESSED_VALUES direct fallback failed', { township, tcCol, year, err })
          }
        }
        if (finalResults.length > 0) break
      }
    }

    finalResults.sort((a, b) => {
      const aVal = a.assessedMarketValuePerSqft ?? Infinity
      const bVal = b.assessedMarketValuePerSqft ?? Infinity
      return aVal - bVal
    })
    const limited = finalResults.slice(0, limit)
    console.log('[comps-equity] Equity results', { total: finalResults.length, returned: limited.length, uniquePins: uniquePins.length })

    const resp: CookCountyApiResponse<EquityRecord[]> & { _debug?: EquityDebugInfo } = {
      success: true,
      data: limited,
      error: null,
      source: 'Cook County Open Data - Equity (Assessed Values)',
    }
    if (wantDebug) {
      resp._debug = {
        nbhd: nbhd || null,
        nbhdFromParcel,
        parcelsCount: parcels.length,
        uniquePinsCount: uniquePins.length,
        resultsBeforeLimit: finalResults.length,
        subjectLivingArea: property.livingArea ?? 0,
        townshipFallbackUsed,
        sampleLookups,
      }
    }
    return resp
  } catch (error) {
    console.error('Error fetching comparable equity:', error)
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : 'Failed to fetch comparable equity',
      source: 'Cook County Open Data - Equity',
    }
  }
}

/**
 * Parse assessed value from string to number
 */
function parseAssessedValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = parseFloat(String(value).replace(/,/g, ''))
  return isNaN(parsed) ? null : parsed
}

/**
 * Extract total assessed value from ASSESSED_VALUES record.
 * Tries board > certified > mailed; falls back to land+bldg sum when tot columns missing.
 */
function getAssessedTotalFromRecord(av: Record<string, unknown> | null): number | null {
  if (!av) return null
  const tot =
    av.board_tot ?? av.board_total ?? av.certified_tot ?? av.certified_total ?? av.mailed_tot ?? av.mailed_total
  let val = tot != null ? parseAssessedValue(tot) : null
  if (val != null && val > 0) return val
  const land = parseAssessedValue(av.board_land ?? av.certified_land ?? av.mailed_land)
  const bldg = parseAssessedValue(av.board_bldg ?? av.certified_bldg ?? av.mailed_bldg)
  if (land != null && bldg != null && (land > 0 || bldg > 0)) return land + bldg
  // Fallback: scan for any *_tot or *_total key with numeric value
  for (const k of Object.keys(av)) {
    if ((k.endsWith('_tot') || k.endsWith('_total')) && !k.includes('_land') && !k.includes('_bldg')) {
      const v = parseAssessedValue(av[k])
      if (v != null && v > 0) return v
    }
  }
  return val
}

/**
 * Parse integer value safely from unknown type
 */
function parseIntSafe(value: unknown): number | null {
  if (!value) return null
  const parsed = parseInt(String(value), 10)
  return isNaN(parsed) ? null : parsed
}

// Export types
export type { PropertyData, SalesRecord, CookCountyApiResponse, AssessmentHistoryRecord }
