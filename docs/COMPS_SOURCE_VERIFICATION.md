# How to Verify Which Comps Source Is Being Used

## In the UI

After loading comps, you’ll see the **source**:

- **Add comps dialog** (appeal flow): in the amber guidance box — “Comps from **Realie Premium Comparables**” or “Comps from **Cook County Open Data - Parcel Sales**…”
- **Comps page** (`/properties/[id]/comps`): a gray banner at the top — “**Source:** Realie Premium Comparables” or “**Source:** Cook County Open Data - Parcel Sales…”

## In Vercel / Server Logs

The comps API logs when Realie Premium is used or skipped:

- `[comps] Using Realie Premium Comparables` — Realie Premium returned comps; those are shown.
- `[comps] Realie Premium skipped` — Realie API error (e.g. quota, auth).
- `[comps] Realie Premium returned 0 comps, falling back to Cook County` — Realie responded but returned no usable comps (e.g. no 14-digit PINs).
- `[comps] Realie Premium skipped: no subject lat/long from Parcel Universe` — Subject property has no coordinates, so Realie Premium is not attempted.

## When Realie Premium Is Used

1. Subject has lat/long from Parcel Universe (`getAddressByPIN`).
2. `REALIE_API_KEY` is set in Vercel.
3. Realie Premium API returns at least one comp with a valid 14-digit Cook County PIN.

If any of these fails, the flow falls back to Cook County + Realie enrichment.

## Data Enrichment

- **Realie Premium**: Sqft, beds, baths come from Realie if the response includes them (`buildingArea`, `totalBedrooms`, `totalBathrooms`, etc.). If the API uses different field names, we may not map them.
- **Cook County path**: Uses Cook County Improvement Chars + Realie Parcel Lookup (up to 15 calls) to enrich. Enrichment merges Realie data into primary fields when County has null.
