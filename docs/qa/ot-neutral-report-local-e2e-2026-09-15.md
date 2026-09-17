# OT Neutral Report - Local E2E and Browser QA

Date: 2026-09-15  
Scope: local-only; synthetic data and mocked external boundaries; no live Stripe, email, Blob, customer, payment, refund, or deployment action.

## Result

The neutral marketing and checkout surfaces pass local browser QA in both feature states. Desktop Chrome (1280x900) and an iPhone-sized touch viewport (390x844) were exercised on the homepage, pricing, checkout, Terms, and success routes. All tested pages rendered a visible H1, had no horizontal overflow, and produced no application page errors. The only console error was the expected local 404 for Vercel Insights; it is explicitly allowlisted as third-party local-development noise.

The flag-off run preserved legacy copy. The flag-on run showed the Cook County Assessment Records & Matching Property Report copy and suppressed the legacy DIY Appeal Packet and appeal-argument language on the governed marketing/commerce surfaces.

## Browser journeys

- Flag off: 11 passed, 1 neutral-only checkout test skipped.
- Flag on: 12 passed.
- Checkout used semantic form locators and intercepted only `/api/checkout/session`; the request remained T2 and navigated only to a same-origin mocked success URL. No Stripe request occurred.
- Packet redemption intercepted only `/api/ot/packet/download`, required a 43-character code in the POST body, kept it out of the URL, cleared the input after completion, and downloaded the mocked customer ZIP.

## Defects found and fixed

1. The packet form ignored the server's neutral ZIP filename and forced `overtaxed-appeal-evidence.pdf`. ZIP bytes would therefore have been saved with a PDF extension. The form now accepts only the exact neutral filename `overtaxed-records-report.zip`; all other/missing filenames retain the legacy PDF fallback.
2. The representative neutral PDF rendered literal `\\u{2014}` sequences in customer-visible headings and source lines. The neutral report content now uses ASCII hyphens, and all three pages were rerendered without escaped Unicode text.

## Artifact verification

A representative report was generated through the trusted producer using synthetic Cook County-shaped fixtures. It was a 3-page, unencrypted, non-form PDF 1.7 (12,833 bytes). All three pages were rendered at 140 DPI and visually inspected. The title, neutral disclaimer, subject facts, matching filter, visible arithmetic, ambiguous-proration disclosure, official-window evidence, source receipts, hashes, and provenance manifest were present and legible. Transient PDF and PNG files were removed after inspection.

The deterministic customer ZIP and delivery boundaries were exercised by focused tests and the native PostgreSQL journey. ZIP membership remained exactly `report.pdf` and `report.csv`, with stable hashes/CRCs and no internal manifest or evidence files in the customer archive.

## API and operator boundaries

- Unauthenticated QA POST: `401 UNAUTHORIZED`.
- Unauthenticated refund listing: `401`.
- Packet GET: `405 METHOD_NOT_ALLOWED`.
- Packet POST while its delivery flag is off: `404 NOT_AVAILABLE`.
- Focused checkout, producer, QA, promotion, refund, delivery-authority, packet route/page, and ZIP suites: 314 tests passed (two native-only suites skip without their explicit disposable-database URLs).
- TypeScript and production build passed.

## Native PostgreSQL acceptance

A fresh disposable PostgreSQL 18 cluster was initialized under a `mktemp` directory on an unused loopback port. All 34 migrations were applied. Four distinct identities were used: privileged migration, restricted neutral runtime, restricted application/read projection, and a dedicated restricted neutral-delivery runtime. The schema/role migration preflight passed and proved all four identities distinct, non-superuser/non-bypass for runtimes, and connected to the same database. The neutral-delivery client requires explicit TLS mode away from loopback.

The synthetic owner journey then exercised actual production repositories, stores, issuance logic, and the POST download route with local in-memory official-byte/private-storage adapters only:

1. seeded a checkout reservation and authoritative paid-order/payment binding fixture;
2. opened and approved QA under the trusted database clock and weekly/manual-review constraints;
3. promoted the exact neutral PDF/CSV bundle into the deterministic customer ZIP;
4. bound the promoted ZIP hash, byte length, content-addressed locator, property fingerprint, and source order to the fulfillment artifact;
5. inserted a synthetic local delivery attempt and issued a one-use capability through the dedicated restricted neutral-delivery identity (never the migration identity);
6. redeemed the capability through the production POST route and verified `application/zip`, private/no-store headers, exact download filename, full ZIP SHA-256, and exact `report.pdf`/`report.csv` member names;
7. proved the second redemption returns `410 EXHAUSTED` and the database use count remains bounded;
8. proved the refund-required branch preserved the paid order for separate provider handling but created no fulfillment, capability, or downloadable artifact; mocked refund receipt verification also converged to `REFUND_CONFIRMED` without a real Stripe call.

The dedicated delivery identity cannot select the shared `ot_order` table. It receives only a migration-owned, security-barrier projection restricted to orders already joined to neutral reservations and neutral fulfillments; a seeded legacy fulfillment was absent from that projection. The migration does not enable RLS on or change ownership of `ot_order`.

Capability issuance and redemption resolve fulfillment kind through trusted database projections rather than a caller-provided neutral flag. Neutral rows never fall back to the legacy store when `OT_NEUTRAL_DELIVERY_DATABASE_URL` is absent, and the legacy stores explicitly exclude neutral fulfillment and capability rows.

Neutral capabilities are one-use regardless of a caller requesting a larger budget: the pure decision rejects `maxUses != 1`, and a database trigger rejects a raw neutral insert with `max_uses=5`. A post-claim storage/hash failure durably consumes and revokes the code with `STORAGE_FAILURE`, returns `409 REISSUE_REQUIRED`, and a later attempt returns `410 REVOKED`.

The two native PostgreSQL acceptance suites passed with `--detectOpenHandles` (2/2). No real Stripe, email, Blob, customer, payment, or refund operation occurred.

This run also found and fixed a production authorization defect: packet issuance recognized QA-approved neutral fulfillments but required the legacy PDF locator namespace. The pure decision layer now requires the neutral ZIP namespace for neutral fulfillments and continues to reject cross-namespace substitution.

A claimed capability is never presented as safely retryable after a storage read or hash failure. The route returns `409 REISSUE_REQUIRED` with a bounded support instruction, and the packet page tells the customer to request a replacement code. The spent and revoked state remains durable for operator review/reissue; no blind object retry or capability refund occurs.

## Remaining boundary

Browser Stripe/checkout transport and all provider boundaries remained mocked by design. The native test seeded authoritative paid/payment rows rather than contacting Stripe, used synthetic official bytes rather than Cook County, used in-memory private storage rather than Blob, and invoked capability issuance from a synthetic durable delivery attempt rather than sending email. This proves local state convergence and authority enforcement; it is not evidence of a live charge, provider acceptance, email delivery, or Production configuration.

Release remains blocked pending the parent task's independent security/quality review and separately approved Preview/Production gates.

The production browser pass requires rebuilding with `OT_NEUTRAL_REPORT_CHECKOUT_ENABLED=true` before `next start`; setting the flag only on an already-built server does not alter statically rendered marketing copy. After that exact build/start sequence, the 12-test desktop/mobile Playwright run passed.
