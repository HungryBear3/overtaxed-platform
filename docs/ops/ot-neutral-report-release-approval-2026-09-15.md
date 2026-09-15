# OT neutral report release approval packet — 2026-09-15

## Candidate

- Branch: `codex/ot-neutral-report-20260915`
- Base: `7a405615bbeec5c6ccb790d316bd9c199eeb3654`
- Candidate before this packet: `8ffa14acfbc3eebb1aa3ddae0c8209b80253dc8f`
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

- Full non-visual Jest: 3,943 passed, 79 skipped.
- Fulfillment suite after Phase 3: 1,910 passed; native suites excluded without test URLs.
- Focused final delivery/security: 314 passed; terminal security closure 183 passed.
- TypeScript: passed.
- Production build: passed, 143 pages.
- Fresh PostgreSQL 18: all 34 migrations applied from zero.
- Four identities proved: migration, normal app, neutral repository, neutral delivery.
- Migration preflight: passed.
- Native Phase 2 and Phase 3 journeys: 2/2 passed with `--detectOpenHandles`.
- Synthetic owner journey: paid binding → QA → ZIP promotion → capability → POST download; exact ZIP hash/members and one-use exhaustion passed.
- Playwright production server: 12/12 passed across desktop Chrome and iPhone viewport; no horizontal overflow or application errors.
- Representative three-page PDF rendered and visually inspected.

## Migration hashes

- Repository: `813e404da095a5e1e75a052dc2067925e7f41ac931e4e1f7f5834b79d734c8f6`
- QA/delivery: `0fa316caf8b70620fbc411180f87b40105b821287b14da62361bb05b7bdb4194`
- Delivery runtime: `c2916caffc314a3a5f887e3086fc4ce16e79190a6e72803d4492748a700e43d3`

## Production remains inactive

No branch push, pull request, Preview deployment, Production migration, role membership, environment change, feature activation, live checkout mutation, real order, Stripe call, email, Blob write, delivery, or refund was performed.

All neutral flags remain fail-closed. Required protected configuration includes distinct neutral repository and delivery database URLs; credentials must use the supported protected-secret flow and are not placed in chat or logs.

## Requested approval — next gate only

Approve:

1. Push this branch and open a pull request.
2. Run CI and independent PR review.
3. Create a Preview deployment with neutral features still disabled.
4. Apply the three migrations to a Preview database using the privileged migration identity.
5. Grant the Preview app, neutral repository, and neutral delivery logins their exact restricted role memberships.
6. Run Preview preflight, synthetic checkout/QA/download smokes, desktop/mobile browser checks, and deployment file tracing.

This approval does **not** authorize Production migration/deployment, feature activation, live charges, customer contact, email delivery, refunds, marketing, or real orders. Those remain a separate gate after Preview evidence.
