# OT Checkout / Filing-Window Gate Release Runbook

## Scope

This release is limited to OT T2/T3 checkout intake, filing-window evidence, durable checkout contracts, Stripe settlement validation, order-level recovery, and admin notice review.

Explicitly excluded: subscription lifecycle changes, referrals, performance fees, invoice scheduling/collections, generic payment recovery, and global Stripe-event leasing.

## Hard release gates

Do not deploy application code until all gates pass:

1. Freeze and independently review the exact commit.
2. Confirm required runtime configuration exists without printing values:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_T2_DIY_PRO`
   - `STRIPE_PRICE_T3_DFY`
   - `OT_CHECKOUT_GATE_SECRET`, or a sufficiently strong `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
3. Refresh or explicitly verify the authoritative township snapshot. The checked-in source marker is `2026-07-23` and the route fails closed after its configured freshness TTL.
4. Obtain and verify a production database backup.
5. Run `prisma migrate status` against the intended migration datasource.
6. Apply `20260723220000_add_ot_checkout_window_snapshot` **before** activating the code.
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
- Build compiles, then clean base and the release both fail because `/admin/appeals` performs a Prisma query during prerender.

## Migration verification

Expected OT-only migration effects:

- `ot_order.stripeSessionId` becomes nullable.
- Add unique `checkoutKey` and `contractKey`.
- Add authoritative township/window snapshot fields.
- Add T2 acknowledgment and T3 notice-review evidence fields.
- Add checkout attempt, expiry, price/product/amount/currency binding fields.
- Add settled amount/currency and order-level recovery reason.

Expected indexes:

- `ot_order_checkoutKey_key`
- `ot_order_contractKey_key`

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
    'settledAmountCents', 'settledCurrency', 'recoveryReason'
  )
ORDER BY column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'ot_order'
  AND indexname IN ('ot_order_checkoutKey_key', 'ot_order_contractKey_key')
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
