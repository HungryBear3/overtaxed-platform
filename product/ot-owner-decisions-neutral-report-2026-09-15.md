# OT owner decisions — neutral records report

**Approved by:** Alexy Kaplun  
**Approved:** 2026-09-14 CDT  
**Implementation status:** local candidate only; no deployment or production mutation authorized by this record.

## Approved operating decisions

1. **Offer and name.** Keep the $69 checkout open for a neutral official-record compilation. The customer-facing working name is **Cook County Assessment Records & Matching Property Report**. “Matching” is used instead of “Comparable” so the title does not itself assert OT’s conclusion that a property is legally comparable.
2. **Refunds.** Refund the full $69 when OT cannot produce the complete report promised at checkout or when the verified Assessor window was closed on the order date. A customer may also request a full refund within 24 hours if delivery has not occurred. After delivery, OT corrects transcription or arithmetic errors at no charge; county outcomes do not create refund rights.
3. **Fulfillment this week.** Use a manual evidence ledger for an initial cohort of at most 10 live orders until the automated T2 path produces, binds, and delivers this exact neutral artifact end to end. Do not use the legacy appeal-argument generator as a substitute.
4. **QA caps.** QA is transcription/source verification only: target 12 minutes, hard stop 20 minutes per order, and 25 orders per reviewer per week. Reaching the cap produces HOLD or CANNOT_FULFILL, never unbounded research or merits analysis.
5. **Checkout record.** The $69 neutral-report checkout is intended to remain open only for a single-PIN, supported Cook County class-2 property when the official Assessor window is verified open and the required report fields are complete. The separate strict automated eligibility/qualification policy remains unsigned and inactive.

## Approved claims boundary

- OT may reproduce and clearly attribute official record values and show transparent arithmetic.
- OT must not claim eligibility, over-assessment, savings, value, likely outcome, or that a customer should appeal.
- A published `card_proration_rate` of `0` must be described only as **ambiguous because the public transformation collapses raw NULL and zero**. Until CCAO confirms the semantics in writing, OT must not say the value “most likely” means not recorded.
- The report may describe its filter and list every row that passes it. It must call those rows **matching properties**, not assert that they are legal/appraisal comparables.

## Release gates

Before any deployment or traffic push:

1. the checkout gate must be separated from the unsigned strict-eligibility policy;
2. the artifact delivered must be the neutral report described above, not the legacy appeal argument;
3. payment, exact artifact hash, reviewer decision, delivery, and any refund must be durably bound;
4. customer, refund, Terms, checkout, and email copy must agree;
5. tests, build, rendered-page review, and a live read-only smoke must pass under separately approved release authority.

