# Retired blog posts — banned claims

These eleven posts were served at `/blog/<slug>`, listed on `/blog`, syndicated in
`/rss.xml`, and advertised in `sitemap.xml`. They are withdrawn, byte-for-byte,
because each states a claim the frozen lexicon bans. Nothing under `docs/` is
served by Next.js.

**They were not rewritten.** Retirement is the approved disposition; editing the
claims to pass a scan would destroy the evidence of what was published. Their
bytes are unchanged, and `__tests__/blog/served-blog-governance.test.ts` asserts
that every one of them still trips the lexicon retroactively — a retired file is
evidence, and evidence that no longer reproduces the defect is worthless.

## Why each one could not stay

| Slug | Rows tripped |
|---|---|
| `bloom-township-property-tax-appeal-2026` | BL-B1 inflected, BL-C2, BL-C3 |
| `bremen-township-property-tax-appeal-2026` | BL-B3, BL-B5 nothing-to-lose |
| `calumet-township-property-tax-appeal-2026` | BL-B3 |
| `cook-county-comparable-sales-appeal` | BL-C1 |
| `cook-county-property-tax-how-it-works` | BL-B2 |
| `free-property-tax-check-cook-county` | BL-B3, BL-C1, BL-C3 |
| `how-much-can-you-save-appealing-property-taxes-illinois` | BL-B1, BL-B3 |
| `is-your-illinois-home-overassessed` | BL-C3 |
| `property-tax-appeal-cook-county` | BL-C1, BL-C3 |

Sixteen violations across those nine.

Two more were retired on the same terms once the full corpus sweep ran. They
were clean under the frozen lexicon, which is exactly why they had survived:

| Slug | Why |
|---|---|
| `cook-county-board-of-review-appeal-guide` | `:70` — *"Homeowners who file with solid comparable sales evidence **frequently win reductions**. … but **reductions of $500–$2,000 per year are common** for residential properties."* No frozen row catches this. BL-B3 matches "you could save" and "estimated savings"; this states the same claim as a property of the outcome rather than a promise to the reader, and BL-B2's "success rate" does not match "frequently win". |
| `cook-county-property-tax-appeal-deadline-2026` | `:34` — *"Once your reassessment notice arrives, **you typically have 30 days to file**."* The frozen countdown rule in `generated-content-safety` matches this exactly. The post had simply never been swept, because it was not one of the controller's five. |

Owner ruling 2 keeps a previously ungoverned post public *only if every required
sweep passes*. These two do not pass, so they are retired rather than exempted.

The two that named the problem in the first place:

- `bloom-township…:18` — *"In 2025, Cook County homeowners who appealed their
  assessments **saved an average of $1,200+ per year**. That's money back in your
  pocket."*
- `bremen-township…:31` — *"The process is free to file — **you have nothing to
  lose**."*

Both passed all 22 original lexicon rows. BL-B1 matched only the infinitive
`save an average of`; BL-B5 matched only `risk-free` and `no risk`. They were
caught only after those two rows were widened to their inflected forms, which is
the whole reason this retirement happened.

## How they were found, and why it took three rounds

`content/blog` held 18 posts. `app/blog/[slug]` serves any slug the loader
returns, and the sitemap advertised every one — but the safety sweep named five,
because five is what the controller's frozen corpus accepts. Thirteen posts were
served and indexed with nothing looking at them. Seven survive.

That is the same shape as `/resources` (five appeal-domain downloads served while
the row that covered them passed) and `/homestead-exemption` (a live page in
neither the 53 nor the 22). Enumerating surfaces by hand, while the app serves
them dynamically, is the defect.

The fix is not this directory. It is that `app/sitemap.ts` no longer reads
`content/blog` itself — every consumer now derives from `lib/blog`, and the
governance suite reconciles the served set against the governed set from that one
source. A tenth post cannot be added, served and indexed without failing a test.

## Restoring any of these

Do not move a file back into `content/blog` until its banned claims are gone. The
governance suite sweeps the whole live corpus with no exemption list and no
accepted-failure ledger, so a restored post fails immediately and by name.
