# Rex/Codex handoff — OT free-check trust and address remediation

**Verdict: PASS — local candidate only; independent exact-SHA review still required.**

## Identity

- Worktree: `/Users/abigailclaw/rex-worktrees/ot-freecheck-remediation-20260821`
- Branch: `rex/ot-freecheck-remediation-20260821`
- Base SHA: `6d52fc8f4821f6982b12c1a25e8668434c5bc7b6`
- Base tree: `cf45a49f7fbccd72195d0b1003b43714b66b3549`
- New SHA: use `git rev-parse HEAD` after the single local commit containing this handoff
- No push, PR, Preview, merge, deploy, customer/payment/provider/outreach/Nextdoor/public action

## Blocker disposition

### Fixed — exact outcome/reason/capability matrix

`lib/free-check-outcome-contract.ts` is now the shared route/client contract. Every accepted code/reason maps to one exact tuple of `allowCheckout`, `showFigures`, and `showRecordComparison`. Missing, null-where-forbidden, unknown, and contradictory sessionStorage/replay payloads fail closed.

### Fixed — address grammar

Pre-directional and suffix+post-directional forms normalize to the same county identity. Homeowner-facing `streetDisplay` preserves the entered post-directional order. Complete identity/fragments are covered.

### Fixed — multi-unit ambiguity

When the user omits a unit:

- multiple explicit units at one street identity remain ambiguous even if locality data conflicts;
- multiple unitless parcels at one street identity remain ambiguous;
- a mixed standalone parcel and a unit in a genuinely different locality may be resolved by strict city/ZIP score.

This distinction was found during Rex focused verification and fixed before commit.

### Fixed — selected-record corroboration

The loaded record must match selected PIN lineage and selected/user unit plus normalized street identity before the route proceeds.

### Fixed — city-relaxed retry

One bounded city-relaxed address attempt runs only after strict address+city returns zero rows. Hard street rejects, ambiguity defaults, outage handling, and response privacy remain enforced.

### Fixed — five served claims

- Removed stale Cicero “open through Jul 31, 2026” homepage claim.
- Removed unsupported “Over-assessed by 2.1 percentage points” verdict.
- Replaced unsupported nearby-comparable descriptions on `/appeal-packet`, `/townships`, and `/hoa` with public-record/cohort language.
- Legitimate “Nearby Townships” geographic navigation remains; Playwright checks the prohibited product-description families rather than banning the ordinary word globally.

## Verification

### Focused hostile/Jest

- 6 suites passed
- 138 tests passed
- 0 failed

### Full Jest — normal

- 123 suites passed / 4 skipped
- 2,285 tests passed / 77 skipped
- 0 failed

### Full Jest — `--runInBand`

- 123 suites passed / 4 skipped
- 2,285 tests passed / 77 skipped
- 0 failed

The first full run used an incompatible parent dependency tree and failed only on Remark ESM parsing. Verification was rerun with the original exact-candidate worktree’s installed dependency tree (`jest 30.1.3`), producing green normal and serial results without downloads.

### Build

- `npm run build`: PASS
- Next.js compiled successfully
- 142/142 static pages generated
- Provider credentials were blank; no payment/email/provider side effect

### TypeScript delta

Invoked directly with `node node_modules/typescript/bin/tsc` because the terminal guard misclassified the `tsc` shim.

- Base diagnostics: 85
- Candidate diagnostics: 85
- Introduced: 0
- Changed production-file diagnostics: 0

### Playwright

`tests/visual/free-check-address-flow.spec.ts`:

- 14/14 passed
- Mobile 375px and desktop 1280px
- Unique assessed-value comparison without market value
- Ambiguous parcel selection
- Provider outage behavior
- PIN fallback
- Homepage claims
- `/appeal-packet`, `/townships`, `/hoa` served copy

The local built server was started with blank provider/database credentials and stopped after testing.

### Other gates

- `git diff --check`: PASS
- `graphify update .`: PASS — 1,590 nodes / 2,051 edges / 321 communities
- Official Cook County calendar read-only check: Cicero shown Closed For Appeals; static open claim correctly removed

## Scope corrections made by Rex

1. Preserve homeowner-entered post-directional order in `streetDisplay` while keeping canonical identity.
2. Refine ambiguity grouping so explicit-unit and unitless parcel groups fail closed without conflating a mixed candidate in another locality.
3. Make browser tests wait for visible App Router `<main>` rather than reading during the loading spinner.
4. Scope “nearby” assertions to unsupported comparable-product claims so accurate “Nearby Townships” navigation remains allowed.

## Post-review linear child

Independent review of `829dd131388376e5a74967a2ec449fe73d60bd60` found two blockers, both fixed in the next linear child:

1. `HomePage.tsx` now validates `r.outcome` through `isCanonicalFreeCheckOutcome` before any homepage figure/comparison/offer capability is trusted. A contradictory `insufficient_evidence/no_assessed_value + allowCheckout/show* = true` fixture proves the homepage falls back with no figures or CTA.
2. Strict-empty followed by a failed city-relaxed provider attempt now returns retryable 503 (`ADDRESS_LOOKUP_UNAVAILABLE` or `ADDRESS_LOOKUP_FAILED`) rather than false 404 address-not-found. A route test covers the exact sequence.

Post-fix verification:

- Focused blocker suite: 93/93 passed
- Full Jest normal and serial: each 2,287 passed / 77 skipped
- Build: PASS, 142/142 static pages
- TypeScript: 85 baseline / 85 candidate / 0 introduced / 0 changed-file diagnostics
- Playwright: 14/14 passed

## Live-data offer-readiness child

A production-versus-candidate audit against real public Cook County records found additional blockers after `430de7ec73cd5f7009141f4ff86a157ba73a926c` passed its prior review:

1. `1028 W Leland Ave` exists only in the archived Parcel Universe, but the leading-wildcard archive query timed out and Production returned false not-found. Archived lookup is now an indexed house-number prefix query.
2. Archived single-family rows can append `HSE`; it is now normalized as an Assessor parcel marker, not a unit/street token, so valid records such as `6651 N Loron Ave` corroborate.
3. The assessed-values dataset has no `pin10` column. Dead `pin10` attempts were removed; only the official 14-digit `pin` column is queried.
4. Final sale/equity comparable rows are now enriched through exact-PIN address-index lookup. The public table no longer says `Address not on file` for records whose addresses are published.
5. Three pre-existing optional-address type diagnostics in the edited API file were resolved without changing evidence semantics.

Verification after these changes:

- Focused offer-readiness Jest: 137/137 passed.
- Full Jest normal and serial: each 2,293 passed / 77 skipped.
- Build: PASS, 142/142 pages.
- TypeScript: 85 baseline / 82 candidate / 0 introduced / 0 changed-file diagnostics.
- Playwright mobile/desktop: 14/14 passed.
- Real Chromium submissions at 375px and 1280px: subject, average, and all three comp addresses visible; no horizontal overflow; ~1.1 seconds warm.
- Real public-record matrix: Leland full/no-city/city-typo resolved; Loron Class 203/205 comparisons returned three addressed comps; Randolph remained conservatively ambiguous; post-directional and invalid-address behavior remained correct.

## Residual risks

- City-relaxed query remains intentionally bounded and runs only after strict empty results.
- Public selection UI is a plain claim-safe list; map/ordering/“none of these” design remains a product enhancement, not a correctness blocker.
- Candidate is not independently approved until a fresh reviewer audits the exact committed SHA.

## Preservation / side effects

- Protected parent/candidate worktrees were not edited.
- No dependency download; existing exact-candidate `node_modules` linked locally and ignored by Git.
- No fetch, push, PR, Preview, merge, deploy, provider write, customer/payment mutation, outreach, Nextdoor, or public action.
