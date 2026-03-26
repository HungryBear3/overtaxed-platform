# PRD: FreeCheck Component Refactor

## Goal
Fix encoding corruption and clean up the FreeCheckResult component in `components/check/FreeCheckResult.tsx`.

## Task 1: Fix encoding corruption in FreeCheckResult.tsx

The following strings have corrupted apostrophes/ellipsis characters. Fix them all:

- `We17ll` → `We'll`
- `you19re` → `you're`
- `township19s` → `township's`
- `Saving26` → `Saving…`

Search for any other garbled characters (stray numbers inside words) and fix them too.

## Task 2: Fix garbled pricing button text

In FreeCheckResult.tsx, these two buttons have broken text:

```
"Get full comp packet 169 DIY 14"
"Full automation 149/property"
```

Fix them to read clearly:
- `"DIY Plan — $169"` 
- `"Full Service — $149/property"`

## Task 3: FreeCheckFormWrapper refactor

Currently `FreeCheckForm.tsx` handles both input state and result display by rendering `<FreeCheckResult>` inline. This creates a messy component boundary.

Refactor:
1. Create `components/check/FreeCheckFormWrapper.tsx` — a new parent component that:
   - Manages `result` state
   - Renders `<FreeCheckForm>` passing `onResult` callback
   - Renders `<FreeCheckResult>` when result is available
2. Update `FreeCheckForm.tsx` to accept an `onResult: (result: Result) => void` prop instead of managing result state internally. Remove the `result` state and `FreeCheckResult` import from FreeCheckForm.
3. Update `app/check/page.tsx` to import and use `<FreeCheckFormWrapper>` instead of `<FreeCheckForm>`.
4. Export the shared `Result` type from a shared file or from FreeCheckResult.tsx so both components can import it without duplication.

## Acceptance criteria
- No TypeScript errors (`npx tsc --noEmit`)
- All apostrophes render correctly
- Button text is clean and readable
- Check page works: user enters PIN/address → result appears below form
- Commit all changes with message: `refactor: FreeCheckFormWrapper + fix encoding corruption`
- Push to main
