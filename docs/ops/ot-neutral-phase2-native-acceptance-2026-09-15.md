# OT neutral repository native acceptance — 2026-09-15

Local-only evidence. No Production database, Stripe, Blob, deployment, or customer action occurred.

- PostgreSQL: disposable local PostgreSQL 18.x.
- Migration command: `prisma migrate deploy`; all 32 repository migrations applied.
- Identities: privileged migration owner, separate global application login, and separate neutral login granted membership in the non-login `ot_neutral_runtime` role. The preflight opened all three URLs and compared `current_user`, database/server identity, and privilege profiles.
- Runtime preflight: verified non-superuser/non-bypass ownership, RLS, column-scoped authority reads, ledger CRUD, and denied deletes.
- Native test: the application login inserted authoritative order rows; the neutral login performed concurrent reservation/idempotency/capacity work; the owner performed setup/cleanup. Restricted-runtime delete denial was verified.
- Fresh three-role preflight command used `DIRECT_URL`, `DATABASE_URL`, and `OT_NEUTRAL_DATABASE_URL` simultaneously. All 32 migrations and the native Jest run passed with `--detectOpenHandles`.
- Neutral migration SHA-256: `813e404da095a5e1e75a052dc2067925e7f41ac931e4e1f7f5834b79d734c8f6`.
- Migration identity and connection values are intentionally omitted.

The migration SQL hash must be recomputed for any release packet after the candidate is committed. This file is not Production acceptance.
