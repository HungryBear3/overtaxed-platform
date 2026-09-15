# OT neutral report release approval packet — 2026-09-15

## Current candidate

- Product: **Cook County Assessment Records & Matching Property Report**
- Price: **$69 USD**
- Canonical merge chain: the exact 122-PR main-rooted chain in `docs/ops/ot-neutral-canonical-equivalence-2026-09-15.md`.
- Current implementation tip: PR #210, `32a70273bec8675feb6d2aa01e036f62147a9f09`.
- The evidence-only documentation update is the next stacked PR and is bound
  to its exact head by the GitHub PR record after commit.
- Approved aggregate reference: PR #47, `2203e06d995a29d928ee9efae81771efb00fcbcf`; preserved as a noncanonical reference/fallback.
- Exact excluded PRs: `docs/ops/ot-neutral-noncanonical-pr-disposition-2026-09-15.md`.
- Strict automated qualification remains separate, unsigned, and inactive.

## Implemented controls

1. Exact-byte official county/calendar evidence and neutral PDF/CSV generation.
2. Current-year, single-PIN, single-card, class-2, open-window pre-payment gate.
3. Order/PIN/payment/policy/evidence binding and ten-paid-order pilot cohort.
4. Separate restricted database identities for migration, app read-side, neutral repository, and neutral delivery.
5. Durable checkout, Blob, QA, ZIP, delivery, capability, and refund ledgers.
6. QA-only review with a 20-minute hard stop and 25 opened reviews per reviewer/week.
7. Deterministic private customer ZIP with only `report.pdf` and `report.csv`.
8. POST-only one-use capability with reversal/dispute/supersession checks.
9. Operator-gated refund verification requiring the exact successful $69 USD provider receipt; no automatic refund creation.
10. Neutral customer copy with no eligibility, savings, or outcome promise.
11. All neutral runtime feature switches default-off and guarded in Preview.

## Review remediation now bound to the candidate

- Dependent PRs receive real pull-request CI rather than manual-only workflow runs.
- Oversized PR #89 is removed from canonical ancestry and replaced by compile-safe PRs #87-#88.
- The hardened migration continues to revoke direct neutral-runtime access to `ot_order`, `ot_payment_binding`, and `ot_settlement_reversal`.
- The mandatory post-migration preflight now proves SELECT on only the three constrained neutral views, actively proves direct shared-table reads fail, and never restores a shared-table grant.
- The complete canonical and excluded-PR sets are durably bound by exact PR/base/head/SHA manifests.
- Zero-diff PR #200 is explicitly excluded.

## Verification

- Focused post-migration/entrypoint suites: 47/47 passed.
- Fresh disposable PostgreSQL 18 proof: all 35 migrations applied; the
  hardened four-role post-migration preflight passed; Phase 3 native acceptance
  passed while direct shared-commerce SELECTs were denied.
- TypeScript: passed.
- The pre-remediation canonical implementation passed 204 suites / 4,114 tests and a production build.
- Exact-head attached CI and Vercel must return terminal green on the rewritten ancestry and PR #210 before independent review can pass.
- Features remain disabled. No Preview database has been migrated.

## Current hard gate

The code/document candidate is not authorized for merge or Production. Preview database work requires all of the following before any migration command:

1. A separately provisioned, provably isolated Preview PostgreSQL database.
2. The durable non-Production Preview database marker.
3. Four distinct protected credentials: migration owner, app reader, neutral repository, neutral delivery.
4. All neutral feature flags disabled.
5. Use only `npm run neutral-report:preview-migrate`, followed by `npm run neutral-report:migration-preflight`.
6. Stop on any failed proof.

## Not authorized

No merge, PR cleanup, Production deployment/migration, feature activation, live charge, real order, customer contact, email, refund, marketing, or protected-secret disclosure is authorized by this packet.
