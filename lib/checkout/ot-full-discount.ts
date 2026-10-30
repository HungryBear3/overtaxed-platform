import type Stripe from "stripe"

/**
 * Full-discount (100%, zero-total) OT checkout entitlement.
 *
 * A customer may only present a promotion CODE string. It becomes a discount
 * only when Stripe resolves it to a promotion code whose id is on the server
 * allowlist and whose coupon removes the entire price of the exact product
 * being sold. Nothing here accepts a client-asserted amount, coupon or product.
 */
export const FULL_DISCOUNT_ALLOWLIST_ENV = "OT_FULL_DISCOUNT_PROMOTION_CODE_IDS"

export type FullDiscountContract = { productId: string; amountCents: number; currency: string }
export type FullDiscount = { promotionCodeId: string; couponId: string }

export function allowlistedPromotionCodeIds(): Set<string> {
  return new Set(
    (process.env[FULL_DISCOUNT_ALLOWLIST_ENV] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.startsWith("promo_")),
  )
}

/** The coupon must remove exactly the whole price, scoped to this product only. */
export function couponFullyDiscounts(coupon: Stripe.Coupon | string | null | undefined, contract: FullDiscountContract): coupon is Stripe.Coupon {
  if (!coupon || typeof coupon === "string") return false
  const products = coupon.applies_to?.products ?? []
  if (products.length !== 1 || products[0] !== contract.productId) return false
  if (coupon.percent_off === 100 && coupon.amount_off == null) return true
  return (
    coupon.percent_off == null &&
    coupon.amount_off === contract.amountCents &&
    coupon.currency?.toLowerCase() === contract.currency
  )
}

function promotionCoupon(promotion: Stripe.PromotionCode): Stripe.Coupon | string | null {
  return promotion.promotion?.coupon ?? null
}

/** Checkout-time: resolve a customer-entered code to an allowlisted full discount, or null. */
export async function resolveCheckoutFullDiscount(
  stripe: Stripe,
  code: string,
  contract: FullDiscountContract,
): Promise<FullDiscount | null> {
  const allowed = allowlistedPromotionCodeIds()
  if (allowed.size === 0 || !code) return null
  const found = await stripe.promotionCodes.list({ code, active: true, limit: 1, expand: ["data.promotion.coupon"] })
  const promotion = found.data[0]
  if (!promotion || promotion.code !== code || !promotion.active || !allowed.has(promotion.id)) return null
  const coupon = promotionCoupon(promotion)
  if (!couponFullyDiscounts(coupon, contract) || !coupon.valid) return null
  return { promotionCodeId: promotion.id, couponId: coupon.id }
}

/**
 * Settlement-time: re-prove the durable order's promotion code is still on the
 * allowlist and its coupon is a full, product-scoped discount. Redemption may
 * already have exhausted the coupon, so `valid`/`active` are not required here.
 */
export async function verifySettlementFullDiscount(
  stripe: Stripe,
  promotionCodeId: string,
  contract: FullDiscountContract,
): Promise<FullDiscount | null> {
  if (!allowlistedPromotionCodeIds().has(promotionCodeId)) return null
  const promotion = await stripe.promotionCodes.retrieve(promotionCodeId, { expand: ["promotion.coupon"] })
  if (promotion?.id !== promotionCodeId) return null
  const coupon = promotionCoupon(promotion)
  if (!couponFullyDiscounts(coupon, contract)) return null
  return { promotionCodeId, couponId: coupon.id }
}
