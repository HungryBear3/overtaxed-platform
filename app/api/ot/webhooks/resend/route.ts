// POST /api/ot/webhooks/resend
//
// The authenticated provider-callback boundary for paid T2 packet delivery.
//
// Kept strictly separate from `/api/outreach/webhooks/resend`, which serves the
// condo outreach campaign. That endpoint's verifier permits an absent secret
// outside production and carries a legacy raw-HMAC fallback — a defensible
// posture for campaign telemetry, and not one that may govern evidence about a
// paid order. This endpoint has its own secret
// (OT_T2_RESEND_WEBHOOK_SECRET), accepts Svix signatures only, and fails closed
// without a secret in EVERY environment.
//
// Default-off: with OT_T2_DELIVERY_CALLBACK_ENABLED absent — which is every
// environment — this route is indistinguishable from one that does not exist.
import { NextRequest, NextResponse } from "next/server"
import { t2DeliveryCallbackEnabled } from "@/lib/fulfillment/flag"
import { MAX_CALLBACK_BODY_BYTES } from "@/lib/fulfillment/provider-callbacks"
import { ingestT2ResendCallback } from "@/lib/fulfillment-runtime/t2-resend-events"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const

function json(body: object, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS })
}

/**
 * Header names the verifier may read.
 *
 * An allowlist rather than the whole header bag, so nothing else a proxy
 * attaches can reach the verification path.
 */
const SIGNATURE_HEADERS = [
  "svix-id",
  "svix-timestamp",
  "svix-signature",
  "webhook-id",
  "webhook-timestamp",
  "webhook-signature",
] as const

export async function POST(request: NextRequest) {
  if (!t2DeliveryCallbackEnabled()) return json({ ok: false }, 404)

  // Bound the body BEFORE reading it, when the sender declared a length. A
  // missing or lying Content-Length is caught by the byte check after the read,
  // which `ingestT2ResendCallback` performs on the raw text.
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_CALLBACK_BODY_BYTES)
    return json({ ok: false }, 413)

  let rawBody: string
  try {
    // Raw text, never `request.json()`. The signature covers these exact bytes,
    // and a parse-then-reserialize round trip would verify something else.
    rawBody = await request.text()
  } catch {
    return json({ ok: false }, 400)
  }

  const headers: Record<string, string | null> = {}
  for (const name of SIGNATURE_HEADERS) headers[name] = request.headers.get(name)

  let outcome: Awaited<ReturnType<typeof ingestT2ResendCallback>>
  try {
    outcome = await ingestT2ResendCallback({ rawBody, headers })
  } catch {
    // The thrown value may carry provider, database, or connection detail. A 500
    // is also the right answer for the provider: it will retry, and the replay
    // identity makes that retry safe.
    console.error("[ot-t2-callback] outcome=THREW")
    return json({ ok: false }, 500)
  }

  if (!outcome.ok) {
    // Deliberately coarse on the wire. A caller probing with forged bodies must
    // not learn whether it failed the signature, the timestamp, the shape, or
    // the event-type allowlist. The precise code is logged, never returned.
    console.warn(`[ot-t2-callback] outcome=REFUSED code=${outcome.code}`)
    if (
      outcome.code === "INVALID_SIGNATURE" ||
      outcome.code === "INVALID_PROVIDER_EVENT_ID"
    )
      return json({ ok: false }, 401)
    if (outcome.code === "SECRET_NOT_CONFIGURED") return json({ ok: false }, 503)
    if (outcome.code === "BODY_TOO_LARGE") return json({ ok: false }, 413)
    // An event we do not model is not an error the provider can act on, and
    // answering 4xx would make it retry forever. Accept and record nothing.
    if (
      outcome.code === "IGNORED_EVENT_TYPE" ||
      outcome.code === "UNSUPPORTED_EVENT_TYPE"
    )
      return json({ ok: true, received: true }, 200)
    return json({ ok: false }, 400)
  }

  // Bounded outcome only: no order id, no fulfillment id, no message id, no
  // recipient. An operator reads the detail from the durable callback log.
  console.info(`[ot-t2-callback] outcome=${outcome.result.outcome}`)
  return json({ ok: true, received: true }, 200)
}

/**
 * A signed callback is a POST. Stating the refusal as code rather than as an
 * absence means a future edit has to delete this to introduce a GET form.
 */
export async function GET() {
  return json({ ok: false }, 405)
}
