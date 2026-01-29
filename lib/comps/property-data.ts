import type { PropertyData } from "@/lib/cook-county"

/**
 * Build PropertyData for Cook County API (e.g. getComparableSales) from a DB property.
 * Uses normalizePIN for pin format.
 */
export function propertyDataFromDb(property: {
  pin: string
  address: string
  city: string
  state: string
  zipCode: string
  county: string
  neighborhood?: string | null
  buildingClass?: string | null
  cdu?: string | null
  livingArea?: number | null
  landSize?: number | null
  yearBuilt?: number | null
  bedrooms?: number | null
  bathrooms?: { toString: () => string } | null
  currentAssessmentValue?: { toString: () => string } | null
  currentLandValue?: { toString: () => string } | null
  currentImprovementValue?: { toString: () => string } | null
  currentMarketValue?: { toString: () => string } | null
}): PropertyData {
  const pin = String(property.pin).replace(/[^0-9]/g, "")
  const assessedTotal = property.currentAssessmentValue
    ? parseFloat(property.currentAssessmentValue.toString())
    : null
  const assessedLand = property.currentLandValue
    ? parseFloat(property.currentLandValue.toString())
    : null
  const assessedBldg = property.currentImprovementValue
    ? parseFloat(property.currentImprovementValue.toString())
    : null
  const marketVal = property.currentMarketValue
    ? parseFloat(property.currentMarketValue.toString())
    : null
  const baths = property.bathrooms
    ? parseFloat(property.bathrooms.toString())
    : null

  return {
    pin,
    address: property.address,
    city: property.city,
    state: property.state,
    zipCode: property.zipCode,
    county: property.county,
    neighborhood: property.neighborhood ?? null,
    township: null,
    latitude: null,
    longitude: null,
    buildingClass: property.buildingClass ?? null,
    cdu: property.cdu ?? null,
    livingArea: property.livingArea ?? null,
    landSize: property.landSize ?? null,
    yearBuilt: property.yearBuilt ?? null,
    bedrooms: property.bedrooms ?? null,
    bathrooms: baths,
    exteriorWall: null,
    roofType: null,
    basement: null,
    airConditioning: null,
    garage: null,
    assessedLandValue: assessedLand,
    assessedBuildingValue: assessedBldg,
    assessedTotalValue: assessedTotal,
    marketValue: marketVal,
    taxCode: null,
    taxRate: null,
    stateEqualizer: null,
    assessmentHistory: [],
    dataSource: "Overtaxed DB",
    lastUpdated: new Date(),
  }
}
