# OT delivery evidence Phase 1 — completion report

Task: `ot-delivery-evidence-phase1-20260831` (queue authority: internal-draft-pr)

## Task/scope and product-state interpretation

Goal: give newly settled `OTOrder` tier purchases durable confirmation-email
attempt/outcome evidence without changing payment truth, fulfillment promises,
or customer-facing behavior. The July audit's FM1/FM2 gap is still present on
current `main` for the *confirmation email*: the OT PAID settlement path fired
`sendOrderConfirmation` fire-and-forget and `sendEmail` discarded the Resend
message id. (The audit's packet-side gaps have since been addressed separately
by the `OTFulfillment` subsystem; that subsystem is about packet artifacts and
was deliberately not touched or reused — the confirmation email is order-level
evidence, so it lives on `ot_order` itself as nullable columns.) No contact
with or mutation of any live customer/order; this is code + tests only.

## Identity

- Repo: `HungryBear3/overtaxed-platform` (local checkout)
- Base: `origin/main` @ `ab1a21a633186b96262c653399593508f85539d6`
  (verified equal to `origin/main` HEAD at claim time)
- Branch: `cc/ot-delivery-evidence-phase1-20260831`
- Final SHA: see queue RECEIPT (commit created after this report)

## What was implemented

1. **Schema (additive, old-writer compatible).** Five nullable columns on
   `ot_order`: `confirmationEmailStatus` (ATTEMPTED | SENT | FAILED),
   `confirmationEmailAttemptedAt`, `confirmationEmailSentAt`,
   `confirmationEmailMessageId`, `confirmationEmailErrorClass`. All-NULL is
   the truthful "never attempted" state of every pre-existing row; no
   backfill, no rewrite of historical financial state, no new index.
   Migration `20260831120000_add_ot_confirmation_email_evidence` is
   `ALTER TABLE ... ADD COLUMN` only (governed by a regression test).
2. **Structured-receipt seam in `lib/email/send.ts`.**
   `sendEmailWithReceipt` returns `{ ok, providerMessageId }` or
   `{ ok, errorClass }` where `errorClass` is a closed non-PII allowlist
   (`PROVIDER_NOT_CONFIGURED | PROVIDER_ERROR | SEND_EXCEPTION |
   HELD_TIER_REFUSED`). `sendEmail` and `sendOrderConfirmation` are now thin
   boolean adapters over the seam — every existing caller keeps its exact
   signature and semantics (no repository-wide return-type churn).
3. **Evidence seam `lib/fulfillment-runtime/confirmation-evidence.ts`.**
   `sendOrderConfirmationWithEvidence(orderId, args)`: best-effort ATTEMPTED
   pre-write (guarded `confirmationEmailAttemptedAt IS NULL`), the send, then
   a durable outcome write guarded `confirmationEmailSentAt IS NULL` — first
   success wins, so a later failure can never overwrite a truthful success.
   Never throws.
4. **Webhook wiring (exact newly won `OTOrder -> PAID` path only).** Gated by
   the new strict default-off flag `OT_CONFIRMATION_EVIDENCE_ENABLED`
   (`lib/fulfillment/flag.ts`, house `=== "true"` style, independent of the
   T2 gate which is already live). Flag on: the confirmation send is awaited
   with evidence recorded. Flag off: byte-for-byte legacy fire-and-forget.
   `sendNewOrderAlert` (ops) is unchanged. The recovery path and the
   `alreadyPaid` replay guard are untouched.

## Required-vs-best-effort classification (contract §7)

Evidence persistence is **strict default-off best-effort**. Failure of any
evidence write logs a bounded error, preserves the current payment
acknowledgment and notification semantics, keeps the StripeEvent claim (so no
Stripe retry ⇒ no duplicate email), and leaves payment truth untouched. There
is deliberately no half-required write: the webhook's ack/claim behavior is
identical whether evidence writes succeed, fail, or are disabled.
**Promotion gate:** promoting to a required write (500 + claim release +
replay-time evidence retry, mirroring the existing T2 duplicate-evidence
pattern) is a later, separately gated slice, to be considered only after the
migration is applied and Preview shows the best-effort writes healthy.

## RED observed before implementation

`npx jest __tests__/billing/webhook-confirmation-evidence.test.ts
__tests__/email/send-receipt.test.ts
__tests__/billing/ot-confirmation-evidence-migration.test.ts --runInBand`
at base + tests only: **3 suites failed, 12 failed / 5 passed** — failures
exactly the missing seams (`sendOrderConfirmationWithReceipt is not a
function`, `Cannot find module .../confirmation-evidence`, evidence fields
null, migration file absent); the 5 passes were the legacy-preservation
assertions that already hold on main (recovery suppression, flag-off legacy
path, boolean adapters). Full RED log preserved in the queue task directory
(`evidence/red-run.log`).

## Regression coverage (all GREEN at final SHA)

- paid exact-bound order records attempt + success identity (SENT, sentAt,
  Resend message id) on the production webhook branch (real route POST + real
  evidence seam; only db/stripe/provider boundaries doubled);
- send failure records durable FAILED + bounded class without changing
  `status/amountPaid/settledAmountCents`, ack still 200/received;
- replay: second event for the same paid session sends nothing and leaves
  original evidence (incl. sentAt identity) untouched;
- direct guard proof: later failure cannot overwrite prior SENT evidence;
- `PAID_RECOVERY_REQUIRED` settlement sends no confirmation, writes no
  evidence;
- evidence-store failure: ack preserved, exactly one send, claim retained
  (no retry storm), payment truth intact;
- flag off (default): legacy fire-and-forget call, zero evidence writes;
- non-OT/boolean callers: `sendEmail`/`sendOrderConfirmation` semantics
  byte-compatible (unit suite);
- migration governance: ADD COLUMN-only, nullable, `ot_order` only, no
  DEFAULT/UPDATE/DROP; schema fields optional.

## Commands and results (final tree)

| Gate | Result |
| --- | --- |
| Focused new suites | 3 suites / 17 tests pass |
| Billing/packet/email/checkout suites | 24 suites / 178 tests pass |
| `npm test -- --runInBand` (full) | 127 passed, 4 skipped suites; 2379 passed, 77 skipped tests; 0 failures |
| `npx prisma validate` | valid |
| `npx prisma generate` | Prisma Client v7.3.0 generated cleanly |
| `npm run type-check` | 82 errors, byte-identical to base-SHA baseline (diff of error sets empty); none introduced |
| `npm run build` | passes (prisma generate + next build; no migrations run by design of the build script) |
| `npm run format:check` | repo-wide pre-existing non-conformance (579 files at base); delta = only the 4 new files, which follow the repo's house style like their siblings; no previously-conforming file regressed |
| `git diff --check` | clean |
| Secret/value scan over changed scope | clean (only the pre-existing fake test fixture value `ga4_secret`, same as sibling suite at base) |
| `graphify update .` | NOT RUN — tool unavailable in the sandbox runner; run on the Mac before/at PR review (see residual risks) |

## Schema/migration compatibility argument

The deployed old writer never references the five new columns, so its
INSERT/UPDATE statements are unaffected; columns are nullable with no
defaults, so no table rewrite and no historical row changes; the Prisma
client generated from the new schema treats them as optional. Applying the
migration before or after deploying this code is safe in both orders when the
flag is off (columns unused); the flag may only be enabled after the
migration is applied (promotion gate above).

## Payment/replay/notification invariant review

- Settlement writes (`updateMany` full-contract guards), recovery diversion,
  and the StripeEvent claim/release protocol are unchanged.
- Replay: the `alreadyPaid` early-return still suppresses all emails; the
  additional sentAt-IS-NULL guard makes evidence idempotent even against
  out-of-order callers.
- `PAID_RECOVERY_REQUIRED` still returns before any email.
- Await of the confirmation send adds provider latency to the webhook only
  when the flag is on; it cannot 500 (helper never throws).

## Residual risks / next separately gated slice

- `graphify update .` could not run in the sandbox (tool lives on the Mac);
  run it in the repo before merge review.
- ATTEMPTED with no outcome can persist if the process dies mid-send — that
  is the truthful crash state and is distinguishable by design.
- Evidence is best-effort: a DB outage during the write loses evidence (not
  payment truth, not notification safety). Promotion slice: required-write
  semantics + replay-time evidence retry.
- Not in scope (unchanged, per task §8): admin resend/mark-delivered UI,
  Resend bounce reconciliation, packet generation, customer-facing copy.

## Side-effect attestation

No live Stripe/Production DB/customer/order/packet/email/provider/refund/
dispute/fulfillment state was queried or mutated; no email or customer
communication sent; no packet generated; no price/product/deadline/
official-source/eligibility/refund/legal copy changed; no deploy, alias,
merge, publish, flag enablement, or Vercel/config/secret change; no secrets
or customer PII printed; no force-push; no source data deleted. The known
July customer/order was not contacted or touched.

## Precise next decision

Push branch + open DRAFT PR (single credentialed step; see queue receipt),
then Rex/Abigail review the diff and CI, run `graphify update .` on the Mac,
and decide whether to schedule the migration apply + flag promotion slice.
