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

**Recommendation:** Use the **county's official form** rather than our custom PDF. Options:
- **A)** Provide a link to download the county form; user prints, signs (wet or per their preference), scans, and uploads it back to us (or staff attaches it when filing).
- **B)** If the county form is fillable (AcroForm), programmatically fill the fields and generate a PDF for the user to sign. We would need to obtain the form, inspect its fields, and map our data.
- **C)** Contact CCAO (312.443.7550) to confirm whether our custom authorization PDF is acceptable for representative filings.

---

## 2. Wet Signature vs Electronic Signature

**Current state:** We capture an e-signature via checkbox ("I authorize…") and store `signedAt` + `ipAddress`. Our PDF shows "Signed electronically: {date/time}."

**County rules (from research):**
- E-signatures conforming with the **Illinois Electronic Commerce Security Act** may be accepted in lieu of notarization.
- **However:** "Photocopies and scans of signed documents are accepted, but the CCAO reserves the right to require or request an original copy with a 'wet' signature as it deems necessary."
- Some sources mention an "Owner/Lessee Verification Form" that must be **notarized** for certain filings—this may apply to different property types or appeal types.

**Risk:** For staff-assisted filing, CCAO could:
- Accept our e-signed PDF initially
- Later request an original with wet signature
- Reject appeals if they enforce wet/original requirements

**Recommendation:**
- **Short term:** Add clear disclosure in the UI: *"The Cook County Assessor may require an original signed form. If requested, we will send you the official form to sign and return."*
- **Preferred:** Offer a flow where the user downloads the **official county form** (pre-filled if possible), signs it (wet signature), and uploads a scan. We store that as the authorization document for staff to attach when filing.
- **Verify:** Call CCAO (312.443.7550) or email to confirm: (1) Is our custom authorization PDF acceptable? (2) Do they require wet signature or original for representative filings?

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
