import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/auth/session"
import {
  t2EvidenceConsoleEnabled,
  t2ManualReviewControlEnabled,
} from "@/lib/fulfillment/flag"
import { enterManualReview } from "@/lib/fulfillment-runtime/manual-review-store"

const Body = z.object({
  action: z.literal("ENTER_MANUAL_REVIEW"),
  expectedStatus: z.enum([
    "NOT_STARTED",
    "NEEDS_RECONCILIATION",
    "INCOMPLETE_INPUT",
    "ARTIFACT_PENDING",
    "ARTIFACT_READY",
  ]),
  expectedStatusRevision: z.number().int().min(0).max(2_147_483_646),
}).strict()

const OrderId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)

const json = (body: object, status: number) => NextResponse.json(body, { status })

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  const session = await getSession(request)
  const user = session?.user as { id?: unknown; role?: unknown } | undefined
  if (
    user?.role !== "ADMIN" ||
    typeof user.id !== "string" ||
    user.id.length < 1 ||
    user.id.length > 128
  ) return json({ ok: false, code: "UNAUTHORIZED" }, 401)

  if (!t2EvidenceConsoleEnabled() || !t2ManualReviewControlEnabled())
    return json({ ok: false, code: "MANUAL_REVIEW_CONTROL_DISABLED" }, 404)

  let requestOrigin: string
  try {
    const origin = request.headers.get("origin")
    if (!origin) throw new Error("missing")
    requestOrigin = new URL(origin).origin
  } catch {
    return json({ ok: false, code: "INVALID_ORIGIN" }, 403)
  }
  if (requestOrigin !== new URL(request.url).origin)
    return json({ ok: false, code: "INVALID_ORIGIN" }, 403)
  if (request.headers.get("content-type") !== "application/json")
    return json({ ok: false, code: "INVALID_CONTENT_TYPE" }, 400)

  const { orderId } = await context.params
  if (!OrderId.safeParse(orderId).success)
    return json({ ok: false, code: "INVALID_ORDER_ID" }, 400)

  const parsed = Body.safeParse(await request.json().catch(() => undefined))
  if (!parsed.success) return json({ ok: false, code: "INVALID_BODY" }, 400)

  try {
    const result = await enterManualReview({
      orderId,
      actorUserId: user.id,
      expectedStatus: parsed.data.expectedStatus,
      expectedStatusRevision: parsed.data.expectedStatusRevision,
    })
    if (result.ok) return json(result, 200)
    const status = result.code === "ORDER_NOT_FOUND" ||
      result.code === "NO_FULFILLMENT_SUMMARY" ? 404 : 409
    return json(result, status)
  } catch {
    return json({ ok: false, code: "INTERNAL_ERROR" }, 500)
  }
}