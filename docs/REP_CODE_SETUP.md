# Representative Code Setup for Staff-Assisted Filing

## Overview

To submit property tax appeals on behalf of other property owners, OverTaxed IL must obtain a **representative code** (rep code) from Cook County. Per Cook County Assessor guidance (March 2025), a rep code from the Cook County Board of Review is required to create a business email account for submitting appeals for other property owners.

## Two Filing Contexts

| Context | Portal | Rep registration |
|---------|--------|------------------|
| **Assessor appeals** | [propertytaxfilings.cookcountyil.gov](https://propertytaxfilings.cookcountyil.gov) | Create account with business email; rep code may be required for representative filings |
| **Board of Review appeals** | [appeals.cookcountyboardofreview.com](https://appeals.cookcountyboardofreview.com) | Attorney registration with ARDC code; non-attorneys contact BOR for guidance |

Staff-assisted filing today focuses on **Assessor appeals**. Board of Review appeals are a second-level appeal after the Assessor's decision.

## Obtaining a Rep Code

### Board of Review (for BOR appeals)

- **Attorneys:** Register at [cookcountyboardofreview.com/registering-online-account-attorneys](https://www.cookcountyboardofreview.com/registering-online-account-attorneys)
  - Requires: User name, password, name/firm, email, **ARDC Number/Attorney Code**
  - Valid ARDC card required; approval on annual basis
  - If you don't have an Attorney Code, register by providing ARDC Code, firm info, and scanned ARDC card
- **Non-attorneys:** The Board of Review's published process targets attorneys. Contact the Board of Review for guidance on representative registration without an ARDC code.

### Assessor's Office (for Assessor appeals)

- The Assessor's filing portal (propertytaxfilings.cookcountyil.gov) requires an email address to create an account.
- Per CCAO guidance: obtain a rep code from the Board of Review to create the business email account used for representative submissions.
- **Action:** Contact Cook County Assessor (312.443.7550) or Board of Review to confirm the exact process for non-attorney representatives filing Assessor appeals.

## Creating the Business Email Account

1. Obtain the rep code from the appropriate Cook County office (BOR or Assessor, per their guidance).
2. Create a dedicated business email (e.g., `filings@overtaxed-il.com`) for representative submissions.
3. Register this email on the Cook County Assessor portal (propertytaxfilings.cookcountyil.gov) for staff-assisted filings.
4. Store the rep code in OverTaxed IL admin config (see Phase 4 implementation) for reference when staff files.

## Filing Flow with Rep Code

When staff files an appeal on behalf of a user:

1. Staff logs into the Cook County portal using the business account (created with rep code).
2. Staff uploads the appeal packet and Attorney/Representative Authorization form.
3. Staff enters the **property owner's email** as the appellant (per appeal); the business email is the representative account.
4. Staff records the filing confirmation in the admin filing queue.

## References

- [Cook County Board of Review – Registering for Attorneys](https://www.cookcountyboardofreview.com/registering-online-account-attorneys)
- [Cook County Board of Review – Registering for Property Owners](https://www.cookcountyboardofreview.com/registering-online-account-property-owners)
- [Cook County Assessor – File an Appeal](https://www.cookcountyassessor.com/file-appeal)
- [FILING_ON_BEHALF.md](./FILING_ON_BEHALF.md) – Staff-assisted filing flow
