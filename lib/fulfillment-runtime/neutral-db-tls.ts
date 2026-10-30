import { X509Certificate } from "node:crypto"
import { isIP } from "node:net"
import { checkServerIdentity, type PeerCertificate } from "node:tls"
import type { PoolConfig } from "pg"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const ALLOWED_URL_OPTIONS = new Set(["sslmode", "pgbouncer"])
const MAX_CA_BYTES = 128 * 1024
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/

/**
 * Build a node-postgres connection that preserves Supabase verify-full.
 *
 * node-postgres parses `sslmode` from a connection string after merging the
 * explicit `ssl` object. Leaving `sslmode=verify-full` in the URL can therefore
 * replace the pinned CA object and fall back to the host trust store. Supabase's
 * project chain is not in that store on Vercel, which fails with
 * `self-signed certificate in certificate chain` before any SQL runs.
 *
 * Validate the original URL first, then remove all accepted query options from the string
 * passed to pg and supply the reviewed CA explicitly. TLS certificate and
 * hostname verification remain enabled.
 */
export type NeutralPoolTrustOptions = {
  /**
   * Explicit code-level opt-in for a TLS-only loopback server (for example an
   * owned hostssl fixture). Never inferred from a CA or from the environment.
   */
  loopbackTls?: "verify-full"
}

export function buildNeutralPoolConfig(
  rawUrl: string,
  rawCa: string | undefined,
  options: NeutralPoolTrustOptions = {},
): Pick<PoolConfig, "connectionString" | "host" | "port" | "user" | "password" | "database" | "ssl"> {
  const loopbackTls = options.loopbackTls
  if (loopbackTls !== undefined && loopbackTls !== "verify-full")
    throw new Error("NEUTRAL_DATABASE_TLS_OPTION_INVALID")


  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    // WHATWG URL errors retain the rejected input in an enumerable property.
    // Never let a credential-bearing connection string escape through it.
    throw new Error("NEUTRAL_DATABASE_URL_INVALID")
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:")
    throw new Error("NEUTRAL_DATABASE_URL_INVALID")

  const seen = new Set<string>()
  for (const [key, value] of parsed.searchParams) {
    if (!ALLOWED_URL_OPTIONS.has(key) || seen.has(key))
      throw new Error("NEUTRAL_DATABASE_URL_OPTION_FORBIDDEN")
    seen.add(key)
    if (key === "pgbouncer" && (value !== "true" || parsed.port !== "6543"))
      throw new Error("NEUTRAL_DATABASE_URL_OPTION_FORBIDDEN")
  }

  if (LOOPBACK.has(parsed.hostname)) {
    // Keep local development plaintext and deterministic. No URL option is
    // useful here, and retaining one would let pg reinterpret the explicit
    // ssl=false setting. An explicit host also removes WHATWG's IPv6 brackets
    // before node-postgres hands the value to net.connect.
    if (seen.size > 0) throw new Error("NEUTRAL_DATABASE_URL_OPTION_FORBIDDEN")
    // Only the explicit opt-in enables TLS here; a CA alone keeps plaintext.
    // The opt-in demands a parsed CA certificate and keeps Node's chain
    // verification. Identity is bound to the exact URL host (see exactHostIdentity):
    // pg sends no servername for an IP literal, so Node would otherwise validate
    // against its 'localhost' fallback.
    const ssl = loopbackTls === "verify-full"
      ? { rejectUnauthorized: true, ca: validatedCa(rawCa, true), ...exactHostIdentity(parsed.hostname) }
      : false
    try {
      return {
        host: parsed.hostname === "[::1]" ? "::1" : parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5432,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: decodeURIComponent(parsed.pathname.slice(1)),
        ssl,
      }
    } catch {
      throw new Error("NEUTRAL_DATABASE_URL_INVALID")
    }
  }

  if (parsed.searchParams.get("sslmode")?.toLowerCase() !== "verify-full")
    throw new Error("NEUTRAL_DATABASE_VERIFY_FULL_REQUIRED")

  const ca = validatedCa(rawCa, false)

  // Neither option belongs in node-postgres once this helper has validated it.
  // Removing both guarantees pg-connection-string cannot replace the explicit
  // TLS object or reinterpret a Prisma-only pooler hint.
  parsed.searchParams.delete("sslmode")
  parsed.searchParams.delete("pgbouncer")
  // A DNS host keeps the unchanged TLS object: pg supplies servername=host and
  // Node's standard validator applies. An IP literal gets no servername from pg,
  // so its identity is bound to the exact address instead.
  const identity = isIP(unbracket(parsed.hostname)) ? exactHostIdentity(parsed.hostname) : {}
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: true, ca, ...identity },
  }
}

function unbracket(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
}

/**
 * Node's standard certificate identity check, bound to the exact validated URL
 * host (IPv6 brackets removed). The name Node offers is ignored: for an IP
 * literal it is the 'localhost' fallback, not the dialled endpoint. Any error is
 * returned unchanged, so rejectUnauthorized=true still refuses the connection;
 * CA chain verification runs before this check and is unaffected.
 */
function exactHostIdentity(hostname: string): {
  checkServerIdentity: (offered: string, cert: PeerCertificate) => Error | undefined
} {
  const host = unbracket(hostname)
  return { checkServerIdentity: (_offered, cert) => checkServerIdentity(host, cert) }
}

function validatedCa(rawCa: string | undefined, requireCaCertificate: boolean): string {
  const ca = rawCa?.trim() ?? ""
  if (!ca) throw new Error("NEUTRAL_DATABASE_CA_REQUIRED")
  if (
    Buffer.byteLength(ca, "utf8") > MAX_CA_BYTES ||
    ca.includes("\0") ||
    !PEM_CERTIFICATE.test(ca)
  )
    throw new Error("NEUTRAL_DATABASE_CA_INVALID")
  // The remote path keeps its historical PEM-shape check. The loopback opt-in
  // is new, so it additionally requires a parseable certificate marked CA.
  if (requireCaCertificate) {
    let isCa = false
    try {
      isCa = new X509Certificate(ca).ca
    } catch {
      isCa = false
    }
    if (!isCa) throw new Error("NEUTRAL_DATABASE_CA_INVALID")
  }
  return ca
}
