// Cron: contingency fee invoicing — WITHDRAWN.
//
// Contingency performance-fee invoicing is a held product. Authorization runs
// first and fails closed, so an unauthorised caller cannot use this endpoint to
// probe subscriber state; an authorised caller receives the withdrawal without
// any user enumeration or invoice creation.
//
// The guard used to read `if (expectedKey && ...)`, which skips the check
// entirely when CRON_SECRET is unset or empty — an unconfigured deployment
// answered an anonymous GET. The reachable response was already inert, so this
// was the last fail-open cron guard rather than a live leak; it is corrected
// because a held-product path is exactly where the pattern must not survive to
// be copied, and because it was disclosed as closed while it was not.
import { NextRequest, NextResponse } from "next/server"

import { heldProductResponse } from "@/lib/products/held-response"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return heldProductResponse("PERFORMANCE_INVOICE", "api/cron/performance-invoices", {
    performanceUsersChecked: 0,
    invoicesCreated: 0,
    invoiceIds: [],
  })
}
