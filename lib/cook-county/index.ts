// Cook County Open Data API
// Export all functions and types

export {
  getPropertyByPIN,
  searchPropertiesByAddress,
  ADDRESS_LOOKUP_UNAVAILABLE,
  getComparableSales,
  getComparableEquity,
  getAddressByPIN,
  haversineMiles,
  normalizePIN,
  formatPIN,
  isValidPIN,
} from './api'

export type {
  PropertyData,
  SalesRecord,
  EquityRecord,
  CookCountyApiResponse,
  PIN,
  ParcelUniverseRecord,
  ImprovementCharacteristicsRecord,
  ParcelSalesRecord,
  AssessmentHistoryRecord,
} from './types'
