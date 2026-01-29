# Pricing Structure Comparison

## Option 1: Cumulative Pricing (Base + Per-Additional)

**Growth (3–9 properties):**
- Base: $149 × 3 = $447 (covers first 3)
- Additional: $125/property for 4th–9th
- Examples: 3 = $447, 4 = $572, 5 = $697, 6 = $822, 7 = $947, 8 = $1,072, 9 = $1,197

**Portfolio (6–15 properties):**
- Base: $149 × 3 = $447 (covers first 3)
- Tier 2: $125 × 6 = $750 (covers 4th–9th)
- Tier 3: $100/property for 10th–15th
- Examples: 6 = $1,197, 9 = $1,197, 10 = $1,297, 15 = $1,797

**Stripe Implementation:**
- **Option A:** Multiple line items: base price + add'l price × quantity
- **Option B:** Custom amount (calculate total, send as single line item)

**Pros:** More granular pricing, matches retail structure
**Cons:** More complex Stripe setup, harder upgrades, requires recalculation on property changes

---

## Option 2: Property Ranges with Price Breaks (RECOMMENDED)

**Growth:** 3–5 = $X/year, 6–9 = $Y/year
**Portfolio:** 6–9 = $A/year, 10–15 = $B/year

**Stripe:** One price per range = standard subscription flow

**Pros:**
- ✅ Simpler Stripe setup (one price per range)
- ✅ Easier to implement (standard Stripe subscription)
- ✅ Easier upgrades (change price ID when crossing range boundary)
- ✅ Clearer for users
- ✅ Better for Prisma (store tier + enforce max limit)

**Cons:** Less granular (price jumps at boundaries)

---

## Recommendation: Option 2 (Ranges)

**Suggested Pricing:**

| Tier      | Range      | Price      | Rationale                                    |
|-----------|------------|------------|----------------------------------------------|
| Growth    | 3–5        | $697/year  | $149×3 + $125×2 = $697                      |
| Growth    | 6–9        | $1,197/year| $149×3 + $125×6 = $1,197                    |
| Portfolio | 6–9        | $1,197/year| Same as Growth 6–9                          |
| Portfolio | 10–15      | $1,797/year| $149×3 + $125×6 + $100×6 = $1,797           |

**Stripe Setup:**
- `STRIPE_PRICE_GROWTH_3_5` = $697/year
- `STRIPE_PRICE_GROWTH_6_9` = $1,197/year
- `STRIPE_PRICE_PORTFOLIO_6_9` = $1,197/year
- `STRIPE_PRICE_PORTFOLIO_10_15` = $1,797/year
