/**
 * Free result -> paid checkout transfer. Only the browser holding this result's
 * capability cookie (Path=/api/free-check) receives a signed, single-use,
 * checkout-scoped cookie naming the result's persisted acquisition snapshot.
 *
 * POST ?id=res_... -> { transferred: true } + Set-Cookie (Path=/api/checkout).
 */
import { NextRequest } from "next/server"
import { rateLimit, getClientIdentifier } from "@/lib/rate-limit"
import { createPostgresAnalysisStore } from "@/lib/evidence/server/postgres-analysis-store"
import { productionFreeResultAccess } from "@/lib/evidence/server/free-result-access"
import { createGuardedSnapshotTransferRoute, productionSnapshotTransferAuthority } from "@/lib/commerce/snapshot-checkout-transfer"

const handlers = createGuardedSnapshotTransferRoute({ store: createPostgresAnalysisStore(), access: productionFreeResultAccess(), transfer: productionSnapshotTransferAuthority() })

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit(getClientIdentifier(req), 10, 60_000)
  if (!allowed) return Response.json({ error: "Too many requests" }, { status: 429 })
  return handlers.POST(req)
}
