// Cron: contingency fee invoicing — WITHDRAWN.
//
// Contingency performance-fee invoicing is a held product. The CRON_SECRET
// check is preserved and still runs first, so an unauthorised caller cannot use
// this endpoint to probe subscriber state; an authorised caller receives the
// withdrawal without any user enumeration or invoice creation.
import { NextRequest, NextResponse } from "next/server"

import { heldProductResponse } from "@/lib/products/held-response"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return heldProductResponse("PERFORMANCE_INVOICE", "api/cron/performance-invoices", {
    performanceUsersChecked: 0,
    invoicesCreated: 0,
    invoiceIds: [],
  })
}
