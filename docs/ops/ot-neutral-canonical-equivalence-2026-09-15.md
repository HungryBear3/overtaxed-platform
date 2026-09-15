# OT neutral-report canonical equivalence

Date: 2026-09-15 CDT

## Scope

The corrected canonical stack continues from PR #177 (`5fb04d7`) through PRs
#180-#209. The source units after historical `fb1ad00` were replayed in their
original order, with the three oversized units split into compile-safe review
layers. PR #47 remains open and untouched.

## Exact equivalence

Before this manifest was added, canonical head `db0b815` differed from approved
neutral candidate `2203e06` in exactly one file:

```text
M  .github/workflows/ci.yml   +4 -3
```

That delta is intentional canonical remediation: pull-request CI runs for every
stack layer instead of only PRs targeting `main`. Every other tracked path was
byte-identical to `2203e06`. The approved candidate already contains the four
current-main/PR #46 paths, so no unrelated mainline file is reverted.

## Review structure

- PRs #180-#187 replay recovery, diagnostics, eligibility target, deadline
  authority, capture authority, owner privilege, and owner-decision units.
- PRs #188-#189 split the neutral evidence pipeline into runtime and tests.
- PRs #190-#192 split checkout persistence into schema, runtime, and tests.
- PRs #193-#197 split QA/delivery into schema, domain runtime, integration,
  customer copy, and tests.
- PRs #198-#209 replay owner-journey proof and Preview/release hardening.

Every layer changes at most 30 files and at most 800 non-mechanical lines. The
schema/migration layers are isolated for database review; no migration ran.

## Local verification at canonical final-tree content

- TypeScript: passed (`npm run type-check`).
- Jest: 204 suites passed, 4,114 tests passed; 7 suites/80 tests skipped by
  their existing environment gates.
- Production build: passed (`npm run build`).
- Neutral features remain default-off.

## Hard gates preserved

No merge, PR #47 closure, Preview database migration, Production change,
activation, secret operation, payment, refund, customer contact, or marketing
action occurred. Preview database work still requires a provably isolated
database marker and all four restricted credentials.
