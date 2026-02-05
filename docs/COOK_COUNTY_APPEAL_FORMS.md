# Cook County Appeal Forms – Research (Task 8.2)

## Summary

- **Residential appeal form:** Fillable PDF and/or online (SmartFile). [Cook County Assessor – Form documents](https://www.cookcountyassessor.com/form-document/residential-appeal-form).
- **Filing:** Online filing (SmartFile) is encouraged; paper/PDF may be accepted for self-filers. Anyone filing **on behalf of** another must use the online system; paper will not be accepted for representative filings.
- **Official rules:** [Official Appeal Rules of the Cook County Assessor](https://www.cookcountyassessor.com/official-appeal-rules-cook-county-assessor). Rule 15 governs comparables (3+ sales, 5+ equity, same neighborhood/class, similar size).
- **2025 rules:** Updated rules effective Feb 25, 2025; all CCAO forms must be fully completed with authorized signatures; supporting documentation must be legible and complete.

## What We Provide vs County Forms

| Item | We provide | County form/portal |
|------|------------|---------------------|
| Appeal packet (summary, comps, requested value) | ✅ Our PDF (appeal-summary) | User uploads to portal or attaches |
| Subject property + comps (PINs, values, $/sq ft) | ✅ In our PDF | May be re-entered or uploaded |
| Official CCAO appeal form (signature, checkboxes) | ❌ User fills on county site or PDF | Required by county |
| Filing submission | ❌ User submits at county portal | [File an appeal](https://www.cookcountyassessor.com/file-appeal) |

**Conclusion:** We do **not** replace the official county form. We produce a **supporting packet** (summary + comps + requested value) that the user can attach or use when filling the county form or SmartFile. Our PDF should state Rule 15 compliance and include all PINs and comp details so the user (or staff) can complete the county form accurately.

## Implementation (8.3–8.4)

- **Template system:** Our “appeal form” is the appeal-summary PDF (county-specific content: Cook County Rule 15, 10% ratio, township/deadline text). No separate county PDF template is filled programmatically; the county form is filled by the user on their site or their fillable PDF.
- **Form generation engine:** `lib/document-generation/appeal-summary.ts` – already generates the packet PDF. Enhance with Rule 15 compliance sentence, “no cherry-picking” line, and PIN/verification note (see `docs/APPEAL_RULE15_AND_ARGUMENT_IMPROVEMENTS.md`).
- **Validation:** Before download, ensure appeal has requested value, and comps meet minimum (3 sales, 5 equity recommended). Optional: warn if below minimum.

## References

- [Residential Appeal Form](https://www.cookcountyassessor.com/form-document/residential-appeal-form)
- [Online Appeals Guide](https://www.cookcountyassessor.com/form-document/online-appeals-guide)
- [Official Appeal Rules (Rule 15)](https://www.cookcountyassessor.com/official-appeal-rules-cook-county-assessor)
- [Assessment calendar and deadlines](https://www.cookcountyassessor.com/assessment-calendar-and-deadlines)
- 2025 Appeal Rules (PDF) – effective Feb 25, 2025
