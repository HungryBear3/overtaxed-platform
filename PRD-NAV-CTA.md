# PRD: OT Nav CTA Cleanup

## Goal
Simplify the navigation bar on the homepage (`app/page.tsx`) to have ONE clear primary CTA and better conversion flow.

## Current Nav (desktop)
```
[Logo] ... Pricing | Free Check → (amber btn) | Deadlines | How It Works | Sign in | Get Started (blue btn)
```

## Target Nav (desktop)
```
[Logo] ... How It Works | Pricing | Deadlines | Appeal Packet ($37) | Sign in (text) | Free Tax Check → (amber btn, ONLY primary button)
```

## Changes Required

### In `app/page.tsx` — the `<nav>` section only:

1. **Remove the "Get Started" blue button entirely** — it's redundant with Free Check
2. **Rename "Free Check →" to "Free Tax Check →"** — more specific
3. **Reorder links to**: How It Works | Pricing | Deadlines | Appeal Packet ($37) | Sign in | Free Tax Check → (button)
4. **Add "Appeal Packet ($37)" as a new text link** — href="/appeal-packet", same styling as Pricing/Deadlines text links
5. **Keep the amber button styling** on "Free Tax Check →" — it's the only button in the nav

### Mobile sticky bar (MobileStickyBar component in page.tsx):
6. **Change label** from "Start Free Property Check →" to "Check My Taxes — Free"
7. **Keep subtext** as-is: "Takes 5 minutes · No credit card"

## Files to Edit
- `app/page.tsx` — the nav section (lines ~50-85) and the MobileStickyBar props

## DO NOT change:
- Any other section of the page (hero, features, pricing cards, footer, etc.)
- The `components/navigation/header.tsx` file (that's the dashboard nav, not landing)
- Any imports or metadata

## After changes:
- `git add -A && git commit -m "refactor(nav): simplify CTAs - single amber button, add appeal packet link"`
