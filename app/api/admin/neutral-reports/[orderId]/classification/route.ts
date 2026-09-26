import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/auth/session"
import {
  NEUTRAL_CLASSIFICATION_NOTE_CODES,
  NEUTRAL_ORDER_CLASSES,
} from "@/lib/fulfillment/neutral-order-classification"
import { classifyNeutralOrder } from "@/lib/fulfillment-runtime/neutral-order-classification-store"
import { NEUTRAL_OPERATOR_PRIVATE_HEADERS } from "@/lib/fulfillment-runtime/neutral-operator-route-headers"

const OrderId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const Body = z
  .object({
    action: z.literal("CLASSIFY"),
    class: z.enum(NEUTRAL_ORDER_CLASSES),
    noteCode: z.enum(NEUTRAL_CLASSIFICATION_NOTE_CODES).optional(),
  })
  .strict()

const json = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: NEUTRAL_OPERATOR_PRIVATE_HEADERS })

/**
 * Record the durable, insert-only class of one order. Insert-only and
 * idempotent: re-asserting the same class succeeds, a different one is a 409.
 * The actor key comes from the authenticated session, never from the body.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const session = await getSession(request)
  const user = session?.user as { id?: unknown; role?: unknown } | undefined
  if (user?.role !== "ADMIN" || typeof user.id !== "string" || user.id.length < 1 || user.id.length > 128)
    return json({ ok: false, code: "UNAUTHORIZED" }, 401)
  if (process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED !== "true")
    return json({ ok: false, code: "NOT_AVAILABLE" }, 404)
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ ok: false, code: "INVALID_ORIGIN" }, 403)
  } catch {
    return json({ ok: false, code: "INVALID_ORIGIN" }, 403)
  }
  if (request.headers.get("content-type") !== "application/json")
    return json({ ok: false, code: "INVALID_CONTENT_TYPE" }, 400)
  const { orderId } = await context.params
  if (!OrderId.safeParse(orderId).success) return json({ ok: false, code: "INVALID_ORDER_ID" }, 400)
  // The submitted value is never echoed, and the zod error — which would quote
  // it — is never serialized into the response.
  const parsed = Body.safeParse(await request.json().catch(() => undefined))
  if (!parsed.success) return json({ ok: false, code: "INVALID_BODY" }, 400)
  try {
    const result = await classifyNeutralOrder({
      orderId,
      actorKey: `admin:${user.id}`,
      class: parsed.data.class,
      noteCode: parsed.data.noteCode ?? null,
    })
    return json(result, result.ok ? 200 : 409)
  } catch {
    return json({ ok: false, code: "INTERNAL_ERROR" }, 500)
  }
}
