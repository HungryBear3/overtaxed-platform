// Prisma Client with pg adapter (required for Prisma 7+)
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Append connect_timeout for serverless to reduce ETIMEDOUT on cold starts (pg/libpq respects this)
function withConnectTimeout(url: string | undefined, seconds: number): string | undefined {
  if (!url || url.includes("placeholder")) return url
  if (url.includes("connect_timeout=")) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}connect_timeout=${seconds}`
}
const connectionString = withConnectTimeout(process.env.DATABASE_URL, 60)

// Apply TLS relaxation at module load time (before Prisma initialization)
// Required for Supabase connection pooler: Prisma's engine enforces TLS verification
// at a lower level than pg.Pool SSL config, so we need to relax global TLS check for pooler connections.
// This is opt-in via DATABASE_INSECURE_TLS=1 to keep it explicit and secure by default.
// Note: This will generate a Node.js warning, which is expected and harmless in this controlled scenario.
if (connectionString && process.env.DATABASE_INSECURE_TLS === '1') {
  const useLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
  const useSSL = process.env.DATABASE_SSL !== 'false' && !useLocalhost
  const isUsingPooler = connectionString.includes('pooler.supabase.com') || connectionString.includes('pgbouncer=true')
  
  if (useSSL && isUsingPooler && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }
}

// Use pg driver adapter (required with Prisma 7)
function createPrismaClient() {
  const useLocalhost =
    connectionString?.includes('localhost') ||
    connectionString?.includes('127.0.0.1')

  // Supabase (and other hosted Postgres) expect TLS; local Postgres usually does not.
  // Allow an override via DATABASE_SSL=false to force-disable SSL.
  const useSSL = process.env.DATABASE_SSL !== 'false' && !useLocalhost

  // Prefer secure CA certificate approach if available
  const caCert = process.env.SUPABASE_CA_PEM
  const hasCaCert = !!caCert
  
  // Detect if using connection pooler (pooler uses different certificate than direct connection)
  const isUsingPooler = connectionString?.includes('pooler.supabase.com') || connectionString?.includes('pgbouncer=true')

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
  // Serverless cold starts need longer timeout; "timeout exceeded when trying to connect" on sign-in
  const connectionTimeoutMillis = isServerless ? 60_000 : 10_000

  const pool = new Pool({
    connectionString,
    max: poolSize,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis,
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
