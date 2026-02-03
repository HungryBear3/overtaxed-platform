// Cook County Open Data API Client
// Uses Socrata Open Data API (SODA)
// Documentation: https://dev.socrata.com/docs/queries/

import type {
  PropertyData,
  ParcelUniverseRecord,
  ImprovementCharacteristicsRecord,
  ParcelSalesRecord,
  SalesRecord,
  CookCountyApiResponse,
  PIN,
  AssessmentHistoryRecord,
} from './types'

// Dataset IDs from Cook County Open Data Portal
const DATASETS = {
  // Parcel Universe - Property locations, PINs, addresses
  PARCEL_UNIVERSE: 'tx2p-k2g9',
  // Assessed Values - Land, building, and total assessed values (mailed, certified, board)
  ASSESSED_VALUES: 'uzyt-m557',
  // Single-Family Improvement Characteristics  
  SINGLE_FAMILY_CHARS: 'bcnq-qi2z',
  // Multi-Family Improvement Characteristics
  MULTI_FAMILY_CHARS: 'n6jx-6jqg',
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
 * Fetch data from Socrata API
 */
async function fetchSocrataData<T>(
  datasetId: string,
  query: string
): Promise<T[]> {
  const url = `${BASE_URL}/${datasetId}.json?${query}`
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      // App token is optional but increases rate limits
      // 'X-App-Token': process.env.SOCRATA_APP_TOKEN || '',
    },
    next: { revalidate: 3600 }, // Cache for 1 hour
  })
  
  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Socrata API error:', { status: response.status, datasetId, body: errorBody.slice(0, 500) })
    throw new Error(`Socrata API error: ${response.status} ${response.statusText}`)
  }
  
  return response.json()
}

/**
 * Look up property by PIN in Parcel Universe
 */
async function getParcelUniverseByPIN(
  pin: PIN
): Promise<ParcelUniverseRecord | null> {
  const normalizedPIN = normalizePIN(pin)
  const query = `$where=${encodeURIComponent(`pin='${normalizedPIN}'`)}&$limit=1`
  
  const results = await fetchSocrataData<ParcelUniverseRecord>(
    DATASETS.PARCEL_UNIVERSE,
    query
  )
  
  return results[0] || null
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
 * Look up property characteristics (Multi-Family)
 */
async function getMultiFamilyCharsByPIN(
  pin: PIN
): Promise<ImprovementCharacteristicsRecord | null> {
  const normalizedPIN = normalizePIN(pin)
  const query = `$where=${encodeURIComponent(`pin='${normalizedPIN}'`)}&$limit=1&$order=${encodeURIComponent('tax_year DESC')}`
  
  const results = await fetchSocrataData<ImprovementCharacteristicsRecord>(
    DATASETS.MULTI_FAMILY_CHARS,
    query
  )
  
  return results[0] || null
}

/**
 * Look up assessed values by PIN
 * Returns mailed, certified, and board values for land, building, and total
 */
async function getAssessedValuesByPIN(
  pin: PIN
): Promise<Record<string, unknown> | null> {
  const normalizedPIN = normalizePIN(pin)
  // Get the most recent assessment year
  const query = `$where=${encodeURIComponent(`pin='${normalizedPIN}'`)}&$limit=1&$order=${encodeURIComponent('year DESC')}`
  
  const results = await fetchSocrataData<Record<string, unknown>>(
    DATASETS.ASSESSED_VALUES,
    query
  )
  
  return results[0] || null
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
    const yearsToTry = Array.from({ length: Math.max(1, startYear - 2012) }, (_, i) => startYear - i).filter((y) => y >= 2006)

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
    
    // Try to fetch improvement characteristics (single-family first, then multi-family)
    let charData = await getSingleFamilyCharsByPIN(normalizedPIN)
    if (!charData) {
      charData = await getMultiFamilyCharsByPIN(normalizedPIN)
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
 * Search properties by address
 */
export async function searchPropertiesByAddress(
  address: string,
  city?: string,
  limit: number = 10
): Promise<CookCountyApiResponse<ParcelUniverseRecord[]>> {
  try {
    // Build query with case-insensitive search
    let where = `upper(property_address) like upper('%${address.replace(/'/g, "''")}%')`
    if (city) {
      where += ` AND upper(property_city) like upper('%${city.replace(/'/g, "''")}%')`
    }
    
    const query = `$where=${encodeURIComponent(where)}&$limit=${limit}`
    
    const results = await fetchSocrataData<ParcelUniverseRecord>(
      DATASETS.PARCEL_UNIVERSE,
      query
    )
    
    return {
      success: true,
      data: results,
      error: null,
      source: 'Cook County Open Data',
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
 * Fetch address (and city, zip) by PIN from Parcel Universe. Used to enrich comps list.
 */
async function getAddressByPIN(pin: PIN): Promise<{ address: string; city: string; zipCode: string } | null> {
  const parcel = await getParcelUniverseByPIN(pin)
  if (!parcel) return null
  const p = parcel as unknown as Record<string, unknown>
  const address =
    (p.prop_address_full ?? p.property_address ?? p.addr ?? "") as string
  const city = (p.prop_address_city_name ?? p.property_city ?? p.cook_municipality_name ?? "") as string
  const zipCode = (p.prop_address_zipcode_1 ?? p.property_zip ?? p.zip_code ?? "") as string
  if (!address && !city) return null
  return { address: address || `PIN ${formatPIN(String(p.pin ?? pin))}`, city, zipCode }
}

/**
 * Fetch improvement characteristics (living area, year built, etc.) by PIN.
 * Tries Single-Family then Multi-Family dataset. Used to enrich sales comps.
 */
async function getImprovementCharsForPIN(pin: PIN): Promise<{
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
} | null> {
  let chars = await getSingleFamilyCharsByPIN(pin)
  if (!chars) chars = await getMultiFamilyCharsByPIN(pin)
  if (!chars) return null
  const c = chars as unknown as Record<string, unknown>
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
 * Get comparable sales for a property
 * Rule 15: 3+ sales comps, similar size/class/location
 * Enriches each sale with living area etc. from Improvement Characteristics when Parcel Sales has no chars.
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
      livingAreaTolerancePercent = 25,  // ±25% living area
      yearBuiltTolerance = 10,  // ±10 years
      limit = 20,
      saleDateAfter = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000), // 2 years
    } = options

    // Parcel Sales (wvhk-k5uv) does not include char_bldg_sf; filters that need it are skipped
    const filters: string[] = []
    if (property.neighborhood) filters.push(`nbhd='${property.neighborhood}'`)
    if (property.buildingClass) filters.push(`class='${property.buildingClass}'`)
    const saleDateStr = saleDateAfter.toISOString().split('T')[0]
    filters.push(`sale_date >= '${saleDateStr}'`)
    filters.push(`pin != '${property.pin}'`)

    const query = `$where=${encodeURIComponent(filters.join(' AND '))}&$limit=${limit}&$order=sale_date DESC`
    const results = await fetchSocrataData<Record<string, unknown>>(
      DATASETS.PARCEL_SALES,
      query
    )

    const rawRecords = results as Array<Record<string, unknown>>
    const uniquePins = [...new Set(rawRecords.map((r) => String(r.pin ?? '')))].filter(Boolean).slice(0, 20)
    const charsByPin = new Map<string, Awaited<ReturnType<typeof getImprovementCharsForPIN>>>()
    await Promise.all(
      uniquePins.map(async (pin) => {
        const chars = await getImprovementCharsForPIN(pin)
        if (chars) charsByPin.set(pin, chars)
      })
    )

    const salesRecords: SalesRecord[] = rawRecords.map((record) => {
      const pin = String(record.pin ?? '')
      const salePrice = parseFloat(String(record.sale_price ?? 0)) || 0
      const chars = charsByPin.get(pin) ?? null
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
      }
    })

    return {
      success: true,
      data: salesRecords,
      error: null,
      source: 'Cook County Open Data - Parcel Sales',
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
 * Parse assessed value from string to number
 */
function parseAssessedValue(value: unknown): number | null {
  if (!value) return null
  const parsed = parseFloat(String(value))
  return isNaN(parsed) ? null : parsed
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
