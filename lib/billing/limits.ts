/**
 * Subscription tier limits.
 * COMPS_ONLY (DIY reports): 1. STARTER ($149/property/yr): 5. GROWTH: 9. PORTFOLIO: 20. PERFORMANCE: unlimited.
 * 20+ properties require custom pricing (contact us).
 */

export const PROPERTY_LIMITS: Record<string, number> = {
  COMPS_ONLY: 1,
  STARTER: 5,
  GROWTH: 9,
  PORTFOLIO: 20,
  PERFORMANCE: 999,
}

export function getPropertyLimit(tier: string): number {
  return PROPERTY_LIMITS[tier] ?? PROPERTY_LIMITS.COMPS_ONLY
}

export function canAddProperty(currentCount: number, tier: string): boolean {
  const limit = getPropertyLimit(tier)
  if (limit >= 999) return true // PERFORMANCE
  return currentCount < limit
}

/**
 * Check if property count requires custom pricing (20+).
 */
export function requiresCustomPricing(n: number): boolean {
  return n > 20
}
