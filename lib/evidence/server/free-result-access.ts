import "server-only"
/**
 * Result-bound browser capability for the free check. A successful lookup POST
 * sets a signed HttpOnly SameSite=Strict cookie naming the exact result,
 * snapshot and subject it issued; result and report reads require it and
 * compare it with the persisted record. No signup, no new storage: the HMAC
 * key is the existing NEXTAUTH_SECRET, and a missing key fails closed.
 *
 * Each result gets its own cookie name (`ot_free_result_<resultId>`), so a
 * late response for an older lookup cannot overwrite, and so revoke, a newer
 * result's capability in the same browser jar (tabs share one jar). The name
 * carries no authority: only the signed value bound to that result does.
 * Capacity: browsers cap cookies per site and request header size, so this
 * suits a small concurrent set of results (on the order of ten within 24h);
 * nothing here enforces a cap, and an evicted result needs a fresh lookup.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto"

/** Prefix of the per-result cookie name; see `freeResultCookieName`. */
export const FREE_RESULT_COOKIE = "ot_free_result"
const TTL_SECONDS = 24 * 3600
const MIN_SECRET_LENGTH = 32
const RESULT_ID = /^res_[a-z0-9]{24}$/

/** Cookie name scoped to one result, or null for a malformed result id. */
export function freeResultCookieName(resultId: string): string | null {
  return RESULT_ID.test(resultId) ? `${FREE_RESULT_COOKIE}_${resultId}` : null
}

export type FreeResultBinding = {
  resultId: string
  snapshotId: string
  subject: { pin: string; township: string; taxYear: number }
}

export interface FreeResultAccess {
  /** False when no usable signing secret exists: every guarded call refuses. */
  configured: boolean
  /** Set-Cookie value for this binding, or null when unconfigured. */
  issueCookie(binding: FreeResultBinding): string | null
  /** The signed binding for `resultId` carried by this request, or null. */
  readBinding(req: Request, resultId: string): FreeResultBinding | null
  /** True only when the binding names the persisted result's canonical identity. */
  matches(binding: FreeResultBinding, persisted: FreeResultBinding): boolean
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url")

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

export function createFreeResultAccess(opts: { secret: string | undefined; now?: () => number }): FreeResultAccess {
  const secret = opts.secret && opts.secret.length >= MIN_SECRET_LENGTH ? opts.secret : undefined
  const now = opts.now ?? Date.now
  const sign = (payload: string) => createHmac("sha256", secret!).update(`otfr1.${payload}`).digest()
  return {
    configured: secret !== undefined,
    issueCookie(b) {
      const name = freeResultCookieName(b.resultId)
      if (!secret || !name) return null
      const payload = b64(JSON.stringify({
        r: b.resultId, s: b.snapshotId, p: b.subject.pin, t: b.subject.township, y: b.subject.taxYear,
        e: Math.floor(now() / 1000) + TTL_SECONDS, n: randomBytes(16).toString("hex"),
      }))
      return `${name}=${payload}.${b64(sign(payload))}; Path=/api/free-check; Max-Age=${TTL_SECONDS}; HttpOnly; SameSite=Strict; Secure`
    },
    readBinding(req, resultId) {
      const name = freeResultCookieName(resultId)
      if (!secret || !name) return null
      const raw = readCookie(req, name)
      const [payload, mac, extra] = (raw ?? "").split(".")
      if (!payload || !mac || extra !== undefined) return null
      const expected = sign(payload)
      const given = Buffer.from(mac, "base64url")
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
      try {
        const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
        if (typeof c.e !== "number" || c.e * 1000 <= now()) return null
        if (c.r !== resultId || typeof c.s !== "string" || typeof c.p !== "string" || typeof c.t !== "string" || typeof c.y !== "number") return null
        return { resultId: c.r, snapshotId: c.s, subject: { pin: c.p, township: c.t, taxYear: c.y } }
      } catch {
        return null
      }
    },
    matches(b, p) {
      return b.resultId === p.resultId && b.snapshotId === p.snapshotId &&
        b.subject.pin === p.subject.pin && b.subject.township === p.subject.township && b.subject.taxYear === p.subject.taxYear
    },
  }
}

/** Production authority. There is no bypass: an unset secret means refusal. */
export function productionFreeResultAccess(): FreeResultAccess {
  return createFreeResultAccess({ secret: process.env.NEXTAUTH_SECRET })
}

/** Refuses cross-site fetch metadata and any foreign Origin. */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") return false
  const origin = req.headers.get("origin")
  return !origin || origin === new URL(req.url).origin
}
