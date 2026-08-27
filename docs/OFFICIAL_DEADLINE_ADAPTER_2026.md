# Official Deadline Adapter — 2026 source repair (review note)

Scope of this note: `scripts/refresh-township-deadlines.ts` (parser v2.0.0),
its tests under `__tests__/deadlines/`, and the pinned captures under
`__tests__/fixtures/deadlines/`. Nothing here activates the adapter: the
committed snapshot `data/deadlines/cook-county.json` remains `synthetic: true`
and `evaluateOfficialDeadlineState` continues to refuse it.

## What changed and why

The v1 parser read an HTML `<table>` from both sources. Neither source
publishes a table anymore:

- The **Assessor** calendar is a Drupal accordion of per-township cards.
- The **Board of Review** retired its HTML calendar routes (the old
  `/appeal-calendar` family now 404s); the current official publication is a
  first-party PDF linked from the Board's own site.

## Sources (pinned)

| Stage | URL | Fixture SHA-256 |
| --- | --- | --- |
| assessor | `https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines` | `bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca` |
| bor | `https://www.cookcountyboardofreview.com/sites/g/files/ywwepo261/files/document/file/2026-08/2026TOWNSHIPOPEN-CLOSE.pdf` | `04eaa4db1b0be4bc00dd3ec5834cd67bc16ab0cba4bb0380e676461a16b7925b` |

Capture details in `__tests__/fixtures/deadlines/SOURCES.md`.

## Parser behavior

**Assessor (HTML accordion).** Each `.views-row` card with a `row On|Off
title` header is one township. A card with both a Reassessment Notice Date and
a Last File Date yields a window; the printed text must agree with the
machine-readable `datetime` attribute, and an "Open For Appeals Until" banner,
when present, must agree with the last-file date. The open date is the notice
date, per the page's own definition ("When a township 'opens' property owners
will receive a Reassessment Notice in the mail"). A card with neither date is
recorded as listed-with-no-window (`window: null`), which downstream renders
as pending. Anything else — one date, an unreadable or self-contradictory
date, a banner without dates, a duplicate township, an inverted window — fails
the whole stage.

**Board of Review (PDF).** The PDF is digitally produced (Distiller from
Excel) with a real text layer. The parser reads the PDF's own text operators
directly — a bounded interpreter over the exact constructs this layout uses
(FlateDecode content stream, rotated text matrix, `Tj`/`TJ` shows). No OCR, no
AI, no browser, no network conversion, no external tool. Groups of townships
share one open/close row; each numbered group's townships get
`openDate`/`lastFileDate` windows. The exemptions session block ("Exemptions /
(1st Installment) / All townships") is recognised explicitly and excluded —
it is a complaint-filing session for exemptions, not a township appeal
window. Any deviation — a second page, a transformed or unrotated text
matrix, an unsupported operator, changed title or column headers, prose where
dates belong, more dates than open/close/evidence, a group without an id, a
duplicate township — fails the stage with a specific error.

## Fail-closed rules preserved

- Fetching stays injected; `main()` still refuses without `--allow-network`;
  nothing fetches on import.
- Whole-snapshot semantics: any stage failure means nothing is written.
- Atomic publication via temp-file rename.
- Provenance `contentSha256` is the hash of the **exact fetched bytes** — for
  the Board, the PDF file itself, never a decoding of it. `FetchedSource.body`
  is now `Uint8Array` for exactly this reason.
- No inferred years: only printed dates with explicit four-digit years parse.
- Duplicate townships, malformed rows, partial cards: loud stage failure, no
  silent skips.
- The committed snapshot stays synthetic; this change does not publish or
  overwrite `data/deadlines/cook-county.json`.

## Residual risks / open items

- **Fixture tests are not a live gate.** A fresh read-only two-source live
  validation is required before any snapshot or runtime change; this PR makes
  no live-source acceptance claim.
- The Board PDF's URL embeds the session year and an upload path
  (`2026-08`); next session's URL will differ and the adapter must be
  re-pointed then (it will fail loudly at fetch/parse, not silently).
- The BOR PDF at capture time lists only Group 1; the parser accepts future
  groups of the same shape, but a layout redesign (multi-page, added
  columns beyond an evidence deadline, hearing dates on the open/close line)
  intentionally fails the stage for human review.
- The Assessor "open = notice date" equivalence follows the page's prose; if
  the county ever prints a distinct open date column again, the parser should
  be revisited (it would fail loudly only if the card shape changes).
- The PDF interpreter does not model glyph widths; within-chunk column
  attribution relies on the typesetter's large kern jumps (threshold 500/1000
  em) plus strict shape validation. Adversarial tests cover drift ("prose
  where dates belong"), but a pathological same-width layout change would be
  caught by the shape checks, not by geometry.
