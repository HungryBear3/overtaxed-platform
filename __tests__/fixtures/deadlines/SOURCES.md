# Deadline parser fixtures — provenance

Both files are byte-exact captures of the official county sources, saved with
plain `curl` GETs on **2026-08-27** (America/Chicago). Do not edit them; the
test suite pins their SHA-256 digests and fails if a byte changes.

## `assessor-calendar-20260827.html`

- Source: Cook County Assessor, Assessment & Appeal Calendar
- URL: `https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines`
- HTTP: 200, `text/html; charset=UTF-8`, Drupal 11
- SHA-256: `bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca`
- Shape: per-township accordion cards (`.views-row`), two 2026 calendar sets
  (South & West Suburbs; North Suburbs & City of Chicago), 38 townships —
  22 with published windows (4 currently open, 18 already closed), 16 listed
  with no dates yet.

## `bor-township-open-close-20260827.pdf`

- Source: Cook County Board of Review, "Dates and Deadlines 2026 Session"
  township open/close PDF
- URL: `https://www.cookcountyboardofreview.com/sites/g/files/ywwepo261/files/document/file/2026-08/2026TOWNSHIPOPEN-CLOSE.pdf`
- Discovered from: the Board's retired calendar route
  (`https://www.cookcountyboardofreview.com/appeal-process/deadlines`, now 404)
  links this PDF directly from its own error page.
- HTTP: 200, `application/pdf`, `last-modified: Mon, 03 Aug 2026 11:37:44 GMT`
- SHA-256: `04eaa4db1b0be4bc00dd3ec5834cd67bc16ab0cba4bb0380e676461a16b7925b`
- Shape: single page, digitally produced (Acrobat Distiller from
  `2026TOWNSHIPOPEN-CLOSE.xlsx`, real text layer — not a scan). At capture
  time it lists the exemptions session and Group 1 (Evanston, New Trier,
  Norwood Park, Oak Park, River Forest, Riverside, Rogers Park; open
  8/3/2026, close 9/1/2026). The Board appends groups as the session
  progresses.
