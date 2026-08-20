# `/check` freshness-corpus correction

Date: 2026-08-20
Parent: `0fc65116920b44d0eb105bc30d2d4e476d792f5b`
Status: local candidate only; independent exact-SHA review required

## Correction

- Added route ID 32 (`/check`) to the controller acceptance matrix, increasing the freshness corpus from 52 to 53 routes.
- Carried the canonical projection capabilities into the free-check response: date visibility, countdown visibility, filing CTA, reminder signup, and checkout.
- Made the result renderer fail closed when those flags are absent, including older cached payloads.
- Suppressed stale/unverified dates, county filing actions, reminder signup, and paid entry points together.
- Added a hostile rendered-result case with stale 1900 dates and all capabilities denied.

## Verification

- Focused Jest: 4 suites, 110 tests passed.
- Full Jest: 89 suites passed; 1,462 passed, 77 skipped, 0 failed.
- Production build: passed.
- TypeScript baseline: unchanged at 86 errors across 44 files.
- Controller QA: 53 routes, 22 named surfaces, 10 fixtures, zero mutations; self-test 7/7 passed.
- Controller packet manifest: 6/6 hashes passed.
- `git diff --check`: passed.

## Holds

No push, PR, merge, deploy, Preview, production, provider, county, customer, payment, email, reminder, or public action occurred. Gate B and Gate C remain blocked until a fresh independent review binds the final commit SHA.
