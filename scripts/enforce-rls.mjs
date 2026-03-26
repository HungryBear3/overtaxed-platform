#!/usr/bin/env node
/**
 * enforce-rls.mjs
 * After every migration:
 *   1. Enable RLS on any public table missing it
 *   2. Revoke all anon/authenticated grants from sensitive tables
 *      (app uses Prisma direct DB connection — PostgREST anon key is never used)
 *
 * Tables in PUBLIC_READ_ONLY are left with anon SELECT (no PII, no writes).
 */
import pg from "pg"

// Tables intentionally readable by anon (no PII)
const PUBLIC_READ_ONLY = new Set(["visitor_count"])

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error("[enforce-rls] ERROR: No DATABASE_URL or DIRECT_URL set")
  process.exit(1)
}

const client = new pg.Client({ connectionString })

try {
  await client.connect()

  // 1. Enable RLS on any table missing it
  const { rows: noRls } = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = false
  `)
  if (noRls.length === 0) {
    console.log("[enforce-rls] RLS: all tables already enabled ✅")
  } else {
    console.log(`[enforce-rls] RLS: enabling on ${noRls.length} table(s): ${noRls.map(r => r.tablename).join(", ")}`)
    for (const { tablename } of noRls) {
      await client.query(`ALTER TABLE public."${tablename}" ENABLE ROW LEVEL SECURITY`)
      console.log(`[enforce-rls]   ✅ RLS enabled: ${tablename}`)
    }
  }

  // 2. Revoke anon/authenticated grants from all non-public tables
  const { rows: allTables } = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `)

  const sensititiveTables = allTables.map(r => r.tablename).filter(t => !PUBLIC_READ_ONLY.has(t))

  const { rows: existingGrants } = await client.query(`
    SELECT DISTINCT table_name FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND table_name != ALL($1)
  `, [Array.from(PUBLIC_READ_ONLY)])

  if (existingGrants.length === 0) {
    console.log("[enforce-rls] Grants: no anon/authenticated grants to revoke ✅")
  } else {
    console.log(`[enforce-rls] Grants: revoking anon/authenticated from ${existingGrants.length} table(s)`)
    for (const { table_name } of existingGrants) {
      await client.query(`REVOKE ALL ON public."${table_name}" FROM anon, authenticated`)
      console.log(`[enforce-rls]   ✅ Revoked: ${table_name}`)
    }
  }

  console.log("[enforce-rls] Done — database access hardened.")
} finally {
  await client.end()
}
