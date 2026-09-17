# OT neutral report PR split plan — 2026-09-15

## Finding

PR #47 is 215 files, 36,137 additions, and 545 deletions against `origin/main` before the final access remediation. This is not generated-file noise. Its branch descends from an unmerged September 3–13 T2 delivery stack. The neutral-report commits depend on that stack's schemas, payment binding, fulfillment/artifact tables, capability machinery, and packet download route.

The neutral-only range beginning with owner approval `a4a6dd2^` is still 112 files, 5,722 additions, and 423 deletions before the final access remediation. It cannot meet the normal 30-file/800-line review envelope as one independently deployable change without removing required end-to-end functionality.

Rebasing/cherry-picking only the neutral commits onto current `origin/main` is unsafe: it would either fail to apply or silently omit reviewed payment/artifact/delivery dependencies. No history rewrite was performed.

## Coherent dependent split

Use stacked PRs, each based on the preceding exact reviewed head:

1. **Foundation / shared paid authority** — payment binding and reversal containment, fulfillment/artifact schema, capability/download safety, private-surface telemetry isolation, and restricted runtime identities.
2. **Neutral evidence artifact** — official-source gateway, neutral content/PDF/CSV generation, ambiguity disclosures, and deterministic evidence tests.
3. **Neutral commerce admission** — deadline authority, `$69` contract, reservation/checkout-attempt repository, capacity constraints, and reconciliation.
4. **Neutral QA/refund** — QA ledger, 12/20-minute rules, 25/week cap, refund-required queue, receipt verification, transient-provider retry audit, and constrained commerce projections.
5. **Neutral delivery/customer surfaces** — deterministic customer ZIP, promotion, restricted delivery projection, one-use capability, checkout/success/email/terms copy, browser and native owner-journey tests.
6. **Preview release controls** — four-identity database marker/preflight, composed migration entrypoint, complete disabled-feature registry, and release evidence.

Each stack member needs its own exact-SHA independent review, focused/native tests, and green CI. Database migrations remain cumulative and may only be rehearsed on a provably isolated Preview database through the composed entrypoint.

## Required decision

PR #47 must not be merged at its current size without either approval to replace it with the six stacked PRs above (recommended), or an explicit owner exception accepting the large review surface and naming the compensating review standard. This record requests neither merge nor exception; it records the blocker and safe split.
