import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { listNeutralOperatorQueue } from "@/lib/fulfillment-runtime/neutral-operator-queue"
import { NEUTRAL_OPERATOR_PRIVATE_HEADERS } from "@/lib/fulfillment-runtime/neutral-operator-route-headers"

const json = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: NEUTRAL_OPERATOR_PRIVATE_HEADERS })

/**
 * Bounded, non-PII operator read model. Read-only: it writes nothing, sends
 * nothing, and promotes nothing. Default-off behind its own strict flag.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request)
  const user = session?.user as { id?: unknown; role?: unknown } | undefined
  if (user?.role !== "ADMIN" || typeof user.id !== "string" || user.id.length < 1 || user.id.length > 128)
    return json({ ok: false, code: "UNAUTHORIZED" }, 401)
  if (process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED !== "true")
    return json({ ok: false, code: "NOT_AVAILABLE" }, 404)
  try {
    const result = await listNeutralOperatorQueue()
    return json(result, result.ok ? 200 : 409)
  } catch {
    return json({ ok: false, code: "INTERNAL_ERROR" }, 500)
  }
}
