/** @jest-environment node */
import type Stripe from "stripe"

const contract = { productId: "prod_t2", amountCents: 6900, currency: "usd" }
const coupon = (o: Record<string, unknown> = {}) => ({ id: "coupon_full", valid: true, percent_off: 100, amount_off: null, currency: null, applies_to: { products: ["prod_t2"] }, ...o })
const promo = (o: Record<string, unknown> = {}, c: Record<string, unknown> = {}) => ({ id: "promo_full", code: "FREEREPORT", active: true, promotion: { type: "coupon", coupon: coupon(c) }, ...o })
function stripeWith(list: unknown[]) {
  const listMock = jest.fn(async () => ({ data: list }))
  return { client: { promotionCodes: { list: listMock } } as unknown as Stripe, listMock }
}
async function load() {
  return await import("@/lib/checkout/ot-full-discount")
}

beforeEach(() => {
  process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS = "promo_full"
})

it("resolves an allowlisted, active, product-scoped 100% promotion code", async () => {
  const { resolveCheckoutFullDiscount } = await load()
  const s = stripeWith([promo()])
  await expect(resolveCheckoutFullDiscount(s.client, "FREEREPORT", contract)).resolves.toEqual({ promotionCodeId: "promo_full", couponId: "coupon_full" })
  expect(s.listMock).toHaveBeenCalledWith({ code: "FREEREPORT", active: true, limit: 1, expand: ["data.promotion.coupon"] })
})

it.each([
  ["no allowlist configured", () => { delete process.env.OT_FULL_DISCOUNT_PROMOTION_CODE_IDS }, [promo()]],
  ["code not found", () => {}, []],
  ["not allowlisted", () => {}, [promo({ id: "promo_other" })]],
  ["inactive", () => {}, [promo({ active: false })]],
  ["partial percent", () => {}, [promo({}, { percent_off: 50 })]],
  ["partial amount", () => {}, [promo({}, { percent_off: null, amount_off: 100, currency: "usd" })]],
  ["unscoped coupon", () => {}, [promo({}, { applies_to: undefined })]],
  ["other product", () => {}, [promo({}, { applies_to: { products: ["prod_other"] } })]],
  ["multi-product", () => {}, [promo({}, { applies_to: { products: ["prod_t2", "prod_t3"] } })]],
  ["invalid coupon", () => {}, [promo({}, { valid: false })]],
])("refuses %s", async (_n, arrange, list) => {
  arrange()
  const { resolveCheckoutFullDiscount } = await load()
  await expect(resolveCheckoutFullDiscount(stripeWith(list).client, "FREEREPORT", contract)).resolves.toBeNull()
})
