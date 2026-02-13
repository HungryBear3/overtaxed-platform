# Lessons Learned: Overtaxed Platform

This document captures bugs, deployment issues, and solutions encountered during the development of the Overtaxed platform. Use this as a reference to avoid repeating the same issues.

> **Related:** See also `../newstart-il/LESSONS_LEARNED.md` for extensive lessons from the sister project, including Vercel deployment, TypeScript build fixes, Prisma issues, and Next.js 15+ compatibility patterns.

## Table of Contents
1. [Prisma 7+ Configuration](#prisma-7-configuration)
2. [Prisma Schema Changes with Turbopack](#prisma-schema-changes-with-turbopack)
3. [Tailwind CSS v4 Setup](#tailwind-css-v4-setup)
4. [Supabase Connection](#supabase-connection)
5. [Husky v9 Migration](#husky-v9-migration)
6. [NextAuth.js v5 Setup](#nextauthjs-v5-setup)
7. [Cook County Tax Rate Integration](#cook-county-tax-rate-integration)
8. [Next.js 16 Prerender / useSearchParams](#nextjs-16-prerender--usesearchparams)
9. [Vercel + GoDaddy Deployment](#vercel--godaddy-deployment)
10. [GitHub Sync (overtaxed-platform vs FreshStart-IL)](#github-sync-overtaxed-platform-vs-freshstart-il)
11. [Sync to overtaxed-platform Repo (Robocopy)](#sync-to-overtaxed-platform-repo-robocopy)
12. [JWT / Stale Subscription Data](#jwt--stale-subscription-data)
13. [Stripe Webhook Debugging](#stripe-webhook-debugging)
14. [Vercel Preview + Stripe Test Mode](#vercel-preview--stripe-test-mode)
15. [Admin Set-Subscription (Testing)](#admin-set-subscription-testing)
16. [Property add – assessment backfill](#property-add--assessment-backfill)
17. [Comps-to-appeal flow, PDF wrap, and filing UX](#comps-to-appeal-flow-pdf-wrap-and-filing-ux)
18. [Property slot capping and production DB migration](#property-slot-capping-and-production-db-migration)
19. [GitHub secret exposure – Stripe webhook signing secret](#github-secret-exposure--stripe-webhook-signing-secret)
20. [Stripe: multiple customers per email; serverless DB pool](#20-stripe-multiple-customers-per-email-serverless-db-pool)
21. [Pricing upgrade UX: additional slots and caps](#21-pricing-upgrade-ux-additional-slots-and-caps)
22. [Starter slots display, add-slots Checkout redirect, charge-only-additional (Growth/Portfolio)](#22-starter-slots-display-add-slots-checkout-redirect-charge-only-additional-growthportfolio)
23. [Assessment history: $0 / -100% → Not available yet](#23-assessment-history-0--100--not-available-yet)
24. [Pricing dropdown: Add 1 more showing total not additional](#24-pricing-dropdown-add-1-more-showing-total-not-additional)
25. [Comparison report value-add: Realie, map, similarity line](#25-comparison-report-value-add-realie-map-similarity-line)
26. [PDF summary: enriched comps, table layout, map & photos in PDF](#26-pdf-summary-enriched-comps-table-layout-map--photos-in-pdf)
27. [Local network permission prompt (overtaxed-il)](#27-local-network-permission-prompt-overtaxed-il)
28. [Realie API: comps list vs subject/appeal; Premium Comparables](#28-realie-api-comps-list-vs-subjectappeal-premium-comparables)
29. [Sign-out, paywalls, admin build, DB timeouts](#29-sign-out-paywalls-admin-build-db-timeouts)
30. [Contact form, visitor counter, legal pages](#30-contact-form-visitor-counter-legal-pages)

---

## Prisma 7+ Configuration

### Issue: Datasource URL in schema.prisma Not Supported
**Error:** `Error code: P1012` - `url` and `directUrl` properties are no longer supported in `schema.prisma` in Prisma 7+

**Solution:** 
1. Remove `url` and `directUrl` from `prisma/schema.prisma`
2. Create `prisma.config.ts` at project root:

```typescript
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
    directUrl: process.env["DIRECT_URL"],
  } as { url?: string; directUrl?: string },
});
```

3. Use `PrismaPg` adapter in `lib/db/prisma.ts`:

```typescript
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })
```

**Lesson:** Prisma 7+ requires connection URLs in `prisma.config.ts`, not `schema.prisma`. The TypeScript types for `defineConfig` may be outdated, requiring a type assertion for `directUrl`.

---

## Prisma Schema Changes with Turbopack

### Issue: New Schema Fields Not Recognized After `prisma generate`
**Error:** `PrismaClientValidationError: Unknown argument 'taxCode'. Did you mean 'zipCode'?`

**Context:** After adding new fields to `schema.prisma` and running `npx prisma generate`, the Next.js dev server with Turbopack still used the old Prisma client types, causing validation errors when trying to use the new fields.

**Root Cause:** Next.js Turbopack aggressively caches compiled code in the `.next` folder. Even after regenerating the Prisma client, the cached build artifacts still reference the old types.

**Solution (Full Reset):**
```powershell
# 1. Stop the dev server (Ctrl+C)

# 2. Clear ALL caches
Remove-Item -Recurse -Force .next
Remove-Item -Recurse -Force node_modules\.prisma
Remove-Item -Recurse -Force node_modules\@prisma

# 3. Reinstall and regenerate
npm install
npx prisma generate

# 4. Restart dev server
npm run dev
```

**Alternative (Temporary Workaround):** If the full reset doesn't work immediately, temporarily comment out the new fields in your API routes and return hardcoded `null` values. The frontend should handle null gracefully.

**Lesson:** 
- When adding new Prisma schema fields, always clear both `.next` AND `node_modules\.prisma` folders
- Killing the dev server isn't enough - cached compiled chunks persist in `.next/dev/server/chunks/`
- Consider running `npm run build` (production build) to verify schema changes are picked up correctly
- Multiple Node processes may hold locks on `.next/dev/lock` - kill all Node processes if restart fails

---

## Tailwind CSS v4 Setup

### Issue: PostCSS Plugin Moved
**Error:** `It looks like you're trying to use 'tailwindcss' directly as a PostCSS plugin. The PostCSS plugin has moved to a separate package.`

**Solution:**
1. Update `postcss.config.mjs`:

```javascript
// Before (v3)
const config = {
  plugins: {
    tailwindcss: {},
  },
};

// After (v4)
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

2. Update `app/globals.css`:

```css
/* Before (v3) */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* After (v4) */
@import "tailwindcss";
```

**Lesson:** Tailwind CSS v4 moved the PostCSS plugin to `@tailwindcss/postcss` package. The CSS directive syntax also changed from `@tailwind` to `@import "tailwindcss"`.

---

## Supabase Connection

### Issue: Connection Pooler vs Direct Connection
**Context:** Supabase provides two connection methods:
- **Connection Pooler (port 6543):** For serverless environments like Vercel
- **Direct Connection (port 5432):** For migrations and Prisma Studio

**Solution:**
```env
# .env.local
# Connection Pooler - for app/Vercel (port 6543)
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Direct Connection - for migrations (port 5432)
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
```

**Lesson:** 
- Use `DATABASE_URL` (pooler) for the app in serverless environments
- Use `DIRECT_URL` (direct) for migrations
- Direct connection may be blocked by firewall; pooler usually works
- If migrations timeout, use Supabase SQL Editor with manual SQL

### Issue: Migrations Timeout or Fail
**Solution:** Generate SQL and run manually in Supabase SQL Editor:
1. Create `prisma/manual_setup.sql` with all CREATE statements
2. Go to Supabase Dashboard → SQL Editor
3. Paste and run the SQL
4. Verify in Table Editor

**Lesson:** For slow networks or blocked direct connections, manual SQL import is faster and more reliable than `prisma migrate dev`.

---

## Husky v9 Migration

### Issue: Husky v8 API Not Compatible with v9
**Error:** `TypeError: require(...).install is not a function`

**Solution:** Update `package.json` prepare script:

```json
{
  "scripts": {
    // Before (v8)
    "prepare": "node -e \"try { require('husky').install() } catch (e) {}\""
    
    // After (v9)
    "prepare": "husky || true"
  }
}
```

**Lesson:** Husky v9 removed the `.install()` API. The new syntax is just `husky` command. The `|| true` prevents errors in CI environments where git hooks aren't needed.

---

## NextAuth.js v5 Setup

### Issue: Session Token Cookie Name
**Context:** NextAuth.js v5 uses different cookie names in development vs production.

**Solution:** Explicitly specify cookie name in middleware and session helpers:

```typescript
const isProduction = process.env.NODE_ENV === "production"
const sessionCookieName = isProduction 
  ? "__Secure-authjs.session-token" 
  : "authjs.session-token"

const token = await getToken({
  req: request,
  secret: process.env.NEXTAUTH_SECRET,
  cookieName: sessionCookieName,
})
```

**Lesson:** Always specify the cookie name explicitly when using `getToken()` in middleware or API routes. The cookie prefix changes based on environment.

### Issue: Extended Session Types
**Solution:** Create `types/next-auth.d.ts`:

```typescript
import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      role: string
      subscriptionTier: string
      subscriptionStatus: string
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string
    role?: string
    subscriptionTier?: string
    subscriptionStatus?: string
  }
}
```

**Lesson:** TypeScript module augmentation is required to add custom properties to NextAuth.js session and JWT types.

---

## Quick Reference: Key Files

| Purpose | File |
|---------|------|
| Prisma config | `prisma.config.ts` |
| Prisma schema | `prisma/schema.prisma` |
| DB client | `lib/db/prisma.ts` |
| Auth config | `lib/auth/config.ts` |
| Session helpers | `lib/auth/session.ts` |
| Middleware | `middleware.ts` |
| PostCSS config | `postcss.config.mjs` |
| Tailwind import | `app/globals.css` |
| Type extensions | `types/next-auth.d.ts` |
| Manual SQL | `prisma/manual_setup.sql` |
| Vercel + GoDaddy | `docs/OVERTAXED_VERCEL_GODADDY.md` |
| Vercel Preview + Stripe test | `docs/VERCEL_PREVIEW_STRIPE_SETUP.md` |
| Env / Stripe secrets | `docs/OVERTAXED_SECRETS_AND_PRICES.md` |
| Admin set-subscription (testing tiers) | `POST /api/admin/set-subscription` — see [Admin Set-Subscription](#admin-set-subscription-testing) |
| Testing subscriptions & limits | `docs/TESTING_SUBSCRIPTION_AND_LIMITS.md` — reduce test account tier, test property limits |
| Filing on behalf of users | `docs/FILING_ON_BEHALF.md` — options (staff-assisted vs API); why DIY-only today (Cook County API not released) |
| Appeal flow & comps guidance | `docs/APPEAL_FLOW_AND_COMPS.md` — when to select comps; direct to comps first; optional Realie on comps page |
| Realie: when we call; comps list | `docs/EXTERNAL_PROPERTY_DATA_SOURCES.md` — comps list = Cook County only by default; optional Premium Comparables (1–2 calls). See [§28 Realie API](#28-realie-api-comps-list-vs-subjectappeal-premium-comparables). |
| GitHub sync (monorepo → overtaxed-platform) | **Use robocopy** — [Sync to overtaxed-platform Repo](#sync-to-overtaxed-platform-repo-robocopy). Alternative: `SYNC_OVERTAXED.md` (subtree, slower) |

---

## Tech Stack Summary

| Component | Version | Notes |
|-----------|---------|-------|
| Next.js | 16.1.1 | App Router, Turbopack |
| React | 19.2.3 | |
| TypeScript | 5.x | Strict mode |
| Prisma | 7.x | PrismaPg adapter required |
| NextAuth.js | 5.0.0-beta | JWT strategy |
| Tailwind CSS | 4.x | @tailwindcss/postcss |
| Husky | 9.x | New prepare syntax |
| Supabase | PostgreSQL | Connection pooler |

---

## Cook County Tax Rate Integration

### Issue: Tax Bill vs Assessment Value Confusion
**Context:** Initial implementation calculated estimated tax savings incorrectly using Assessment × 2.5%, but Cook County property taxes use a more complex formula.

**Correct Formula:**
```
Tax Bill = (Assessed Value × State Equalizer - Exemptions) × Tax Rate
```

Where:
- **State Equalizer** (2024 final): **3.0355** (Illinois Dept of Revenue). See [2024 Cook County Final Multiplier](https://tax.illinois.gov/research/news/2024-cook-county-final-multiplier.html). Do not use 2.916 (outdated).
- **Tax Rate**: Varies by tax code (6–10%+). Use `tax_code_rate` from dataset (percentage, e.g. 5.525); store as decimal (÷ 100).
- **Exemptions**: Homeowner ($10,000), Senior ($8,000), etc.

**Data Sources:**
| Data | Dataset ID | Source |
|------|------------|--------|
| Tax Rates by Tax Code | `9sqg-vznj` | Cook County Clerk |
| Parcel Tax Code | `tx2p-k2g9` | Parcel Universe (field: `tax_code`) |
| Assessment History | `uzyt-m557` | Assessor - Assessed Values |

**Implementation:**
```typescript
// Correct savings calculation (taxRate as decimal, e.g. 0.05525)
const calcSavings = (reductionPercent: number) => 
  assessedValue * reductionPercent * stateEqualizer * taxRate

// Example: 10% reduction on $57,472 assessment, rate 5.525%, equalizer 3.0355
// $57,472 × 0.10 × 3.0355 × 0.05525 ≈ $960/year
```

**Tax rate dataset (9sqg-vznj):**
- Use **`tax_code_rate`** (total composite rate as %), not sum of `agency_rate`. Store as decimal (÷ 100).
- Dataset has data **through 2013 only**. Query years 2024 down to 2013 until a row is found.
- Parcel tax code: try `tax_code`, `taxcode`, `tax_code_display` (Socrata column names may vary).

**Lesson:** 
- Assessment value is NOT the tax bill — it's ~10% of market value.
- Always multiply assessment reduction by State Equalizer AND Tax Rate.
- Tax rates vary by tax code; use actual rates when available.
- Link to Cook County Treasurer for users to see actual historical tax bills.

---

## Next.js 16 Prerender / useSearchParams

### Issue: "Error occurred prerendering page /appeals/new" on Vercel Build
**Error:** `Export encountered an error on /appeals/new/page: /appeals/new, exiting the build.`

**Context:** Pages that use `useSearchParams()` (e.g. `/appeals/new`, `/auth/signin`) are prerendered at build time. Search params exist only at request time, so Next.js 14+ fails during static generation.

**Solution:** Wrap the page (or a parent route) in a `<Suspense>` boundary. Create a `layout.tsx` in the same route segment that wraps `children` in `<Suspense fallback={...}>`.

**Implemented:**
- `app/appeals/new/layout.tsx` — wraps the "new appeal" page (uses `useSearchParams` for `?propertyId=`)
- `app/auth/signin/layout.tsx` — wraps the sign-in page (uses `useSearchParams` for `?callbackUrl=`)

**Lesson:** Any client component using `useSearchParams()` must be inside a `<Suspense>` boundary; otherwise Vercel (and `next build`) prerender will fail. Use a layout with Suspense when the whole page uses search params.

---

## Vercel + GoDaddy Deployment

### Setup
- **Vercel:** Import **HungryBear3/overtaxed-platform**, add env vars (DB, NextAuth, Stripe keys + price IDs + webhook secret), deploy. Use **pooler** `DATABASE_URL` (port 6543).
- **Custom domain (e.g. overtaxed-il.com):** Add domain in Vercel → Settings → Domains, then add DNS records in GoDaddy (CNAME `www` → `cname.vercel-dns.com`, optional A `@` for root).
- **After DNS propagates:** Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to `https://www.overtaxed-il.com` (or your domain), no trailing slash. Update Stripe webhook URL to the live domain; set `STRIPE_WEBHOOK_SECRET` from that endpoint. Redeploy.

**Reference:** `docs/OVERTAXED_VERCEL_GODADDY.md` (step-by-step), `docs/OVERTAXED_SECRETS_AND_PRICES.md` (env vars, placeholders only — never commit real secrets).

**Lesson:** Use pooler for serverless; point auth and Stripe at the canonical domain; never put secrets in docs or Git.

---

## GitHub Sync (overtaxed-platform vs FreshStart-IL)

### Issue: "GitHub showing last commit 2 hours ago" / Vercel not picking up pushes
**Context:** This repo lives in a **monorepo** (FreshStart-IL / ai-dev-tasks). `git push` updates **FreshStart-IL** only. **Vercel Overtaxed** deploys from **HungryBear3/overtaxed-platform** — a **separate** repo. That repo is updated only when you explicitly sync the `overtaxed-platform` folder into it.

**Use robocopy:** [Sync to overtaxed-platform Repo (Robocopy)](#sync-to-overtaxed-platform-repo-robocopy) — recommended; fast and reliable.

**Alternative (subtree split):** From the **repo root** (folder that **contains** `overtaxed-platform`):

```powershell
cd "C:\Users\alkap\.cursor\FreshStart IL\ai-dev-tasks"
git subtree split --prefix=overtaxed-platform -b overtaxed-export
git push https://github.com/HungryBear3/overtaxed-platform.git overtaxed-export:main
git branch -D overtaxed-export
```

Use **PowerShell** path format; Git Bash uses `/c/Users/...`. If `git subtree split` fails (e.g. "signal pipe" on Windows), use the **manual clone/copy/push** flow in **`SYNC_OVERTAXED.md`** (repo root).

**Lesson:** Pushes from the monorepo do **not** update the overtaxed-platform repo. Run subtree split + push (or manual sync) whenever you want Overtaxed on GitHub and Vercel to reflect latest changes.

---

## Sync to overtaxed-platform Repo (Robocopy)

### Which method to use?
| Method | Use when |
|--------|----------|
| **Robocopy** (this section) | **Default.** After editing `overtaxed-platform/` — fast, copies only changed files. |
| `git subtree split` | Backup or CI; slow (walks full history). See `SYNC_OVERTAXED.md`. |

**Why robocopy?** The monorepo (FreshStart-IL / ai-dev-tasks) contains `overtaxed-platform/`. Vercel deploys from **HungryBear3/overtaxed-platform** — a separate repo. Robocopy syncs the folder into a deploy clone; subtree split is slower and can fail on Windows.

### Preferred Method: robocopy + separate clone
**Context:** `git subtree split` is slow (walks 265+ commits each time). A separate clone + robocopy copies only changed files and pushes in seconds.

### One-time setup
```powershell
cd "c:\Users\alkap\.cursor\FreshStart IL\ai-dev-tasks"
git clone https://github.com/HungryBear3/overtaxed-platform.git overtaxed-platform-deploy
```

### Every sync (after editing code in overtaxed-platform)
```powershell
cd "c:\Users\alkap\.cursor\FreshStart IL\ai-dev-tasks"

# Copy overtaxed-platform into the deploy clone (excludes .git, node_modules, .next, .env.local)
robocopy overtaxed-platform overtaxed-platform-deploy /E /XD .git node_modules .next /XF .env.local /NFL /NDL /NJH /NJS

# Commit and push
cd overtaxed-platform-deploy
git add -A
git status
git commit -m "sync from monorepo"
git push origin main
```

### robocopy flags
| Flag | Purpose |
|------|---------|
| `/E` | Copy subdirectories including empty |
| `/XD .git node_modules .next` | Exclude these directories |
| `/XF .env.local` | Exclude this file |
| `/NFL /NDL /NJH /NJS` | Quiet output (optional) |

### Git identity (if needed)
If commit fails with "Author identity unknown":
```powershell
git config --global user.email "your@email.com"
git config --global user.name "Your Name"
```

### LF/CRLF warnings
When robocopy copies from monorepo (often LF line endings) to the deploy clone on Windows, `git add` may show "LF will be replaced by CRLF" warnings. These are normal and harmless; the commit still succeeds.

**Lesson:** Use robocopy + deploy clone for fast sync. Reserve `git subtree split` for one-off or CI use. Vercel auto-deploys on push to overtaxed-platform main.

**Cross-reference:** `tasks/tasks-overtaxed-platform.md` — "Push to production" section for quick copy-paste commands.

---

## JWT / Stale Subscription Data

### Issue: Dashboard shows old subscription tier after Stripe checkout
**Context:** After completing Stripe checkout, the webhook updates `subscriptionTier` and `subscriptionStatus` in the database. The user's JWT token, however, was created at login and still contains the old values. NextAuth session data comes from the JWT, so the user sees "Free Tier" or "DIY" until they sign out and back in.

**Solution:** Pages that display subscription info (dashboard, account) should fetch fresh user data from the database instead of relying solely on session:

```typescript
// Fetch fresh user data from DB (JWT may have stale subscription info)
const freshUser = await prisma.user.findUnique({
  where: { id: session.user.id },
  select: { subscriptionTier: true, subscriptionStatus: true, ... },
})
const user = { ...session.user, ...freshUser }
```

**Lesson:** JWT tokens cache user data at login. For fields that change via webhooks or background jobs (subscription, role), fetch from DB on critical pages.

---

## Property add – assessment backfill

### Issue: New property shows no assessment value; user must manually refresh
**Context:** For some properties (e.g. condos), the Cook County snapshot returned when adding by PIN has `assessedTotalValue` null or zero, while `assessmentHistory` contains valid prior years. The property was created with null `currentAssessmentValue`, so "Start appeal" was blocked until the user manually ran "Refresh property data."

**Solution:** In `POST /api/properties`, after creating the property and its assessment history, if `currentAssessmentValue` is null or zero but we have assessment history, derive it from the latest non-zero year (same logic as the refresh route) and update the property. The response then reflects the backfilled value so the user can start an appeal without a manual refresh.

**Lesson:** When adding a property, backfill current assessment from history when the snapshot lacks it. Manual refresh remains available for stale data or re-sync.

---

## Comps-to-appeal flow, PDF wrap, and filing UX

### Comps from property page → new appeal (auto-attach)
**Context:** Users expected "Start Appeal with These Comps" to use all shown comps. Previously they landed on the new appeal page and still had to add comps manually.

**Solution:**
- **Property comps page** (`/properties/[id]/comps`): "Start Appeal with These Comps" is a button (not a link) that writes `{ propertyId, comps }` to `sessionStorage` (key: `overtaxed_appeal_comps`) then navigates to `/appeals/new?propertyId=...`. Copy clarifies: "When you start an appeal below, all X comps will be added automatically."
- **New appeal page** (`/appeals/new`): On load, read `sessionStorage`; when the selected property matches the stored `propertyId`, show a green notice ("X comps from the property page will be added to this appeal") and include the comps array in the POST body when creating the appeal. After successful create, clear `sessionStorage`.
- **POST /api/appeals**: Schema accepts optional `comps` array (same shape as POST `/api/appeals/[id]/comps`, max 20). After creating the appeal, create `ComparableProperty` records and connect them to the new appeal (all as `SALES`).

**Lesson:** Use sessionStorage to pass comps across the navigation so the user doesn’t re-select; only attach comps when the selected property matches the stored one.

### PDF appeal summary – text overlap
**Context:** Long lines in the appeal summary PDF were drawn with `drawText(..., { maxWidth })`. pdf-lib wraps visually but we only decremented `y` by a fixed `lineHeight` once, so wrapped lines overlapped. After adding wrapLines, overlap remained because a fixed 14pt line height was smaller than the actual rendered line height (ascender + descender + gap).

**Solution:** (1) Add a `wrapLines(text, font, fontSize)` helper that splits text into words and builds lines that fit within `maxWidth` using `font.widthOfTextAtSize()`. Draw each line with `drawText(line)` (no maxWidth) and decrement `y` per line. (2) **Scale line height by font size:** use `lineHeightFor(fontSize) = max(14, ceil(fontSize * 1.4))` so 11pt→16pt, 13pt→19pt, 16pt→23pt; pass this into both `drawText` and `drawLine`. (3) **Type the font parameter as `PDFFont`:** use `f: PDFFont` in wrapLines (and import `PDFFont` from `pdf-lib`). Do **not** use `ReturnType<typeof doc.embedFont>`, which is `Promise<PDFFont>` — the Vercel build fails with "Property 'widthOfTextAtSize' does not exist on type 'Promise<PDFFont>'".

**Lesson:** When using pdf-lib: wrap manually and advance `y` per line; use a line height that scales with font size (e.g. 1.4×); type font params as `PDFFont`, not the return type of `embedFont`.

### Ready to File vs Mark as Filed
**Context:** Users thought "Ready to File" would submit the appeal. The platform does not submit to the county; users must file at the Cook County Assessor portal. "Mark as Filed" is for updating our status after they’ve filed there.

**Solution:** On the appeal detail page, when status is DRAFT or PENDING_FILING, show an amber "How filing works" box: (1) Ready to File = packet prepared, does not submit; (2) User submits at [Cook County Assessor portal](https://www.cookcountyassessoril.gov/file-appeal); (3) After submitting there, click Mark as Filed here to track status; (4) Explain that we cannot submit on their behalf yet because the Cook County Assessor has not released a public e-filing API, and we will add filing-on-behalf (Starter+) once it is available. New appeal page filing line: same explanation (submit at portal; we cannot file on your behalf yet—no public API; we will add when available).

**Lesson:** Make it explicit that we prepare the packet and they file at the county; "Mark as Filed" is a status update in our app, not the actual filing. Clarify that filing-on-behalf is blocked on the county releasing an API, not on our roadmap only.

---

## Property slot capping and production DB migration

### Slot capping by quantity paid
**Context:** Property limits must reflect the **quantity** the user paid for (e.g. 5 slots on Growth), not just the tier maximum. Annual billing and Stripe subscription quantity must stay in sync.

**Implementation:**
- **User model:** Added `subscriptionQuantity` (Int?), `stripeCustomerId` (String?), `stripeSubscriptionId` (String?).
- **Webhook** (`POST /api/billing/webhook`): On `checkout.session.completed`, set `subscriptionQuantity` from `metadata.propertyCount`, plus Stripe customer/subscription IDs. On `customer.subscription.updated`, read `subscription.items.data[0].quantity` and update `user.subscriptionQuantity`.
- **Limits:** `getPropertyLimit(tier, subscriptionQuantity)` uses `subscriptionQuantity` when set (0 = 0 slots); otherwise tier default. All call sites (dashboard, account, properties API, plan-info) pass the user’s `subscriptionQuantity`.
- **Pricing UI:** Growth/Portfolio use slot indices (e.g. 1–7, 1–11) mapped to property counts for checkout; "Growth Annual" is 3–9 properties.

### Production DB: new User columns
**Issue:** After adding `subscriptionQuantity`, `stripeCustomerId`, `stripeSubscriptionId` to the schema, Vercel build failed on `/admin/users` with **P2022** (column does not exist). Next.js tried to prerender that page, which runs `prisma.user.findMany()` including the new columns.

**Fixes:**
1. **Prerender:** Add `export const dynamic = "force-dynamic"` to `app/admin/users/page.tsx` so the page is not statically generated at build time.
2. **Migration:** Run the migration in production (Supabase). Use `npx prisma db push` from a machine that can reach the DB, or run the SQL from `prisma/migrations/add_user_billing_columns.sql` in the Supabase SQL Editor (add the three columns to `User`).

### Admin set-subscription and null userId
**Issue:** In `POST /api/admin/set-subscription`, the `where` for `prisma.user.findFirst` was `email ? { email } : { id: userId }`. When `userId` was null, Prisma received `{ id: null }`, which is invalid and caused a TypeScript/build error.

**Solution:** Build the `where` object explicitly: if `email` is provided use `{ email }`; else if `userId` is non-null use `{ id: userId }`; otherwise return 400. Never pass `id: null` to Prisma.

**Lesson:** For new billing columns, either force-dynamic any page that selects them until production DB is migrated, or run the migration before deploying. Keep admin `where` clauses strictly non-null for unique fields.

---

## GitHub secret exposure – Stripe webhook signing secret

### Issue: GitHub alerts on exposed secrets
**Context:** GitHub (and secret-scanning tools) may flag commits that contain values that look like real secrets (e.g. `whsec_` followed by 32+ alphanumeric characters). Even placeholder examples in documentation can trigger alerts if they match the pattern.

**What we did:**
- In `docs/STRIPE_SETUP.md`, replaced any `whsec_xxxxxxxx...`-style placeholders with clearly fake placeholders: `whsec_<your-secret>` and `whsec_<paste-value-from-cli>`.
- Added a note: if a webhook secret was ever committed to git, rotate it in Stripe (Developers → Webhooks → recreate or roll the secret), then set the new signing secret in your environment (e.g. Vercel `STRIPE_WEBHOOK_SECRET`) and redeploy.

### If GitHub notifies you of an exposed secret
1. **Rotate immediately:** In Stripe (use the same mode as the exposed secret – test or live), create a new webhook endpoint or use “Roll”/regenerate the signing secret for the existing endpoint.
2. **Update env:** Set the new value in Vercel (and any other env) as `STRIPE_WEBHOOK_SECRET`. Redeploy so the app uses the new secret.
3. **Do not** re-commit the old or new secret in docs or code; keep docs as placeholders only.

**Lesson:** Never commit real webhook (or API) secrets. Use placeholders in docs that don’t match real-secret patterns. If a secret was committed, treat it as compromised and rotate it everywhere.

---

## 20. Stripe: multiple customers per email; serverless DB pool

### Multiple Stripe customer IDs for the same user
**Context:** When a user checks out multiple times (e.g. first Starter for 1 property, then again for a second), Stripe can create **separate customer records** (different `customer_id`) even with the same email and card. Our sync originally looked up only the **first** customer by email (`customers.list({ email, limit: 1 })`), so subscriptions on the second customer were never counted — dashboard showed "1 of 1" instead of 2.

**Solution:**
- **Sync** (`POST /api/billing/sync-subscription`): List **all** customers with that email (`customers.list({ email, limit: 100 })`). For each customer ID, fetch active + trialing + past_due subscriptions and **sum** all line-item quantities. Store a single "primary" customer ID (for the portal link) and one primary subscription ID; the displayed slot count is the sum across all customers.
- **Checkout** (`POST /api/billing/checkout`): When the user already has `stripeCustomerId`, pass `customer: user.stripeCustomerId` instead of `customer_email`. New subscriptions then attach to the **same** customer, so future upgrades don't create more customer IDs and incremental upgrades within a tier work correctly.

**Lesson:** Same email can map to multiple Stripe customers. Sync must aggregate subscriptions across all of them. Checkout should reuse the existing customer when present so users can upgrade incrementally on one customer.

### MaxClientsInSessionMode (Supabase pooler)
**Context:** In production (Vercel), login and other DB-heavy pages failed with `DriverAdapterError: MaxClientsInSessionMode: max clients reached`. Each serverless instance was using a pg `Pool` with `max: 5`; many concurrent requests exhausted the pooler's session limit.

**Solution:** In `lib/db/prisma.ts`, detect serverless (e.g. `process.env.VERCEL` or `AWS_LAMBDA_FUNCTION_NAME`) and set the pool **max to 1** for that environment. Each instance then uses at most one connection; the pooler can serve many more instances without hitting the limit.

**Lesson:** In serverless, keep the Prisma/pg pool size per instance to 1 (or 2 at most) when using a connection pooler in Session mode. Use Transaction mode in Supabase if available for higher concurrency.

---

## 21. Pricing upgrade UX: additional slots and caps

### Growth from Starter: show 1–7 additional, not 1–9
**Context:** When a user is on Starter (2 slots) and upgrades to Growth, the dropdown was offering 1–9 properties. That implies they could buy 9 *additional* on top of 2 = 11 total, which exceeds Growth’s max of 9. Users expect “add 1–7 more” (total 3–9).

**Solution:** On the pricing page, when `subscriptionTier` is STARTER (or null/unknown), for the Growth range “3–9” show only **1–7** options and send **total** = 2 + selected to checkout. Treat `null` tier as Starter so the UI is conservative (1–7) if plan-info hasn’t loaded.

### Webhook must sum all subscriptions
**Context:** After adding one Growth slot (user had 2 Starter), the dashboard showed “2 of 1” because the webhook set `subscriptionQuantity` to only the *new* subscription’s quantity (1), overwriting the previous 2.

**Solution:** In both `checkout.session.completed` and `customer.subscription.updated`, **sum** quantities across all active/trialing/past_due subscriptions for that customer before writing to the DB. Sync already did this; the webhook now does too so the correct total is stored immediately.

### Allow add-more when already on Growth or Portfolio
**Context:** After upgrading to Growth, the user could not add more Growth slots because checkout required `currentTier === "STARTER"` for Growth.

**Solution:** Allow Growth checkout when `currentTier === "STARTER"` (first upgrade) **or** `currentTier === "GROWTH"` (add more). Same for Portfolio: allow when GROWTH (first time) or PORTFOLIO (add more). Update pricing page `requiresStarterFirst` / `requiresGrowthFirstOrFullSlots` so the button is not disabled when already on that tier.

### Cap “add more” by current slots
**Context:** User on Growth with 3 slots could still select “add 9” in the dropdown, implying 12 total (over the 9 cap).

**Solution:** Pass `currentSlots` (e.g. `subscriptionQuantity`) into the quantity options. For Growth when already on Growth: max additional = `9 - currentSlots` (e.g. 3 slots → offer 1–6 only). For Portfolio when already on Portfolio: max additional = `20 - currentSlots`, capped at 11. Same cap in `subscribe()` when sending `propertyCount` so checkout receives a valid total.

**Lesson:** Upgrade flows must distinguish “first-time upgrade” (Starter→Growth: 1–7 additional) from “add more on same tier” (Growth: 1–(9−current) additional). Webhook and UI must use the *sum* of all subscriptions and cap dropdowns by tier max minus current slots.

---

## 22. Starter slots display, add-slots Checkout redirect, charge-only-additional (Growth/Portfolio)

### Starter: show paid slots, not property count
**Context:** User had paid for 1 Starter slot but had 2 properties; UI showed "2/2 slots used" and suggested upgrading to Growth. The first 2 slots are the Starter bucket; display must reflect **paid** slots so "add one more" is clear.

**Solution:** On the Starter card, when `currentTier === "STARTER"` show **paid** slots: `currentSlots/STARTER_SLOTS` (e.g. 1/2 slots used, 1 available). Dropdown: "1 slot (current)" and "2 slots — add 1 more (+$149/yr)" so the choice is "keep current" vs "add 1 more," not "choose 1 or 2" as if both were new. Label: "Keep current or add 1 more slot:". Export `STARTER_SLOTS = 2` from `lib/billing/pricing.ts` for use in checkout and UI.

### Add-slots: use Checkout (not hosted invoice) for redirect
**Context:** When adding a slot (e.g. Starter 1→2, or Growth add-more), we sent the user to Stripe's **hosted invoice page**. That page has no success/cancel URL — after payment the user stayed on Stripe with no "return to site" action.

**Solution:** For add-slots, create a **Stripe Checkout session** with `mode: "payment"` (one-time), same customer, line item for the additional slot(s), and `success_url` / `cancel_url` pointing to the app (e.g. `/account?checkout=success&slots_added=1`, `/pricing?checkout=cancelled`). Webhook: on `checkout.session.completed` with `metadata.addSlots === "true"`, update the existing subscription quantity (and DB) instead of treating it as a new subscription or DIY payment.

### Growth/Portfolio: charge only for additional slots
**Context:** User on Starter with 2 slots selected "Add 1 more" on Growth; UI showed $372/yr and "3 total" because we charged for 3 Growth properties. The first 2 were already paid in Starter.

**Solution:** When **creating** the Stripe subscription for Growth from Starter, set **quantity = propertyCount - STARTER_SLOTS** (e.g. 3 total → 1 Growth slot → $124). User keeps Starter subscription (qty 2) and gets a new Growth subscription (qty 1); webhook sums them so total slots = 3. Same for Portfolio from Growth: **quantity = propertyCount - GROWTH_MAX_PROPERTIES** (e.g. 10 total → 1 Portfolio slot → $99). Pricing page: for Growth from Starter show price as **n × $124** (additional only) and summary "first 2 already in Starter"; for Portfolio from Growth "first 9 in Growth."

**Lesson:** Tier buckets are additive (Starter 2, then Growth 1–7, then Portfolio 1–11). Checkout must charge only for the **new** tier's slots; display and copy must make "already paid" vs "additional" explicit.

---

## 23. Assessment history: $0 / -100% → Not available yet

**Context:** For future tax years (e.g. 2026) the county may return assessed value $0; we computed change as (current − prior)/prior, yielding -100%. Showing "$0" and "-100%" was misleading.

**Solution:** In the assessment history table (appeal detail and property detail), treat any row where **assessment value is 0 or null** as "not available yet": show **"Not available yet"** (gray) for the value column and **"—"** for the change column instead of $0 and -100%.

**Where:** `app/appeals/[id]/page.tsx` and `app/properties/[id]/page.tsx`; condition `unavailable = assessmentValue == null || assessmentValue === 0`.

**Lesson:** When displaying county assessment history, mask placeholder/missing data (e.g. future year not yet assessed) with clear copy instead of raw zeros and misleading percentages.

---

## 24. Pricing dropdown: Add 1 more showing total not additional

**Context:** On the Pricing page, the Portfolio card dropdown showed "Add 1 more (10 total) — $990/yr" instead of $99/yr in two scenarios: (1) **Growth → Portfolio** (user on Growth with 9 properties, adding 1 to reach 10); (2) **Portfolio add-more** (user already on Portfolio with 10 properties, adding 1 more). Checkout correctly charged $99; only the dropdown label was wrong.

**Causes:**
- **Growth → Portfolio:** The option label used `totalPrice` = `getAnnualPrice(PORTFOLIO, count)` (10 × $99 = $990) instead of the **additional** price for the selected quantity (n × $99).
- **Portfolio add-more:** `subscriptionQuantity` from Stripe can be 1 (one Portfolio “slot”) while the user actually has 10 properties. The UI used it as total, so preselection and "X total" were wrong (e.g. "Add 10 more (10 total)" or "Add 1 more (2 total)"); checkout sent wrong `propertyCount` when using `currentSlots + selectedQuantity`.

**Solution:**
- **Growth → Portfolio:** For `plan.id === "PORTFOLIO" && currentTier === "GROWTH"`, show **additional** price only: `n * PORTFOLIO_PRICE_PER_PROPERTY` in the option label (e.g. "Add 1 more (10 total) — $99/yr").
- **Portfolio add-more:** (1) Preselect 1 when `currentTier === "PORTFOLIO"` and `effectiveRange === "10-20"` and `currentCount` is 10–19, so the dropdown defaults to "Add 1 more" at $99. (2) Use **totalProperties** (from `/api/billing/plan-info`) for "X total" in option labels and summary, and for checkout `propertyCount`, so display and API stay correct regardless of `subscriptionQuantity`.

**Where:** `app/pricing/page.tsx` — option label for PORTFOLIO + GROWTH; preselection in `useEffect`; `portfolioTotal = totalProperties + n` for Portfolio options; summary and `subscribe()` use `totalProperties + selectedQuantity` for Portfolio add-more.

**Lesson:** Pricing dropdowns for add-more flows must show **per-additional** cost (n × per-property price), not total tier price. When Stripe quantity doesn’t match “total properties” (e.g. Portfolio slot count), use API `propertyCount` for display and checkout.

---

## 25. Comparison report value-add: Realie, map, similarity line

**Context:** To make the comparison report more valuable for assessors (and align with competitors like SquareDeal.tax), we added: (1) **Similarity line** in the PDF per comp when we have subject vs comp data (same neighborhood, same class, within 20% living area, distance); (2) **Realie free tier** to backfill living area / year built / beds / baths when Cook County Improvement Chars are missing (e.g. some condos); (3) **Map and building images** on the appeal detail page (Google Static Maps + Street View).

**Implementation:**
- **PDF** (`lib/document-generation/appeal-summary.ts`): After each comp's details, add a "Similarity:" line built from subject vs comp (neighborhood match, building class match, living area within ±20%, distance from subject). Applied to both sales and equity comp sections.
- **Realie** (`lib/realie/`): Parcel ID Lookup (state=IL, county=Cook); 25 requests/month (free tier). Used for subject (GET property, appeal, PDF) and for comps **on an appeal** (appeal GET + download-summary). Comps list (property comps page) is Cook County only by default; optional "Include Realie recently sold" uses Premium Comparables Search (see [§28](#28-realie-api-comps-list-vs-subjectappeal-premium-comparables)). Set `REALIE_API_KEY`; see `docs/EXTERNAL_PROPERTY_DATA_SOURCES.md`.
- **Map & Street View:** `GET /api/appeals/[id]/map-data` returns subject + comp lat/lng (via Cook County `getAddressByPIN`); comps array is same length as `compsUsed` (null entry when coords missing). `GET /api/appeals/[id]/map-image` proxies Google Static Maps (subject red "S", comps blue "1","2",…). `GET /api/map/streetview?lat=&lng=&size=` proxies Google Street View Static. Appeal detail page shows map section and Street View thumbnails for subject and each comp when coords exist. Set `GOOGLE_MAPS_API_KEY` and enable Maps Static API + Street View Static API in Google Cloud Console.

**Lesson:** Optional env vars (`REALIE_API_KEY`, `GOOGLE_MAPS_API_KEY`) keep the app working without them; map/Street View and Realie enrichment are additive. Map-data comps array must match appeal comp order (one entry per comp, null when coords unavailable) so UI can index by comp index for thumbnails.

---

## 26. PDF summary: enriched comps, table layout, map & photos in PDF

**Context:** The appeal summary PDF was not reflecting the same comp (and subject) data as the app (enriched living area, $/sq ft, distance, beds/baths), and the Subject vs Comparables table had PINs overlapping adjacent columns. Map and property pictures (Street View) did not appear in the PDF.

**Implementation:**
- **Enriched comps in PDF:** In `GET /api/appeals/[id]/download-summary`, comps are now built the same way as GET appeal: Realie enrichment (up to 8 comps with missing livingArea/beds/baths) and on-the-fly distance (subject + comp coords via `getAddressByPIN`, then `haversineMiles`). The same `subjectLat`/`subjectLon` and `compCoordsList` are reused for map/Street View image fetching.
- **Subject vs Comparables table:** In `lib/document-generation/appeal-summary.ts`, column X positions were widened (e.g. first column 50→158) so the Property/PIN column fits formatted PINs (e.g. 14-08-211-050-1001). Subject row first cell shows "Subject" only (PIN is in the property block above). `drawTableRow` allows a longer first column (22 chars) via optional `firstColMax` so full PINs are not truncated into the next column.
- **Map & property photos in PDF:** When `GOOGLE_MAPS_API_KEY` is set, download-summary fetches: (1) Google Static Map PNG (same center/zoom/markers as map-image API); (2) subject Street View JPEG (280×186); (3) up to 6 comp Street View JPEGs (120×90). These are passed as optional `mapImagePng`, `subjectStreetViewJpeg`, `compStreetViewJpegs` on `AppealSummaryData`. The PDF generator adds a "Map & Property Photos" section after the Subject vs Comparables table: static map scaled to page width, then "Subject property" image, then "Comparable properties" grid (3 per row, "Comp 1" … labels). New pages are added when y runs low. Requires Maps Static API and Street View Static API enabled in Google Cloud Console.

**Where:** `app/api/appeals/[id]/download-summary/route.ts`, `lib/document-generation/appeal-summary.ts` (interface, table colXs, drawTableRow firstColMax, Map & Property Photos section with embedPng/embedJpg).

**Lesson:** Keep PDF data source aligned with the app (same enrichment in download-summary as in GET appeal). Use fixed column positions and per-column character limits for table layout. Embed map and Street View only when the API key is present so the PDF still generates without them.

---

## 27. Local network permission prompt (overtaxed-il)

**Context:** Users saw a system prompt that "overtaxed-il wants to look for and connect to any device on your local network." This is a browser/OS permission (e.g. macOS/iOS) triggered when the site makes requests to localhost or the local network.

**Cause:** The app contained **debug ingest** code that sent `fetch()` requests to `http://127.0.0.1:7242/ingest/...` from both the client (appeal detail page map-data) and from API routes (map-image, streetview, map-data, appeal-summary PDF). When the browser sees requests to 127.0.0.1, it can treat that as "local network" and prompt for permission.

**Solution:** Remove all `fetch('http://127.0.0.1:7242/...')` calls and the `DEBUG_LOG` helper that used them. They were leftover from a one-off experiment and are not needed in production. If you need local logging in development, use a build-time or env guard so it never runs in production or in client code that triggers the permission.

**Lesson:** Do not ship client-side or server-side code that fetches to localhost (e.g. 127.0.0.1) in production; it can trigger "local network" permission prompts and confuse users.

---

## 28. Realie API: comps list vs subject/appeal; Premium Comparables

**Context:** Realie free tier is 25 requests/month. We need rich data for the subject and for comps used in the appeal/PDF, but we must limit calls. The Parcel ID Lookup (subject property) response does **not** include a "Recently Sold Comparables" list; that list in Realie's own tool comes from a **separate** endpoint (Premium Comparables Search, which takes lat/lng and returns many comps in one call).

**Decisions:**
- **Comps list (property comps page):** Cook County Open Data only by default — **0 Realie calls** when loading the page. Optional "Also include Realie recently sold comparables" uses 1–2 calls (subject location from `getFullPropertyByPin`, then **Premium Comparables Search** with that lat/lng). See `GET /api/properties/[id]/comps?includeRealieComps=1`.
- **Subject:** Realie used when viewing a property, an appeal, or generating the PDF (1 call per subject, cached in DB).
- **Comps on an appeal:** Realie enrichment only for comps **already attached to that appeal** (appeal GET + download-summary), capped at comp count (max 15). Not for the full comp picker list.
- **Premium Comparables:** `lib/realie/client.ts` — `getComparablesByLocation(lat, lng, options?)` calls Realie's `/api/public/premium/comparables`; one API call returns up to 15–50 recently sold comps with address, sq ft, beds/baths, sale price, $/sq ft.

**Lesson:** To stay within quota, use Realie only for subject + appeal comps (and optional Premium Comparables when the user opts in). Parcel ID Lookup does not include comparables; use Premium Comparables Search for "Recently Sold Comparables." See `docs/EXTERNAL_PROPERTY_DATA_SOURCES.md`.

---

## 29. Sign-out, paywalls, admin build, DB timeouts

### Sign-out button broken (Link vs signOut)
**Context:** A sign-out link using `<Link href="/api/auth/signout">` did not reliably sign the user out; Auth.js session/cookie handling expects the client to call `signOut()`.

**Solution:** Use Auth.js client `signOut({ redirectTo: "/auth/signin" })` from `next-auth/react`. Create a `SignOutButton` component that calls `signOut()`; use it in header, account page, and delete-account section instead of a Link. See `components/auth/SignOutButton.tsx`.

**Lesson:** For Auth.js (NextAuth) v5, use the client `signOut()` function rather than linking to the signout API route.

### Report and Realie paywalls
**Context:** Unpaid users (COMPS_ONLY without DIY purchase) could download PDF appeal summaries and use Realie comps. PDF download and Realie enrichment are premium features.

**Solution:** (1) **PDF download:** In `GET /api/appeals/[id]/download-summary`, check payment before generating; return 403 if unpaid. Appeal page shows paywall UI when `!canDownloadReport`. (2) **Realie comps:** In `GET /api/properties/[id]/comps?includeRealieComps=1`, return 403 for unpaid users. AddCompsDialog and property comps page use `canUseRealieComps` from plan-info; show paywall message when false. DIY ($69) or Starter+ unlocks both.

### DIY checkout and slots
**Context:** DIY/comps-only users needed clear UX: pay $69 for one property slot, see "Pick a property & get comps" only when paid; repeat DIY purchases should add slots.

**Solution:** `hasPaidForDiy` in plan-info; pricing page always shows DIY checkout; when paid, also shows "Pick a property & get comps." Webhook on `checkout.session.completed` with `metadata.plan === "COMPS_ONLY"` increments `subscriptionQuantity` for additional DIY purchases. DIY card disclaimer: "PIN monitoring and deadline notifications are not included. Those features are available on Starter and above."

### New-user slots copy
**Context:** COMPS_ONLY users with 0 properties saw "0 of 1 used," which felt confusing for first-time users.

**Solution:** For COMPS_ONLY, 0 properties, no subscriptionQuantity → show "Add your first property" and "1 free property included" instead of "0 of 1 used." ManagedPropertiesList uses `isNewFreeUser` prop for this copy.

### Admin build failing (prerender + DB)
**Context:** Admin pages (`/admin`, `/admin/appeals`) prerendered at Vercel build time and ran `prisma.user.findMany()` etc., causing build failures when DB was unreachable or schema mismatched.

**Solution:** Add `export const dynamic = "force-dynamic"` to admin page components so they are not statically generated.

### DB connection ETIMEDOUT (Supabase slow)
**Context:** Dashboard and sign-in sometimes failed with `PrismaClientKnownRequestError: ETIMEDOUT` during `prisma.user.findUnique()`. Supabase can be slow to respond, especially when paused (free tier) or under load.

**Solution:** (1) In `lib/db/prisma.ts`, append `connect_timeout=60` to the connection string (pg/libpq respects this for the TCP connect phase). (2) Keep `connectionTimeoutMillis: 60_000` for the pg Pool. (3) Use Supabase **pooler** (port 6543, `?pgbouncer=true`) in `DATABASE_URL` for Vercel. (4) If Supabase is slow, ETIMEDOUT may persist despite our timeouts—check status.supabase.com, ensure project is not paused, consider same-region Vercel + Supabase.

**Lesson:** ETIMEDOUT during DB calls can be Supabase-side (their system, cold starts, pauses). Our timeouts give more headroom; if issues persist, the bottleneck is often external.

---

## 30. Contact form, visitor counter, legal pages

### Contact form
**Context:** Users need a way to reach support (support@overtaxed-il.com) for questions, refunds, or technical issues.

**Implementation:** `app/contact/page.tsx` with `ContactForm` component; `POST /api/contact` sends to support and confirmation to user via `sendContactEmail` in `lib/email/send.ts`. Rate-limited (5 req/15 min). Categories: general, appeal-question, technical, billing, refund, other. **Vercel:** Set `SUPPORT_EMAIL` in Vercel env vars (Production) — defaults to support@overtaxed-il.com if not set.

### Visitor counter
**Context:** Track unique visitors without cookies (session-based, privacy-friendly). Per newstart-il LESSONS_LEARNED §1013: use `sessionStorage.getItem('visitor_tracked')` to count once per session.

**Implementation:** `VisitorCount` model in Prisma (date, count); `GET/POST /api/visitors`; `VisitorCounter` component. Client POSTs on first load if not tracked; GET fetches total and today. Graceful degradation: returns 0 if DB unavailable. **Migration:** Run `npx prisma db push` from `overtaxed-platform/` when Supabase is reachable (or create `visitor_counts` via Supabase SQL Editor). Until the table exists in production, the API returns 0; page still renders. Add to `prisma/enable_rls.sql` when enabling RLS.

### Legal pages
- **Terms:** `/terms` — 30-day refund policy (§6a), authorization, liability, contact.
- **Privacy:** `/privacy` — data collection, use, sharing, retention, rights, support@overtaxed-il.com.
- **Disclaimer:** `/disclaimer` — not legal/tax advice, no guarantee of results, Cook County only.
- **FAQ:** `/faq` — PIN, deadlines, DIY vs full automation, comps, filing, refunds.

### Footer links
Landing page and app footer include Contact, FAQ, Terms, Privacy, Disclaimer, and VisitorCounter (showToday).

---

## Stripe Webhook Debugging

### Issue: Subscription doesn't update after checkout
**Context:** User completes Stripe checkout but dashboard still shows old tier. The webhook should update the user record on `checkout.session.completed`.

**Checklist:**
1. **Vercel logs:** Deployments → select deploy → Logs. Search for `[webhook]`. Look for "Event verified", "Processing checkout.session.completed", "SUCCESS", or errors.
2. **Stripe Dashboard → Webhooks:** Verify the endpoint URL (Production: `https://www.overtaxed-il.com/api/billing/webhook`). Check that `checkout.session.completed` is enabled. View event history for failed/succeeded delivery.
3. **Webhook secret:** `STRIPE_WEBHOOK_SECRET` in Vercel must match the signing secret from the *correct* webhook endpoint (live vs test).
4. **Metadata:** Checkout session must include `metadata.userId` and `metadata.plan`. The checkout API route sets these; verify they're present in Stripe's event payload.

**Lesson:** Live and test Stripe use different webhook endpoints and secrets. Ensure Production env vars point to live webhook secret.

---

## Vercel Preview + Stripe Test Mode

### Issue: Can't use test cards in production
**Context:** Stripe blocks test card numbers (4242...) when using live API keys. You need a way to test checkout without real charges.

**Solution:** Use Vercel's **Preview** environment. Preview deploys (from branches other than `main`, or from PRs) use Preview env vars. Set Stripe *test* keys for Preview:

| Variable | Production | Preview |
|----------|------------|---------|
| `STRIPE_SECRET_KEY` | `sk_live_...` | `sk_test_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` | `pk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Live webhook secret | Test webhook secret |
| `STRIPE_PRICE_STARTER` | Live price ID | Test price ID |
| `STRIPE_PRICE_GROWTH_PER_PROPERTY` | Live price ID | Test price ID |
| `STRIPE_PRICE_PORTFOLIO_PER_PROPERTY` | Live price ID | Test price ID |
| `STRIPE_PRICE_COMPS_ONLY` | Live price ID | Test price ID |

**Setup steps:** See [Vercel Preview setup](#vercel-preview-setup) below or `docs/VERCEL_PREVIEW_STRIPE_SETUP.md` for a full step-by-step guide.

**Stripe test webhook:** Create a separate webhook in Stripe (test mode) pointing to your Preview URL, e.g. `https://overtaxed-platform-xxx-username.vercel.app/api/billing/webhook`. Preview URLs change per branch; you may need to update the webhook URL when testing different branches, or use a stable Preview URL if available.

**Lesson:** Use Preview env for full checkout testing with test cards. Production stays on live Stripe.

---

## Vercel Preview Setup

1. **Vercel Dashboard** → overtaxed-platform → **Settings** → **Environment Variables**
2. For each Stripe-related variable, add a **second** row:
   - Click **Add New**
   - Same **Name** (e.g. `STRIPE_SECRET_KEY`)
   - **Value:** test key / test price ID
   - **Environments:** Select **Preview** only (uncheck Production, Development)
   - Save
3. **Repeat** for: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH_PER_PROPERTY`, `STRIPE_PRICE_PORTFOLIO_PER_PROPERTY`, `STRIPE_PRICE_COMPS_ONLY`
4. **Create Preview deploy:** Push to a branch (e.g. `develop`) or open a PR. Vercel will deploy a Preview; use that URL for testing.
5. **Stripe test webhook:** In Stripe (test mode) → Developers → Webhooks → Add endpoint. URL = `https://your-preview-url.vercel.app/api/billing/webhook`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` for Preview. If Preview URL changes per deploy, update the webhook URL in Stripe or use a custom Preview domain.

---

## Admin Set-Subscription (Testing)

### Purpose
Set a user's subscription tier without going through Stripe. Useful for testing different tiers (Starter, Growth, Portfolio) and property limits without live card charges.

### Endpoint
`POST /api/admin/set-subscription`

### Auth
- Header: `x-admin-secret: YOUR_ADMIN_SECRET` (set `ADMIN_SECRET` in Vercel env vars), **or**
- Logged in as user with `role: "ADMIN"`

### Body
```json
{
  "email": "user@example.com",
  "subscriptionTier": "STARTER",
  "subscriptionStatus": "ACTIVE"
}
```
Tiers: `COMPS_ONLY`, `STARTER`, `GROWTH`, `PORTFOLIO`, `PERFORMANCE`.  
Status: `INACTIVE`, `ACTIVE`, `PAST_DUE`, `CANCELLED`.

### Example (curl)
```bash
curl -X POST https://www.overtaxed-il.com/api/admin/set-subscription \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: your-secret" \
  -d '{"email": "al@example.com", "subscriptionTier": "STARTER", "subscriptionStatus": "ACTIVE"}'
```

### GET (list users / get one)
```bash
# All users
curl -H "x-admin-secret: your-secret" "https://www.overtaxed-il.com/api/admin/set-subscription"

# One user
curl -H "x-admin-secret: your-secret" "https://www.overtaxed-il.com/api/admin/set-subscription?email=al@example.com"
```

**Lesson:** Add `ADMIN_SECRET` to Vercel (any random string). Use this endpoint to test tiers without Stripe. Keep the secret private.

---

## Stripe Test Cards in Live Mode

**Fact:** Stripe intentionally blocks test card numbers (e.g. 4242 4242 4242 4242) when your app uses **live** API keys. This is by design.

**Options for testing without real charges:**
1. **Vercel Preview + test Stripe keys** — Use Preview environment with test keys; test cards work there.
2. **Admin set-subscription endpoint** — Set tier directly; no checkout needed for tier/limit testing.
3. **Real card + refund** — Small processing fee; use for final production verification only.

---

**Last Updated:** February 2026

**Feb 2026:** §30 — Contact form (SUPPORT_EMAIL in Vercel); visitor counter (session-based, graceful degradation); legal pages (Terms w/ 30-day refund, Privacy, Disclaimer, FAQ); footer links. Deployed via robocopy → overtaxed-platform-deploy. Verify deployment in Vercel Dashboard; run `npx prisma db push` for visitor_counts when DB reachable. §27 — Local network permission fix (removed 127.0.0.1 ingest). §28 — Realie API: comps list = Cook County only by default; optional Premium Comparables (1–2 calls); Parcel ID Lookup does not include comparables. Filing copy updated (Cook County API not released). Appeal flow: direct to comps first (property + new appeal tips); comps page data source + "how to choose comps"; docs/APPEAL_FLOW_AND_COMPS.md.

**Jan 2026:** §26 — PDF summary: enriched comps in download-summary, Subject vs Comparables table layout (PIN overlap fix), map & Street View embedded in PDF when GOOGLE_MAPS_API_KEY set. §25 — Comparison report value-add (Realie, map, Street View, PDF similarity line).
