// Server-only handler factory for POST /api/ot/packet/download.
//
// The route binds this with NO arguments, which is the only production shape:
// the reader then runs with its fixed native defaults exactly as before. The
// optional `deps` exist solely for an in-process server constructor (a local
// qualification harness) and accept nothing but `store` and `readBytes` — no
// environment, flag, authorization or result override. Injection is refused at
// construction in production and re-checked on every request, so a later
// NODE_ENV change cannot turn an injected handler into a delivery path.
import "server-only"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { t2PacketDownloadEnabled } from "@/lib/fulfillment/flag"
import { PACKET_DOWNLOAD_CAPABILITY_LENGTH } from "@/lib/fulfillment/packet-download"
import {
  readT2PacketForCapability,
  type PacketDownloadDeps,
  type PacketDownloadRefusal,
} from "@/lib/fulfillment-runtime/packet-download"

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
  if (blocker === "CAPABILITY_SPENT_REISSUE_REQUIRED")
    return json({ ok: false, code: "REISSUE_REQUIRED", message: "This download attempt could not be completed. Contact support for a replacement code." }, 409)
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

/** Injection may only ever carry these two fields. */
export type PacketDownloadHandlerDeps = Readonly<Pick<PacketDownloadDeps, "store" | "readBytes">>

const isProduction = () => process.env.NODE_ENV === "production"

function injectionForbidden(): never {
  throw new Error("PACKET_DOWNLOAD_INJECTION_FORBIDDEN")
}

/**
 * Validate and snapshot injected dependencies. The caller's object is never read
 * again, and every injected call re-checks the environment, so neither a later
 * mutation nor NODE_ENV drift can redirect or enable an injected operation.
 */
function snapshotDeps(deps: unknown): Readonly<Pick<PacketDownloadDeps, "store" | "readBytes">> {
  if (isProduction()) injectionForbidden()
  if (deps === null || typeof deps !== "object" || Array.isArray(deps)) throw new Error("PACKET_DOWNLOAD_DEPS_INVALID")
  const keys = Object.keys(deps)
  if (keys.length === 0 || keys.some((k) => k !== "store" && k !== "readBytes")) throw new Error("PACKET_DOWNLOAD_DEPS_INVALID")
  const input = deps as PacketDownloadHandlerDeps
  const snapshot: Pick<PacketDownloadDeps, "store" | "readBytes"> = {}
  if (input.store !== undefined) {
    const s = input.store
    if (!s || typeof s.issue !== "function" || typeof s.authorize !== "function" ||
        typeof s.reassert !== "function" || typeof s.revoke !== "function")
      throw new Error("PACKET_DOWNLOAD_DEPS_INVALID")
    const issue = s.issue.bind(s), authorize = s.authorize.bind(s), reassert = s.reassert.bind(s), revoke = s.revoke.bind(s)
    snapshot.store = Object.freeze({
      issue: (i: Parameters<typeof issue>[0]) => (isProduction() ? injectionForbidden() : issue(i)),
      authorize: (i: Parameters<typeof authorize>[0]) => (isProduction() ? injectionForbidden() : authorize(i)),
      reassert: (i: Parameters<typeof reassert>[0]) => (isProduction() ? injectionForbidden() : reassert(i)),
      revoke: (i: Parameters<typeof revoke>[0]) => (isProduction() ? injectionForbidden() : revoke(i)),
    })
  }
  if (input.readBytes !== undefined) {
    const read = input.readBytes
    if (typeof read !== "function") throw new Error("PACKET_DOWNLOAD_DEPS_INVALID")
    snapshot.readBytes = async (i: { locator: string }) => {
      if (isProduction()) injectionForbidden()
      const bytes = await read({ locator: i.locator })
      if (isProduction()) injectionForbidden()
      return bytes
    }
  }
  return Object.freeze(snapshot)
}

export function createPacketDownloadHandlers(deps?: PacketDownloadHandlerDeps) {
  const injected = deps === undefined ? null : snapshotDeps(deps)

  async function POST(request: NextRequest) {
    if (!t2PacketDownloadEnabled()) return json({ ok: false, code: "NOT_AVAILABLE" }, 404)
    // An injected handler is never a production delivery path, however it was built.
    if (injected && isProduction()) return json({ ok: false, code: "NOT_AVAILABLE" }, 404)

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
      result = injected
        ? await readT2PacketForCapability({ capabilityValue: parsed.data.capability }, injected)
        : await readT2PacketForCapability({
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

    // Final injected gate: no bytes leave an injected handler in production.
    if (injected && isProduction()) return json({ ok: false, code: "TEMPORARILY_UNAVAILABLE" }, 503)

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
  async function GET() {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405)
  }

  return Object.freeze({ POST, GET })
}
