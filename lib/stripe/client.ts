import Stripe from "stripe"

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[stripe] STRIPE_SECRET_KEY not set – payments disabled")
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

// Price IDs – set in Stripe dashboard and match here
// DIY reports: $69/property one-time. Starter: $149/property/year.
// Growth: $125/property/year (3-9 properties). Portfolio: $100/property/year (10-20 properties).
// Performance: 4% deferred. 20+ = custom pricing.
export const PRICE_IDS = {
  COMPS_ONLY: process.env.STRIPE_PRICE_COMPS_ONLY ?? "",
  STARTER: process.env.STRIPE_PRICE_STARTER ?? "",
  GROWTH_PER_PROPERTY: process.env.STRIPE_PRICE_GROWTH_PER_PROPERTY ?? "", // $125/property/year
  PORTFOLIO_PER_PROPERTY: process.env.STRIPE_PRICE_PORTFOLIO_PER_PROPERTY ?? "", // $100/property/year
  // PERFORMANCE: 4% of 3-year savings, deferred – handled separately
} as const
