// POST /api/ot/packet/download
//
// The customer-facing access boundary for an immutable T2 evidence packet.
//
// Why POST, and why a body: the capability is the entire authorization, so it
// must never appear in a URL. A URL-borne value lands in the access log, the
// `Referer` of every outbound link on the page it decorates, browser history,
// and any proxy or CDN cache in between. A request body lands in none of those.
// The GET handler below exists purely to make that refusal explicit and testable.
//
// Nothing on this path reads a session, an email, or any other ownership claim:
// `ot_order` is anonymous and its email is an unverified checkout field, so
// there is no ownership here that could be trusted. (The account-owned legacy
// invoice packet download is a different product and is unrelated.)
//
// Default-off: with OT_T2_PACKET_DOWNLOAD_ENABLED absent — which is every
// environment — this route is indistinguishable from one that does not exist.
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { t2PacketDownloadEnabled } from "@/lib/fulfillment/flag"
import { PACKET_DOWNLOAD_CAPABILITY_LENGTH } from "@/lib/fulfillment/packet-download"
import {
  readT2PacketForCapability,
  type PacketDownloadRefusal,
} from "@/lib/fulfillment-runtime/packet-download"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const Body = z
  .object({
    capability: z
      .string()
      .length(PACKET_DOWNLOAD_CAPABILITY_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict()

/**
 * The only legal body is one small JSON object holding one 43-character value,
 * so 1 KiB is generous. The cap exists because `request.json()` will buffer
 * whatever a client streams: an unbounded read on an unauthenticated route is a
 * memory cost anyone can impose, and the capability check happens after it.
 */
const MAX_BODY_BYTES = 1024

/**
 * Media type only, charset tolerant.
 *
 * `application/json; charset=utf-8` is a perfectly ordinary thing for a client
 * to send, and an exact string compare against the whole header rejects it.
 * Parameters are ignored rather than validated: they cannot change what we do.
 */
function isJsonMediaType(header: string | null): boolean {
  if (header === null) return false
  return header.split(";")[0].trim().toLowerCase() === "application/json"
}

type BoundedBody =
  | { ok: true; text: string }
  | { ok: false; code: "REQUEST_TOO_LARGE" | "INVALID_REQUEST" }

/**
 * Read at most `MAX_BODY_BYTES` from the request stream.
 *
 * The limit is enforced on the bytes actually received, not on `Content-Length`:
 * a chunked request declares no length at all, so trusting the header alone
 * would bound nothing. The header is still checked first, because refusing an
 * over-large declared body before reading it is cheaper than proving it.
 */
async function readBoundedBody(request: NextRequest): Promise<BoundedBody> {
  const declared = request.headers.get("content-length")
  if (declared !== null) {
    if (!/^\d{1,15}$/.test(declared.trim())) return { ok: false, code: "INVALID_REQUEST" }
    if (Number(declared.trim()) > MAX_BODY_BYTES)
      return { ok: false, code: "REQUEST_TOO_LARGE" }
  }

  const body = request.body
  if (body === null) return { ok: false, code: "INVALID_REQUEST" }

  const reader = body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        // Stop pulling immediately; the rest is never buffered.
        await reader.cancel().catch(() => {})
        return { ok: false, code: "REQUEST_TOO_LARGE" }
      }
      // Copied, not viewed: a reader is free to reuse the buffer it handed us.
      chunks.push(Buffer.from(value))
    }
  } catch {
    // A truncated or aborted stream is just a malformed request. The thrown
    // value is never read: it can carry connection detail.
    return { ok: false, code: "INVALID_REQUEST" }
  }
  return { ok: true, text: Buffer.concat(chunks, total).toString("utf8") }
}

/**
 * Client-visible outcomes.
 *
 * Deliberately coarse. A holder of a live capability learns nothing useful from
 * a precise reason, and an attacker probing with guessed values must not be able
 * to tell "no such capability" from "that order was refunded". The three GONE
 * cases are the exception: they are only reachable by someone who already held a
 * real capability, and telling them why it stopped working is the difference
 * between a support ticket and a mystery.
 */
function refusal(blocker: PacketDownloadRefusal): NextResponse {
  if (blocker === "CAPABILITY_EXPIRED") return json({ ok: false, code: "EXPIRED" }, 410)
  if (blocker === "CAPABILITY_REVOKED") return json({ ok: false, code: "REVOKED" }, 410)
  if (blocker === "CAPABILITY_EXHAUSTED" || blocker === "CAPABILITY_USE_NOT_CLAIMED")
    return json({ ok: false, code: "EXHAUSTED" }, 410)
  if (blocker === "STORAGE_READ_FAILED" || blocker === "STORED_BYTES_MISMATCH")
    return json({ ok: false, code: "TEMPORARILY_UNAVAILABLE" }, 503)
  return json({ ok: false, code: "NOT_AVAILABLE" }, 404)
}

const PRIVATE_HEADERS = {
  // A packet is private, single-recipient, and must never be cached by a browser,
  // a proxy, or a CDN edge that other customers share.
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const

function json(body: object, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS })
}

export async function POST(request: NextRequest) {
  if (!t2PacketDownloadEnabled()) return json({ ok: false, code: "NOT_AVAILABLE" }, 404)

  // A capability must never travel in a URL, so a POST that carries a query
  // string is refused outright rather than ignored. Nothing here parses the
  // query or reads a value out of it — the presence of a `?` is the whole test,
  // which is why no parameter can be accidentally honoured later.
  if (request.url.includes("?"))
    return json({ ok: false, code: "QUERY_NOT_ALLOWED" }, 400)

  if (!isJsonMediaType(request.headers.get("content-type")))
    return json({ ok: false, code: "INVALID_CONTENT_TYPE" }, 400)

  const raw = await readBoundedBody(request)
  if (!raw.ok)
    return json({ ok: false, code: raw.code }, raw.code === "REQUEST_TOO_LARGE" ? 413 : 400)

  let decoded: unknown
  try {
    decoded = JSON.parse(raw.text)
  } catch {
    // The parse error quotes the input, so it is discarded unread.
    return json({ ok: false, code: "INVALID_REQUEST" }, 400)
  }

  const parsed = Body.safeParse(decoded)
  // The submitted value is never echoed, and the zod error — which would quote
  // it — is never serialized into the response.
  if (!parsed.success) return json({ ok: false, code: "INVALID_REQUEST" }, 400)

  let result: Awaited<ReturnType<typeof readT2PacketForCapability>>
  try {
    result = await readT2PacketForCapability({
      capabilityValue: parsed.data.capability,
    })
  } catch {
    // The thrown value may carry provider, database, or connection detail.
    return json({ ok: false, code: "TEMPORARILY_UNAVAILABLE" }, 503)
  }

  if (!result.ok) {
    // Bounded code only: no capability, no digest, no order or customer identifier.
    console.warn(`[ot-packet-download] outcome=REFUSED code=${result.blocker}`)
    return refusal(result.blocker)
  }

  // `BodyInit` wants a `Uint8Array<ArrayBuffer>`; a Node `Buffer` is a
  // `Uint8Array<ArrayBufferLike>` and does not satisfy it. Copying through the
  // view respects byteOffset/byteLength, so a pooled Buffer yields exactly the
  // packet bytes and never the surrounding pool.
  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": result.mediaType ?? "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename ?? "overtaxed-appeal-evidence.pdf"}"`,
      "Content-Length": String(result.byteSize),
    },
  })
}

/**
 * A capability may never arrive in a URL, so there is no GET form of this route
 * — not even one that reads a query parameter and refuses it. Stating that as
 * code rather than as an absence means a future edit has to delete this comment
 * to introduce the leak.
 */
export async function GET() {
  return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405)
}
