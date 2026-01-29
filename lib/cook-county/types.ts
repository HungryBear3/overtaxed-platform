// Cook County Open Data API Types
// Based on Socrata API and PRD Appendix D

// PIN format: 14 digits (e.g., "16-01-216-001-0000")
export type PIN = string

// Parcel Universe data from Cook County Open Data
export interface ParcelUniverseRecord {
  pin: string
  pin10: string
  class: string
  township_code: string
  township_name: string
  nbhd: string  // Neighborhood code
  tract_geoid: string
  tax_code: string
  zip_code: string
  municipality_name: string
  property_address: string
  property_city: string
  property_zip: string
  latitude: string
  longitude: string
  // Assessment values
  mailed_tot: string  // Total mailed assessment
  mailed_bldg: string  // Building assessment
  mailed_land: string  // Land assessment
  certified_tot: string
  certified_bldg: string
  certified_land: string
  board_tot: string  // Board of Review value
  board_bldg: string
  board_land: string
}

// Single/Multi-Family Improvement Characteristics
export interface ImprovementCharacteristicsRecord {
  pin: string
  pin10: string
  class: string
  township_code: string
  nbhd: string
  // Property characteristics
  char_bldg_sf: string  // Building square feet
  char_land_sf: string  // Land square feet
  char_yrblt: string    // Year built
  char_beds: string     // Bedrooms
  char_fbath: string    // Full baths
  char_hbath: string    // Half baths
  char_bsmt: string     // Basement type
  char_bsmt_fin: string // Basement finish
  char_ext_wall: string // Exterior wall
  char_roof_cnst: string // Roof construction
  char_attic_type: string // Attic type
  char_attic_fnsh: string // Attic finish
  char_air: string      // Air conditioning
  char_gar1_size: string // Garage size
  char_gar1_att: string  // Garage attached
  char_type_resd: string // Residence type
  char_use: string       // Use
  char_cnst_qlty: string // Construction quality (CDU)
  char_renovation: string // Renovation
  char_site: string      // Site
  char_porch: string     // Porch
  // Assessment values
  av_land: string       // Assessed value - land
  av_bldg: string       // Assessed value - building
  tot_val: string       // Total value
}

// Parcel Sales data
export interface ParcelSalesRecord {
  pin: string
  year: string
  class: string
  township_code: string
  nbhd: string
  sale_date: string
  sale_price: string
  sale_type: string
  deed_type: string
  seller_name: string
  buyer_name: string
  // Property details
  char_bldg_sf: string
  char_land_sf: string
  char_yrblt: string
  char_beds: string
  char_fbath: string
  // Assessment at time of sale
  av_bldg: string
  av_land: string
}

// Normalized property data (combined from multiple sources)
export interface PropertyData {
  pin: string
  address: string
  city: string
  state: string
  zipCode: string
  county: string
  
  // Location
  neighborhood: string | null
  township: string | null
  latitude: number | null
  longitude: number | null
  
  // Property characteristics
  buildingClass: string | null
  cdu: string | null  // Construction quality / CDU
  livingArea: number | null  // Square feet
  landSize: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null  // Full + 0.5 * half
  exteriorWall: string | null
  roofType: string | null
  basement: string | null
  airConditioning: string | null
  garage: string | null
  
  // Assessment values
  assessedLandValue: number | null
  assessedBuildingValue: number | null
  assessedTotalValue: number | null
  marketValue: number | null  // assessedTotalValue × 10 (Cook County equalization)
  
  // Tax information
  taxCode: string | null  // Cook County tax code (determines tax rate)
  taxRate: number | null  // Total tax rate as decimal (e.g., 0.0756 for 7.56%)
  stateEqualizer: number | null  // State equalization factor (e.g., 2.916)
  
  // Assessment history (multiple years)
  assessmentHistory: AssessmentHistoryRecord[]
  
  // Source metadata
  dataSource: string
  lastUpdated: Date
}

// Historical assessment record
export interface AssessmentHistoryRecord {
  year: number
  assessedLandValue: number | null
  assessedBuildingValue: number | null
  assessedTotalValue: number | null
  marketValue: number | null  // assessedTotalValue × 10
  stage: 'mailed' | 'certified' | 'board'  // Which stage of assessment
}

// Sales record for comps
export interface SalesRecord {
  pin: string
  address: string
  city: string
  zipCode: string
  neighborhood: string | null
  
  saleDate: Date
  salePrice: number
  pricePerSqft: number | null
  
  // Property characteristics
  buildingClass: string | null
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  
  dataSource: string
}

// API response wrapper
export interface CookCountyApiResponse<T> {
  success: boolean
  data: T | null
  error: string | null
  source: string
}
