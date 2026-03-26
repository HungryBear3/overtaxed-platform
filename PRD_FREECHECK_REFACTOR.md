# PRD: OverTaxed IL — Free Check Page Refactor

## Goal
Refactor the free check page (`app/check/page.tsx`) to use a `FreeCheckFormWrapper` client component pattern for better architecture and maintainability.

## Working Directory
`/Users/abigailclaw/overtaxed-platform` (branch: main)

## Context
- `app/check/page.tsx` — currently the main check page (server component)
- `components/check/` — check-related components live here
- There are backup files in `components/check/tmp_backup/` with previous versions for reference

## Tasks

### 1. Create FreeCheckFormWrapper component
File: `components/check/FreeCheckFormWrapper.tsx`

A client component (`"use client"`) that:
- Wraps the FreeCheckForm and FreeCheckResult components
- Manages the state between form submission and result display
- Handles the transition: form → loading → result
- Props: none needed (self-contained state machine)

### 2. Update app/check/page.tsx
- Keep as server component for metadata/SEO
- Import and render `<FreeCheckFormWrapper />` in the page body
- Page should be clean and minimal — delegate all interaction to the wrapper

### 3. Ensure existing functionality works
- Free check form submission
- Result display
- Error states

### 4. Build and verify
Run: `npm run build`
Fix any TypeScript errors.

## Constraints
- Use existing components — do not rewrite from scratch
- No new npm dependencies
- Keep existing UI/UX intact

## Completion
1. Commit: `refactor: FreeCheckFormWrapper for clean client/server split`
2. Push: `git push origin main`
3. Run: `openclaw system event --text "Done: OT FreeCheckFormWrapper refactor complete" --mode now`
