# Appeal Summary: Rule 15 Alignment & Argument Improvements

Reference: [Official Appeal Rules of the Cook County Assessor](https://www.cookcountyassessor.com/official-appeal-rules-cook-county-assessor) (Rule 15), PRD Appendix D, and sample report format (Sales Analysis + Lack of Uniformity).

**Assessor guidance (March 2025):** Sales OR equity comps are acceptable; both are not required. Most important factors: **identical classification** (age, stories, # units) and **$/sqft**. We implement: year built filter (±10 years), building class match for equity comps, and $/sqft computation and sorting.

## What We Already Do (Current PDF & Flow)

- **Summary of Request** — Noticed value, requested value, reduction $/%, one-line rationale.
- **Subject property** — PIN, address, neighborhood, subdivision, block, class, CDU, living area, land/improvement/market values, beds/baths, year built.
- **Sales Analysis** — Separate section for SALES comps with sale price, date, $/sq ft, living area, year built, distance; short narrative.
- **Lack of Uniformity** — Separate section for EQUITY comps with assessed market value, $/sq ft, living area, year built, distance; short narrative.
- **Conclusion** — Requested value supported by X sales comps and Y equity comps; respectful request for reduction.
- **Comps guidance in UI** — Add-comps dialog and appeal detail page explain 3+ sales, 5+ equity, same neighborhood/class, similar size/age.

---

## Rule 15–Focused Improvements

| Rule 15 requirement | Suggestion | Where |
|---------------------|------------|--------|
| **At least 3 comps** (and similar size, class, location; no cherry-picking) | Add a short “Compliance” or “Evidence” line in the PDF: *“This submission includes [N] sales comps and [M] equity comps from the same neighborhood and building class, consistent with Rule 15.”* | PDF: after Summary of Request or start of Conclusion |
| **PINs for subject + comps** | Already in PDF (subject PIN, each comp PIN). Optional: add a one-line note: *“All comparables are identified by Cook County PIN for verification.”* | PDF: Conclusion or comp sections intro |
| **Similar size, class, location** | In comp selection UI/backend, surface and store “same neighborhood,” “same class,” “same CDU,” “living area within range” (we have these on `ComparableProperty`). In PDF, add a small **Rule 15 compliance** line listing: *“Comps: same neighborhood & class; living area within range; distances under 0.5 mi (sales) / 0.8 mi (equity).”* if we have that data. | PDF + comp model/UI |
| **Photos** | Rule 15 often expects photos for subject + comps. We don’t have photo upload yet. Note in doc: *“Photo attachments for subject and comparables can be submitted separately to the Assessor per Rule 15.”* | PDF footnote or “What to submit” line |

---

## Argument Strengthening (More Compelling for Assessors)

| Improvement | Why it helps | Implementation idea |
|-------------|--------------|---------------------|
| **One-number “value conclusion”** | Assessors look for a clear opinion of value. We already state requested value; add one line that ties comps to it: *“Sales analysis and uniformity comps support a fair market value (and thus assessed value) of $X.”* | PDF: in Summary of Request or Conclusion |
| **Subject $/sq ft vs comp $/sq ft** | Shows over-assessment in the same terms assessors use. Add a line: *“Subject assessed $/sq ft: $Y; comparable sales average $/sq ft: $Z; subject is [X]% above comparable norm.”* (Compute when we have subject living area + assessment and comp price/assessment and living area.) | PDF + small calc in download-summary or appeal-summary |
| **Median / average of comps** | “The median of the listed sales is $X; the requested value is at/below that median.” Strengthens the “not cherry-picked” message. | PDF: after sales list (median sale price, median $/sq ft); same for equity if useful |
| **Date range of sales** | “Sales occurred between [earliest] and [latest].” Shows recency and arm’s-length timing. | PDF: one line in Sales Analysis intro |
| **Explicit “no cherry-picking”** | One sentence: *“Comparables were selected by proximity, same neighborhood and building class, and similar living area; no cherry-picking.”* | PDF: Rule 15 / Evidence line |
| **Filing deadline & township** | Already have township/deadline in appeal details. Optional: add *“Filing deadline for [Township] township: [date]. This submission is timely.”* if we have township. | PDF: Appeal Details or Summary |
| **Requested value = 10% of market** | Cook County assesses at 10% of market value. Optional line: *“Requested assessed value of $X reflects an estimated market value of $Y (10% assessment ratio).”* | PDF: Summary or Conclusion |

---

## Suggested Priority Order

1. **Quick PDF adds** (no new data): Rule 15 compliance sentence (comp counts + same neighborhood/class); “no cherry-picking” line; “PINs provided for verification.”
2. **Subject vs comp $/sq ft** (small calc): Compute subject $/sq ft and comp median $/sq ft; one line in PDF. Requires subject `currentAssessmentValue` and `livingArea` and comp `pricePerSqft` or `assessedMarketValuePerSqft` + `livingArea`.
3. **Median sale price / median $/sq ft** in Sales Analysis (and optionally for equity).
4. **Sales date range** in Sales Analysis intro.
5. **Photo / attachment note** for Rule 15 until we support uploads.
6. **10% ratio sentence** (requested assessment = 10% of market) if we want to reinforce Cook County math.

---

## Data We Already Have (for calcs)

- Subject: `currentAssessmentValue`, `livingArea`, `currentMarketValue`.
- Comps: `salePrice`, `livingArea`, `pricePerSqft`, `assessedMarketValue`, `assessedMarketValuePerSqft`, `saleDate`, `distanceFromSubject`.
- From this we can add:
  - Subject $/sq ft = `currentAssessmentValue / livingArea` (or market value / living area).
  - Median/average of comp sale price and comp $/sq ft.
  - Min/max sale dates for sales comps.

---

## References

- [Cook County Assessor – Assessment calendar and deadlines](https://www.cookcountyassessor.com/assessment-calendar-and-deadlines)
- [Official Appeal Rules (Rule 15)](https://www.cookcountyassessor.com/official-appeal-rules-cook-county-assessor)
- PRD Appendix D: Report structure (subject, Sales Analysis 3+ comps, Lack of Uniformity 5+ comps), Rule 15 compliance
