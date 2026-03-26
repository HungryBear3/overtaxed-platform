# OT Affiliate / Referral System — PRD

## Goal
Build a lightweight affiliate/referral tracking system so partners like John Grafft can share a unique link, and we can track which paid conversions they drove.

## How It Works (simple version)

1. Referral links look like: `overtaxed-il.com/?ref=john` or `overtaxed-il.com/?ref=abc123`
2. When a user visits with `?ref=`, store the referral code in a cookie (30-day TTL)
3. When that user completes a paid checkout (Stripe), attach the referral code to their record
4. Admin dashboard shows: referral code → number of visits → number of paid conversions → total revenue attributed

## Database Changes (Prisma)

Add a `referral_code` field to the relevant user/payment tables:

```prisma
model Referral {
  id          String   @id @default(cuid())
  code        String   @unique  // e.g. "john", "abc123"
  name        String?           // Human-readable: "John Grafft"
  createdAt   DateTime @default(now())
  visits      Int      @default(0)
  conversions Int      @default(0)
  revenue     Decimal  @default(0)
}
```

Also add `referralCode String?` to the User model (or equivalent payment/lead model) to track which referral code brought them in.

## Frontend Changes

1. **Capture referral code on landing** — in the root layout or a client component, read `?ref=` from URL params and store in a cookie named `ot_ref` with 30-day expiry.

2. **Pass referral code on checkout** — when initiating a Stripe checkout session, include the referral code from the cookie as metadata: `{ referralCode: cookieValue }`.

## Backend Changes

1. **Stripe webhook handler** — when a `checkout.session.completed` event fires, check for `referralCode` in the metadata. If present, increment `conversions` and `revenue` on the matching Referral record.

2. **Admin API route** — `GET /api/admin/referrals` returns all Referral records with stats. Protected by admin auth.

3. **Visit tracking** — optional: on each page load where `ot_ref` cookie is set, increment the visit count (use a middleware or API route to avoid double-counting).

## Admin UI

Add a simple referrals tab to the existing admin dashboard:
- Table: Code | Name | Visits | Conversions | Revenue
- "Create new referral code" button (just adds a row to the DB)
- No payout automation needed yet — manual payouts via Venmo/check

## Done Criteria
- [ ] Referral model in Prisma schema with migration
- [ ] `?ref=` param captured and stored in cookie on visit
- [ ] Referral code passed as Stripe checkout metadata
- [ ] Stripe webhook increments conversion + revenue on successful payment
- [ ] Admin route returns referral stats
- [ ] Admin dashboard has referrals tab
- [ ] Test: visit `/?ref=test`, complete checkout, verify DB updated
- [ ] Commit with message: "feat: affiliate referral tracking system"

## Notes
- Keep it simple — no automated payouts, no commission percentages yet
- The first use case is John Grafft: create code "john" in the DB, give him the link
- Do NOT break existing Stripe checkout or auth flows
- Do NOT modify any existing user data or migrations destructively
