# PRD: Illinois Property Tax Appeal Digital Product

## Goal
Add a digital product ("Illinois Property Tax Appeal Packet") for sale directly on overtaxed-il.com. This is a one-time purchase downloadable PDF bundle. Sell via Stripe payment link or Gumroad embed.

## What We're Building
A purchase flow on the overtaxed-il.com website that lets visitors buy a downloadable "Illinois Property Tax Appeal Packet" for $37.

## Product Contents (generate as real content files)
Create a `/public/downloads/` directory with the following documents as PDFs (generate as HTML files we can convert, or as rich markdown that will become the PDF):

1. `cover-letter-template.md` — A formal appeal letter template addressed to the Illinois Property Tax Appeal Board (PTAB) or County Board of Review. Include placeholders for: homeowner name, property address, PIN number, current assessed value, proposed assessed value, date. Professional tone, 1 page.

2. `evidence-checklist.md` — Checklist of evidence to gather for a strong appeal:
   - Comparable sales (comps) in the neighborhood
   - Recent appraisal or purchase price
   - Photos of property defects
   - Assessment errors (incorrect square footage, bedroom count, etc.)
   - Neighbor assessment comparisons
   Include tips for finding each item (CCAO website, Zillow, etc.)

3. `filing-instructions.md` — Step-by-step instructions for filing a property tax appeal in Illinois:
   - Cook County: Board of Review process, deadlines, online portal
   - Collar counties (DuPage, Lake, Will, Kane, McHenry): process differences
   - PTAB (state-level) as a secondary option
   - Common mistakes that get appeals denied
   - Timeline: what to expect after filing

4. `county-deadline-calendar.md` — Appeal deadline windows by Illinois county (2024/2025 data where available). At minimum include: Cook, DuPage, Lake, Will, Kane, McHenry, Winnebago, Champaign, Sangamon, Peoria. Format as a table: County | Filing Window | Where to File | Notes

5. `faq.md` — 10 most common questions homeowners ask about Illinois property tax appeals:
   - Do I need an attorney?
   - What if my appeal is denied?
   - How much can I save?
   - Will my taxes go up if I appeal?
   - How long does it take?
   - etc. Honest, practical answers.

## Website Changes

### New page: `/app/appeal-packet/page.tsx`
Sales landing page for the product. Include:
- Headline: "Stop Overpaying Property Taxes — DIY Appeal Packet"
- Subheadline: "Everything you need to file your own Illinois property tax appeal. No attorney required."
- List of what's included (5 documents)
- Price: $37 (crossed out $67 for urgency)
- Buy button (Stripe payment link — use placeholder URL `https://buy.stripe.com/PLACEHOLDER` for now)
- Trust signals: "Instant download", "Works for all Illinois counties", "Plain English — no legal jargon"
- Simple, clean design consistent with the existing site (use existing Tailwind classes/components)

### Update homepage or nav
Add a subtle CTA somewhere on the homepage or in the nav linking to `/appeal-packet` — something like "DIY Appeal Toolkit →" or a banner/card section.

### Thank you / download page: `/app/appeal-packet/success/page.tsx`
Simple page that shows after purchase:
- "Thank you for your purchase!"
- Download links for each of the 5 documents (link to `/public/downloads/` files)
- Note: "Check your email for a copy of these links" (placeholder text for now)

## Tech Notes
- This is a Next.js 14+ app (App Router)
- Use existing Tailwind config and component patterns from the codebase
- No new dependencies needed — keep it simple
- The Stripe payment link is a placeholder for now — just use `https://buy.stripe.com/PLACEHOLDER`
- Don't worry about email delivery for now — that's phase 2
- Do NOT modify any existing pages in a breaking way — additive only

## Out of Scope (Phase 2)
- Actual PDF generation
- Email delivery of download links
- Gumroad listing
- Etsy listing

## Done When
- [ ] All 5 content documents created in `/public/downloads/`
- [ ] `/appeal-packet` sales page live and looking good
- [ ] Homepage has a link/CTA to the appeal packet page
- [ ] `/appeal-packet/success` thank you page exists
- [ ] Everything builds without errors (`npm run build` or `next build`)
- [ ] Commit all changes with message: "feat: add property tax appeal digital product"
- [ ] Run: `openclaw system event --text "Done: Property Tax Appeal Packet pages built and committed" --mode now`
