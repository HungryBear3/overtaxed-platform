// POST /api/admin/evidence/[orderId]/delivery-recovery
//
// The bounded operator control for a delivery that did not resolve itself.
//
// Deliberately modelled on the manual-review control next to it, and using the
// same authentication and CSRF pattern rather than a new one: an ADMIN session,
// a same-origin check, an explicit JSON content type, and a compare-and-set
// against an exact expected status and revision.
//
// Two actions, both narrow. Neither can send, re-mint, or regenerate anything —
// see lib/fulfillment-runtime/t2-delivery-recovery.ts for the full list of what
// is deliberately unreachable from here.
//
// Default-off: with OT_T2_DELIVERY_RECOVERY_ENABLED absent — which is every
// environment — this route is indistinguishable from one that does not exist.
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/auth/session"
import {
  t2DeliveryRecoveryEnabled,
  t2EvidenceConsoleEnabled,
} from "@/lib/fulfillment/flag"
import {
  NO_IN_FLIGHT_EVIDENCE,
  RESOLVE_REASON_CODES,
  runT2DeliveryRecovery,
} from "@/lib/fulfillment-runtime/t2-delivery-recovery"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Two disjoint bodies rather than one permissive shape.
 *
 * The evidence assertion and the reason code are REQUIRED on the resolving
 * branch and forbidden on the reconciling one, so an operator cannot end a send
 * by sending the reconcile action with extra fields, and cannot end one by
 * omitting the assertion.
 */
const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("RECONCILE_PROVIDER_CALLBACKS"),
      // Only from a state whose send is still unresolved. DELIVERED was here
      // and is deliberately gone: it already holds the evidence a replay looks
      // for, so a pass from it could only spend replay budget and write REFUSED
      // rows while appearing to succeed.
      //
      // Written as literals so the parsed value keeps its narrow type. The
      // authority is RECONCILABLE_STATUSES in the store, and a test asserts
      // this list equals it, so the two cannot drift apart unobserved.
      expectedStatus: z.enum(["DELIVERY_PENDING", "PROVIDER_ACCEPTED", "DELAYED"]),
      expectedStatusRevision: z.number().int().min(0).max(2_147_483_646),
    })
    .strict(),
  z
    .object({
      action: z.literal("RESOLVE_UNRESOLVED_SEND"),
      // Only from the unresolved state. Stated in the schema as well as in the
      // store, so an impossible request is refused before it reaches a lock.
      expectedStatus: z.literal("DELIVERY_PENDING"),
      expectedStatusRevision: z.number().int().min(0).max(2_147_483_646),
      evidence: z.literal(NO_IN_FLIGHT_EVIDENCE),
      reasonCode: z.enum([...RESOLVE_REASON_CODES] as [string, ...string[]]),
    })
    .strict(),
])

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

  if (!t2EvidenceConsoleEnabled() || !t2DeliveryRecoveryEnabled())
    return json({ ok: false, code: "RECOVERY_DISABLED" }, 404)

  try {
    const origin = request.headers.get("origin")
    const expectedOrigin = new URL(request.url).origin
    if (!origin || origin !== expectedOrigin) throw new Error("invalid serialized origin")
  } catch {
    return json({ ok: false, code: "INVALID_ORIGIN" }, 403)
  }
  if (request.headers.get("content-type") !== "application/json")
    return json({ ok: false, code: "INVALID_CONTENT_TYPE" }, 400)

  const { orderId } = await context.params
  if (!OrderId.safeParse(orderId).success)
    return json({ ok: false, code: "INVALID_ORDER_ID" }, 400)

  const parsed = Body.safeParse(await request.json().catch(() => undefined))
  // The zod error is never serialized: it would quote the submitted body.
  if (!parsed.success) return json({ ok: false, code: "INVALID_BODY" }, 400)

  try {
    const result = await runT2DeliveryRecovery({
      orderId,
      actorUserId: user.id,
      ...parsed.data,
    })
    if (result.ok) return json(result, 200)
    const status =
      result.code === "ORDER_NOT_FOUND" || result.code === "NO_FULFILLMENT_SUMMARY"
        ? 404
        : result.code === "RECOVERY_DISABLED"
          ? 404
          : 409
    return json(result, status)
  } catch {
    // The thrown value may carry provider, database, or connection detail.
    console.error("[ot-t2-delivery-recovery] outcome=THREW")
    return json({ ok: false, code: "INTERNAL_ERROR" }, 500)
  }
}
