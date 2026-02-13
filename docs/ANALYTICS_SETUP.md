# Analytics Setup (GA4, Google Ads, Meta Pixel)

Analytics tracking for OverTaxed follows the same pattern as newstart-il (FreshStart). See `../newstart-il/LESSONS_LEARNED.md` for full lessons.

## Environment Variables (Vercel)

| Variable | Format | Source |
|----------|--------|--------|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `G-XXXXXXXXXX` | Google Analytics 4 → Admin → Data Streams |
| `NEXT_PUBLIC_GOOGLE_ADS_ID` | `AW-XXXXXXXXX` | Google Ads → Tools → Conversions |
| `NEXT_PUBLIC_META_PIXEL_ID` | Numeric | Meta Business → Events Manager → Data Sources |

All are optional. If none are set, analytics components render nothing.

## Implementation

- **AnalyticsProvider** wraps the app in `app/layout.tsx`; loads GA4, Google Ads, and Meta Pixel when IDs are set
- **UTM capture:** Automatic on page load; stored in localStorage for attribution
- **Page views:** Tracked on client-side navigation via `usePathname` / `useSearchParams`
- **Events:** `lib/analytics/events.ts` — signUp, login, propertyAdded, appealStarted, appealFiled, checkoutStarted, subscriptionComplete, diyPurchase, pdfDownload, contactFormSubmit
- **CheckoutSuccessTracker:** In account layout; fires purchase events when `?checkout=success` or `?checkout=diy_success`

## Troubleshooting: "Your Google tag wasn't detected" (GA4)

**Cause:** `NEXT_PUBLIC_*` variables are **replaced at build time**, not at runtime. If you add or change env vars in Vercel but don't redeploy, the built app still has the old (empty) values.

**Fix:**
1. **Redeploy** after adding/changing env vars: Vercel → Deployments → ⋮ on latest → **Redeploy**
2. Or push a new commit to trigger a fresh build
3. Verify variable names exactly: `NEXT_PUBLIC_GA_MEASUREMENT_ID` (case-sensitive)
4. Confirm the var is set for **Production** environment

See `../newstart-il/LESSONS_LEARNED.md` § "Analytics Setup and Tracking Prevention Issues" for full details (env vars, ad blockers, verification methods).

## Best Practices (from newstart-il)

1. Load gtag.js with **GA4** measurement ID; configure Google Ads via `gtag('config')`, not as script source
2. **Redeploy** after adding/changing `NEXT_PUBLIC_*` vars (build-time replacement)
3. **Test:** Disable ad blockers; check `window.gtag`, `window.dataLayer` in console; GA4 Realtime view
4. Some users block tracking — expected; tags work for majority without blockers

## Files

- `components/analytics/google-analytics.tsx`
- `components/analytics/meta-pixel.tsx`
- `components/analytics/analytics-provider.tsx`
- `components/analytics/checkout-success-tracker.tsx`
- `lib/analytics/events.ts`
- `lib/analytics/utm-tracking.ts`
