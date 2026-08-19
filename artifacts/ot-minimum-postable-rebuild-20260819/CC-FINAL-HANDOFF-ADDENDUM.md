# OT Minimum-Postable CC Rebuild — Independent Verification Addendum

**Status: COMPLETE, HELD FOR CONTROLLER REVIEW.** Gate B and Gate C remain HOLD.
Nothing was pushed, opened as a PR, merged, deployed, or sent. No provider,
payment, customer, email, upload, social, or public action was performed. No
production or public HTTP retrieval was made.

This document supplements `CC-FINAL-HANDOFF.md`. That document was written by
the implementer lane at `d48ec34`. This one records (a) an independent
re-verification of its claims and (b) one materially incomplete contract
section found during that re-verification and closed in `a795f21`.

| | |
|---|---|
| Branch | `cc/ot-minimum-postable-rebuild-20260819` |
| Base | `40337808a63d5f666e2c4780e5b0a4d7ad7fa90f` |
| **Final SHA** | **`a795f21fa942669a59e3e86ac564f2e2c3de5083`** |
| Previously reported final | `d48ec3403cfe88bdd84c2c98537df6340f3ffafa` — **superseded**; see §2 |
| Working tree | clean |
| Gate B / Gate C | **HOLD** |

---

## 1. Independent re-verification of the `d48ec34` handoff

Every claim below was re-measured from the worktree rather than accepted from
the prior document. All of them held.

| Claim in `CC-FINAL-HANDOFF.md` | Independently measured | Verdict |
|---|---|---|
| Branch head adds only the handoff on top of `d48ec34` | `git diff --name-only d48ec34 6a3e331` = that one file | **confirmed** |
| Diffstat vs base = 112 files, 10,858 insertions, 3,473 deletions | identical | **confirmed** |
| Six out-of-map production files in the continuation | computed the authorized set (49-row map + the two v2 files) and differenced it against `457b296..d48ec34`: **exactly six**, and exactly the six disclosed | **confirmed** |
| Jest 88 suites passed, 0 failing, 1,456 passed, 77 skipped | identical, exit 0 | **confirmed** |
| tsc 86 errors, identical to base but for a 3-line shift | 86 errors; `diff` against the stored `tsc-baseline.txt` shows only `lib/cook-county/api.ts` 187–189 → 198–200 | **confirmed** |
| Production build passes | exit 0, `✓ Compiled successfully` | **confirmed** |
| `git diff --check` exit 0 | exit 0 | **confirmed** |
| No `.only` / `.skip` added | 0 hits across the branch test diff | **confirmed** |
| QA packet `shasum -c` 6/6, self-test 7/7, offline 52/22/10/0 | re-ran: 6/6 `OK`; self-test exit 0; offline `PASS` | **confirmed** |
| Failed candidate unchanged at `829eb01c` | unchanged | **confirmed** |
| Active checkout porcelain SHA-256 `99848751…54a0` | identical | **confirmed** |
| Snapshot is `synthetic: true` with 1900 placeholders | `synthetic: true`, 230 `1900-` dates | **confirmed** |
| `lib/appeals/township-deadlines.ts` holds no date literal | 0 | **confirmed** |
| Credential/PII scan clean | only `sk_test_should_never_be_used`-style dummies | **confirmed** |

Frozen 11-file package manifest re-verified 11/11 `OK` before and after.

## 2. What the prior handoff missed — Section D on `/check`

`CC-FINAL-HANDOFF.md` reports the four-state free check as complete. It is
complete on `/` (HomePage) and in `app/api/free-check/route.ts`. It was **not**
complete on `/check`, the surface the contract's Section D is actually about.

Three files on the authorized 49-file map had never been touched on this branch:

| File | Map row | State at `d48ec34` |
|---|---:|---|
| `components/check/FreeCheckResult.tsx` | 19 | untouched since base |
| `lib/email/templates.ts` | 33 | untouched since base |
| `app/api/free-check/route.ts` | 25 | wired, but still released a savings projection |

### What was live

`components/check/FreeCheckResult.tsx` is rendered by `FreeCheckFormWrapper`
from `app/check/page.tsx` — a live, canonical, indexable route. It carried its
own `MEANINGFUL_SAVINGS_THRESHOLD = 100` and decided the result from it:

- above the threshold: **"Estimated savings"** at `$X/year`, `~$Y over 3 years`,
  **"An appeal could lower your taxes — and a win in 2026 locks in savings
  through 2029"**, `"No lawyer required. Takes 5 minutes."`, and a **"Start Your
  Appeal"** button;
- below it: `"below our confidence threshold"`;
- otherwise: **"Your property appears fairly assessed … An appeal based on
  assessed value is unlikely to succeed"**;
- an **"Est. overpayment"** card at `~$X/year`;
- the equity table graded the reader red/amber/green as **"Over-assessed" /
  "Borderline" / "Fairly assessed"**;
- a footer line, **"Savings estimates are based on comparable property
  analysis"**;
- links to `cookcountyassessor.com`, against the controller host ruling;
- the street address and the savings figure posted to `/api/township-alert`;
- **no CC-02 and none of CC-03…CC-06 anywhere on the surface.**

That is BL-A5, BL-B1, BL-B3, BL-B4, BL-B6, BL-C1, BL-C2, BL-C3 and BL-C4, plus
acceptance-checklist D1, D2, D3 and D4, on a reachable page.

This was reachable in the committed default, not only after a real snapshot.
`evaluateFreeCheckOutcome` returns `code: "supportive"` with `showFigures: true`
even when the window is unverified (`reason: "window_unverified"`), and the
route released `potentialOverpaymentPerYear` on exactly that condition
(`releaseProjection = outcome.code === "supportive"`). So with the synthetic
snapshot in place, a property with a sufficient assessed-value gap still
rendered a dollar savings claim.

`lib/email/templates.ts` additionally held a complete banned-claims email —
subject `"Your free check result: $X/year in potential savings"`, body
`"appears to be over-assessed"` and `"you may be overpaying by approximately
$X/year"` over `"Start your appeal — no attorney required"` — gated by the same
`$100` threshold. It had **no production caller**, so nothing was being sent;
it was a ready-made message waiting to be wired.

The 52-route acceptance corpus passed 74/74 throughout, because `/check` is not
one of the 52 freshness routes and no test covered this component.

### What `a795f21` changes

- `FreeCheckResult.tsx` consumes the route's `disclosure` and `outcome`: CC-02
  byte-exact in a single element immediately above the verdict, exactly one of
  CC-03…CC-06 rendered as given, figures gated on `showFigures`, every paid
  entry point gated on `allowCheckout`. A response with no `outcome` resolves to
  **CC-05 with no offer**. The threshold, the savings hero, the overpayment
  card, the three verdict branches, and the red/amber/green grade are gone. The
  county's own free filing link is deliberately *not* gated.
- `app/api/free-check/route.ts` no longer computes the projection at all —
  `potentialOverpaymentPerYear` / `potentialOverpayment3Year` are sent as `null`
  on every path — and the `"resulting in an estimated overpayment of $X/year"`
  clause is removed from the generated argument text. The assessed-value
  comparison, which is public record, stays.
- `lib/email/templates.ts` withdraws `freeCheckFollowupTemplate` entirely.
  `shouldSendFreeCheckFollowup` is kept and **always returns false**, so a
  caller added later fails closed rather than finding no gate.
- The street address and savings figure are no longer posted to
  `/api/township-alert`.

**No out-of-map production file was touched.** All three are map rows 19, 25
and 33. The six out-of-map files disclosed in `CC-FINAL-HANDOFF.md` §4 are
unchanged by this commit and still need the ruling requested there.

## 3. Out-of-map test accounting for this commit

Per the v2 rule, every out-of-map test edit is listed with its path, the failing
assertion before adjustment, the authorized production cause, and the result.

| Test file | Failing assertion before adjustment | Authorized production cause | Result |
|---|---|---|---|
| `__tests__/freecheck-followup.test.ts` *(map test #12)* | `shouldSendFreeCheckFollowup(1200, 0) === true`, `(100, 0) === true`, and 8 cases asserting the template's savings subject/body copy | The `$100` threshold is removed and the template withdrawn (row 33) | Rewritten: **4/4**. Asserts the export is gone, that no figure unlocks a send, and — over comment-stripped source — that no savings/overpayment/merits copy remains in the module |
| `__tests__/check/free-check-result-contract.test.tsx` *(new, out of map)* | n/a — new file. Added because no test covered `/check`, which is how §2 survived the corpus | Section D on map row 19 | **15/15**. CC-02 byte-exact and positionally above the verdict in all four states; exactly one of CC-03…CC-06; a 13-pattern banned-claims sweep per state; zero paid entry points in B/C/D; CC-05 fallback on a missing outcome; canonical `.gov` host only |

## 4. Verification at `a795f21`

| Check | Base (`4033780`) | Final (`a795f21`) | Verdict |
|---|---|---|---|
| `npx jest --ci` | 3 suites failing, 23 tests failing | **89 suites passed, 0 failing; 1,461 passed, 77 skipped, 1,538 total**, exit 0 | Better than base |
| `npx tsc --noEmit` | 86 errors / 44 files | **86 errors**; `diff` vs stored baseline shows only the `lib/cook-county/api.ts` 187–189 → 198–200 shift | No new errors |
| `npm run build` | passes | **exit 0**, `✓ Compiled successfully` | No regression |
| `git diff --check` | — | exit 0 | Clean |
| `__tests__/acceptance/freshness-corpus` | — | **74/74** | Unchanged |
| QA packet `shasum -c` | — | **6/6 OK** | No drift |
| `qa_runner.py --self-test` | — | exit 0, **7/7** | — |
| `qa_runner.py` (offline) | — | exit 0, `PASS`, **52 routes / 22 surfaces / 10 fixtures / 0 mutations** | — |

Diffstat vs base: **117 files changed, 11,675 insertions, 3,707 deletions.**

Provider zero-call is unchanged and re-checked: `session-window-gates` and
`session-contract-reuse` mock `stripe` at the module boundary and assert
`stripeCreate` was not called on every refusal path. No test constructs a live
Stripe, Resend, or Cook County client. No network call was made.

## 5. Preservation

| Artifact | Expected | Observed | Verdict |
|---|---|---|---|
| Active checkout `/Users/abigailclaw/overtaxed-platform` porcelain SHA-256 | `998487519ffd6e34df5640c576f0b5ebfdaa6a0096491c7be3c9e0986b7754a4` | identical | **untouched** |
| Active checkout HEAD | `2d8d12ff8c71c03c97ef5b10773b96a9d5c052de` | identical | untouched |
| Failed candidate | `829eb01c259ce768d0feaa2f272925e0258f3b43` | unchanged | **unchanged**; not read this session |
| Frozen 11-file package `MANIFEST.sha256` | 11 files | **11/11 OK** | verified before and after |
| Rex QA packet `SHA256SUMS.txt` | 6 files | **6/6 OK** | no byte drift |

## 6. What is being asked of the controller

Carried forward from `CC-FINAL-HANDOFF.md` §12, unchanged:

1. **Ratification or rejection of the six out-of-map production files**, in
   particular `lib/checkout/window-gate-token.ts` and `app/hoa/hoa-client.tsx`.
2. **Rex exact-SHA independent review**, now of
   **`a795f21fa942669a59e3e86ac564f2e2c3de5083`** rather than `d48ec34`.
3. A separate decision on the two residue items that invite the defect back:
   `scripts/check-township-deadlines.ts` and the unreachable T3 branch in
   `app/api/checkout/session/route.ts`.

Added by this addendum:

4. **Note for the review checklist:** the 52-route corpus does not cover
   `/check`, `/` or any other non-freshness consumer surface. §2 was live on a
   reachable page while the corpus reported 74/74. Recommend the corpus, or a
   companion sweep, be extended to the named surfaces in the QA packet's
   22-surface list before Gate B — otherwise the next such gap is equally
   invisible.

Gate B and Gate C remain HOLD. No implementer self-approval. No push, PR, merge,
deploy, provider call, payment test, customer contact, or public action is
requested or implied.
