# Appeal flow and when to select comparables

## Primary flow (no extra step)

We keep the path short: **input PIN (or select property) → appeal that property → review/select comps from all sources on the appeal page → generate PDF.**

1. User selects the property to appeal (from Properties or after adding by PIN).
2. User clicks **Start Appeal** → new appeal page with property pre-selected.
3. User clicks **Create Appeal** → lands on appeal detail.
4. On appeal detail: **Add Comps** (dialog) — Cook County comps by default; optional **Include Realie recently sold** for more comps from one extra API call. User selects 5–8 comps, adds them.
5. User sets requested value and downloads the PDF.

No detour to a separate “comps page” is required. All comp selection (County + optional Realie) happens in the **Add Comps** dialog on the appeal.

## Optional: comps page first

Users who prefer to review comps on a full page before creating an appeal can still:

1. Open **Property** → **Find Comparable Properties** (comps page).
2. Optionally include Realie comps there, select comps, then **Start Appeal with These Comps**.
3. They land on new appeal with property and comps pre-filled; **Create Appeal** attaches those comps.

So: **primary path is appeal-first, add comps on the appeal; comps page is optional.**

## In-product copy

- **Property detail:** Single CTA **Start Appeal** (no “pick comps first” nudge).
- **New appeal page:** Tip that after creating the appeal they’ll add comparables (County + optional Realie), set value, and download PDF — all on the appeal page.
- **Appeal detail:** **Add Comps** opens the dialog with County comps; button to **Include Realie recently sold comps** for all sources in one place.

## Data sources in Add Comps dialog

- **Cook County:** Default; uses Parcel Sales, Improvement Characteristics, ASSESSED_VALUES, and NEIGHBORHOODS datasets. Fallbacks when few results: relaxed building class, 3-year window, township-level search.
- **Realie (Premium Comparables):** Optional; one extra call when user clicks “Include Realie recently sold comps.” Each comp shows its source (e.g. “Cook County Open Data” or “Realie (Premium Comparables)”).
