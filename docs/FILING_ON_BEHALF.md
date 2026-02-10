# Filing Appeals on Behalf of Users

## Current state

Today, **all users** (including paid Starter/Growth/Portfolio) use a **DIY filing flow**:

1. We prepare the appeal packet (summary PDF, comps, requested value).
2. The user downloads the PDF and submits it themselves at the [Cook County Assessor portal](https://www.cookcountyassessoril.gov/file-appeal).
3. The user then clicks **Mark as Filed** in our app so we can track status.

We do **not** submit the appeal to the county for them. The in-app copy explains that we cannot submit on their behalf yet because the Cook County Assessor has not released a public e-filing API, and we will add filing-on-behalf (Starter+) once it is available.

## Why we don’t submit today

- **No public e-filing API.** The Cook County Assessor’s appeal process is a **human-facing web portal** (form, upload, possibly login). There is no documented public API for programmatic submission. Without an API, we cannot “click submit” for the user from our backend.
- **Legal/authorization.** Submitting on someone’s behalf requires clear authorization (e.g. in TOS and possibly a signed form). That’s in scope (see task 19.1) but not a substitute for an actual submission mechanism.

So we **cannot** offer true “we file for you” without either (A) the county providing an API, or (B) a **staff-assisted** flow.

## Options to offer “submit on behalf”

### Option A: Staff-assisted filing (recommended for MVP)

**Idea:** Paid users get a “File for me” option. We don’t automate the county site; instead, **our staff** files using the county portal on the user’s behalf.

**Flow (high level):**

1. User marks appeal as **Ready to file** and chooses **File for me** (Starter+).
2. We generate and store the appeal packet (PDF + comps + requested value).
3. Appeal goes into a **filing queue** for staff.
4. Staff logs into the Cook County portal (with user consent and secure handling of any credentials if required), uploads the packet, and submits.
5. When the county confirms (e.g. confirmation number or email), staff records that in our app (e.g. set status to FILED, set `filedAt`, optionally store confirmation #).
6. User is notified (email/in-app) that the appeal was filed.

**Pros:** Works with the current county portal; no API needed; clear value for paid tiers.  
**Cons:** Operational cost (staff time), need queue/UI for staff, and you must handle authorization and possibly county account/credentials securely.

**Implementation outline:**

- New appeal status or flag, e.g. **PENDING_STAFF_FILING** (or use existing PENDING_FILING with a “filing method” of STAFF).
- **Filing queue** (admin or internal UI): list of appeals that requested “file for me,” with packet download and a “Mark as filed” + confirmation #.
- **TOS update:** User authorizes Overtaxed to submit the appeal to the county on their behalf (task 19.1).
- Optional: store county confirmation number on `Appeal` and show it to the user.

### Option B: County e-filing API (if/when available)

If Cook County (or a vendor) later offers an **official API** for appeal submission:

- Integrate that API (server-side) for paid tiers.
- User still authorizes us in TOS; we’d submit via the API and set status/FILED when the API confirms.
- No staff queue needed for those submissions.

We are not aware of such an API today; if it appears, we can add a dedicated integration and keep staff-assisted as a fallback.

### Option C: Don’t submit — keep DIY only

- Keep current flow: we prepare the packet, user files at the county portal, user marks as filed in our app.
- Differentiate paid tiers by **limits** (properties, appeals), **support**, **comps/reports**, and **future** features (e.g. Performance Plan, 3-year tracking), not by “we click submit for you.”
- Copy should be clear: e.g. *“We prepare your appeal packet; you submit at the Cook County portal (one-time step).”* so paid users don’t expect us to file.

## Recommendation

- **Short term:** Keep DIY flow; clarify in UI and marketing that we **prepare** the appeal and they **submit** once at the county portal. Avoid promising “we file for you” until you have a concrete mechanism.
- **Next step for “file for me”:** Implement **Option A (staff-assisted filing)** for Starter+ (or a subset of tiers): queue, staff UI, and “Mark as filed” + confirmation, with TOS updated so we’re authorized to submit on their behalf. That delivers real “submit on behalf” without waiting for a county API.
