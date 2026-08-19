# OT Minimum-Postable CC Rebuild — Handoff

**Status: BLOCKED.** Scope requires two production files outside the frozen
49-file maximum map. Per `OT-REBUILD-CONTRACT.md` lines 111–118 I stopped
before editing them rather than widening the map on my own authority.

| | |
|---|---|
| Worktree | `/Users/abigailclaw/.openclaw/workspace/rex/worktrees/ot-minimum-postable-rebuild-20260819` |
| Branch | `cc/ot-minimum-postable-rebuild-20260819` |
| Base | `40337808a63d5f666e2c4780e5b0a4d7ad7fa90f` |
| Candidate HEAD | `edeaabccd795b83030546941c7ab35303bc47214` |
| Commits | `ec4129e`, `c76110a`, `edeaabc` (local only; nothing pushed) |
| Gate B | **HOLD** — unchanged by this work |

No push, PR, merge, deploy, provider call, customer contact, payment test, or
public action was performed. `scripts/refresh-township-deadlines.ts` has never
been run against a live county source.

---

## 1. The blocker

**Section C cannot be completed inside the frozen map.**

The contract requires (inventory row 5) that `lib/appeals/township-deadlines.ts`
"remove callable 2025/fallback behavior". That module is the root of the
competing-authority problem: it exports a hard-coded 2025 schedule, a hard-coded
2026 schedule, and a constant `TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED =
"2026-07-23"` that other modules use to mint provenance.

Removing those exports is reachable at **compile level** from two production
files that are not among the 49:

### B5-a · `lib/monitoring/schedule.ts`

```
lib/monitoring/schedule.ts:6   import { TOWNSHIP_DEADLINES_2025 } from "@/lib/appeals/township-deadlines"
lib/monitoring/schedule.ts:31  for (const [townshipKey, dates] of Object.entries(TOWNSHIP_DEADLINES_2025))
```

`getActiveTownshipNamesForChecks` derives an "active township" set from the 2025
map using its own lead/trail arithmetic (`LEAD_DAYS = 14`, `TRAIL_DAYS = 45`).
This is a **ninth independent deadline authority** — Rex's verification counted
eight. It decides which properties get assessment checks, so it is not
cosmetic. Deleting the 2025 map breaks the module at compile time; leaving it
means the 2025 schedule remains callable, which is the exact behaviour row 5
requires removing.

### B5-b · `app/api/admin/ot-orders/[orderId]/review/route.ts`

```
route.ts:9   import { ASSESSOR_CALENDAR_URL, TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED } from "@/lib/appeals/township-deadlines"
route.ts:24      sourceUpdated: TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
route.ts:26      verifiedAt: `${TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}T12:00:00.000Z`,
```

`snapshotForTownship` stamps a **fabricated `verifiedAt`** onto an admin order
review record. Nothing was verified at that instant; the timestamp is a string
literal with `T12:00:00.000Z` concatenated onto it. This is the precise failure
mode the canonical state exists to eliminate — provenance that asserts a
verification that never happened — and it sits on the admin approval path that
gates order review.

**These are exact reachability findings, not a "shared consumer" rationale.** I
enumerated every consumer of every symbol involved; all others are inside the
map. `ASSESSOR_CALENDAR_URL` is deliberately **kept** exported — it is a neutral
official-source link, not a date claim — which is what keeps
`lib/social/ot-deadline-approval.ts` (social code, explicitly barred) out of the
blast radius.

### Two dispositions, both needing owner/controller sign-off

1. **Extend the map by two files.** Convert `lib/monitoring/schedule.ts` to the
   canonical adapter and replace the admin route's fabricated snapshot with a
   real evaluated state. Smallest correct outcome. Needs authorization to edit
   two files outside the frozen maximum.
2. **Accept a partial wiring** in which those two keep the legacy exports.
   ~50 of 52 paths wire; the residue is a live ninth authority and a live
   fabricated `verifiedAt` on admin order review. I do **not** recommend this —
   it leaves the fabricated-provenance defect in place while the candidate
   reads as remediated.

There is also a factual conflict I cannot resolve without contacting a public
source (barred): `lib/appeals/township-deadlines.ts` uses host
`cookcountyassessoril.gov` while `lib/deadline-sources.ts` and the new
`SOURCES` constant use `cookcountyassessor.com`. One is wrong. Resolving it
requires a retrieval from the county — separately authorized, and not read-only
in the sense that matters here.

---

## 2. What is complete and verified

### `ec4129e` — removal
Canonical copy module `lib/copy/canonical.ts` (CC-01…CC-18 as single
definitions); held-product registry and uniform 410 `PRODUCT_HELD`;
`/appeal-contingency` and its success page withdrawn rather than restating the
22%/if-granted terms; dashboard/account/admin plan labels say "no longer
offered"; Board-of-Review mentions corrected to the Assessor on Assessor-stage
surfaces, with CC-11 added only where the Board is substantively correct
(`/disclaimer` Rule 15; expired phase of `/appeal-deadline/[slug]`).

### `c76110a` — provider boundaries
Filing-authorization POST and upload return 410 after auth and before body
parse; `lib/email/send.ts` refuses to compose or send for a held tier; Stripe
invoice creation asserts the product is not held.

### `edeaabc` — canonical freshness source (**not wired**)
`official-source-state.ts`, `township-resolution.ts`,
`refresh-township-deadlines.ts`, `data/deadlines/cook-county.json`, and 79
tests across four suites. Covers the 24h TTL, the same-day rule inside 14 days,
future timestamps, stage separation, the 900-second serving ceiling,
render-time countdown decay, county-midnight rollover, PIN parity, and
whole-snapshot-or-nothing publication.

Two design decisions worth controller attention:

- **The committed snapshot is `synthetic: true`** and
  `evaluateOfficialDeadlineState` refuses a synthetic snapshot outright. No
  county page has been fetched. Its placeholder dates are in **1900**, so if
  that flag is ever flipped without a real retrieval behind it the result is
  visibly broken rather than a plausible 2026 deadline a homeowner might act
  on. Nothing was copied from the seed dates in `lib/townships.ts`; those are
  design fiction and must not be laundered into something shaped like
  provenance.
- **Township identity has two tiers.** An official property record establishes
  eligibility. A page slug (`/township/rogers-park`) may describe the county's
  published calendar but yields `showCountdown: false`, `allowDeadlineCta:
  false`, `allowReminderSignup: false`, `allowCheckout: false`. Without this
  split, either the 38 township pages become contentless or a routing artefact
  becomes an eligibility claim. **This is a policy-shaped call and I flag it
  for Abigail rather than asserting it is settled.**

---

## 3. Verification evidence

| Check | Result |
|---|---|
| Preservation hash, `/Users/abigailclaw/overtaxed-platform` | `998487519ffd6e34df5640c576f0b5ebfdaa6a0096491c7be3c9e0986b7754a4` — **matches frozen value** |
| Failed candidate `ot-minimum-postable-clean-20260818` | `829eb01c259ce768d0feaa2f272925e0258f3b43` — **unchanged**; read for defect evidence only, nothing copied |
| Frozen package `MANIFEST.sha256` | all 11 files **OK** |
| TypeScript | **86 errors / 44 files — identical to base.** Zero in new files |
| Production build | **passes** |
| Jest | 84 suites pass; 3 fail (`session-contract-reuse`, `session-window-gates`, `deadlines-tracking`) — **the same three that fail at base** |

Jest failure attribution: base 23 failing tests → head 27. The **+4 are mine and
intended**: `session-window-gates` cases at lines 188, 206, 295 and the
server-resolved-township case use `tier: "T3"`, which now returns 410
`PRODUCT_HELD` before the window logic runs. That suite's rewrite is queued
work, not a regression.

---

## 4. Residue and open items

**Deliberate, needing a decision that is not mine:**
- `GET /api/appeals/[id]/authorization/download` left working. It returns a
  document the customer already signed; revoking access to their own record is
  a data disposition decision.
- `components/sections/*` (10 files) and
  `components/board-of-review/BoardOfReviewWaitlist.tsx` are unreachable dead
  code (zero external imports). Left untouched — the contract bars dead-section
  deletion beyond the authorized testimonial removal.

**Not started (all downstream of the blocker):**
- Blocker B2: acknowledgment-token payment path; `session-window-gates` rewrite.
- Section C wiring: 11 authority modules to adapters, 52 paths fail-closed.
  **Zero production consumers import the canonical modules today.**
- Section D: four-state free check; `MEANINGFUL_SAVINGS_THRESHOLD` removal;
  HomePage dollar figures.
- Section E: rendered acceptance corpus (52 rows).
- Out-of-map test edits already made, each needing an authorization basis
  recorded: `session-contract-reuse`, `session-approved-notice-conversion`,
  `v2/checkout-window-gates`, `v2/checkout-copy`, `v2/home-free-check-flow`,
  `v2/preview-side-effects`, `v2/marketing-unification`, `metadata-titles`,
  `products/retired-surfaces`.

**No implementer self-approval.** Gate B remains HOLD pending Abigail's
signature on the policy-sensitive register rows and Rex's exact-SHA
verification. Gate C, PR, merge, deploy, provider calls, customer contact,
payment tests, and public replies remain separate approvals.
