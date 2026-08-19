# OT Minimum-Postable CC Rebuild — Final Handoff

**Status: COMPLETE, HELD FOR CONTROLLER REVIEW.** Gate B and Gate C remain HOLD.
Nothing was pushed, opened as a PR, merged, deployed, or sent. No provider,
payment, customer, email, upload, social, or public action was performed. No
production or public HTTP retrieval was made by CC.

**Two disclosures need controller attention before anything else in this
document:**

1. **Six production files outside the authorized map were edited.** Four are
   one-line normalizations of the Assessor calendar URL, which the controller's
   own ruling directs. Two — `lib/checkout/window-gate-token.ts` and
   `app/hoa/hoa-client.tsx` — are substantive. Exact reachability evidence is in
   §4. These were carried in from the uncommitted working tree at resume and are
   integral to the required outcome; they are disclosed rather than reverted,
   and they are not self-approved.
2. **A defect in the uncommitted work made T2 checkout structurally
   uncompletable**, and would have made every checkout retry create a new order
   row with a Stripe idempotency key that deduplicated nothing. It is fixed in
   `a574e75`; the mechanism is in §3.

| | |
|---|---|
| Worktree | `/Users/abigailclaw/.openclaw/workspace/rex/worktrees/ot-minimum-postable-rebuild-20260819` |
| Branch | `cc/ot-minimum-postable-rebuild-20260819` |
| Base | `40337808a63d5f666e2c4780e5b0a4d7ad7fa90f` |
| **Final code SHA** | **`d48ec3403cfe88bdd84c2c98537df6340f3ffafa`** |
| Branch head | this evidence commit, which sits directly on top of `d48ec34` and adds only this file. Review the code at `d48ec34`; `git diff d48ec34 HEAD` is this document alone. |
| Working tree at handoff | clean |
| Gate B / Gate C | **HOLD** |

---

## 1. Exact parent chain

```
d48ec34  a574e75  test(acceptance): render the 52-route freshness corpus and re-pin the suites
a574e75  eefabda  fix(checkout): give the checkout snapshot a stable contract identity
eefabda  457b296  remediation(freshness): wire every deadline consumer to the canonical state
457b296  2c19f4f  remediation(freshness): close canonical dependency gap
2c19f4f  edeaabc  docs(evidence): record blocker handoff for the minimum-postable rebuild
edeaabc  c76110a  remediation(freshness): add the canonical deadline source (not yet wired)
c76110a  ec4129e  remediation(provider): fail closed at every held-product boundary
ec4129e  4033780  remediation(removal): withdraw held products from consumer surfaces
```

The pre-existing history is preserved; three bounded continuation commits were
added. No rebase, amend, squash, or history rewrite.

**Diffstat vs base:** 112 files changed, 10,858 insertions, 3,473 deletions —
83 production/content files and 29 test files.

---

## 2. Dependency-closure accounting for the two newly authorized files

### `lib/monitoring/schedule.ts`

Reachability at the time of the blocker:

```
lib/monitoring/schedule.ts:6   import { TOWNSHIP_DEADLINES_2025 } from "@/lib/appeals/township-deadlines"
lib/monitoring/schedule.ts:31  for (const [townshipKey, dates] of Object.entries(TOWNSHIP_DEADLINES_2025))
```

`getActiveTownshipNamesForChecks` derived an "active township" set from the 2025
map using its own `LEAD_DAYS = 14` / `TRAIL_DAYS = 45` arithmetic — a ninth
independent deadline authority deciding which properties get assessment checks.
It now reads `describeTownshipCalendar`, so it holds no schedule and performs no
date arithmetic. With the committed snapshot it selects no townships, which is
the correct resting state for an un-refreshed deployment.

### `app/api/admin/ot-orders/[orderId]/review/route.ts`

```
route.ts:9   import { ASSESSOR_CALENDAR_URL, TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED } from "@/lib/appeals/township-deadlines"
route.ts:24      sourceUpdated: TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
route.ts:26      verifiedAt: `${TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}T12:00:00.000Z`,
```

`snapshotForTownship` stamped a fabricated `verifiedAt` — a string literal with
`T12:00:00.000Z` concatenated onto the day a developer last edited a constant —
onto an admin order review record on the approval path. It now reports the real
canonical evaluated state, and reports unknown/unverified when there is none. No
timestamp is minted anywhere on this path.

`ASSESSOR_CALENDAR_URL` remains exported. It is a neutral link to the
authority's page, not a date claim, which is what keeps
`lib/social/ot-deadline-approval.ts` (social code, explicitly barred) outside
the blast radius.

---

## 3. The checkout contract-identity defect

Found by the rewritten `session-window-gates` suite once it was pointed at the
canonical path instead of the removed `getFreeCheckAppealWindowStatus` mock.

`CheckoutWindowSnapshot.freshnessExpiresAt` is `evaluatedAt + 900s`, and
`evaluatedAt` is the instant of the request that produced it. Two evaluations of
the *same* county retrieval, milliseconds apart, therefore produce snapshots
that are not equal as JSON. Three mechanisms hashed or compared the whole
snapshot across requests:

| Mechanism | Consequence |
|---|---|
| `issueAnalysisAcknowledgmentToken` / `verifyAnalysisAcknowledgmentToken` | The T2 challenge could never be redeemed. A buyer presenting a valid token was handed a new challenge, forever. T2 is the only tier that can reach a provider, so checkout could not complete at all. |
| `buildOtContractKey` | The contract key changed on every attempt: the upsert stopped finding the existing row, and the Stripe idempotency key derived from it stopped deduplicating. Every retry would have created a new order row and a new payable session. |
| `checkoutContractMatches` | A legitimate retry after a provider failure read as `CHECKOUT_KEY_CONFLICT`. |

Fix: `otSnapshotIdentity` — the same snapshot without the serving deadline: the
property record, township, window, source, and *retrieval* instant, i.e. every
field that is a fact about the county rather than about when we last asked.
Token binding, the contract key, and contract matching use it. The
optimistic-concurrency predicates bind `order.eligibilitySnapshot` (the row as
read) rather than a freshly evaluated snapshot.

Freshness is not weakened. Every request re-evaluates the canonical state from
scratch and refuses a stale one *before* a token or key is examined, and the
full snapshot including the boundary is still what gets persisted, so
`validateCurrentT3Settlement` can still prove the evidence was fresh when the
buyer paid.

**This fixes the path so that it is correct when a policy is signed; it does not
open it.** `SIGNED_ELIGIBILITY_POLICIES` is empty because OD-2 and OD-3 are
unsigned, and no value of `OT_ELIGIBILITY_POLICY_VERSION` creates an entry.
`session-window-gates` asserts that the committed default refuses checkout with
a verified open window, with a signed policy, and with both — separately.

---

## 4. Out-of-map production files

The authorized set is the 51-item map (49 original + `lib/monitoring/schedule.ts`
+ `app/api/admin/ot-orders/[orderId]/review/route.ts`). Six production files
outside it were changed in the continuation commits.

### Substantive — require ratification

**`lib/checkout/window-gate-token.ts`**

Reachability. It is the sole definition site of `CheckoutWindowSnapshot`, of
`checkoutSnapshotFromProjection` (the single construction site for that type),
and of the T2 acknowledgment token. It is imported by three files, two of which
are on the map:

```
app/api/checkout/session/route.ts:14-20   type CheckoutWindowSnapshot, checkoutSnapshotFromProjection,
                                          otSnapshotIdentity, issueAnalysisAcknowledgmentToken,
                                          verifyAnalysisAcknowledgmentToken
lib/checkout/ot-contract.ts:3-6           otSnapshotIdentity, type CheckoutWindowSnapshot
lib/checkout/ot-settlement.ts:8           checkoutSnapshotFromProjection
```

The required outcome "finish acknowledgment-token payment boundaries" cannot be
satisfied without editing it: the token is defined here and the defect in §3
lives in the payload it binds. Nothing in this file was widened beyond that —
the change adds `otSnapshotIdentity` and uses it in issue/verify.

**`app/hoa/hoa-client.tsx`** (with `app/hoa/page.tsx`, also out-of-map)

Reachability. `public/resources/overtaxed-hoa-resident-resource.html` and
`.pdf` are accepted rows 46 and 47 of the frozen 52 and *are* on the map, but
nothing on the map serves them. At base the only link is here:

```
app/hoa/hoa-client.tsx:84-85   export const HOA_RESOURCE_HTML_PATH / HOA_RESOURCE_PDF_PATH
app/hoa/hoa-client.tsx:119,130 href={HOA_RESOURCE_PDF_PATH} / href={HOA_RESOURCE_HTML_PATH}
app/hoa/page.tsx:3             import { ResourceDownloadGroup } from "./hoa-client"
```

The two artifacts carry a standing "Current appeal windows" badge, a "Refreshed
monthly" line, and a description of `/deadlines` as a table of open and close
dates for all 38 townships. None of that is true, and none of it can be
corrected here: the JSX they were rendered from is not in this repository — it
survives only inside the self-extracting HTML bundle — and the PDF is a headless
Chrome render of that bundle, so the two would disagree until both were rebuilt.
The surface is withdrawn instead. `app/hoa/page.tsx` additionally drops
`todayLabel = "Updated for 2026 Cook County appeal windows"`, a standing
freshness claim on a static page with no retrieval behind it.

A printed sheet pinned in a lobby is the worst carrier in the product for a date
we cannot attribute: it outlives the page it came from, carries no retrieval
timestamp a reader could check, and reaches residents who never visit the site.
Regenerating the flyer from real verified state is separate work that needs a
real snapshot first.

### Mechanical — controller-directed URL normalization

Per the ruling of 2026-08-19 that `https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines`
is the one authorized spelling. One line each, href and visible label only:

| File | Change |
|---|---|
| `app/appeals/[id]/page.tsx` | `.com` href + matching link text → `.gov` |
| `app/appeals/new/page.tsx` | `ASSESSOR_CALENDAR_URL` constant → `.gov` |
| `app/dashboard/page.tsx` | `.com` href → `.gov` |

### Already present in the reviewed commits

Thirty-three further production files sit outside the 51-item map but were
introduced by `ec4129e` (removal) and `c76110a` (provider boundaries), described
narratively in `CC-REBUILD-HANDOFF.md` and unchanged by this continuation. They
are enumerated here because the earlier handoff did not list them against the
allowlist:

`app/account/page.tsx`, `app/admin/page.tsx`, `app/admin/performance/page.tsx`,
`app/api/admin/create-performance-invoice/route.ts`,
`app/api/appeals/[id]/authorization/route.ts`,
`app/api/appeals/[id]/authorization/upload/route.ts`,
`app/api/billing/pay-invoice/route.ts`, `app/api/contingency-intake/route.ts`,
`app/api/cron/performance-invoices/route.ts`, `app/api/drip/send/route.ts`,
`app/appeal-contingency/layout.tsx`, `app/appeal-contingency/success/page.tsx`,
`app/appeal-packet/page.tsx`, `app/appeal-packet/success/page.tsx`,
`app/board-of-review/page.tsx`, `app/check/page.tsx`, `app/checkout/page.tsx`,
`app/disclaimer/page.tsx`, `app/faq/page.tsx`, `app/layout.tsx`,
`app/opengraph-image.tsx`, `app/page.tsx`, `app/pricing/page.tsx`,
`app/terms/page.tsx`, `components/account/PendingInvoicesSection.tsx`,
`components/sections/testimonials.tsx`, `lib/billing/performance-fee.ts`,
`lib/billing/stripe-invoice.ts`, `lib/copy/canonical.ts`, `lib/email/send.ts`,
`lib/products/held-response.ts`, `lib/products/held.ts`, `lib/stripe/client.ts`,
plus the evidence file `artifacts/.../CC-REBUILD-HANDOFF.md`.

### Files NOT edited, with evidence

`lib/email/templates.ts` and `scripts/check-township-deadlines.ts` still carry
`https://www.cookcountyassessor.com/assessment-calendar-and-deadlines`. Both are
out of map and neither is required by any behaviour above, so neither was
touched. `scripts/check-township-deadlines.ts` additionally prints "Suggested
entries for `TOWNSHIP_DEADLINES_<year>`" for pasting back into the module this
work emptied, and is still wired to `npm run township-deadlines:check`. It
imports no removed symbol and is not reachable from the application, so it is
residue rather than a live authority — but it is an invitation to reintroduce
the fallback and it performs an outbound county fetch. **Recommend the
controller authorize its removal or neutering separately.**

---

## 5. Per-file authorization accounting for out-of-map test edits

The nine tests disclosed in the v2 authorization are listed first; the remainder
are new and are accounted for on the same basis.

| Test file | Failing assertion before adjustment | Authorized production cause | Result |
|---|---|---|---|
| `checkout/session-window-gates` *(disclosed)* | `blocks T3 when the server-resolved township is not officially open` expected 409 `T3_WINDOW_BLOCKED`, got 410; 19 further cases fell to `CHECKOUT_ELIGIBILITY_CLOSED` because the suite mocked `@/lib/free-check-appeal-window`, which the route no longer calls | T3_DFY is a held product refusing at 410 before window evaluation (`ec4129e`); the route projects the canonical snapshot (`eefabda`) | Rewritten: 28/28. T3 cases moved to T2; the hold asserted directly; four new cases prove the committed default refuses |
| `checkout/session-contract-reuse` *(disclosed)* | `TypeError: projectTownshipDeadline is not a function` — the suite stubbed `@/lib/appeals/township-deadlines` with two exports | Same module is now a canonical adapter | Rewritten: 8/8. Snapshot + policy mocked; ack flow threaded through every call |
| `v2/checkout-window-gates` *(disclosed)* | — | — | Passes unchanged |
| `v2/checkout-copy` *(disclosed)* | — | — | Passes unchanged |
| `v2/home-free-check-flow` *(disclosed)* | `DIY Appeal Packet $69` expected on a preview result; `No overpayment flagged`; `Future cycle` / `Opens May 8, 2028`; `Check dates` / `Exact appeal dates unavailable` | Offer gated solely on the route's `outcome.allowCheckout`; headline is CC-03…CC-06 byte-exact from the route; `future_cycle` split into `upcoming` / `unknown` | Updated: 7/7, plus a new case proving the CTA *does* render when the route allows checkout |
| `v2/preview-side-effects` *(disclosed)* | — | — | Passes unchanged |
| `v2/marketing-unification` *(disclosed)* | required `TOWNSHIP_STATUS_COUNTS` in `/townships`; required `closes today` and `Township schedules checked regularly` in `lib/townships.ts` | Page counts come from the canonical view model; the ticker runs no countdown and the standing line was untrue | Updated: 97/97; now asserts the roster holds no date literal at all |
| `metadata-titles` *(disclosed)* | — | — | Passes unchanged |
| `products/retired-surfaces` *(disclosed)* | — | — | Passes unchanged |
| `deadlines-2026` | imports `TOWNSHIP_DEADLINES_2026`, `TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED`, `getOfficial2026Deadline`; 8 date assertions | Those exports are removed; the adapter contains no date literal | Rewritten: 19/19, with a fixture-driven verified arm |
| `deadlines-sourcing` | `DEADLINE_VERIFY_NOTICE` and `/not an official deadline/` | Replaced by `DEADLINE_PENDING_NOTICE`; a date is withheld, not disclaimed | Rewritten: 8/8; adds a canonical-host assertion |
| `active-township-campaigns` | `it.each` pinning four hard-coded Last File Dates and the Chicago-midnight flip; `lastFileDate` on the campaign type | Campaigns read `describeTownshipCalendar`; the pending arm carries no dates | Rewritten: 11/11; the midnight boundary re-proved against an injected verified snapshot |
| `freecheck-appeal-window` | four cases asserting hard-coded 2026 dates and `future_cycle` | Same removal; `future_cycle` split | Rewritten: 13/13; adds proof that `allowCheckout` is true only for an official property record |
| `followups/safety` | `expect(email?.subject).toContain("August 12, 2026")` | `buildFollowupEmail` performs no lookup; the caller passes a projection | Updated: 8/8; adds a verified-projection arm and a closed-window arm |
| `hoa-page-stance` | required `Updated for 2026 Cook County appeal windows`; five flyer-download cases | Standing freshness claim removed; flyer surface withdrawn | Updated: 38/38; now asserts the claim is absent and the artifacts unlinked |
| `deadlines-tracking` | `officialCount: 16 … sourceUpdated: "2026-07-23"` | Counts come from the canonical view model; `sourceUpdated` carries a real retrieval instant or nothing | Updated: 4/4 |
| `deadlines/official-source-state`, `deadlines/render-time-countdown` | fixture URL regex pinned to `cookcountyassessor.com` | Controller host ruling | Updated: 79/79 across the four canonical suites |
| `acceptance/freshness-corpus` *(new)* | n/a — new file | Section E | 74/74 |

---

## 6. Verification against base

All final results are from the exact final SHA `d48ec34` with a clean tree.
Base figures for Jest are carried forward from `CC-REBUILD-HANDOFF.md` rather
than re-measured this session — checking out the base in this worktree would
have discarded the working tree the continuation resumed from. The base
TypeScript figure was diffed directly against Rex's stored `tsc-baseline.txt`.

| Check | Base (`4033780`) | Final (`d48ec34`) | Verdict |
|---|---|---|---|
| `npx jest` | 3 suites failing, 23 tests failing | **88 suites passed, 0 failing; 1,456 passed, 77 skipped, 1,533 total** | Better than base; the three base-failing suites (`session-contract-reuse`, `session-window-gates`, `deadlines-tracking`) are green |
| `npx tsc --noEmit` | 86 errors / 44 files | **86 errors** | Identical count, diffed line-by-line against the stored baseline (`reviews/ot-minimum-postable-20260819/tsc-baseline.txt`). The only textual difference is three pre-existing `lib/cook-county/api.ts` errors shifted from lines 187–189 to 198–200. Zero errors in any new or rewritten file |
| `npm run build` | passes | **passes**, exit 0, `✓ Compiled successfully` | No regression |
| `git diff --check` | — | exit 0 | No whitespace errors |
| Rex QA packet `shasum -c` | — | 6/6 `OK`, no byte drift | Packet intact |
| `python3 qa_runner.py --self-test` | — | exit 0, **7/7 pass** | — |
| `python3 qa_runner.py` (offline) | — | exit 0, `status: PASS`, **52 routes / 22 named surfaces / 10 fixtures / 0 mutations** | — |

Baseline failures are not hidden: the base's 23 failing tests were in the three
suites named above, and each is now green because the behaviour they asserted
(hard-coded dates, a T3-purchasable tier, a seed-date status tally) is the
behaviour this work removes. Every such expectation change is itemized in §5.

**Provider zero-call.** No test in the suite constructs a live Stripe, Resend,
or Cook County client; `session-window-gates` and `session-contract-reuse` mock
`stripe` at the module boundary and assert `stripeCreate` was not called on
every refusal path. No network call was made by CC at any point.

---

## 7. Proof that synthetic / 1900 data cannot become production truth

- `evaluateOfficialDeadlineState` refuses `snapshot.synthetic` before it reads a
  single date. The check is on the data, not on `NODE_ENV`, so no deployment can
  switch it off.
- The committed `data/deadlines/cook-county.json` is `synthetic: true` with every
  placeholder date in **1900**, so a flag flipped without a real retrieval behind
  it produces a visibly broken result rather than a plausible 2026 deadline a
  homeowner might act on.
- `acceptance/freshness-corpus` renders all 38 township pages, the campaign
  pages, `/deadlines`, `/townships`, `/about` and `/appeal-contingency` and
  asserts that the string `1900` appears in none of them — body, metadata, or
  JSON-LD.
- `deadlines-2026` asserts that no view-model row carries any date field and that
  `JSON.stringify(view)` contains no `1900`.
- Fixture **FX-10** drives a synthetic snapshot that is otherwise fresh and open
  through the evaluator and requires `available: false` with
  `reason: "synthetic_source"` and all eight capabilities off.
- `lib/appeals/township-deadlines.ts` contains no date literal at all
  (asserted by regex over the comment-stripped source), so a fallback cannot be
  reintroduced there without reintroducing the data.

Nothing was copied from the seed dates in `lib/townships.ts`. No `verifiedAt`,
`retrievedAt`, or `sourceUpdatedAt` is minted anywhere; the only retrieval
instants that exist come from the snapshot's own provenance.

---

## 8. Proof that township slugs cannot authorize eligibility or payment

The two-tier identity split is enforced at one place and read everywhere:

- `informationalTownship(...)` yields `resolutionSource: "page_slug"`;
  `resolveTownship(...)` yields `resolutionSource: "official_property_record"`.
  `isEligibleIdentity` recognizes only the latter.
- In `projectDeadline`, `open = status === "open" && state.eligible` and
  `live = status !== "closed" && state.eligible`. `showCountdown`,
  `allowDeadlineCta`, `allowReminderSignup`, `allowDeadlineEmail` and
  `allowCheckout` all derive from those two, so a slug-resolved projection can
  state what the county published and nothing else.
- `describeTownshipCalendar` — the entry point used by township pages, the
  index, the campaign pages, the ticker, and the free check by name — always
  constructs the informational tier. There is no argument that changes it.
- `checkoutSnapshotFromProjection` takes `allowCheckout` from the projection and
  ANDs it with a signed policy version rather than recomputing it, and it is the
  single construction site for `CheckoutWindowSnapshot`, so a payment path
  cannot assemble a snapshot field-by-field with `allowCheckout` left true.
- `freecheck-appeal-window` asserts directly that a verified open window reached
  by name gives `allowCheckout: false` while the same window reached through an
  official property record gives `allowCheckout: true`.
- The campaign suite asserts a verified open window still yields
  `daysRemaining: null` on a landing page, because the reader is anonymous.

---

## 9. 52-route representation and hostile-fixture behaviour

`__tests__/acceptance/freshness-corpus.test.tsx` reads the controller's
`acceptance-matrix.json` directly rather than restating it, so the route list
cannot drift from the one Rex verifies against.

- Asserts exactly 52 accepted rows with 52 distinct paths, and that **no row is
  unaccounted for**: 45 are rendered (38 township pages, 2 campaign pages,
  `/deadlines`, `/townships`, `/about`, `/appeal-contingency`, `/contact`), 5 are
  read as committed blog markdown, 2 are the withdrawn download artifacts.
- Every rendered surface is asserted free of a long-form date, an ISO date, a
  countdown, `closes today`, and `1900` — in the body, in `generateMetadata`,
  and inside every JSON-LD block, which additionally must contain no
  `"@type":"Event"` and no `startDate`.
- `/appeal-deadline/west-chicago` renders a dateless pending page rather than
  404ing (the URL is in the sitemap and is a paid destination);
  `/appeal-deadline/rogers-park` is pinned as a 404, because Rogers Park is a
  township and not one of the four approved campaigns.
- The two flyer artifacts are asserted unreferenced from any rendered surface.
- Blog articles must cite `cookcountyassessoril.gov`, must not cite
  `cookcountyassessor.com`, and must carry no countdown.
- CC-02 … CC-06 are compared byte-exact against the matrix's `canonical_copy`.

**Hostile fixtures FX-01 … FX-10.** Each is driven through
`evaluateOfficialDeadlineState` + `projectDeadline` and — except FX-01 and
FX-03 — must return `available: false` with **all eight capabilities false
together** and no ISO date anywhere in the projection:

| Fixture | Condition | Result |
|---|---|---|
| FX-01 | fresh / open, property-record identity | verified; `allowCheckout: true`; real `retrievedAt` |
| FX-02 | prior-Chicago-day retrieval inside 14 days of close | `source_stale`, joint suppression |
| FX-03 | verified window already closed | described, but countdown / CTA / reminder / checkout all false |
| FX-04 | retrieval stamped after evaluation | `source_from_future`, joint suppression |
| FX-05 | malformed `contentSha256` | `parse_failed`, joint suppression |
| FX-06 | `parseStatus: parse_error` | `parse_failed`, joint suppression |
| FX-07 | `parseStatus: schema_error` | `parse_failed`, joint suppression |
| FX-08 | no township identity | `township_unresolved`, joint suppression |
| FX-09 | resolved township lacks the requested stage | `stage_missing`, joint suppression |
| FX-10 | synthetic source, otherwise fresh and open | `synthetic_source`, joint suppression |

**Two guards were added to the evaluator to make FX-05 pass honestly**, both for
fields nothing previously read:

- a source whose `httpStatus` is not 2xx is `source_unavailable`. A snapshot
  recording a 403 — which is exactly what the controller's own read-only probe
  of the Assessor calendar returned on 2026-08-19 — would otherwise have been
  served as verified county data;
- a `contentSha256` that is not 64 hex characters is `parse_failed`. This module
  holds parsed rows and not bytes, so it cannot detect a hash that is merely
  wrong; verifying the digest against the source bytes belongs to
  `scripts/refresh-township-deadlines.ts`, which already does it. What it can
  refuse is a provenance record that cannot evidence the retrieval it claims.

---

## 10. Preservation

| Artifact | Expected | Observed | Verdict |
|---|---|---|---|
| Active checkout `/Users/abigailclaw/overtaxed-platform` porcelain SHA-256 (`git status --porcelain -uall`) | `998487519ffd6e34df5640c576f0b5ebfdaa6a0096491c7be3c9e0986b7754a4` | identical | **untouched** |
| Active checkout HEAD | `2d8d12ff8c71c03c97ef5b10773b96a9d5c052de` | identical | untouched |
| Failed candidate `ot-minimum-postable-clean-20260818` | `829eb01c259ce768d0feaa2f272925e0258f3b43` | identical | **unchanged**; not read this session, nothing copied |
| Rex QA packet `qa/SHA256SUMS.txt` | 6 files | 6/6 `OK` | no byte drift |
| Frozen authoritative inputs (5 hashed) | see below | 5/5 `OK` | verified before editing |

Authoritative-input hashes re-verified at resume:
`2026-08-18-MINIMUM-POSTABLE-AUTHORIZATION.md` `f680e9e5…4288c`;
`REX-DIRTY-BASE-COLLISION-PREFLIGHT.md` `a328195b…9287d`;
`REX-OT-FRESHNESS-IMPLEMENTATION-INVENTORY.md` `9ef19c46…e889c`;
`11-MAX-CLAUDE-CODE-ACCEPTANCE-CHECKLIST.md` `3068389d…1dd1`;
`04-CANONICAL-COPY-AND-BANNED-CLAIMS.md` `a7577e68…2c499`.

---

## 11. Residue

Deliberate, and not the implementer's call:

- `GET /api/appeals/[id]/authorization/download` is unchanged and still works.
  It returns a document the customer already signed; revoking access to their
  own record is a data-disposition decision.
- `components/sections/*` (10 files) and
  `components/board-of-review/BoardOfReviewWaitlist.tsx` remain in place as
  unreachable dead code (zero external imports), per the contract.
- The T3 reassessment-notice review branch in `app/api/checkout/session/route.ts`
  (lines 436–571) is now **unreachable**: T3_DFY is held and refuses at
  410 before it. It was left in place rather than deleted, and the acceptance
  suite asserts the 410 refusal directly. Recommend the controller decide
  whether it is removed or kept against a future unhold.
- `scripts/check-township-deadlines.ts` — see §4.
- `public/resources/overtaxed-hoa-resident-resource.{html,pdf}` remain on disk,
  served from nowhere.

Not done, and out of scope for CC:

- **No official-source retrieval was performed.** The committed snapshot is a
  fixture and every surface fails closed against it. A real snapshot requires
  the separately authorized Tier-3 retrieval; until then the product's honest
  state is "we have not verified any township's deadline", which is what it now
  says.
- **OD-2 and OD-3 remain unsigned**, so paid eligibility is closed by design.

---

## 12. What CC is asking for

1. **Ratification or rejection of the six out-of-map production files in §4**,
   in particular `lib/checkout/window-gate-token.ts` and
   `app/hoa/hoa-client.tsx`.
2. **Rex exact-SHA independent review of `d48ec3403cfe88bdd84c2c98537df6340f3ffafa`** — the branch head adds only this document on top of it.
3. A separate decision on the two residue items in §11 that invite the defect
   back: `scripts/check-township-deadlines.ts` and the unreachable T3 branch.

Gate B and Gate C remain HOLD. CC does not self-approve. No push, PR, merge,
deploy, provider call, payment test, customer contact, or public action is
requested or implied by this handoff.
