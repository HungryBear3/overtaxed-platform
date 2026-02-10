# External Property Data & Photos (MLS, Zillow, Redfin)

This doc covers how we get property data today and options for MLS, Zillow, Redfin, and similar sources.

## Current Source: Cook County Open Data

- **Property details & living area:** [Single-Family](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Single-Family-Improvement-Characteristics/bcnq-qi2z) and [Multi-Family Improvement Characteristics](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Multi-Family-Improvement-Characteristics/n6jx-6jqg) (e.g. `bldg_sf` = living area). Not all PINs have a record (e.g. some condos); we show “—” when missing.
- **Sales comps:** [Assessor – Parcel Sales](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Parcel-Sales/wvhk-k5uv). We enrich each comp with living area (and year built, beds/baths) from Improvement Characteristics by PIN so “similar property” (same neighborhood, class, and similar size) is better supported.
- **Assessment history, values, parcel address:** Assessed Values, Parcel Universe, etc. via the same Cook County Data Portal.

No photos or listing data from Cook County.

---

## Ensuring Similar Property for Comps

1. **Same neighborhood & building class** — We filter comps by `nbhd` and `class` when available.
2. **Living area** — We now:
   - Store and show subject `livingArea` from Improvement Chars (and fallbacks).
   - Enrich each **sales comp** with living area (and year built, beds/baths) by looking up that comp’s PIN in Single- and Multi-Family Improvement Characteristics, so the comps list and appeal summary show sq ft and you can pick similar-sized properties.
3. **Distance** — We can compute distance from subject when we have lat/lon (e.g. from Parcel Universe). Showing “distance from subject” in the comp list and PDF helps assessors see proximity.
4. **Rule 15** — Our PDF and UI guidance stress same neighborhood, same class, similar size, no cherry-picking, and PINs for verification.

If living area still doesn’t show for the **subject** property, that usually means the PIN has no row in Single- or Multi-Family Improvement Characteristics (e.g. some condos or special classes). Refreshing or re-adding the property won’t add it unless Cook County adds that PIN to those datasets. We can backfill from **Realie** (see below) when those fields are missing.

---

## Realie Property Data API (enrichment fallback)

We use [Realie](https://www.realie.ai) as an optional enrichment source when Cook County Improvement Characteristics are missing for a PIN.

- **When we call:** (a) **Subject property** — when `livingArea`, `yearBuilt`, `bedrooms`, or `bathrooms` are null (e.g. GET property by id); (b) **Comps** — when loading comparable sales, any comp with missing chars may be enriched before display (capped per request to preserve quota).
- **Endpoint:** Parcel ID Lookup (`GET /api/public/property/parcelId`) with `state=IL`, `county=Cook`, `parcelId=<PIN digits>`.
- **Fields we use:** `buildingArea` → living area, `yearBuilt`, `totalBedrooms`, `totalBathrooms`.
- **Free tier:** 25 API requests per calendar month. We cache responses by PIN in memory and enforce the monthly limit; once the limit is reached, we skip Realie until the next month.
- **Config:** Set `REALIE_API_KEY` in the environment to enable. Without it, no Realie calls are made.
- **Upgrade path:** Paid tiers ($50–$350/month for higher request volumes) can be used when we have paying customers and need broader enrichment.

See [Realie API docs](https://docs.realie.ai/) and [Pricing](https://docs.realie.ai/api-reference/pricing).

---

## Google Maps (map + building images)

We use **Google Maps Platform** for the appeal comps map and building photos (Street View).

- **When we use it:** On the appeal detail page we show (1) a **static map** with subject (red “S”) and comp markers (blue “1”, “2”, …), and (2) **Street View** thumbnails for the subject and each comp when coordinates are available.
- **APIs:** Static Maps API (one image with markers), Street View Static API (per-location image). Both are called from the server (API key not exposed to the client).
- **Config:** Set `GOOGLE_MAPS_API_KEY` in the environment to enable. Without it, the map and Street View sections are not shown (or return 503). Enable “Maps Static API” and “Street View Static API” in Google Cloud Console; billing may be required (pay-as-you-go with free tier).
- **Attribution:** We show “Map data © Google” in the UI per Google’s terms.

---

## MLS (Multiple Listing Service)

- **What it is:** Licensed listing data (list price, sold price, photos, beds/baths, sq ft, DOM, etc.) used by agents and boards.
- **Can we pull data/pictures from it?**
  - **Not without a license.** MLS data is proprietary; use is governed by the local MLS (e.g. MRED, Midwest Real Estate Data). Scraping or using MLS data without a contract is not allowed.
- **Practical options:**
  - **Partnership / license** with an MLS or a data aggregator (e.g. some title/data vendors) that is allowed to resell or expose MLS data via API. That typically involves contracts and fees.
  - **Agent/broker tools** that already have MLS access could, in theory, integrate with us via a licensed API if one is offered.

So we **do not** pull data or pictures from MLS unless we have a proper license/partnership.

---

## Zillow

- **What it is:** Public-facing real estate site with estimates, listings, and photos.
- **Can we pull data/pictures from it?**
  - **Generally no for production.** Zillow’s [Terms of Use](https://www.zillow.com/corp/Terms.htm) prohibit scraping, automated access, and using their content (including photos and estimates) in our own product without permission. Doing so risks ToS violation and legal risk.
- **Practical options:**
  - **Official API / partnership** — If Zillow offers a commercial API or data license, that would be the only compliant way to use their data at scale.
  - **User-provided links** — We can show a “View on Zillow” (or similar) link to the user so they open Zillow in their browser; we don’t ingest or display Zillow content ourselves.

We **do not** scrape or pull data/pictures from Zillow for the app.

---

## Redfin

- **What it is:** Another public real estate site with listings, sales history, and photos.
- **Can we pull data/pictures from it?**
  - **Same idea as Zillow.** Redfin’s terms typically prohibit scraping and unauthorized use of their content. Using their data or images in our app without permission is not advised.
- **Practical options:**
  - **Official API / partnership** — If Redfin offers a data/API product, that would be the compliant route.
  - **Links only** — We can link to Redfin (e.g. “View on Redfin”) so users open their site; we don’t pull or display their data or pictures.

We **do not** scrape or pull data/pictures from Redfin.

---

## Other Sites (Realtor.com, Trulia, etc.)

Same principles:

- **No scraping or unauthorized use** of listing data, photos, or estimates.
- **OK:** Deep links (e.g. “View on Realtor.com”) that open the third-party site.
- **Data/photos in our app:** Only with an official API, feed, or partnership that allows it.

---

## Summary

| Source        | Use in app today | Pull data/photos? | How to use properly                    |
|---------------|------------------|-------------------|----------------------------------------|
| Cook County   | Yes (property + comps) | Yes (we do)        | Open Data APIs; we enrich comps with living area by PIN. |
| Realie        | Yes (fallback)   | Yes (enrichment only) | Parcel ID lookup when Cook County chars missing; 25 req/month free; cache by PIN. |
| MLS           | No               | No (without license) | License/partnership with MLS or aggregator. |
| Zillow        | No               | No                | Official API/partnership only; otherwise links only. |
| Redfin        | No               | No                | Official API/partnership only; otherwise links only. |

**Living area:** We rely on Cook County Improvement Characteristics (and enrichment for comps). For similar-property selection we use same neighborhood, same class, and enriched living area/year built/beds/baths on comps. We do not pull living area or pictures from MLS, Zillow, or Redfin unless we add a licensed/approved integration later.
