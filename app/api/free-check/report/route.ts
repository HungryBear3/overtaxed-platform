/**
 * Free factual PDF for a result this browser was issued. No auth, no payment.
 *
 * GET ?id=res_... -> application/pdf rendered from the persisted result, only
 * when the request carries the signed result-bound cookie from the lookup POST.
 */
import { NextRequest } from "next/server"
import { createPostgresAnalysisStore } from "@/lib/evidence/server/postgres-analysis-store"
import { createFreeReportRoute } from "@/lib/evidence/server/free-report-handler"
import { productionFreeResultAccess } from "@/lib/evidence/server/free-result-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 25

const handlers = createFreeReportRoute({ store: createPostgresAnalysisStore(), access: productionFreeResultAccess() })

export async function GET(req: NextRequest) {
  return handlers.GET(req)
}
