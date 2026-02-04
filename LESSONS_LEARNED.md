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
| Filing on behalf of users | `docs/FILING_ON_BEHALF.md` — options (staff-assisted vs API); why DIY-only today |
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

**Solution:** On the appeal detail page, when status is DRAFT or PENDING_FILING, show an amber "How filing works" box: (1) Ready to File = packet prepared, does not submit; (2) User submits at [Cook County Assessor portal](https://www.cookcountyassessoril.gov/file-appeal); (3) After submitting there, click Mark as Filed here to track status; (4) "Filing on your behalf (Starter+) is coming soon." New appeal page step 3 copy updated to: "Submit at the Cook County Assessor portal (we'll link you). Filing on your behalf (Starter+) is coming soon."

**Lesson:** Make it explicit that we prepare the packet and they file at the county; "Mark as Filed" is a status update in our app, not the actual filing.

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
