# PRD: Overtaxed IL — Billing Overhaul (Option B)

## Context
The current site uses subscription billing (Starter $149/yr, Growth $124/yr, Portfolio $99/yr).
We are replacing this with a new one-time + contingency pricing model.

Repo: `/Users/abigailclaw/overtaxed-platform`
Live site: https://www.overtaxed-il.com
DB: Supabase Postgres (URL in .env.local)
Stripe secret key: in .env.local as OT_STRIPE_SECRET_KEY (use this, NOT FS key)

---

## New Pricing Model

### Tiers (all one-time, not subscription)

| Tier | Name | Price | What it is |
|------|------|-------|------------|
| T1 | DIY Starter | $37 | PDF packet: instructions + appeal template. Homeowner finds comps and files themselves. |
| T2 | DIY Pro | $69 | We generate a ready-to-use comp package + instructions. Homeowner files themselves. |
| T3 | Done-For-You | $97 flat | We prepare everything + submit the appeal on their behalf. |
| T4 | Contingency | 22% of first-year savings, $0 upfront, $50 min | We handle everything; they only pay if we win. |

### Channel-specific pricing (note only, no separate checkout needed for MVP)
- Property Managers: $69/property flat OR 22% contingency
- Managing Brokers: 50% of T3 flat referral fee, or $75/contingency win
- REIAs: $127 flat OR 25% contingency + speaking slot
- C of E Recovery: 33% of total refund recovered

### What to build for MVP checkout
Only build checkout flows for T1, T2, T3 (one-time Stripe payments).
T4 (Contingency) = intake form only, no upfront payment. We collect info, contact them separately.

---

## Tasks

### Task 1: Stripe Products
Create 3 new Stripe products + prices using the OT Stripe secret key:
- "DIY Starter" — $37 one-time
- "DIY Pro" — $69 one-time
- "Done-For-You" — $97 one-time

Save the resulting price IDs to `.env.local`:
```
STRIPE_PRICE_T1_DIY_STARTER=price_xxx
STRIPE_PRICE_T2_DIY_PRO=price_xxx
STRIPE_PRICE_T3_DFY=price_xxx
```

Use the Stripe Node.js SDK (`stripe` package, already installed). Write a one-time setup script at `scripts/create-stripe-products.ts`, run it with `npx tsx scripts/create-stripe-products.ts`.

### Task 2: Pricing Page Rewrite
Replace `app/pricing/page.tsx` entirely with the new tier structure.

New page layout:
- Hero: "Pay only if we win — or choose a flat rate that beats any attorney"
- 4 tier cards: T1 ($37), T2 ($69), T3 ($97), T4 (Contingency — "Get Started Free")
- T1/T2/T3: "Buy Now" button → Stripe checkout
- T4: "Get Started" button → `/appeal-contingency` intake form (see Task 4)
- Remove all mentions of "Starter plan", "Growth plan", "Portfolio plan", per-year pricing

### Task 3: Checkout API Routes
Create/update API routes for one-time Stripe checkout:

`POST /api/checkout/session`
Request body: `{ tier: "T1" | "T2" | "T3", propertyPin?: string }`
- Creates a Stripe Checkout Session (mode: "payment")
- success_url: `/checkout/success?session_id={CHECKOUT_SESSION_ID}`
- cancel_url: `/pricing`
- Returns: `{ url: string }`

`GET /app/checkout/success/page.tsx`
- Show "Payment successful" confirmation
- If T1: show download link for appeal packet PDF (already at `/appeal-packet/success`)
- If T2/T3: show "We'll be in touch within 24 hours" message + email confirmation note

### Task 4: Contingency Intake Form
New page: `app/appeal-contingency/page.tsx`

Form fields:
- Full name (required)
- Email (required)
- Phone (required)
- Property PIN (required) — with format hint "XX-XX-XXX-XXX-XXXX"
- Property address (required)
- Estimated current assessed value (optional)
- How did you hear about us? (optional dropdown: Google, Referral, Realtor, Property Manager, Other)
- Submit button: "Get My Free Assessment"

On submit:
- `POST /api/contingency-intake`
- Save to DB as a new model `ContingencyLead` OR reuse `OTLead` model with a `source: "contingency"` field
- Send confirmation email via Resend (OT_RESEND_API_KEY in .env)
- Redirect to `/appeal-contingency/success` ("We'll review your property and be in touch within 2 business days")

Check if `OTLead` model can accommodate this (add `source` field if not present). If schema change needed, create and run Prisma migration.

### Task 5: Remove/Archive Old Subscription Flows
- Remove or hide subscription checkout routes that reference old tier prices
- Comment out or delete references to `STRIPE_PRICE_COMPS_ONLY`, `STRIPE_PRICE_GROWTH_PER_PROPERTY`, etc.
- Keep the old price IDs in .env.local commented out (don't delete — existing subscribers may need them for support)
- Update `app/dashboard/page.tsx` if it references old subscription tier names — replace with new tier names

### Task 6: Update Metadata + SEO
- Update `app/pricing/page.tsx` metadata title/description to reflect new model
- Update any OG/Twitter card text that mentions "subscription" or old prices

### Task 7: TypeScript + Build Check
```bash
cd /Users/abigailclaw/overtaxed-platform
npx tsc --noEmit
npm run build
```
Fix all TypeScript errors before committing.

### Task 8: Commit to Feature Branch + Deploy Preview
⚠️ DO NOT push to main. Push to a feature branch for review first.

```bash
cd /Users/abigailclaw/overtaxed-platform
git checkout -b feat/billing-overhaul
git add -A
git commit -m "feat: billing overhaul — replace subscription tiers with T1/T2/T3/contingency model"
git push origin feat/billing-overhaul
```

Vercel will auto-deploy a preview URL for this branch. Capture the preview URL if possible (check `vercel ls` or the git push output).

### Task 9: E2E Tests Against Preview
After the branch is pushed and Vercel preview is live (wait ~2 min for deploy):

Run the existing Playwright test suite in `/tmp/ot-e2e-tests/` against the **preview URL** (not production):

```bash
cd /tmp/ot-e2e-tests
# Update BASE_URL to preview URL
PLAYWRIGHT_BASE_URL=https://[preview-url].vercel.app npx playwright test --reporter=list
```

Additionally, manually verify these critical flows work on the preview URL:
1. GET `/pricing` — loads without error, shows 4 tiers
2. POST `/api/checkout/session` with `{ tier: "T1" }` — returns a Stripe URL
3. GET `/appeal-contingency` — form loads
4. POST `/api/contingency-intake` — saves to DB (check Supabase)
5. `npx tsc --noEmit` — zero TypeScript errors
6. `npm run build` — clean build

Report pass/fail for each check.

### Task 10: Merge to Main (only if all tests pass)
If and only if Tasks 7 and 9 all pass:

```bash
cd /Users/abigailclaw/overtaxed-platform
git checkout main
git merge feat/billing-overhaul
git push origin main
```

If any test fails: stop here, report the failure, do NOT merge.

---

## Acceptance Criteria
- [ ] New pricing page live with 4 tiers (T1-T4)
- [ ] T1/T2/T3 each have working Stripe checkout (test in browser/curl)
- [ ] T4 contingency intake form saves to DB + sends confirmation email
- [ ] Old subscription tier UI is gone from pricing page
- [ ] TypeScript build passes with zero errors
- [ ] All E2E/smoke tests pass on preview URL
- [ ] Merged to main and deployed to production only after tests pass

---

## Important Notes
- Use `OT_STRIPE_SECRET_KEY` from .env.local — NOT FS_STRIPE_SECRET_KEY
- Use `OT_RESEND_API_KEY` for emails — NOT RESEND_API_KEY (that's Fresh Start)
- Existing `OTLead` model is in Prisma schema — check it before creating a new model
- The `FilingAuthorization` model and appeal flow are separate — do NOT touch them
- Do NOT modify anything in `app/appeal-packet/` — that's already live and working ($37 direct Stripe link)
- T1 ($37 DIY) via checkout is SEPARATE from the existing /appeal-packet direct Stripe link — both can coexist for now

---

## On Completion
Run:
```bash
openclaw system event --text "Done: OT billing overhaul complete — T1/T2/T3 checkout + contingency intake live. Build status: [pass/fail]" --mode now
```
And print a full summary: what was built, what price IDs were created, any issues encountered.
