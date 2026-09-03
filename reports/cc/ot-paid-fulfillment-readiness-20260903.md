# OT paid-fulfillment readiness — local candidate

**Verdict: `PASS_LOCAL_CANDIDATE_FOR_INDEPENDENT_REVIEW`**

Prepared 2026-09-03. Local implementation, local commit, synthetic fixtures and
tests only. No policy signature, checkout opening, push, PR, merge, deploy,
migration, environment or secret change, Production or Preview database access,
Stripe call, customer contact, email, payment, provider action, public claim, or
outreach was performed or is implied by this candidate.

This removes the two paid-fulfillment blockers that do **not** depend on the
unsigned eligibility policy. OD-2 and OD-3 remain unsigned, the signed-policy
registry remains empty, and real paid checkout remains closed throughout.

---

## 1. Exact identities

| | |
|---|---|
| Repository | `HungryBear3/overtaxed-platform` |
| Required base | `ab1a21a633186b96262c653399593508f85539d6` — **matched** |
| Worktree | `/Users/abigailclaw/cc-worktrees/ot-paid-fulfillment-readiness-20260903` |
| Branch (local only) | `cc/ot-paid-fulfillment-readiness-20260903` |
| Parent | `ab1a21a633186b96262c653399593508f85539d6` |
| **HEAD** | **`4302d8ad54e49237abdfb81af67e83016bf2e78b`** |
| Tree | `cc318ac89eaae46849a77bb00a1c0ebbe7f39ed5` |
| Working tree | clean (`git status --porcelain` empty) |
| Diffstat vs base | 13 files changed, 2367 insertions, 24 deletions |
| Binary diff SHA-256 | `73fd78ad29eae3a6320008c4a60820c93535ccd98ca974f09c63bcd9cb455252` |

Evidence packet hashes required by the brief, both verified before any work:

| File | Required | Observed |
|---|---|---|
| `STUDY-REPORT.md` | `dd9c01ca6785891a…` | identical |
| `STUDY-RESULTS.json` | `f5ddca749338482d…` | identical |

Drift and collision check. `origin/main` is still `ab1a21a…`. Draft PR #38
(`05072b60…`) and draft PR #39 (`dfd4365f…`) are unchanged and were read only.
Six other worktrees carry uncommitted edits touching fulfillment, deadline,
checkout or packet paths, but every one is dormant: the newest overlapping file
mtime across all of them is 2026-07-14, and the main checkout's
`git status --porcelain -uall` SHA-256 is byte-identical to the value recorded
for it in August (`998487519ffd6e34…`). No active OT writer overlaps this work.

---

## 2. The paid T2 lifecycle, and where the stub sat

```
/api/checkout/session
  preview stub -> rate limit -> body cap -> zod
  -> held product (T3_DFY = 410)
  -> Stripe price + secret present
  -> resolveProperty (county record establishes the township)
  -> snapshotFor()  ── allowCheckout = projection.allowCheckout && policyVersion !== null
  -> [GATE] !snapshot.allowCheckout          -> 409 CHECKOUT_ELIGIBILITY_CLOSED
  -> [NEW]  three-business-day product cutoff -> 409 CHECKOUT_WINDOW_CLOSING_TOO_SOON
  -> T3 notice branch (unreachable: T3 is held)
  -> T2 acknowledgment token
  -> Stripe Price validation -> contract key -> order upsert
  -> Stripe session-expiry clamp             -> 409 CHECKOUT_WINDOW_TOO_CLOSE
  -> stripe.checkout.sessions.create

/api/billing/webhook  -> settlement -> OTOrder PAID
  -> kickoff.ts (OT_T2_FULFILLMENT_EVIDENCE_ENABLED) -> OTFulfillment ARTIFACT_PENDING
  -> runT2ArtifactBindingWorkflow (OT_T2_ARTIFACT_BINDING_ENABLED)
       -> generateT2Artifact          <<< THE HOLD STUB
       -> size gates -> content-addressed upload -> read-back byte compare
       -> bindT2Artifact -> transactional bind -> ARTIFACT_READY
  -> delivery/email strictly outside the workflow, after a successful bind
```

`generateT2Artifact` had exactly one caller, `runT2ArtifactBindingWorkflow`, and
returned `{ ok: false, blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE" }`
unconditionally. Every downstream stage was already built and tested; the
producer was the single reason a paid T2 order could never be fulfilled.

Every pre-existing fail-closed gate is preserved. The new cutoff is inserted
*after* the eligibility gate, so it can only narrow eligibility, never widen it.

---

## 3. What was implemented

### 3.1 A real, deterministic T2 artifact producer

Three modules, split so the decision logic is pure and testable:

| File | Role |
|---|---|
| `lib/fulfillment/t2-comparables.ts` (new) | non-directional selection, assessed-value attachment, uniformity metric. No IO. |
| `lib/fulfillment/t2-artifact-content.ts` (new) | the packet document and provenance manifest, plus the full refusal vocabulary. No IO, no clock. |
| `lib/fulfillment-runtime/t2-artifact-producer.ts` (rewritten) | fetches, applies the Chicago cutoff, delegates composition. |

**Production cannot reach the success path.** The default gateway's policy
resolver is the live `resolveEligibilityPolicy`. `SIGNED_ELIGIBILITY_POLICIES`
is empty, so the producer refuses at its first check with
`ELIGIBILITY_POLICY_UNSIGNED` — before it loads an order, so no incidental
lookup can mask the real blocker.

> **Corrected after independent audit.** The first revision of this candidate
> claimed that "no environment variable can create an entry" in the registry.
> That was **false**. The registry was a plain `{}` object literal, so a lookup
> inherited from `Object.prototype`: twelve values of
> `OT_ELIGIBILITY_POLICY_VERSION` — `constructor`, `toString`,
> `hasOwnProperty`, `__proto__` and eight more — returned a truthy inherited
> member and made `resolveEligibilityPolicy` report `signed: true` with an
> undefined threshold. That opened the policy half of the live paid-checkout
> gate on an environment value alone, and pushed the producer past its policy
> check into a live database read. The defect was pre-existing at `ab1a21a` and
> was not introduced here, but this candidate depended on it and asserted it
> was impossible. It is now fixed in `lib/checkout/ot-contract.ts`: the registry
> is `Object.create(null)` and the lookup is guarded by
> `Object.prototype.hasOwnProperty.call`. A test asserts all twelve keys refuse.

Successful generation is reachable only by injecting a `T2ArtifactGateway`,
which is what the tests do and what production has no way to do. The default
county gateway is also deliberately unwired and returns null; wiring a correct
non-directional county reader is a separate slice (see §7).

**The cherry-pick is structurally excluded, not merely avoided.**
`selectNonDirectionalComparables` accepts candidates described only by
`ComparableMatchAttributes` — pin, neighbourhood, class, residential subtype,
building area, year built. Assessed value is not a field of that type, so
selection cannot read it, and no later edit can make it read one without
changing the type. Values are attached afterwards. Every qualifying candidate is
accepted; there is no ranking and no top-k, because a ranking needs a direction
and the only directions available are the ones Rule 15 forbids.

> **Corrected after independent audit.** Duplicate PINs were resolved by arrival
> order: a row rejected for a wrong neighbourhood still consumed the PIN, so a
> later good row for the same parcel was dropped as a duplicate and the accepted
> set depended on the order the source returned rows in. That is a determinism
> hole in the one module whose contract is determinism. Duplicates are now
> resolved by content before any attribute filtering: identical repeats collapse
> to one, and rows that disagree about the same parcel are dropped entirely with
> a `conflicting_duplicate_rows` reason, because choosing between them would be
> choosing which record to believe. Not reachable today — `loadCountyData` is
> unwired — but it had to be fixed before the county gateway slice lands.

**The metric is not the degenerate one.** Subject assessed value per building
square foot against the median of the same quantity across the comparable set.
The metric on `main` divides assessed value by (assessed value × 10) on both
sides and is therefore exactly zero for every parcel in Cook County; the
1,200-PIN study confirmed that on 857 real subjects.

Refusal vocabulary, all bounded, stable and non-PII. A refusal returns no text
and no manifest, so nothing is uploaded, bound, or delivered:

`ELIGIBILITY_POLICY_UNSIGNED`, `UNTRUSTED_DEADLINE_AUTHORITY`,
`DEADLINE_SNAPSHOT_STALE`, `FILING_WINDOW_NOT_OPEN`,
`INSUFFICIENT_BUSINESS_DAYS`, `ORDER_PROPERTY_MISMATCH`,
`MISSING_PROPERTY_IDENTITY`, `OUTSIDE_COOK_COUNTY`, `UNSUPPORTED_PROPERTY_CLASS`,
`MULTI_PIN_PROPERTY`, `MISSING_BUILDING_SQFT`, `MISSING_ASSESSED_VALUE`,
`MISSING_PROPERTY_CHARACTERISTICS`, `INSUFFICIENT_COMPARABLES`,
`COMPARABLE_VALUE_INCOMPLETE`, `COMPARABLE_ADDRESS_MISSING`,
`UNIFORMITY_NOT_COMPUTABLE`,
`BELOW_SIGNED_EVIDENCE_THRESHOLD`, `INCOMPLETE_SOURCE_MANIFEST`, plus
`ORDER_NOT_FOUND`, `SUBJECT_RECORD_UNAVAILABLE`,
`COMPARABLE_SOURCE_UNAVAILABLE` and the retained
`T2_ARTIFACT_PRODUCER_UNAVAILABLE` for a thrown producer.

The manifest preserves everything needed to bind an artifact to how it was made:
policy version, owner decisions, signature date and both thresholds; the
selection rule id, tolerances and an explicit `selectionIsDirectional: false`;
the exact comparable PIN list and count; the Rule 15 required and recommended
minimums and whether the recommendation was met; subject and median dollars per
square foot and the relative gap; the deadline source, URL, retrieval instant,
close date and business days remaining; every dataset id, title, URL and
retrieval timestamp; and the producer and template versions. The manifest is
rendered as canonical JSON inside the artifact bytes, so the content hash covers
it.

### 3.2 The Chicago three-business-day cutoff

`lib/checkout/business-days.ts` (new), wired into
`app/api/checkout/session/route.ts` immediately after the eligibility gate and
into the producer.

- Day boundaries are America/Chicago, matching `countyCalendarDay`. Day
  arithmetic runs on `YYYY-MM-DD` strings anchored at UTC midnight, so daylight
  saving cannot produce a 23- or 25-hour step.
- The purchase day is excluded: business days are counted strictly after today,
  through the close date inclusive. Delivery takes up to one business day, so
  the purchase day is not a day the buyer has the packet.
- Fails closed on a missing, malformed, or past close date, and on fewer than
  three business days.
- **Holidays are not applied, because this repository has no holiday
  authority.** This is disclosed rather than invented, and the direction of the
  risk is stated in §7: omitting a holiday overstates the runway.
- This is **not** Stripe's session-expiry clamp. That clamp refuses only when
  under 30 minutes remain and measures against a UTC midnight. Both rules now
  exist; the product rule fires first.

### 3.3 The delivery promise

`lib/email/send.ts` and `app/checkout/success/page.tsx` now say **"within one
business day"**. Every remaining "24 hours" in the tree is enumerated as a named
exemption in `__tests__/copy/delivery-promise.test.ts`:

| File | Why exempt |
|---|---|
| `app/api/auth/register/route.ts`, `app/api/auth/resend-verification/route.ts` | email-verification link validity — a real token lifetime, not a delivery promise |
| `lib/email/send.ts` (staff alert) | internal operations alert to staff, never shown to a customer |
| `app/api/checkout/session/route.ts`, `lib/checkout/ot-contract.ts`, `lib/deadlines/official-source-state.ts` | code comments about the 24-hour source-freshness default |

Claims stay conservative: the packet and the confirmation describe preparation
assistance, the homeowner reviews/signs/files, no legal advice, and no outcome,
acceptance, or savings guarantee. Asserted directly in the copy suite.

> **Corrected after independent audit.** The first revision described this as a
> sweep of the whole tree. It was not: the test iterated a hardcoded five-file
> list and silently skipped missing files, so a new customer-facing 24-hour
> promise anywhere else would have shipped undetected — the auditor proved it by
> planting one. The test now walks `app/`, `lib/`, `components/` and `content/`
> and fails on any unexempted match, and a second test guards the guard. The
> first revision also claimed *every* remaining "24 hours" in the tree was
> enumerated; it enumerated only those under `app/`, `lib/` and `components/`
> and missed `PRD-BILLING-OVERHAUL.md:77`, a historical PRD rather than shipped
> copy, which is now listed as an exemption.

---

## 4. Files changed

```
A  __tests__/checkout/business-days.test.ts
M  __tests__/checkout/session-contract-reuse.test.ts
M  __tests__/checkout/session-window-gates.test.ts
A  __tests__/copy/delivery-promise.test.ts
A  __tests__/fulfillment/t2-artifact-producer.test.ts
M  app/api/checkout/session/route.ts
M  app/checkout/success/page.tsx
A  lib/checkout/business-days.ts
M  lib/checkout/ot-contract.ts
M  lib/email/send.ts
M  lib/fulfillment-runtime/t2-artifact-producer.ts
M  lib/fulfillment-runtime/t2-artifact-workflow.ts
A  lib/fulfillment/t2-artifact-content.ts
A  lib/fulfillment/t2-comparables.ts
```

`t2-artifact-workflow.ts` changed only to widen its `UNAVAILABLE` blocker union
from the single stub code to the producer's refusal vocabulary.

`lib/checkout/ot-contract.ts` is **outside the two blockers this brief named**,
and it is changed anyway. The independent audit found that its policy registry
lookup could be satisfied by an inherited `Object.prototype` key, which opens
the policy half of the live paid-checkout gate on an environment value alone.
The brief required preserving every fail-closed gate and keeping paid checkout
closed throughout; leaving a known environment-variable route into that gate
while this candidate's central claim is that no such route exists was not
defensible. The change is two lines and strictly narrowing: it can only make the
gate harder to open, never easier. A reviewer who disagrees can revert exactly
those two lines without touching anything else.

The Stripe expiry clamp moved from an unexported helper inside the route into
`stripeSessionExpiry` in the business-day module. It had no test at all after
the product cutoff consumed its only case; it now has seven, including a
property test asserting it cannot fire for any window the product cutoff allows.

One pre-existing test changed behaviour deliberately.
`session-contract-reuse.test.ts` had a case proving the Stripe clamp refused a
same-day close without stranding a `CHECKOUT_CREATING` order. The product cutoff
now refuses that request earlier and for the better reason, and because it runs
before any order row is written the original invariant is strengthened: there is
no order to strand. The test now asserts `state.orders.size === 0`. Behind a
three-business-day floor the Stripe clamp is no longer reachable on this path; it
is retained as defence in depth and that is recorded in the test.

---

## 5. Verification

All commands run in the candidate worktree at `4302d8ad`.

| Check | Result |
|---|---|
| `git diff --check` | clean |
| TypeScript vs base | **251 diagnostics, identical to base** ignoring line/column shifts. Zero attributable to any new or changed file. (The first revision said 257; that was a line count of the compiler output including six wrapped continuation lines, not a diagnostic count.) |
| Focused suites (normal) | `__tests__/checkout`, `__tests__/fulfillment`, `__tests__/copy` — 28 suites, 817 tests, all pass |
| Focused suites (serial) | same, `--runInBand`, all pass |
| Full suite (serial) | **127 suites passed, 2453 tests passed, 77 skipped, 0 failed**, exit 0 |
| Production build | `next build` exit 0 |
| Prisma | no schema, migration, or Prisma file touched — validation not applicable |
| Changed-file secret scan | no secret added. One pre-existing `sk_test_contract` dummy in a file I edited elsewhere; `git diff` adds zero secret-shaped lines. |
| Raw PIN scan | every PIN in new fixtures is in a synthetic `99…` block Cook County does not issue. No owner, buyer, or seller name anywhere. |
| Lint | `npm run lint` fails identically at base and candidate (`next lint` was removed in Next 16; it reads "lint" as a directory). Pre-existing, unchanged. |
| Prettier | base is already unclean on all six pre-existing files touched; new files follow the same house style. Running `--write` would reformat unrelated code and widen the diff, so it was not run. Status unchanged relative to base. |

The TypeScript baseline was produced from a pristine worktree at the identical
base SHA rather than assumed.

New tests: 64 (32 business-day including the extracted Stripe clamp, 45 producer
less shared, 6 copy, 6 route cutoff). What they prove, against the brief's list:

- live paid checkout stays 409 while the registry is unsigned — and stays 409
  with a verified open window, and with a signed policy but unverified window;
- producer success is reachable **only** through injected fixtures, and the
  live-resolver path refuses before loading an order;
- a refusal emits no bytes, no provenance, no text, no manifest;
- artifact bytes are identical across runs and across shuffled candidate order,
  **including when the same PIN arrives twice with conflicting attributes** (see
  the correction below);
- comparable provenance is complete, and selection is proven non-directional by
  permuting every assessed value and by reversing candidate order;
- condo/missing sqft, missing assessed value, multi-PIN, outside Cook County,
  non-residential class, insufficient comparables, missing comparable value,
  stale snapshot, synthetic authority, closed window, wrong parcel, incomplete
  source manifest, and below-threshold all fail closed with named blockers;
- three-business-day arithmetic across weekdays, weekends, injected holidays,
  both DST transitions, and the exact Chicago midnight boundary;
- the Stripe 30-minute minimum cannot reopen a product-closed window;
- every 24-hour promise is removed or a named exemption, with the sweep proven
  to fail on a planted offender;
- the policy registry refuses all twelve inherited `Object.prototype` keys, and
  the producer refuses through the **real** default gateway with no injection;
- conflicting duplicate comparable rows produce the same result in either order.

---

## 6. Artifact example (synthetic data only)

Generated from the synthetic fixtures above; no real parcel, order, or person.
Bytes SHA-256 `34fd9b5afb2c055b57ae07c721e60eb74292de567910f7c882e04ce65466085d`,
7,988 bytes.

```
OVERTAXED IL — ASSESSOR-STAGE EVIDENCE PACKET
=============================================

OverTaxed IL analyzes public Cook County records and prepares a defined
Assessor-stage appeal packet. You review it, sign it, and file it yourself.

The $69 packet is a preparation service. We prepare it; you review it, sign it,
and file it with the county yourself.
...
1. YOUR PROPERTY, AS THE COUNTY PUBLISHES IT
PIN:                      99010010010000
Building area:            1,200 sq ft
Assessed total value:     $31,500
Assessed value per sq ft: $26.25

2. HOW THE COMPARABLE PROPERTIES WERE CHOSEN
Selection rule: R1-same-neighborhood-class-subtype-sqft25-yrblt15-median-v1
  - same Assessor neighborhood (99010); same class (203); same residence type;
  - building area within 25% (900-1,500 sq ft); year built within 15 years.
Every property that met those conditions is listed. None was excluded for
having a higher or lower assessment ...

3. THE COMPARABLE PROPERTIES
99010010020001  100 EXAMPLE AVE   1,150  1952  $23,000  $20.00
99010010020002  102 EXAMPLE AVE   1,180  1953  $24,200  $20.51
99010010020003  104 EXAMPLE AVE   1,220  1954  $24,600  $20.16
99010010020004  106 EXAMPLE AVE   1,240  1955  $25,400  $20.48
99010010020005  108 EXAMPLE AVE   1,260  1956  $26,000  $20.63
99010010020006  110 EXAMPLE AVE   1,300  1957  $27,300  $21.00

4. THE COMPARISON
Your assessed value per square foot:              $26.25
Median across the 6 comparables above:            $20.50
Difference, as a share of the comparable median:  +28.1%

That is arithmetic on published assessed values and published building areas.
It is a description of the public record and nothing more. It is not a finding
that your assessment is wrong, not an estimate of any tax change, and not a
prediction of what the Assessor or the Board of Review will decide.
```

Sections 5 through 8 carry the filing window with CC-08 provenance, the source
manifest with a retrieval timestamp per dataset, CC-17/CC-13/CC-14/CC-12, and
the canonical-JSON provenance manifest.

**One scope boundary, stated plainly.** The free-versus-paid evidence matrix
lists a drafted uniformity argument in the homeowner's voice as part of the paid
delta. That component is persuasive prose whose content policy sits under OD-5,
which is unsigned. It is omitted rather than invented; the packet says so in
plain text and the manifest records `draftArgumentIncluded: false` with the
reason. If the owner wants that component, it needs an OD-5 ruling — that is a
product decision, not an implementation gap.

---

## 7. What still blocks revenue

Nothing in this candidate opens paid checkout. In order:

1. **Owner signature for OD-2 and OD-3.** The registry stays empty until an
   owner decision lands in code. The 1,200-PIN study supports an owner decision
   only; it does not choose a value, and R2/30% is deliberately **not** encoded
   here.
2. **Current-year revalidation.** The study ran on tax year 2025, the most
   recent year complete in all 38 townships. 2026 carried mailed values for only
   23 of 38 and no board values. Any signed threshold has to be re-verified
   against the year being sold into.
3. **A trusted live official deadline snapshot.** `data/deadlines/cook-county.json`
   is still `synthetic: true`, so the canonical state refuses it and both the
   window gate and the producer stay closed independently of policy.
4. **A production county data gateway.** `loadCountyData` is deliberately
   unwired. It must read building area, residence type and assessed value for
   the subject and for its whole Assessor neighbourhood with per-dataset
   retrieval timestamps. `getComparableEquity` cannot be reused: it ranks by
   lowest assessed dollars per square foot and caps its cohort at 150 unordered
   parcels.
5. **A holiday authority for the business-day rule.** None exists in the
   repository. Omitting holidays can only *overstate* the days remaining, which
   is the fail-open direction, so this needs a named source before the cutoff is
   relied on near a county holiday.
6. **Checkout enablement, deployment, environment selection**, then a real
   checkout smoke, each a separate approval.
7. **Condominiums remain unservable** by any per-square-foot rule: 31% of
   class-2 parcels have no published improvement characteristics. They refuse
   with `MISSING_BUILDING_SQFT`, which is honest, but it is a coverage decision
   the owner should see.
8. **Draft argument component** — OD-5, as above.

**Smallest next step:** an independent exact-SHA review of `4302d8ad`. It needs
no owner policy decision, nothing is deployed or enabled by it, and it is the
only gate between this candidate and being ready to sit behind a future OD-2/OD-3
signature.

---

## 8. Rollback posture

Local branch only; `main` is untouched. Rollback is `git branch -D
cc/ot-paid-fulfillment-readiness-20260903` and removing the worktree — nothing
is published, deployed, or enabled.

Even if this were merged and deployed as-is, behaviour would be unchanged:
`OT_T2_ARTIFACT_BINDING_ENABLED` and `OT_T2_FULFILLMENT_EVIDENCE_ENABLED` are
default-off, the producer refuses on the unsigned registry, and the new checkout
cutoff can only refuse requests that the existing eligibility gate would have to
have allowed first — and it allows none today. The one user-visible change on a
merge would be the delivery-promise wording, which is a correction.

---

## 8b. Response to the independent adversarial audit

An adversarial audit of `4302d8ad` was run from a fresh context that had not seen
the author's reasoning. It returned `BLOCKED_NEEDS_REMEDIATION` with no blockers,
one HIGH, four MEDIUMs, four LOWs and three NITs. **Every finding was reproduced
before being accepted**, and every one was real. All are now fixed.

| Finding | Status | Fix |
|---|---|---|
| HIGH-1 prototype-chain escape opens the checkout policy gate | reproduced, **fixed** | `Object.create(null)` registry plus a `hasOwnProperty` guard in `ot-contract.ts`; test covers all twelve keys |
| MEDIUM-1 duplicate PINs resolved by arrival order | reproduced, **fixed** | duplicates resolved by content before filtering; conflicting rows dropped with a named reason |
| MEDIUM-2 copy "sweep" iterated a hardcoded list | reproduced, **fixed** | real filesystem walk over four roots, plus a guard-the-guard test; verified to fail on a planted offender |
| MEDIUM-3 headline test used an injected stub, not the live resolver | reproduced, **fixed** | new test calls `generateT2Artifact` with no gateway |
| MEDIUM-4 the only Stripe-clamp test was deleted | reproduced, **fixed** | clamp extracted to `stripeSessionExpiry` with seven tests |
| LOW-1 `UNSUPPORTED_PROPERTY_CLASS` covered out-of-county | reproduced, **fixed** | new `OUTSIDE_COOK_COUNTY` blocker |
| LOW-2 `COMPARABLE_VALUE_INCOMPLETE` covered a missing address | reproduced, **fixed** | new `COMPARABLE_ADDRESS_MISSING` blocker |
| LOW-3 comparable addresses truncated to 36 chars | reproduced, **fixed** | column sized to the widest address |
| LOW-4 `PRD-BILLING-OVERHAUL.md` missed by the enumeration | reproduced, **fixed** | added as an exemption; it is a historical PRD, not shipped copy |
| NIT-1 `close_date_invalid` returned for an unusable clock | accepted, not changed | fails closed either way; renaming it would churn the public decision type for a label |
| NIT-2 threshold comparison FP-sensitive at the exact boundary | accepted, not changed | monotone and refuses at the boundary, which is the conservative direction |
| NIT-3 `minimumBusinessDays: 0` would allow a same-day close | accepted, not changed | not reachable from the route; the parameter exists for tests |

Six claims in the first revision of this report were false or overstated. All six
are corrected in place above: the "no environment variable" claim, the
"before it loads an order" claim, the shuffled-order determinism claim, the
"every remaining 24 hours is enumerated" claim, the 257-diagnostic count (it is
251), and the test name asserting the live resolver was used.

The audit also confirmed, after genuinely trying to break them: the
non-directional selector survived 200 value permutations, 200 order shuffles,
ties, duplicates, invalid fields and boundary sweeps; all 30 refusal paths emit
only `{ok, blocker}`; the business-day arithmetic matched an independent
reference implementation exactly across a 400-day span including both DST
transitions; and every verification figure in the first revision reproduced.

What the audit did **not** verify is recorded in its own report: the 1,200-PIN
study's empirical claims, Rule 15's actual text, the real Cook County holiday
schedule, any live or Preview behaviour, and whether the Gate A ruling says what
this code claims. Those remain open for the independent reviewer.

---

## 9. Zero-side-effect ledger

| Surface | Action |
|---|---|
| `main` / GitHub refs | untouched. `origin/main` `ab1a21a…`, PR #38 `05072b60…`, PR #39 `dfd4365f…` all unchanged; both PRs read only. |
| Other worktrees | untouched. Main checkout porcelain SHA-256 byte-identical to its recorded August value. |
| Push / PR / merge | none |
| Deploy / Vercel / env / secrets | none |
| Prisma schema, migration, database | none. No Production or Preview database contacted. |
| Stripe, payments, providers | none. No provider client constructed outside mocked tests. |
| Customer, order, lead, email data | none read. No email sent. |
| Network | none. No data collection was performed in this task. |
| Public claims, outreach | none |
| Local commits | one, on a local-only branch |

The only writes are inside the candidate worktree and this report.
