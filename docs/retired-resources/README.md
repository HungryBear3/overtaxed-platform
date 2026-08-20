# Retired public resources

These two files were served at `/resources/overtaxed-hoa-resident-resource.html`
and `/resources/overtaxed-hoa-resident-resource.pdf`. They are accepted rows 46
and 47 of the controller's freshness matrix, and rows 40 and 41 of the
implementation map, whose required disposition is
`withdrawn_or_regenerated_with_provenance_and_expiry` — row 41 states plainly
that the stale binary "must not remain public".

They were unlinked from `/hoa` in an earlier commit but remained served at their
original URLs, crawlable, byte-identical to the version that predates every
freshness correction in this work. Moving them out of `public/` is the
withdrawal the rows ask for; nothing under `docs/` is served by Next.js.

What they assert, and why it cannot stand unattributed on a sheet meant to be
printed and pinned in a lobby:

- a standing "Current appeal windows" badge;
- "Refreshed monthly · latest version at overtaxed-il.com/hoa";
- "Cook County property tax appeals — 2026 window" and "Decide whether to act
  before the deadline";
- "Township deadlines — Lookup table of all 38 Cook County townships, with open
  and close dates for the 2026 cycle", pointing at `/deadlines`, a page that
  now publishes no dates at all;
- a "Rev. May 2026" provenance stamp with no retrieval behind it.

They are kept rather than deleted because regenerating them is a separate piece
of work that needs a real verified snapshot first, and because the JSX they were
rendered from survives only inside the self-extracting HTML bundle — the PDF is
a headless render of that bundle, so the two would disagree until both were
rebuilt together.

**Do not move these back under `public/` without regenerating both from verified
canonical state, with provenance and an expiry.**
