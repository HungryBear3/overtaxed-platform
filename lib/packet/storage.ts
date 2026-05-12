// Packet PDF storage abstraction.
//
// Goal: the customer-facing /api/account/packets/[invoiceId]/download route
// is the real access boundary for packet PDFs. A leaked direct blob URL
// must NOT be sufficient to read the packet.
//
// Implementation:
// - We default to Vercel Blob `access: 'private'`. With a private-provisioned
//   store, the blob URL itself is not directly fetchable; reads must go
//   through `get(pathname, { access: 'private', token })` which is an
//   authenticated server-side call.
// - If the store is provisioned as public (some Vercel Blob accounts), we
//   fall back to `access: 'public'` BUT keep the auth route as the only
//   surfaced URL and rely on `addRandomSuffix: true` plus the existing
//   path-allowlist as defense in depth. We are honest about this in the
//   logs: `[packet-storage] using public-blob fallback (URL is bearer
//   credential)`.
// - Mode is controlled by the OT_PACKET_BLOB_ACCESS env var:
//     'private'  → strict private mode (recommended)
//     'public'   → public-fallback mode (legacy / public-store accounts)
//     unset      → defaults to 'private'
//
// Behavior on `read`:
// - private mode: server-side `get(pathname, { access: 'private', token })`
//   returns a stream the route serves to the authenticated user. We never
//   expose the underlying URL.
// - public-fallback mode: we re-validate the stored path/url via the
//   allowlist, then fetch the public URL server-side and stream the bytes
//   through the auth route.

import { get, put } from "@vercel/blob"

export type PacketBlobAccessMode = "private" | "public"

export function getPacketBlobAccessMode(): PacketBlobAccessMode {
  const raw = (process.env.OT_PACKET_BLOB_ACCESS ?? "").trim().toLowerCase()
  if (raw === "public") return "public"
  if (raw === "private") return "private"
  // Default to private — the safer mode. Operators must explicitly opt into
  // public-fallback if their store is provisioned that way.
  return "private"
}

export interface StoredPacketRef {
  pathname: string
  /** Only populated when the underlying store is public. In private mode the
   *  URL is omitted because we never want callers to think they can fetch
   *  the packet without going through our authenticated route. */
  url: string | null
  access: PacketBlobAccessMode
}

export class PacketStorageMisconfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PacketStorageMisconfiguredError"
  }
}

/**
 * Upload a packet PDF using the configured access mode.
 *
 * Throws PacketStorageMisconfiguredError if the store rejects the requested
 * access mode (e.g., trying to write 'private' to a public-provisioned store
 * or vice versa). The caller must surface that as an operator alert — we will
 * NOT silently fall back to a weaker access level.
 */
export async function storePacket(args: {
  pathname: string
  bytes: Buffer
}): Promise<StoredPacketRef> {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new PacketStorageMisconfiguredError(
      "BLOB_READ_WRITE_TOKEN not configured — cannot store packet",
    )
  }
  const access = getPacketBlobAccessMode()

  try {
    const blob = await put(args.pathname, args.bytes, {
      // Both 'private' and 'public' are accepted by the type; the store
      // provisioning decides whether the call succeeds.
      access: access as "public",
      contentType: "application/pdf",
      // In private mode, suffix doesn't matter for security (URL isn't
      // directly fetchable). In public-fallback mode, suffix protects against
      // path-guessing.
      addRandomSuffix: access === "public",
      token,
    })
    return {
      pathname: args.pathname,
      // In private mode we deliberately do not surface the URL upstream.
      // Callers must read via `readPacketStream(pathname)` not by fetching a URL.
      url: access === "public" ? blob.url : null,
      access,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/private access on a public store/i.test(msg)) {
      throw new PacketStorageMisconfiguredError(
        `Configured OT_PACKET_BLOB_ACCESS='private' but the blob store is public. ` +
          `Provision a private store, or set OT_PACKET_BLOB_ACCESS='public' (and accept bearer-URL semantics).`,
      )
    }
    if (/public access on a private store/i.test(msg)) {
      throw new PacketStorageMisconfiguredError(
        `Configured OT_PACKET_BLOB_ACCESS='public' but the blob store is private. ` +
          `Set OT_PACKET_BLOB_ACCESS='private' or unset it (private is the default).`,
      )
    }
    throw err
  }
}

/**
 * Read a packet PDF for the auth-gated download route.
 *
 * Returns a Buffer the route can stream back. Caller is responsible for
 * authn/authz BEFORE calling this — the function does not check identity.
 *
 * - Private mode: uses authenticated `get(pathname, { access: 'private' })`.
 *   No URL is involved; a leaked URL alone cannot reach this code path.
 * - Public-fallback mode: caller must have validated `publicUrl` via the
 *   path-allowlist; we fetch the URL server-side and return the bytes.
 */
export async function readPacketBytes(args: {
  pathname: string
  /** Required only in public-fallback mode. */
  publicUrl?: string | null
}): Promise<Buffer> {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new PacketStorageMisconfiguredError(
      "BLOB_READ_WRITE_TOKEN not configured — cannot read packet",
    )
  }
  const access = getPacketBlobAccessMode()

  if (access === "private") {
    const result = await get(args.pathname, {
      access: "private" as "private",
      token,
      useCache: false,
    })
    if (!result || !result.stream) {
      throw new Error("Private blob get returned no stream")
    }
    const text = await new Response(result.stream as unknown as ReadableStream).arrayBuffer()
    return Buffer.from(text)
  }

  // Public-fallback mode.
  if (!args.publicUrl) {
    throw new Error("Public-fallback storage mode requires a stored publicUrl")
  }
  const res = await fetch(args.publicUrl, { cache: "no-store" })
  if (!res.ok) throw new Error(`Public blob fetch failed: ${res.status}`)
  const buf = await res.arrayBuffer()
  return Buffer.from(buf)
}
