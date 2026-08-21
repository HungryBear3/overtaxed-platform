// POST /api/billing/pay-invoice — WITHDRAWN.
//
// This paid a contingency performance-fee invoice, which is a held product.
// Stripe is deliberately not imported at module scope: the previous eager
// import constructed a provider client before the session check even ran. The
// authenticated-customer check is preserved and runs first; no invoice is read
// and no checkout session is created.
import { NextRequest, NextResponse } from "next/server"

import { getSession } from "@/lib/auth/session"
import { heldProductResponse } from "@/lib/products/held-response"

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return heldProductResponse("PERFORMANCE_INVOICE", "api/billing/pay-invoice")
  } catch (error) {
    console.error("[billing] pay-invoice error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
