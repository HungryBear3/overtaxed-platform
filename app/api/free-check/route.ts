/**
 * Free factual check. No signup; result reads require the issued browser capability.
 * The existing 10/min POST limit is preserved.
 *
 * POST: { pin?, address?, city?, selectedPin? } -> server-issued lookup receipt.
 * GET ?id=res_... -> this browser's persisted FACTUAL_ONLY result.
 *
 * The historically named production adapter uses the official-source collector.
 * Unsupported or unavailable acquisition fails closed; no fixture is served here.
 */
import { NextRequest, NextResponse } from "next/server"
import { rateLimit, getClientIdentifier } from "@/lib/rate-limit"
import { createPostgresAnalysisStore } from "@/lib/evidence/server/postgres-analysis-store"
import { cookCountyUnsupportedAdapter } from "@/lib/evidence/server/factual-analysis"
import { createGuardedFreeCheckRoute } from "@/lib/evidence/server/free-check-handler"
import { productionFreeResultAccess } from "@/lib/evidence/server/free-result-access"

export const maxDuration = 25

// Result reads are bound to the signed capability cookie set by this browser's POST.
const handlers = createGuardedFreeCheckRoute({ adapter: cookCountyUnsupportedAdapter, store: createPostgresAnalysisStore(), access: productionFreeResultAccess() })

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit(getClientIdentifier(req), 10, 60_000)
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  return handlers.POST(req)
}

export async function GET(req: NextRequest) {
  return handlers.GET(req)
}
