/**
 * Subscription tier limits.
 * COMPS_ONLY (DIY): 1. STARTER: 2. GROWTH: 9. PORTFOLIO: 20. PERFORMANCE: unlimited.
 * When subscriptionQuantity is set (paid plan), it caps slots; otherwise tier max is used.
 */

export const PROPERTY_LIMITS: Record<string, number> = {
  COMPS_ONLY: 1,
  STARTER: 2,
  GROWTH: 9,
  PORTFOLIO: 20,
  PERFORMANCE: 999,
}

/**
 * Effective property limit: subscriptionQuantity when set (quantity paid; 0 = no paid slots), else tier default.
 */
export function getPropertyLimit(tier: string, subscriptionQuantity?: number | null): number {
  const tierMax = PROPERTY_LIMITS[tier] ?? PROPERTY_LIMITS.COMPS_ONLY
  if (subscriptionQuantity != null) return Math.max(0, subscriptionQuantity)
  return tierMax
}

export function canAddProperty(
  currentCount: number,
  tier: string,
  subscriptionQuantity?: number | null
): boolean {
  const limit = getPropertyLimit(tier, subscriptionQuantity)
  if (limit >= 999) return true // PERFORMANCE
  return currentCount < limit
}

/**
 * Check if property count requires custom pricing (20+).
 */
export function requiresCustomPricing(n: number): boolean {
  return n > 20
}
