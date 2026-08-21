# Retired appeal-domain downloads

These five files were served from `public/downloads/` at the site root and were
retrievable by anyone. `app/robots.ts` allows `/` and carries no `/downloads`
rule, so they were also crawlable. Nothing under `docs/` is served by Next.js;
moving them here is the withdrawal, and it is the same disposition already
applied to the two HOA resident artifacts in the parent directory.

Four of them were **orphans** — no rendered surface linked them. They survived
every prior correction round because the row-14 sweep looked only at
`/resources/` and the five named blogs, so a document could satisfy the row as
written while sitting unread in the served tree. The fifth was linked from
`/homestead-exemption`.

## Why each one could not stay public

### `county-deadline-calendar.md` — the severe one

- A table of **filing windows for ten Illinois counties** ("September –
  November", "October – December") with no source and no retrieval timestamp.
  This is the claim the entire canonical-freshness effort exists to remove, and
  it also implies coverage outside Cook.
- `| Appeal window closes | **Hard deadline — no extensions** |` — the finality
  warning, attached to **its own** stated dates. The five accepted blogs are
  allowed to carry that warning precisely because they state no date and point
  at the county; this document states the dates itself.
- **"Cook County Board of Review"** named as the place to file, plus
  `cookcountyboardofreview.com`, with **no CC-11 anywhere in the file**.
- `cookcountyassessor.com`, the non-canonical host.
- `- **Worth it for:** Large properties, significant overvaluations, commercial
  property` — an appeal-merits recommendation and a scope claim.

### `filing-instructions.md`

- `### Cook County — Board of Review (Recommended First Step)` recommends the
  Board as the filing route — the one stage OverTaxed cannot serve — with no
  CC-11.
- Collar-county filing guidance for counties outside Cook.

### `faq.md`

- `You have nothing to lose by filing.` — the no-risk guarantee in substance.
- Names the Board of Review with no CC-11.

### `cover-letter-template.md`

- Names the Board of Review with no CC-11.

### `homestead-exemption/homestead-exemption-guide.md`

Not named in the original finding; found by the widened sweep that this
correction adds. It is the worst of the five:

- A per-county **"Estimated Annual Tax Savings"** table — `$600–$1,500/year`,
  `$300–$700/year`, `$250–$600/year` — presented as what the reader will save.
- `homeowners who've saved an average of $1,200+ per year` — the averaged-savings
  claim the frozen lexicon bans outright.
- `## Stop Overpaying Property Taxes — You May Be Missing Free Money`.
- Two links to `cookcountyassessor.com`, the non-canonical host.
- A live external paid offer: **"Illinois Property Tax Appeal Packet — $37"**
  linking to an Etsy listing, served from the OverTaxed public tree.
- `All other IL counties`, implying coverage outside Cook.

## What is deliberately *not* here

`public/downloads/evidence-checklist.md` was inspected and **retained**. It
states no date, no dollar figure, no window, and does not name the Board of
Review. It is generic documentation advice.

The `landlord-notices/`, `small-claims/`, `divorce-prep/`, `ticket-dispute/` and
`expungement/` subdirectories are a separate LegalKits product line, excluded
from this finding by the controlling review, and are untouched.

## Restoring any of these

Do not move a file back under `public/` until the claims above are gone and the
dates behind it come from the canonical verified snapshot with provenance and an
expiry. `__tests__/deadlines/generated-content-safety.test.ts` sweeps the whole
served appeal-domain tree and will fail if one of these documents reappears.
