#!/usr/bin/env node
/**
 * enforce-rls.mjs
 * After every migration, ensure ALL public tables have RLS enabled.
 * Tables that should be skipped (read-only public data, no PII) can be listed in SKIP.
 * Runs as part of the build pipeline via build-with-migrate-retry.mjs.
 */
import pg from "pg"

const SKIP = new Set([
  // Add table names here only if they are truly public read-only with no PII
])

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error("[enforce-rls] ERROR: No DATABASE_URL or DIRECT_URL set")
  process.exit(1)
}

const client = new pg.Client({ connectionString })

try {
  await client.connect()

  const { rows } = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = false
  `)

  const toFix = rows.map((r) => r.tablename).filter((t) => !SKIP.has(t))

  if (toFix.length === 0) {
    console.log("[enforce-rls] All public tables already have RLS enabled ✅")
  } else {
    console.log(`[enforce-rls] Enabling RLS on ${toFix.length} table(s): ${toFix.join(", ")}`)
    for (const table of toFix) {
      await client.query(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`)
      console.log(`[enforce-rls]   ✅ ${table}`)
    }
    console.log("[enforce-rls] Done — all tables secured.")
  }
} finally {
  await client.end()
}
