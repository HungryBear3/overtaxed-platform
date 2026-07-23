# OT HOA Attribution Audit — Property-Manager Pilot

**Date:** 2026-07-23
**Repo:** `/Users/abigailclaw/overtaxed-platform`
**Branch:** `cc/hoa-utm-attribution-20260723`
**Scope:** Minimal revenue-measurement audit of whether the pilot campaign URL preserves usable UTM attribution from `/hoa` through `/check`, lead creation, and the paid-service handoff. Not a CRM/dashboard build.

**Exact campaign URL audited:**
```
https://www.overtaxed-il.com/hoa?utm_source=property_manager&utm_medium=email&utm_campaign=hoa_resident_resource_20260723
```

**Method:** static code tracing + jsdom regression tests + a clean-worktree local compile/build attempt. No live sends, no production deploy, no production DB / customer records / Stripe / credentials. Abigail's email/SMS follow-up path (`FreeCheckResult` → `/api/township-alert` → `sendFreeCheckFollowup`) was **not** modified.

---

## Verdict summary (per measurable stage)

| Stage | Before this branch | After this branch | Evidence |
|---|---|---|---|
| Landing visit (`/hoa?utm_...`) | **BLOCKED** (client) / partial (Vercel prod only) | **PASS** (first-touch capture) | `components/analytics/analytics-provider.tsx` unmounted; new `components/analytics/utm-first-touch.tsx` |
| HOA resource interaction (copy / download / outbound click) | **BLOCKED** | **BLOCKED** (unchanged; out of minimal scope) | `app/hoa/hoa-client.tsx:61,109,211` fire `trackEvent`, but `gtag` is never loaded |
| Free-check start / completion | **BLOCKED** | **PARTIAL** — attribution now *readable*, not yet *recorded* | `components/check/FreeCheckForm.tsx` → `POST /api/free-check` sends only `{pin,address,city}` |
| Lead creation | **BLOCKED** | **BLOCKED** (server-side recording deferred) | `app/api/leads/capture/route.ts`, `app/api/township-alert/route.ts` store no UTM |
| Paid conversion (Stripe) | **BLOCKED** for UTM | **BLOCKED** for UTM (deferred) | `app/api/billing/checkout/route.ts` metadata carries `ot_ref` cookie, no UTM |

**Bottom line:** attribution was broken at *every* stage — not by param stripping, but because the capture layer is unmounted and the funnel never reads or records UTM. This branch fixes the **foundational** break (capture + durable client-side preservation of the exact campaign source through the funnel) with the smallest safe, preview-safe change. Server-side recording into leads/Stripe is deliberately deferred (see Recommendations) because it needs a DB migration and overlaps Abigail's lead path.

---

## What was traced (findings with file:line)

### 1. Capture layer exists but is unmounted (dead code)
- `lib/analytics/utm-tracking.ts:18-40` `captureUTMParams()` reads `window.location.search` and persists `utm_source/medium/campaign/term/content` to `localStorage` (`utm_params`, 30-day expiry).
- Its only caller is `components/analytics/analytics-provider.tsx:27`, and **`AnalyticsProvider` is mounted nowhere** — it is not referenced in `app/` (root `app/layout.tsx` mounts only `ReferralCapture` and Vercel `<Analytics/>`, both production-gated). Result: `captureUTMParams()` never runs, and because no GA `gtag` script is mounted, every `trackEvent()`/`analytics.*` call in `lib/analytics/events.ts` is a no-op (`events.ts:11` guards on `window.gtag`).
- Latent bug: `captureUTMParams()` **overwrites** storage on every call (`utm-tracking.ts:30-33`). Mounted naively app-wide it would clobber the campaign source at the first internal navigation (see #2).

### 2. `/hoa` on-page links overwrite the inbound UTM (by design)
- `app/hoa/hoa-client.tsx:36-44` `buildHref()` builds `/check` and `/deadlines` links with **new** internal params `utm_source=hoa&utm_medium=internal&utm_campaign=hoa_resident_notice_2026`. The resident-notice links (`hoa-client.tsx:157-164` `noticeUrl()`) use `utm_source=hoa_notice&utm_medium=email`.
- This is intentional second-hop tagging, **not** a bug to change — but it means the manager's own click-through drops `utm_source=property_manager` unless first-touch capture holds it.

### 3. `/deadlines` and `/check` never read UTM
- `app/deadlines/page.tsx` and its client tree don't read `searchParams`; its onward CTA goes to `/#hero-check` (drops params).
- `app/check/page.tsx`, `components/check/FreeCheckFormWrapper.tsx`, `components/check/FreeCheckForm.tsx` don't read `searchParams`; the free-check `POST /api/free-check` body is `{pin,address,city}` only; `app/api/free-check/route.ts` ignores UTM.

### 4. Lead creation and email capture store no UTM
- `app/api/leads/capture/route.ts` persists only `email, address, potentialSavings` (`OTLead` model has no attribution fields).
- Free-check email capture posts to `app/api/township-alert/route.ts` with no UTM. **(Abigail's follow-up path — untouched.)**
- Only `lib/analytics/events.ts:27-31` (`analytics.signUp`) attaches stored UTM, and it is never called in this funnel.

### 5. Paid handoff carries referral, not UTM
- `app/api/billing/checkout/route.ts` Stripe metadata includes `referralCode` from the `ot_ref` cookie (`components/ReferralCapture.tsx` handles only `?ref=`), plus `userId/plan/propertyCount`. No UTM. `app/api/checkout/session/route.ts` metadata has no UTM. `OTOrder` has no attribution fields.

### 6. Middleware is safe
- `middleware.ts` only inspects `pathname` for auth and appends `callbackUrl`; it never strips or rewrites query strings, so UTM reaches the browser intact.

---

## Change made (smallest safe patch)

Goal: preserve `utm_source`/`utm_medium`/`utm_campaign` through the funnel. The mechanism already existed but was unmounted; activating it naively would clobber first-touch. So:

1. `lib/analytics/utm-tracking.ts` — added `captureFirstTouchUTM()`: persists campaign UTM only when nothing valid is already stored, so a later internal-UTM navigation (`utm_source=hoa`) cannot overwrite the original `property_manager` source. `localStorage` only — no cookies or network calls. The implementation does not intentionally collect PII, but UTM query values are stored verbatim and therefore must not contain PII.
2. `components/analytics/utm-first-touch.tsx` — new null-rendering client component calling it on mount.
3. `app/layout.tsx` — mounted `<UtmFirstTouchCapture/>` app-wide (ungated, since it has no external side effect). App-wide is required because resident-notice traffic lands directly on `/check` / `/deadlines`, not `/hoa`.
4. `lib/analytics/index.ts` — re-export the new function.

**Effect:** the campaign's three UTM values are captured on the landing visit and remain readable via `getStoredUTMParams()` / `getAttributionData()` across the whole funnel (30-day window), regardless of the internal link re-tagging.

**Explicitly NOT changed:** GA/Meta mounting, `/hoa` link tagging (intentional), any lead/`township-alert`/Stripe/DB code, or Abigail's follow-up path.

---

## Recommendations (deferred — need Alexy's approval; do not overlap Abigail)

1. **Record attribution server-side** at lead creation: attach `getStoredUTMParams()` to the `/api/free-check` / `/api/township-alert` / `/api/leads/capture` payloads and add nullable `utmSource/utmMedium/utmCampaign` columns. Requires a Prisma migration (production DB) — out of scope here.
2. **Carry attribution into Stripe metadata** on checkout so paid conversions are attributable end-to-end.
3. **Optionally mount GA4** (`GoogleAnalytics` + `AnalyticsProvider`) so the existing `hoa_notice_copy` / `hoa_resource_download` / `hoa_outbound_click` events actually fire; today they no-op.

For the 3-target pilot, item 1 is the highest-value next step to make free-check leads attributable to the `property_manager` campaign.

---

## Test & build output

**New regression suite** — `__tests__/attribution/utm-first-touch-preservation.test.tsx`:
```
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```
Covers: exact campaign URL captured on landing; first-touch preserved when a later `/hoa` internal link re-tags traffic; documents that plain `captureUTMParams()` would clobber (why the new fn exists); no-UTM URL stores nothing; component captures on mount and renders nothing.

**Relevant clean-worktree regression suites** — new attribution suite plus `hoa-page-stance`, `v2/marketing-unification`, `v2/home-free-check-flow`, `v2/preview-side-effects`, and `smoke`:
```
Test Suites: 6 passed, 6 total
Tests:       154 passed, 154 total
```
The previously reported `p0-traffic-safety` suite was present only as unrelated untracked WIP in the main dirty worktree and is not part of this commit, so it is not counted here.

**Clean-worktree build attempt** — `next build`:
```
✓ Compiled successfully
Build then stopped during unrelated /admin/appeals prerender: database credentials were intentionally unavailable in the isolated review worktree.
```
The clean review did not use production credentials, access the production database, or reproduce the earlier `187/187`/exit-0 claim. The scoped UTM files compile successfully; full prerender remains environment-unverified from the clean commit. `next.config.mjs` also sets `typescript.ignoreBuildErrors: true`, so this is not a standalone type-check claim.

**Preview URL:** none. No preview deployment was invoked. The change was validated via jsdom tests and the clean-worktree compile/build attempt described above; full credential-free prerender did not complete.
