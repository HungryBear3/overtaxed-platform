import { NextResponse } from "next/server"

/**
 * The legacy authenticated DIY endpoint bypassed the property/window intake.
 * Keep the route as a fail-closed compatibility response so old clients are
 * directed into the server-gated checkout without creating an Invoice or
 * touching Stripe.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Property eligibility must be confirmed before checkout.",
      code: "CHECKOUT_INTAKE_REQUIRED",
      url: "/checkout?plan=diy",
    },
    { status: 409 },
  )
}
