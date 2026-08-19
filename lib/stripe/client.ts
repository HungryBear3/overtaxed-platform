import Stripe from "stripe"

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[stripe] STRIPE_SECRET_KEY not set – payments disabled")
}

/**
 * Eager client retained for the subscription/billing routes that are not held
 * and already depend on this binding. Held-product paths must NOT import this
 * module at module scope — see `getStripe` below.
 */
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

/**
 * Lazy acquisition for held-product boundaries.
 *
 * A held-product helper must assert its hold *before* Stripe is imported,
 * acquired, or constructed. Such a helper therefore dynamically imports this
 * module after its assertion and calls `getStripe()`, so no provider client is
 * reachable on a withdrawn path.
 */
let lazyClient: Stripe | null = null
let lazyClientKey: string | null = null

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  if (lazyClient && lazyClientKey === key) return lazyClient
  lazyClient = new Stripe(key)
  lazyClientKey = key
  return lazyClient
}

// Price IDs – set in Stripe dashboard and match here
// DIY reports: $69/property one-time. Starter: $149/property/year.
// Growth: $124/property/year (3-9 properties). Portfolio: $99/property/year (10-20 properties).
// Contingency: 22% of first-year granted savings. 20+ = custom pricing.
export const PRICE_IDS = {
  COMPS_ONLY: process.env.STRIPE_PRICE_COMPS_ONLY ?? "",
  STARTER: process.env.STRIPE_PRICE_STARTER ?? "",
  GROWTH_PER_PROPERTY: process.env.STRIPE_PRICE_GROWTH_PER_PROPERTY ?? "", // $124/property/year
  PORTFOLIO_PER_PROPERTY: process.env.STRIPE_PRICE_PORTFOLIO_PER_PROPERTY ?? "", // $99/property/year
  // PERFORMANCE legacy enum: contingency fee, 22% of first-year granted savings – handled separately
} as const
