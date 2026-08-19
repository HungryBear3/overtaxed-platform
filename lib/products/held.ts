/**
 * Held-product registry.
 *
 * A held product is one the owner has withdrawn from sale. Holds are enforced at
 * the boundary that actually causes the side effect — the provider helper, not
 * only the HTTP route in front of it — so that a future internal caller cannot
 * reach a withdrawn product by bypassing the route.
 *
 * Holds are release decisions, not configuration. There is deliberately no
 * environment variable that lifts one.
 */

export const HELD_PRODUCT_IDS = [
  /** $97 Done-For-You / full filing tier. */
  "T3_DFY",
  /** 22% contingency service. */
  "CONTINGENCY",
  /** Contingency performance-fee invoicing. */
  "PERFORMANCE_INVOICE",
  /** Board of Review product, waitlist, and referral. */
  "BOR",
  /** Marketing drip sequence. */
  "MARKETING_DRIP",
] as const

export type HeldProductId = (typeof HELD_PRODUCT_IDS)[number]

const HELD = new Set<string>(HELD_PRODUCT_IDS)

export function isHeldProduct(productId: string): boolean {
  return HELD.has(productId)
}

export class HeldProductError extends Error {
  readonly productId: string
  readonly boundary: string

  constructor(productId: string, boundary: string) {
    super(
      `Product "${productId}" is held and cannot be sold, invoiced, or fulfilled. ` +
        `Blocked at boundary "${boundary}".`,
    )
    this.name = "HeldProductError"
    this.productId = productId
    this.boundary = boundary
  }
}

/**
 * Throws when `productId` is held. Call this *before* acquiring a payment
 * provider, opening a database write, or parsing an unbounded request body.
 */
export function assertNotHeldProduct(productId: string, boundary: string): void {
  if (HELD.has(productId)) {
    throw new HeldProductError(productId, boundary)
  }
}

/** Non-throwing form for call sites that return a typed failure instead. */
export function heldProductFailure(
  productId: string,
  boundary: string,
): { success: false; error: string } | null {
  if (!HELD.has(productId)) return null
  return {
    success: false,
    error: new HeldProductError(productId, boundary).message,
  }
}
