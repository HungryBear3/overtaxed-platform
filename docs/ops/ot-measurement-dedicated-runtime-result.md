# Dedicated measurement runtime correction — 2026-11-04

Base: `f3672f53`. Local-only; no hosted configuration/database writes, push or deployment.

## Implemented

- Free-check measurement uses only `OT_FREE_CHECK_MEASUREMENT_DATABASE_URL` through a dedicated pg connection. Shared Prisma/`DATABASE_URL`, paid contracts, and existing SQL binding remain unchanged. No automatic retries or privileged fallback.
- Actual current/session user must be `ot_prod_app`, with safe role flags, exact pre-existing neutral-reader membership (inherit true, set/admin false), and no object ownership. This is measurement qualification, not a whole-app runtime cutover.
- Supabase pooler transport login may be `ot_prod_app.<projectRef>` only on canonical `*.pooler.supabase.com`, with exact 20-character lowercase/digit project pinned by `OT_FREE_CHECK_MEASUREMENT_SUPABASE_PROJECT_REF`; SQL identity remains exactly `ot_prod_app`.
- Remote TLS requires `OT_FREE_CHECK_MEASUREMENT_CA_PEM` (optional existing `SUPABASE_CA_PEM` fallback) and certificate verification; insecure URL TLS options cannot disable it. Local disposable tests use isolated loopback clusters. Connection 500ms, statement 500ms, query 600ms limits. The existing write deadline remains 750ms.
- Missing/bad configuration, unreachable connection or unsafe identity returns measurement `unavailable`; free-check outcome remains available. Export also uses only dedicated runtime.
- `npx tsx scripts/ot-free-check-measurement-preflight.ts` is read-only and proves actual identity plus ledger SELECT only, not hosted INSERT or whole-app compatibility.

## Verification

- Six focused Jest suites: 91 tests passed, including real disposable PostgreSQL migration/binding qualification and route tests.
- Real runtime writer and aggregate exporter execute as restricted login. INSERT/SELECT work; UPDATE/DELETE/TRUNCATE, ALTER TABLE, CREATE TABLE and ALTER ROLE BYPASSRLS fail. Column grants remain exact; API roles remain denied. Actual BYPASSRLS and extra role membership are rejected before operations. Data-preserving rollback passes.
- Missing URL, wrong username, unreachable dedicated endpoint and remote TLS CA absence fail closed; shared Prisma import is a hard-failing mock in these cases.
- Full `npm run type-check` passes; `git diff --check` passes.

## Remaining hosted prerequisites

Provision/locate protected existing `ot_prod_app` credential for the dedicated URL; common ledger migration and exact binding must exist before activation. Require hosted identity/read-only preflight, exact SQL postconditions, bounded hosted write qualification and release verification. No shared datasource change is qualified or needed. Local tests do not establish hosted identity/permissions.

Claude Code CLI was attempted first but returned its five-hour quota limit; implementation and verification continued directly without waiting.

## Successor: driver URL override correction

Independent review identified pg connection-string query parameters overriding explicit TLS, identity and timeout settings. Runtime now passes only decoded user/password/hostname/port/database fields, never `connectionString`; all URL query parameters are ignored. Regression tests inspect the actual pg driver's parsed connection parameters for `?ssl=0`, `?user=postgres&host=attacker.example`, and `?statement_timeout=0&query_timeout=0`. All preserve pinned TLS, validated authority and bounded timeouts. Focused runtime plus real PostgreSQL binding suites: 10 tests pass; full typecheck and diff check pass. Production remains untouched.
