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
| Env / Stripe secrets | `docs/OVERTAXED_SECRETS_AND_PRICES.md` |
| GitHub sync (monorepo → overtaxed-platform) | `SYNC_OVERTAXED.md` (repo root) |

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
**Context:** This repo lives in a **monorepo** (FreshStart-IL / ai-dev-tasks). `git push` updates **FreshStart-IL** only. **Vercel Overtaxed** deploys from **HungryBear3/overtaxed-platform** — a **separate** repo created via `git subtree split`. That repo is updated only when you explicitly sync the `overtaxed-platform` folder into it.

**Solution:** From the **repo root** (folder that **contains** `overtaxed-platform`):

```powershell
cd "C:\Users\alkap\.cursor\FreshStart IL\ai-dev-tasks"
git subtree split --prefix=overtaxed-platform -b overtaxed-export
git push https://github.com/HungryBear3/overtaxed-platform.git overtaxed-export:main
git branch -D overtaxed-export
```

Use **PowerShell** path format; Git Bash uses `/c/Users/...`. If `git subtree split` fails (e.g. "signal pipe" on Windows), use the **manual clone/copy/push** flow in **`SYNC_OVERTAXED.md`** (repo root).

**Lesson:** Pushes from the monorepo do **not** update the overtaxed-platform repo. Run subtree split + push (or manual sync) whenever you want Overtaxed on GitHub and Vercel to reflect latest changes.

---

**Last Updated:** January 29, 2026
