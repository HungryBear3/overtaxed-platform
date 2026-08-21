import { NextResponse } from "next/server"

import { HeldProductError } from "@/lib/products/held"

/**
 * Uniform 410 for a withdrawn product surface.
 *
 * 410 Gone (not 404) because the surface genuinely existed and has been
 * withdrawn; and not 503, because this is a policy decision rather than a
 * transient outage a client should retry.
 */
export function heldProductResponse(
  productId: string,
  boundary: string,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    {
      error: new HeldProductError(productId, boundary).message,
      code: "PRODUCT_HELD",
      product: productId,
      ...extra,
    },
    { status: 410 },
  )
}
