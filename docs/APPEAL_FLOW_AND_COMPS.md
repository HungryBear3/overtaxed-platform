# Appeal flow and when to select comparables

## Design decision: comps before vs after starting an appeal

We support **both** flows and **direct** users toward picking comps first for a stronger appeal, without requiring it.

### Option A: Comps before starting appeal (recommended path)

1. User opens **Property** → **Find Comparable Properties** (comps page).
2. User selects 3+ sales comps (and optionally equity comps).
3. User clicks **Start Appeal with These Comps** → lands on new appeal page with property pre-selected and comps in sessionStorage.
4. User clicks **Create Appeal** → comps are attached automatically; then set requested value and download PDF.

**Pros:** One clear path; user sees comps and evidence before committing to an appeal; comps are attached at creation.  
**Cons:** Extra step if the user just wants to create a draft and add comps later.

### Option B: Start appeal first, add comps after

1. User clicks **Start Appeal** (from property or dashboard) → new appeal page.
2. User selects property, tax year, deadline → **Create Appeal**.
3. On appeal detail page, user clicks **Add Comps** (dialog) to attach comparables, then sets requested value and downloads PDF.

**Pros:** Fast for users who want to create the appeal shell first.  
**Cons:** User may forget to add comps or add them late; PDF is weaker without comps.

### What we do in the product

- **Don’t require** comps before creating an appeal (keeps flow flexible; some users want to create then fill in).
- **Do direct** users to comps first:
  - **Property detail:** Under "Start Appeal" we show: "For a stronger appeal: pick comps first, then start from the comps page" with a link to the property comps page.
  - **New appeal page:** When a property is selected and they don’t have comps from the comps page, we show an amber tip: "For best results, pick comparables first: View comps for this property. On that page, choose your comps and click Start Appeal with These Comps to return here with them attached. You can also add comps after creating the appeal."
- **Comps page:** Clear CTA "Start Appeal with These Comps" so the primary path is property → comps → start appeal with comps attached.

So: **direct before, allow after**. We recommend comps first when coming from a property; we don’t block appeal creation so users can still start an appeal and add comps on the appeal detail page.
