// POST /api/admin/create-performance-invoice — WITHDRAWN.
//
// Contingency performance-fee invoicing is a held product. The authoritative
// admin authorisation check is preserved and still runs first, so this remains
// an admin-only endpoint rather than becoming an open information surface; only
// then does it report the withdrawal. No body is parsed and no invoice is
// created or eligibility computed.
import { NextRequest, NextResponse } from "next/server"

import { getSession } from "@/lib/auth/session"
import { heldProductResponse } from "@/lib/products/held-response"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const adminSecret = process.env.ADMIN_SECRET
    const providedSecret = request.headers.get("x-admin-secret")
    const session = await getSession(request)
    const isAdmin = (session?.user as { role?: string })?.role === "ADMIN"
    const isAuthorized = (adminSecret && providedSecret === adminSecret) || isAdmin
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return heldProductResponse("PERFORMANCE_INVOICE", "api/admin/create-performance-invoice", {
      invoiceIds: [],
    })
  } catch (error) {
    console.error("[admin] create-performance-invoice error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
