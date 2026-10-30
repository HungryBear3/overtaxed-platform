import "server-only"
/**
 * Free result -> paid checkout snapshot transfer. The free capability cookie is
 * scoped to /api/free-check, so the browser holding it asks the server for a
 * second signed HttpOnly cookie scoped to /api/checkout naming the exact
 * persisted acquisition snapshot. Checkout trusts only that cookie (never
 * posted IDs or data), and redeems its nonce exactly once into an immutable
 * order binding before any provider call.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto"
import type { AnalysisStore } from "@/lib/evidence/server/analysis-store"
import { isSameOrigin, type FreeResultAccess } from "@/lib/evidence/server/free-result-access"
import { ACCESS_UNAVAILABLE, CROSS_ORIGIN, RESULT_REFUSED, loadAuthorizedResult } from "@/lib/evidence/server/free-report-handler"
import { inSnapshotRole, snapshotRolePool } from "@/lib/evidence/server/acquisition-snapshot"
import type { Pool } from "pg"

export const SNAPSHOT_TRANSFER_COOKIE = "ot_snapshot_transfer"
const TTL_SECONDS = 30 * 60
const MIN_SECRET_LENGTH = 32
const SNAPSHOT_ID = /^acq_[a-f0-9]{64}$/, NONCE = /^[a-f0-9]{32}$/, PIN = /^\d{14}$/

export type SnapshotTransferClaim = { snapshotId: string; sha256: string; pin: string; nonce: string; exp: number }
export type SnapshotTransferRead = { status: "ABSENT" } | { status: "INVALID" } | { status: "VALID"; claim: SnapshotTransferClaim }

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url")
function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

export function createSnapshotTransferAuthority(opts: { secret: string | undefined; now?: () => number }) {
  const secret = opts.secret && opts.secret.length >= MIN_SECRET_LENGTH ? opts.secret : undefined
  const now = opts.now ?? Date.now
  // Domain-separated from the free result capability (otfr1).
  const sign = (payload: string) => createHmac("sha256", secret!).update(`otst1.${payload}`).digest()
  return {
    configured: secret !== undefined,
    issueCookie(ref: { snapshotId: string; sha256: string; pin: string }): string | null {
      if (!secret || !SNAPSHOT_ID.test(ref.snapshotId) || ref.snapshotId !== "acq_" + ref.sha256 || !PIN.test(ref.pin)) return null
      const payload = b64(JSON.stringify({ s: ref.snapshotId, h: ref.sha256, p: ref.pin, n: randomBytes(16).toString("hex"), e: Math.floor(now() / 1000) + TTL_SECONDS }))
      return `${SNAPSHOT_TRANSFER_COOKIE}=${payload}.${b64(sign(payload))}; Path=/api/checkout; Max-Age=${TTL_SECONDS}; HttpOnly; SameSite=Strict; Secure`
    },
    readClaim(req: Request): SnapshotTransferRead {
      const raw = readCookie(req, SNAPSHOT_TRANSFER_COOKIE)
      if (raw === undefined) return { status: "ABSENT" }
      if (!secret) return { status: "INVALID" }
      const [payload, mac, extra] = raw.split(".")
      if (!payload || !mac || extra !== undefined) return { status: "INVALID" }
      const expected = sign(payload), given = Buffer.from(mac, "base64url")
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { status: "INVALID" }
      try {
        const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
        if (typeof c.e !== "number" || c.e * 1000 <= now() || typeof c.s !== "string" || !SNAPSHOT_ID.test(c.s) || c.s !== "acq_" + c.h || typeof c.p !== "string" || !PIN.test(c.p) || typeof c.n !== "string" || !NONCE.test(c.n)) return { status: "INVALID" }
        return { status: "VALID", claim: { snapshotId: c.s, sha256: c.h, pin: c.p, nonce: c.n, exp: c.e } }
      } catch {
        return { status: "INVALID" }
      }
    },
  }
}
export type SnapshotTransferAuthority = ReturnType<typeof createSnapshotTransferAuthority>

/** Production authority: existing NEXTAUTH_SECRET; unset means refusal. */
export function productionSnapshotTransferAuthority(): SnapshotTransferAuthority {
  return createSnapshotTransferAuthority({ secret: process.env.NEXTAUTH_SECRET })
}

const json = (body: unknown, status: number, cookie?: string) => {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "private, no-store" })
  if (cookie) headers.set("set-cookie", cookie)
  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * POST /api/free-check/transfer?id=res_...: only the browser holding this
 * result's capability receives the checkout-scoped transfer cookie. The body
 * never discloses the snapshot identity.
 */
export function createGuardedSnapshotTransferRoute(deps: { store: AnalysisStore; access: FreeResultAccess; transfer: SnapshotTransferAuthority }) {
  return {
    async POST(req: Request): Promise<Response> {
      if (!isSameOrigin(req)) return CROSS_ORIGIN()
      if (!deps.transfer.configured) return ACCESS_UNAVAILABLE()
      const authorized = await loadAuthorizedResult(deps.store, deps.access, req, new URL(req.url).searchParams.get("id") ?? "")
      if (!authorized.ok) return authorized.response
      const result = authorized.result as { subject: { pin: string }; acquisitionSnapshot?: { id: string; sha256: string } }
      const ref = result.acquisitionSnapshot
      if (!ref) return json({ error: "This result cannot be carried to checkout.", code: "SNAPSHOT_NOT_TRANSFERABLE" }, 409)
      const cookie = deps.transfer.issueCookie({ snapshotId: ref.id, sha256: ref.sha256, pin: String(result.subject.pin).replace(/\D/g, "") })
      if (!cookie) return RESULT_REFUSED()
      return json({ transferred: true }, 200, cookie)
    },
  }
}

export type BindResult = { ok: true } | { ok: false; blocker: "TRANSFER_REPLAYED" | "ORDER_SNAPSHOT_CONFLICT" | "BINDING_UNAVAILABLE" }
export type OrderSnapshotRef = { snapshotId: string; sha256: string; pin: string }
export interface OrderSnapshotBindingStore {
  /** Durably and atomically redeems the transfer nonce into this order's one immutable binding. */
  bind(input: { orderId: string; claim: SnapshotTransferClaim }): Promise<BindResult>
  read(orderId: string): Promise<OrderSnapshotRef | undefined>
}

const BINDER_ROLE = "ot_paid_snapshot_binder", READER_ROLE = "ot_paid_snapshot_reader"
const ORDER_ID = /^[A-Za-z0-9_-]{1,128}$/
type Row = { order_id: string; snapshot_id: string; snapshot_sha256: string; subject_pin: string; transfer_nonce: string }

export function createPostgresOrderSnapshotBindingStore(config: { binderUrl: string; readerUrl: string; ssl: "require" | "disable"; boundedAdmission?: boolean }): OrderSnapshotBindingStore & { close(): Promise<void> } {
  let binder: Pool | undefined, reader: Pool | undefined
  const w = () => (binder ??= snapshotRolePool(config.binderUrl, BINDER_ROLE, config.ssl)), r = () => (reader ??= snapshotRolePool(config.readerUrl, READER_ROLE, config.ssl))
  return {
    async bind({ orderId, claim }) {
      if (!ORDER_ID.test(orderId) || !SNAPSHOT_ID.test(claim.snapshotId) || claim.snapshotId !== "acq_" + claim.sha256 || !PIN.test(claim.pin) || !NONCE.test(claim.nonce)) return { ok: false, blocker: "BINDING_UNAVAILABLE" }
      try {
        const row = await inSnapshotRole(w(), BINDER_ROLE, false, async c => {
          // Any conflict (order already bound, or nonce already redeemed) inserts nothing.
          await c.query("INSERT INTO ot_order_snapshot_binding(order_id,snapshot_id,snapshot_sha256,subject_pin,transfer_nonce) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [orderId, claim.snapshotId, claim.sha256, claim.pin, claim.nonce])
          return (await c.query<Row>("SELECT order_id,snapshot_id,snapshot_sha256,subject_pin,transfer_nonce FROM ot_order_snapshot_binding WHERE order_id=$1", [orderId])).rows[0]
        }, config.boundedAdmission)
        if (!row) return { ok: false, blocker: "TRANSFER_REPLAYED" }
        if (row.snapshot_id !== claim.snapshotId || row.snapshot_sha256 !== claim.sha256 || row.subject_pin !== claim.pin) return { ok: false, blocker: "ORDER_SNAPSHOT_CONFLICT" }
        // Same order, same snapshot: idempotent retry. A different unredeemed nonce is not consumed.
        return { ok: true }
      } catch {
        return { ok: false, blocker: "BINDING_UNAVAILABLE" }
      }
    },
    async read(orderId) {
      if (!ORDER_ID.test(orderId)) return undefined
      const row = await inSnapshotRole(r(), READER_ROLE, true, async c => (await c.query<Row>("SELECT order_id,snapshot_id,snapshot_sha256,subject_pin,transfer_nonce FROM ot_order_snapshot_binding WHERE order_id=$1", [orderId])).rows[0])
      return row ? { snapshotId: row.snapshot_id, sha256: row.snapshot_sha256, pin: row.subject_pin } : undefined
    },
    async close() { await Promise.all([binder?.end(), reader?.end()].map(p => p?.catch(() => {}))) },
  }
}

export function createOrderSnapshotBindingStoreFromEnv(options: { boundedAdmission?: boolean } = {}): (OrderSnapshotBindingStore & { close(): Promise<void> }) | null {
  const binderUrl = process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL, readerUrl = process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL, ssl = process.env.OT_FACTUAL_DATABASE_SSL
  if (!binderUrl || !readerUrl || (ssl !== "require" && ssl !== "disable")) return null
  return createPostgresOrderSnapshotBindingStore({ binderUrl, readerUrl, ssl, boundedAdmission: options.boundedAdmission })
}
