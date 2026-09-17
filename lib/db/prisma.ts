// Prisma Client with pg adapter (required for Prisma 7+)
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  isLoopbackDatasourceUrl,
  isPgBouncerDatasourceUrl,
  isSupabasePoolerUrl,
  resolveApplicationDatasourceUrl,
} from './prisma-migration-identity'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// The application datasource URL is decided in one place, shared with
// prisma.config.ts, rather than re-derived here.
//
// The rule it applies is the same one this file used to open with — a Supabase
// pooler needs `pgbouncer=true` or Prisma hits "prepared statement already
// exists" — with two differences that only ever narrow what is rewritten:
//
//   * pooler detection is HOSTNAME-based. The old `url.includes("pooler.supabase.com")`
//     also matched a URL that merely mentioned the string, so anyone who could
//     put text into a query parameter could get a `pgbouncer=true` appended to
//     a connection aimed somewhere else entirely.
//   * an absent DATABASE_URL resolves to the shared generate-only placeholder
//     instead of `undefined`. Previously `new Pool({ connectionString: undefined })`
//     silently fell back to libpq's PG* environment defaults, which on a build
//     host is a connection nobody configured; the placeholder points at
//     `localhost` with credentials nothing accepts, so module load succeeds and
//     the first query fails as a connection error rather than landing somewhere
//     unintended.
//
// `new Pool(...)` below opens no socket. The pool is lazy: the first connection
// attempt happens on the first query, which is what lets `prisma generate` and
// a bundler's module evaluation succeed on a host with no database at all.
const connectionString = resolveApplicationDatasourceUrl(process.env)

// SAME RULE, ONE IMPLEMENTATION.
//
// The comment above has said "pooler detection is HOSTNAME-based" since the
// rewrite rule moved into prisma-migration-identity, but the two gates BELOW
// went on re-deriving the same fact with `connectionString.includes(...)` —
// substring matching on the whole URL, which is exactly the predicate that
// comment describes as the defect. That mattered: both gates decide TLS. A URL
// carrying the text `pooler.supabase.com` or `pgbouncer=true` anywhere in it —
// a password, a database name, an option value — made `isUsingPooler` true on a
// host that is not a pooler, which suppressed CA-pinned verification and, with
// DATABASE_INSECURE_TLS=1, set NODE_TLS_REJECT_UNAUTHORIZED=0 process-wide.
//
// So the hostname helper is imported and used for every one of them, and
// `pgbouncer=true` is read as a parsed query PARAMETER rather than as a
// substring. The two facts are computed once, here, and both gates read them.
const isUsingPooler =
  isSupabasePoolerUrl(connectionString) ||
  isPgBouncerDatasourceUrl(connectionString)
// Hostname-based too: `localhost` and `127.0.0.1` in a password or a database
// name said nothing about where the connection lands.
const useLocalhost = isLoopbackDatasourceUrl(connectionString)
// Supabase (and other hosted Postgres) expect TLS; local Postgres usually does not.
// Allow an override via DATABASE_SSL=false to force-disable SSL.
const useSSL = process.env.DATABASE_SSL !== 'false' && !useLocalhost

// Apply TLS relaxation at module load time (before Prisma initialization)
// Required for Supabase connection pooler: Prisma's engine enforces TLS verification
// at a lower level than pg.Pool SSL config, so we need to relax global TLS check for pooler connections.
// This is opt-in via DATABASE_INSECURE_TLS=1 to keep it explicit and secure by default.
// Note: This will generate a Node.js warning, which is expected and harmless in this controlled scenario.
if (process.env.DATABASE_INSECURE_TLS === '1') {
  if (useSSL && isUsingPooler && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }
}

// Use pg driver adapter (required with Prisma 7)
function createPrismaClient() {
  // Prefer secure CA certificate approach if available
  const caCert = process.env.SUPABASE_CA_PEM
  const hasCaCert = !!caCert

  // `useSSL`, `useLocalhost` and `isUsingPooler` are the module-level facts
  // computed once from the parsed URL. The pooler uses a different certificate
  // than the direct connection, which is why it changes the CA decision.

  // Configure SSL: prefer CA certificate (secure), but fallback for pooler or when insecure flag set
  let sslConfig: false | { rejectUnauthorized: boolean; ca?: string } = false
  if (useSSL) {
    // Use CA cert only if we have it AND not using pooler (pooler uses different cert)
    // OR if insecure flag is not set (meaning we want strict verification)
    const useCaCert = hasCaCert && !isUsingPooler && process.env.DATABASE_INSECURE_TLS !== '1'
    
    if (useCaCert) {
      sslConfig = {
        rejectUnauthorized: true,
        ca: caCert,
      }
    } else {
      sslConfig = {
        rejectUnauthorized: false,
      }
    }
  }

  // Serverless (Vercel): use 1 connection per instance to avoid "MaxClientsInSessionMode" from pooler
  const isServerless = typeof process.env.VERCEL === "string" || process.env.AWS_LAMBDA_FUNCTION_NAME != null
  const poolSize = isServerless ? 1 : 5

  const pool = new Pool({
    connectionString,
    max: poolSize,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslConfig,
  })

  const adapter = new PrismaPg(pool)

  return new PrismaClient({
    adapter,
  })
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
