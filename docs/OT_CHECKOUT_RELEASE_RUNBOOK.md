# OT Checkout / Filing-Window Gate Release Runbook

## Scope

This release is limited to OT T2/T3 checkout intake, filing-window evidence, durable checkout contracts, Stripe settlement validation, order-level recovery, and admin notice review.

Explicitly excluded: subscription lifecycle changes, referrals, performance fees, invoice scheduling/collections, generic payment recovery, and global Stripe-event leasing.

## Hard release gates

Do not deploy application code until all gates pass:

1. Freeze and independently review the exact commit.
2. Confirm required runtime configuration exists and has no trailing whitespace without printing values:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_T2_DIY_PRO`
   - `STRIPE_PRICE_T3_DFY`
   - `OT_CHECKOUT_GATE_SECRET`, or a sufficiently strong `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
3. Refresh or explicitly verify the authoritative township snapshot. The checked-in source marker is `2026-07-23` and the route fails closed after its configured freshness TTL.
4. Obtain and verify a production database backup.
5. Run `prisma migrate status` against the intended migration datasource.
6. Apply `20260723220000_add_ot_checkout_window_snapshot` and then `20260724143500_add_ot_recovery_payment_binding` **before** activating the code.
7. Run `prisma migrate status` again.
8. Verify the `ot_order` columns, nullability, and indexes listed below.
9. Run a schema drift comparison and classify every difference. Do not treat historical baseline drift as harmless without an explicit review.
10. Only then deploy the application commit.

No step in this runbook authorizes a production migration or deploy by itself.

## Local verification

Use the absolute schema path in linked Git worktrees; a shared `node_modules` symlink can otherwise regenerate Prisma from the main checkout.

```bash
node_modules/.bin/prisma format --schema="$PWD/prisma/schema.prisma"
node_modules/.bin/prisma validate --schema="$PWD/prisma/schema.prisma"
node_modules/.bin/prisma generate --schema="$PWD/prisma/schema.prisma"
pnpm test --runInBand --silent
pnpm exec tsc --noEmit --pretty false --incremental false
node_modules/.bin/next build
```

Known clean-base gates at preparation time:

- TypeScript has an existing baseline backlog. The release may not add diagnostics relative to an identically generated clean base.
- Clean base fails because Prisma-backed admin pages can execute during prerender. The release restores `dynamic = "force-dynamic"` on every Prisma-backed admin page and enforces that invariant with `__tests__/admin/appeals-build-safety.test.ts`; the resulting build completes all 193 pages.

## Verified production preflight — 2026-07-24

Read-only checks against the linked Vercel Production project and production database established:

- `prisma migrate status` sees all 21 repository migrations and exactly two pending migrations: `20260723220000_add_ot_checkout_window_snapshot` and `20260724143500_add_ot_recovery_payment_binding`.
- A custom-format production backup was created at `/Users/abigailclaw/.openclaw/workspace/rex/backups/overtaxed/pre-release-20260724-150046.dump`, mode `0600`, with 623 catalog entries and SHA-256 `fae6dff62705cb158803943f62f8ad22268c861007386ade3b05f487d8226c79`.
- The official Cook County Assessor page returned HTTP 200 at `2026-07-24T19:55Z`, still displayed `Last updated: 7/23/26`, and contained 16 published township rows. The 15 existing rows matched exactly; Lyons was newly added with notice date `2026-07-23` and last-file date `2026-09-03`.
- Production datasource-to-candidate-schema drift contains 24 statements: four are exactly the expected OT release changes; 20 are historical production drift (seven outreach foreign-key additions and 13 index renames). After all 21 migrations on a fresh PostgreSQL database, the candidate contributes zero additional drift statements. Do not auto-apply the 20 historical statements as part of this release.
- Required Production env names are present except the optional `OT_CHECKOUT_GATE_SECRET`; the 44-character `NEXTAUTH_SECRET` supplies the documented fallback. `DATABASE_URL` and the Prisma-configured `DIRECT_URL` are present.
- Both Production Stripe price variables contain a trailing newline. After whitespace removal they resolve read-only through the live Stripe API to active one-time USD prices: T2 `$69.00`, T3 `$97.00`. Rewrite both Production values without trailing whitespace before deployment; changing env or redeploying still requires explicit approval.

## Migration verification

Expected OT-only migration effects:

- `ot_order.stripeSessionId` becomes nullable.
- Add unique `checkoutKey` and `contractKey`.
- Add authoritative township/window snapshot fields.
- Add T2 acknowledgment and T3 notice-review evidence fields.
- Add checkout attempt, expiry, price/product/amount/currency binding fields.
- Add settled amount/currency and order-level recovery reason.
- Add recovery Stripe Session/Event binding fields and the recovery-session lookup index.

Expected indexes:

- `ot_order_checkoutKey_key`
- `ot_order_contractKey_key`
- `ot_order_recoveryStripeSessionId_idx`

Read-only verification query:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ot_order'
  AND column_name IN (
    'stripeSessionId', 'checkoutKey', 'contractKey',
    'windowStatus', 'windowVerifiedAt',
    'analysisAcknowledgedAt', 'noticeEvidence',
    'checkoutAmountCents', 'checkoutCurrency',
    'settledAmountCents', 'settledCurrency', 'recoveryReason',
    'recoveryStripeSessionId', 'recoveryStripeEventId'
  )
ORDER BY column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'ot_order'
  AND indexname IN (
    'ot_order_checkoutKey_key',
    'ot_order_contractKey_key',
    'ot_order_recoveryStripeSessionId_idx'
  )
ORDER BY indexname;
```

## Post-deploy smoke checks

Use test-mode Stripe only unless a separate production-payment approval is given.

1. Pricing T2 and T3 buttons route to `/checkout`, not directly to Stripe.
2. Legacy `/api/billing/checkout-diy` returns `409 CHECKOUT_INTAKE_REQUIRED` and creates no DB/provider object.
3. Ambiguous address requires explicit PIN selection.
4. Unsupported, closed, unknown, or stale filing-window state fails closed.
5. T2 requires signed acknowledgment evidence.
6. T3 outside the ordinary window requires notice review; an admin can approve, reject, or revalidate from `/admin/orders`.
7. Retrying the same checkout contract reuses the durable order/session rather than creating a second charge path.
8. Paid amount, currency, price, product, or durable-contract mismatch enters `PAID_RECOVERY_REQUIRED` and suppresses normal fulfillment notices.
9. Cancelled/refunded orders are not resurrected by a late settlement event.
10. `/checkout/success` does not claim payment or fulfillment without verified state.

## Rollback

- Disable the checkout entry points or revert application code first if a post-deploy defect appears.
- Do not drop additive evidence columns as an emergency rollback; preserve payment and eligibility evidence.
- Resolve paid mismatches manually from the OT order recovery state.
- Any destructive database rollback requires a separate reviewed migration and explicit approval.
