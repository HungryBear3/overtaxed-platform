/**
 * Commercial pricing: per-property pricing by tier.
 * Growth: 3-9 properties at $124/property/year.
 * Portfolio: 10-20 properties at $99/property/year.
 * 20+ = custom pricing.
 */

export const RETAIL_PRICE_PER_PROPERTY = 149

/** Growth tier: $124 per property per year. Min 1, max 9. */
export const GROWTH_PRICE_PER_PROPERTY = 124
export const GROWTH_MIN_PROPERTIES = 1
export const GROWTH_MAX_PROPERTIES = 9

/** Portfolio tier: $99 per property per year. Min 1, max 20. */
export const PORTFOLIO_PRICE_PER_PROPERTY = 99
export const PORTFOLIO_MIN_PROPERTIES = 1
export const PORTFOLIO_MAX_PROPERTIES = 20

/**
 * Get Growth price for property count. Returns null if outside range.
 */
export function growthPriceForProperties(n: number): number | null {
  if (n >= GROWTH_MIN_PROPERTIES && n <= GROWTH_MAX_PROPERTIES) {
    return n * GROWTH_PRICE_PER_PROPERTY
  }
  return null
}

/**
 * Get Portfolio price for property count. Returns null if outside range.
 */
export function portfolioPriceForProperties(n: number): number | null {
  if (n >= PORTFOLIO_MIN_PROPERTIES && n <= PORTFOLIO_MAX_PROPERTIES) {
    return n * PORTFOLIO_PRICE_PER_PROPERTY
  }
  return null
}

/**
 * Check if property count requires custom pricing (20+).
 */
export function requiresCustomPricing(n: number): boolean {
  return n > PORTFOLIO_MAX_PROPERTIES
}
