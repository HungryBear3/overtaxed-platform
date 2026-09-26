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
export function buildNeutralPoolConfig(rawUrl: string, rawCa: string | undefined): Pick<PoolConfig, "connectionString" | "host" | "port" | "user" | "password" | "database" | "ssl"> {
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
    try {
      return {
        host: parsed.hostname === "[::1]" ? "::1" : parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5432,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: decodeURIComponent(parsed.pathname.slice(1)),
        ssl: false,
      }
    } catch {
      throw new Error("NEUTRAL_DATABASE_URL_INVALID")
    }
  }

  if (parsed.searchParams.get("sslmode")?.toLowerCase() !== "verify-full")
    throw new Error("NEUTRAL_DATABASE_VERIFY_FULL_REQUIRED")

  const ca = rawCa?.trim() ?? ""
  if (!ca) throw new Error("NEUTRAL_DATABASE_CA_REQUIRED")
  if (
    Buffer.byteLength(ca, "utf8") > MAX_CA_BYTES ||
    ca.includes("\0") ||
    !PEM_CERTIFICATE.test(ca)
  )
    throw new Error("NEUTRAL_DATABASE_CA_INVALID")

  // Neither option belongs in node-postgres once this helper has validated it.
  // Removing both guarantees pg-connection-string cannot replace the explicit
  // TLS object or reinterpret a Prisma-only pooler hint.
  parsed.searchParams.delete("sslmode")
  parsed.searchParams.delete("pgbouncer")
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: true, ca },
  }
}
