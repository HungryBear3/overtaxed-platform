# OT neutral Preview synthetic acceptance runner — 2026-09-16

This runner is Preview-only and default-off. It does not contact Stripe, Blob,
email, providers, customers, deployments, or Production. It must receive all
four database URLs through the protected process environment; URLs and
credentials must never be placed in arguments, files, chat, or logs.

## Required protected inputs

- `DIRECT_URL`
- `DATABASE_URL`
- `OT_NEUTRAL_DATABASE_URL`
- `OT_NEUTRAL_DELIVERY_DATABASE_URL`
- `OT_NEUTRAL_PREVIEW_PROJECT_REF=iyaxdrehtxsfkaexgxls`
- `OT_NEUTRAL_PREVIEW_MARKER_INSTANCE_ID` set to the separately approved
  durable database-marker instance ID

Run `npm run neutral-report:preview-acceptance` only after protected injection.
The runner validates that every URL encodes the exact Preview project, proves
all four connections resolve to the same database and durable isolated-Preview
marker, rejects elevated restricted roles, and only then starts acceptance.
The membership graph must contain exactly the three functional grants, plus at
most the exact subset of the six migration-documented Supabase-managed grants
for the three logins and three functional roles that the platform installed.
Each restricted login and reachable functional
role must own no database, non-system schema, table, partitioned table, view,
materialized view, sequence, foreign table, index, type, function, procedure,
collation, conversion, operator/operator class/family, or text-search
configuration/dictionary. Database `CREATE` and non-system schema `CREATE` are
forbidden. Effective relation and sequence ACLs (including inherited and
PUBLIC-derived authority) must exactly match the migration-derived,
schema-qualified allowlist, including table-wide versus exact sorted column
sets; missing grants also fail. Ordinary sensitive routines are selected by an
`ot_` routine prefix or `ot*`/`private*` schema. Every effectively executable
SECURITY DEFINER routine is inventoried regardless of schema or name, and
fails. The built-in `pg_catalog`, `information_schema`, `pg_toast*`,
and `pg_temp*` baselines are excluded from this application-object inventory.
PostgreSQL's default PUBLIC-derived database `TEMP` baseline is allowed, but a
role-specific `TEMP` ACL is rejected and neither form is treated as database
`CREATE` authority.

Each run receives an internal UUID-v4 namespace. URL parsing uses the same
libpq connection parser as the PostgreSQL client, rejects routing query
overrides, duplicate/conflicting parameters, and unknown options; requires the
single exact `sslmode=verify-full` mode; and pins
host, database, port, and the four ordered login roles.
The DB-backed transaction runs through the direct owner connection and
exercises checkout/payment binding, QA and ZIP promotion, fulfillment and
delivery capability issuance, a one-use download, and reversal/refund
convergence using synthetic values. Separately, read-only probes through the
three restricted connections verify their role identity, membership, privilege,
ownership, and forced-RLS invariants. The owner-transaction journey is not a
claim that the full behavior path ran under each restricted login. No external
write adapter is present.

Every synthetic write uses one owned PostgreSQL connection and one transaction.
Injected production helpers receive an executor for that already-open
transaction. The runner wraps each helper call in an executor transaction,
which maps to a PostgreSQL savepoint, so a refused statement cannot poison the
remaining journey. Injected callers outside this runner have the same contract:
they own the outer transaction and must establish savepoints when they need
per-call failure isolation.
The runner always issues `ROLLBACK` in `finally`; it never attempts to delete
the immutable payment-binding or settlement-reversal evidence. A new connection
then proves zero matching rows across every touched table. This absence proof
is attempted even if `BEGIN`, the journey, or `ROLLBACK` fails. All failures are
aggregated and credential-redacted; any rollback or absence-proof failure makes
the command fail. The command performs no DDL, GRANT, role,
membership, feature-flag, migration, ledger, or deployment mutation.

Passing this command is Preview evidence only. It does not authorize a merge,
push, Production migration, activation, real order, payment/refund, customer
contact, provider action, or deployment.

## Separate evidence stages (not executed by this runner)

The database runner does not claim browser, mobile, deployment, or exact-head
evidence. Those remain separate stages and must bind their output to the exact
reviewed Git SHA:

1. Desktop route smoke: start the exact-head build locally, then run
   `npx playwright test tests/visual/neutral-report-local-e2e.spec.ts --project=chromium`.
2. Mobile smoke: HOLD until a mobile Playwright project is added to the repo;
   the current configuration defines Desktop Chrome only.
3. Deployment file trace: HOLD until an approved Preview deployment exists;
   record its immutable deployment identifier and prove the changed files are
   present at that exact SHA. This runner never deploys or inspects Production.
