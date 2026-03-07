# Cook County Attorney/Representative Authorization Form – Research

## Summary

Your concerns are valid. The current implementation may not meet Cook County Assessor's Office (CCAO) requirements for staff-assisted filing.

---

## 1. Official County Form vs Our Custom PDF

**Current state:** We generate a **custom PDF** (`lib/document-generation/filing-authorization.ts`) that approximates the Cook County Attorney/Representative Authorization form. It includes property, owner, authorization text, and "Signed electronically: {timestamp}."

**County requirement:** Cook County provides their **own official Attorney/Representative Authorization Form** (residential) at:
- https://www.cookcountyassessor.com/form-document/attorney-representative-authorizationresidential
- Direct PDF: https://prodassets.cookcountyassessoril.gov/s3fs-public/form_documents/attorneyrepresentativeauthorizationform.pdf

The official form includes:
- Owner/lessee declarations (authorization, income/expense accuracy, familiarity with operations, etc.)
- Representative affirmation (has read the Appeal Rules)
- **Signature blocks** for both owner and representative
- Printed name, date, daytime phone

**Risk:** CCAO may reject a custom PDF that does not match their official form layout and required declarations. The 2025 Appeal Rules state that "all CCAO forms must be fully completed with authorized signatures."

**Recommendation:** Use the **county's official form** rather than our custom PDF. Implemented (March 2025):
- **Option B implemented:** We provide a prominent link to the [official Cook County form](https://www.cookcountyassessor.com/form-document/attorney-representative-authorizationresidential). Users can download it, sign it (electronic signature accepted; notarization not required), and upload it via our filing authorization flow. When an uploaded official form exists, staff uses it when filing instead of our generated PDF.
- **Fallback:** Our custom PDF remains available when no official form is uploaded; users can e-sign our form. CCAO prefers the official form—we encourage users to upload it when possible.

---

## 2. Wet Signature vs Electronic Signature

**Current state:** We capture an e-signature via checkbox ("I authorize…") and store `signedAt` + `ipAddress`. Our PDF shows "Signed electronically: {date/time}."

**County rules (confirmed with CCAO, March 2025):**
- **Electronic signatures are accepted** for the Attorney/Representative Authorization form.
- **Notarization is not required** for residential representative filings.
- E-signatures conforming with the **Illinois Electronic Commerce Security Act** are acceptable in lieu of notarization.

**Historical note:** Earlier research noted that CCAO reserves the right to request an original with wet signature. CCAO has since confirmed that electronic signatures are acceptable for representative filings. An "Owner/Lessee Verification Form" that must be notarized may apply to different property types or appeal types—not to the standard residential Attorney/Representative Authorization.

**Recommendation:** Our current e-sign flow is acceptable. UI includes disclosure: *"Cook County accepts electronic signatures; notarization is not required."*

---

## 3. Representative Filing Requirements

From `docs/COOK_COUNTY_APPEAL_FORMS.md`:
- **Anyone filing on behalf of another must use the online system**; paper will not be accepted for representative filings.
- Staff would file via the county portal (e.g. propertytaxfilings.cookcountyil.gov) and upload the appeal packet + authorization form.

The authorization form must be attached when staff submits on the user's behalf. Using the county's official form reduces rejection risk.

---

## 4. Suggested Next Steps

1. **Contact CCAO** (312.443.7550 or via their website) to confirm:
   - Acceptability of our custom authorization PDF vs their official form
   - Wet vs electronic signature requirements for representative filings
   - Any notarization requirements for residential appeals

2. **If county requires their form:**
   - Add a flow: user downloads official form (we can link to it or host a copy), fills/signs, uploads scan
   - Store the uploaded PDF in `FilingAuthorization` (new field or replace our generated PDF)
   - Staff uses the uploaded county form when filing

3. **If county accepts our form but may request wet signature:**
   - Add UI disclosure about possible wet-signature request
   - Consider offering "Download form to sign and mail" as an option

4. **Update docs:** Add this research to `COOK_COUNTY_APPEAL_FORMS.md` and `LESSONS_LEARNED.md` once CCAO confirms.

---

## References

- [Attorney Representative Authorization (Residential)](https://www.cookcountyassessor.com/form-document/attorney-representative-authorizationresidential)
- [Cook County Assessor Forms](https://www.cookcountyassessor.com/forms)
- [Official Appeal Rules](https://www.cookcountyassessor.com/official-appeal-rules-cook-county-assessor)
- 2025 Appeal Rules (PDF) – effective Feb 25, 2025
- CCAO contact: 312.443.7550
