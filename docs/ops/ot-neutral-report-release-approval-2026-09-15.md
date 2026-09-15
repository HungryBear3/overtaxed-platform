# OT neutral report release approval packet — 2026-09-15

## 2026-09-15 remediation status

- Owner approval: replace oversized PR #47 with the documented reviewable
  stack; keep Production, activation, live payments/refunds, customers,
  marketing, and credentials untouched.
- Replacement topology: PRs #54–#65 → #48–#51 → #66 → #67 → #52 → #53.
  Exact heads, sizes, and attached CI run IDs are recorded in the split plan.
- Current terminal tree before this documentation-only refresh:
  `ceeb93a5fad6d04c7f81a29a3b4cf4196092273b`.
- Tree proof: terminal tree
  `a3f9257fc113db825aaab42abbef3194d0fb281c` equals approved `2203e06` plus
  only the credential-free CI trigger and constrained-view post-migration
  proof remediation (`b87bcd4` tree); no other content diff exists.
- Post-migration proof now reads only
  `ot_neutral_runtime_order`, `ot_neutral_runtime_payment_binding`, and
  `ot_neutral_runtime_settlement_reversal`; it explicitly requires direct
  reads of `ot_order`, `ot_payment_binding`, and `ot_settlement_reversal` to
  fail.
- All current PR Preview deployments report Ready after their latest build;
  final exact-head CI/Preview evidence remains attached to each PR and must be
  re-read after this documentation-only commit.
- Remaining hard gate: no migration or DB-backed Preview smoke until one
  provably isolated Preview database, its durable marker, and all four
  restricted credentials exist.
- PR #47 remains open and untouched. Merge and supersession remain blocked on
  fresh independent Verification, Anti-pattern, and Code Quality reviews.

## Candidate

- Branch: `codex/ot-neutral-report-20260915`
- PR: `#47`
- Actual PR base: `e80ebf9edc5b6f8a848710652badfe83ec4297ab`
- Terminal-review input head: `ab94a2343384ac679ccf010c92017a69a958b85e`
- Preview migration entrypoint remediation head: `ee3320272996f3fce93a52b33e54f85d6dd6d1e5`
- Complete disabled-feature guard implementation head: `b2f221b27590e3fd4758e06fdad5d24aa5dd25e8`
- Commerce-read/refund-retry remediation candidate: `9f0c697b94e4774f6f0cd32c0363fada22eede52`
- Product: **Cook County Assessment Records & Matching Property Report**
- Price: **$69 USD**
- Strict automated qualification remains separate, unsigned, and inactive.

## Implemented

1. Exact-byte official county and calendar evidence gateway.
2. Neutral PDF/CSV generation with non-directional matching and ambiguity disclosure.
3. Current-year, single-PIN, single-card, class-2, open-window pre-payment gate.
4. Order/PIN/payment/policy/evidence binding and a ten-paid-order pilot cohort.
5. Separate restricted database identities for neutral repository and neutral delivery.
6. Durable checkout-attempt, Blob-attempt, QA, customer-ZIP, delivery, capability, and refund-work ledgers.
7. QA-only review: 12-minute target, 20-minute hard stop, 25 opened reviews per reviewer/week.
8. Deterministic private customer ZIP containing only `report.pdf` and `report.csv`.
9. POST-only, one-use customer capability with reversal/dispute/supersession checks.
10. Objective report-unavailable refund workflow; refund creation is never automatic and confirmation requires a read-only verified Stripe refund receipt.
11. Neutral customer copy across homepage, pricing, checkout, Terms, success, and email; legacy copy remains behind the disabled path.
12. Provider-authoritative reconciliation for expired unpaid Stripe checkout sessions.

## Verification

- Full Jest after complete disabled-feature guard remediation: 4,113 passed, 80 skipped; 204 suites passed and 7 native suites skipped because no test database URLs were supplied.
- Fulfillment suite after Phase 3: 1,910 passed; native suites excluded without test URLs.
- Focused final delivery/security: 314 passed; terminal security closure 183 passed.
- TypeScript: passed (`tsc --noEmit`).
- Production build: passed, 144 static pages generated.
- Fresh PostgreSQL 18: all 35 migrations applied from zero.
- Four identities proved: migration, normal app, neutral repository, neutral delivery.
- Disposable-local post-migration grant/RLS preflight: passed before PR creation. The separate Preview **PRE-MIGRATION identity/marker preflight** and the post-migration grant/RLS preflight have **not** run against Preview because the four separate Preview credentials and durable Preview database marker have not been provisioned.
- Native Phase 2 and Phase 3 journeys: 2/2 passed with `--detectOpenHandles`.
- The neutral repository role cannot select `ot_order`, `ot_payment_binding`, or `ot_settlement_reversal`; native proof shows legacy rows absent from its constrained projection. A transient synthetic provider lookup leaves the recorded receipt pending with audited retry evidence, and a later successful lookup converges to `REFUND_CONFIRMED` without creating a refund.
- Synthetic owner journey: paid binding → QA → ZIP promotion → capability → POST download; exact ZIP hash/members and one-use exhaustion passed.
- Playwright production server: 12/12 passed across desktop Chrome and iPhone viewport; no horizontal overflow or application errors.
- Representative three-page PDF rendered and visually inspected.

### Independent-review remediation

- Marketing pricing guard now renders the runtime pricing component and checks visible text for `$69` and the absence of `$97`; source comments cannot satisfy or fail the assertion.
- Migration preflight now connects through all four required credentials: `DIRECT_URL`, `DATABASE_URL`, `OT_NEUTRAL_DATABASE_URL`, and `OT_NEUTRAL_DELIVERY_DATABASE_URL`.
- All four connections must resolve to one database name and one durable database-comment marker with schema `ot.database-environment.v1`, purpose `ot-neutral-report`, environment `preview`, `isolated: true`, `production: false`, and a UUID instance id. Hostnames are intentionally ignored so direct and pooler endpoints can identify the same database safely.
- Hostile tests prove fail-closed behavior for missing/malformed markers, Production and contradictory markers, non-isolated databases, wrong purpose, invalid instance ids, and mismatched database names or instance ids.
- A separate `neutral-report:pre-migration-identity-preflight` now runs **before any `prisma migrate` command**. It uses only PostgreSQL catalog/identity queries, so it does not require neutral tables, group roles, or migrations to exist. All four URLs must connect as the exact roles declared in their credentials; `current_user` and `session_user` must both match that declared role; all four roles must be distinct; all four must resolve to the same explicitly isolated non-Production Preview marker; the migration role must have schema and role-migration authority; and the app, neutral repository, and neutral delivery roles must be non-superuser, non-BYPASSRLS, non-CREATEROLE, and unable to create in `public`.
- The single authorized migration entrypoint for this release is `npm run neutral-report:preview-migrate`. It fails closed unless `VERCEL_ENV=preview` and every neutral feature flag is disabled, runs the PRE-MIGRATION identity proof first, and invokes the exact `npx prisma migrate deploy` command only after that proof exits successfully. It uses argument-vector child processes without a shell and never prints credentials. Tests prove invocation order and prove migration is never invoked after a failed preflight or outside the disabled Preview boundary.
- Operators must not run raw `prisma migrate`, `prisma migrate deploy`, `npx prisma migrate deploy`, `db push`, or any other migration command for this release. The composed entrypoint is mandatory; bypassing it invalidates the Preview evidence.
- The existing `neutral-report:migration-preflight` remains a separate **post-migration** check. It proves installed neutral tables, exact group-role membership, grants, ownership, RLS, and denied mutations after migrations and restricted memberships have been applied.
- PRE-MIGRATION hostile tests reject duplicate or aliased identities, `SET ROLE`/session-role indirection, elevated app/runtime/delivery privileges, insufficient migration authority, database/marker divergence, Production markers, malformed/role-less credentials, and non-PostgreSQL URLs. Focused evidence: `npx jest __tests__/fulfillment/neutral-preview-database-marker.test.ts __tests__/fulfillment/neutral-preview-pre-migration.test.ts --runInBand` → 28/28 passed; `npm run type-check` → passed.
- The disabled-feature guard exports the complete runtime activation registry and checks each flag against its actual active value. It now includes `OT_NEUTRAL_REPORT_ACTIVE=1` as well as the nine `…ENABLED` switches. A source-discovery assertion scans `app/` and `lib/` for every neutral `…ENABLED` or `…ACTIVE` runtime switch and fails if the guard registry omits one.
- Composed-entrypoint focused evidence: the entrypoint, identity, and marker suites pass 47/47; full Jest passes 4,113 with only 80 credential-gated native checks skipped; type-check and the 144-page production build pass.

## Migration hashes

- Repository: `813e404da095a5e1e75a052dc2067925e7f41ac931e4e1f7f5834b79d734c8f6`
- QA/delivery: `0fa316caf8b70620fbc411180f87b40105b821287b14da62361bb05b7bdb4194`
- Delivery runtime: `c2916caffc314a3a5f887e3086fc4ce16e79190a6e72803d4492748a700e43d3`
- Neutral commerce projection/refund retry audit: `84e4ad3e148d1b4146106ca59b0a0192e4af3e71a18ba3e01dcefd371789bfe4`

## Production remains inactive

PR #47 exists. The exact implementation candidate is `9f0c697b94e4774f6f0cd32c0363fada22eede52`; its automatic features-disabled Preview is tracked at Vercel dashboard deployment `8aMNG3bJWXn64AYXCmqNpqPAqVnN`. No database was provisioned, marked, migrated, or granted; no environment was changed; and no Production migration/deployment, feature activation, live checkout mutation, real order, Stripe call, email, Blob write, delivery, or refund was performed.

GitHub deployment record `6461605045` is inert metadata only. Its `environment` label is `production`, but GitHub reports `production_environment: false`, it has no deployment statuses, and no provider performed or recorded a deployment from it. The record was not deleted or altered and is not evidence of a Production provider action.

All neutral flags remain fail-closed. Required protected configuration includes four distinct credential URLs that resolve to the same separately provisioned isolated Preview database. Before migrations, its database object must be explicitly marked with the durable JSON database comment described above. Credentials must use the supported protected-secret flow and are not placed in chat or logs.

## Current gate

Code review remediation, focused tests, the full Jest suite, type-check, and production build are green. The database phase is intentionally **blocked** until separate Preview-only credentials exist for the migration owner, normal app, neutral repository, and neutral delivery identities. Do not reuse Production credentials or a Production database. Once those protected Preview credentials exist, use only the composed Preview migration entrypoint. On a fresh isolated Preview database, `prisma migrate deploy` correctly applies **all pending repository migrations**, not only the three neutral migrations. The three neutral migration files are separately pinned and hash-verified below to prove the reviewed neutral SQL bytes. After all pending migrations and restricted memberships have been applied, run the existing post-migration grant/RLS preflight before any synthetic database smoke.

## Requested approval — next gate only

Approve:

1. Push the reviewed remediation to PR #47 and run CI/independent review on its exact head.
2. Keep the automatic Preview features disabled.
3. Separately provision and protect the four Preview-only database credentials and durable database marker.
4. Run only `npm run neutral-report:preview-migrate` with all four protected Preview URLs. This mandatory composed entrypoint proves identities/marker first and, only on success, executes the exact safe `npx prisma migrate deploy`. It must stop on any failure. Do not invoke Prisma migration commands directly.
5. Confirm that `migrate deploy` applied every pending repository migration to the fresh isolated Preview database. Separately verify the three neutral migration file hashes against this packet; do not interpret those three hashes as a request to selectively apply only three migrations.
6. Grant the Preview app, neutral repository, and neutral delivery logins their exact restricted role memberships.
7. Run `npm run neutral-report:migration-preflight` as the post-migration grant/RLS proof. Stop on any failure.
8. Only after both preflights pass in order, run synthetic checkout/QA/download smokes, desktop/mobile browser checks, and deployment file tracing.

This approval does **not** authorize Production migration/deployment, feature activation, live charges, customer contact, email delivery, refunds, marketing, or real orders. Those remain a separate gate after Preview evidence.

## PR-size blocker

Against current `origin/main`, PR #47 is 215+ files and 36k+ added lines because the neutral work descends from a large unmerged T2 delivery stack. Even the neutral-only range is 112 files and 5,722 added lines before the final remediation. A blind rebase/cherry-pick would omit required payment, artifact, capability, and delivery dependencies. The safe six-PR stacked decomposition and explicit alternative exception request are recorded in `docs/ops/ot-neutral-report-pr-split-plan-2026-09-15.md`. Merge remains blocked pending that owner decision.
