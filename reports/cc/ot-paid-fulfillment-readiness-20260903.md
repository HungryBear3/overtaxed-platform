# OT paid-fulfillment readiness — local candidate

**Verdict: `PASS_LOCAL_REMEDIATION_FOR_INDEPENDENT_REVIEW`** (revision 3, the
bounded remediation after the independent exact-SHA review of `a5628ced` —
see §8c. That review returned `FAIL`; its findings, not this report's earlier
PASS narrative, are the authority for revision 3.)

Prepared 2026-09-03, revised 2026-09-04. Local implementation, local commits,
synthetic fixtures and tests only. No policy signature, checkout opening, push,
PR, merge, deploy, migration, environment or secret change, Production or
Preview database access, Stripe call, customer contact, email, payment,
provider action, public claim, or outreach was performed or is implied by this
candidate.

This removes two of the paid-fulfillment blockers that do **not** depend on the
unsigned eligibility policy: the T2 artifact-producer HOLD stub and the missing
Chicago three-business-day cutoff. It does **not** remove a third, which the
independent review found this report had previously misdescribed: the artifact
binding workflow has no runtime caller, so a separate orchestration slice is
still required before any paid T2 order can be fulfilled (§2, §7). OD-2 and
OD-3 remain unsigned, the signed-policy registry remains empty, and real paid
checkout remains closed throughout.

---

## 1. Exact identities

| | |
|---|---|
| Repository | `HungryBear3/overtaxed-platform` |
| Required base | `ab1a21a633186b96262c653399593508f85539d6` — **matched** |
| Worktree | `/Users/abigailclaw/cc-worktrees/ot-paid-fulfillment-readiness-20260903` |
| Branch (local only) | `cc/ot-paid-fulfillment-readiness-20260903` |
| Parent | `ab1a21a633186b96262c653399593508f85539d6` |
| First candidate (audited) | `4302d8ad54e49237abdfb81af67e83016bf2e78b`, tree `cc318ac8…` |
| **Current HEAD (post-remediation)** | **`a5628ced46b6084b8f339fec78f8810e030c8b38`** |
| Tree | `4a1d82ae178004f4341abe8866cc978b11cec4eb` |
| Working tree | clean (`git status --porcelain` empty) |
| Diffstat vs base | 15 files changed, 3259 insertions, 37 deletions (report included) |
| Diff SHA-256 vs base, code only | `a2d196214e7930c2a298dc2cbab7e9c2e64957098805ed317e22a6e8deefc557` |
| Diff SHA-256 vs base, code + report | `343e8e8246c9551e84ed5532f62e1b463a35e837e62d8b0b2473e14ed9ffffe3` |
| Report-only follow-up | `9d02ced55ec03742d841b74352ff646c45dde02a`, tree `7dbcebfc…`, parent `a5628ced` |

**Revision 3 — the bounded remediation commit (2026-09-04).** Exactly one new
commit after `9d02ced`, on the same branch, amending nothing. Its own SHA
cannot appear inside the report it carries; it is sealed in the remediation
handoff and in `~/cc-worktrees/ot-paid-fulfillment-remediation-20260904-out/`.
What can be bound here is the code it contains:

| | |
|---|---|
| Parent | `9d02ced55ec03742d841b74352ff646c45dde02a` |
| Frozen failed review target | `a5628ced46b6084b8f339fec78f8810e030c8b38` (independent review: `FAIL`, three MEDIUM) |
| Remediated review target | the single commit after `9d02ced` — the new branch HEAD |
| Code-only diff SHA-256, `ab1a21a..HEAD` (`git diff --binary`, `reports/` excluded) | `ba6b7e58b3e0d682080bb26de18ea68f959449b0a8df91c5976618bd1e7133f4` |
| Code-only diff SHA-256, `a5628ced..HEAD` | `214438fb37cd4783748aca14ff188e11412896a51b419ea485d0ce4e5e183c8c` |
| Code files changed vs `a5628ced` | 7 (three tests, four modules); 1,948 insertions, 924 deletions, of which the large majority is Prettier normalisation of the six candidate-created files |
| Code files changed vs base | 14, as before; no new file |

**The review target has moved twice.** `4302d8ad` was audited and found to
need remediation; `a5628ced` was independently reviewed and found to need this
bounded remediation; the commit after `9d02ced` is what should be reviewed
now. `bd49efea` and `9d02ced` are report-only.

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
  -> [STOP] nothing invokes the binding workflow. NO RUNTIME CALLER EXISTS.

runT2ArtifactBindingWorkflow (OT_T2_ARTIFACT_BINDING_ENABLED)   <<< reachable from tests only
  -> generateT2Artifact          <<< WAS THE HOLD STUB
  -> size gates -> content-addressed upload -> read-back byte compare
  -> bindT2Artifact -> transactional bind -> ARTIFACT_READY
  -> delivery/email strictly outside the workflow, after a successful bind
```

> **Corrected after independent review (M1).** Revisions 1 and 2 of this
> report drew an arrow from `kickoff.ts` to `runT2ArtifactBindingWorkflow` and
> said "every downstream stage was already built and tested; the producer was
> the single reason a paid T2 order could never be fulfilled." That was false.
> A repo-wide search excluding tests finds exactly one occurrence of
> `runT2ArtifactBindingWorkflow`: its own `export`. Nothing in the billing
> webhook, `kickoff.ts`, any `vercel.json` cron, or any admin route invokes it.
> The webhook reaches kickoff, kickoff records `ARTIFACT_PENDING`, and there the
> runtime path stops. A separate orchestration slice — deciding who invokes the
> workflow, when, under what lease, and with what retry policy — is still
> required before any paid T2 order can be fulfilled, and it is listed as a
> revenue blocker in §7. It is deliberately **not** implemented in revision 3.

`generateT2Artifact` has exactly one caller, `runT2ArtifactBindingWorkflow`,
and before this candidate returned
`{ ok: false, blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE" }` unconditionally.
The stages downstream of the producer are built and tested; the stage upstream
of the workflow does not exist.

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
`ORDER_NOT_FOUND`, `FULFILLMENT_NOT_FOUND`, `FULFILLMENT_ORDER_MISMATCH`,
`GENERATION_INSTANT_UNAVAILABLE`, `SUBJECT_RECORD_UNAVAILABLE`,
`COMPARABLE_SOURCE_UNAVAILABLE` and the retained
`T2_ARTIFACT_PRODUCER_UNAVAILABLE` for a thrown producer.

**The determinism contract, stated precisely (revision 3).** Artifact bytes
are a pure function of: the order (id, PIN, address), the fulfillment's
immutable `createdAt`, the signed policy snapshot, the deadline authority
snapshot (close date, source, retrieval instant), the county records handed to
selection, and the producer/template version. **No wall-clock reading enters
the bytes.** `generatedAt` is the fulfillment row's `createdAt` at second
precision — kickoff creates that row with create-only upsert semantics directly
in its initial status, so for an eligible order it is the instant the
fulfillment entered `ARTIFACT_PENDING`, and the column is never rewritten. The
business-day figure in the manifest is measured from that same instant
(`businessDaysRemainingAtGeneration`). The runtime clock is sampled **once**
per attempt and used only for attempt-time gate decisions — deadline freshness
and the three-business-day cutoff — which refuse but never render; the default
gateway passes that single sample into deadline projection rather than reading
a second ambient clock. Consequently two attempts on different days produce
byte-identical packets and identical SHA-256s, and a retry after an ambiguous
bind replays through `isIdenticalBinding` as an idempotent no-op rather than an
`ARTIFACT_BINDING_CONFLICT`. Fail-closed behaviour for a genuinely different
artifact (changed sources, changed policy) is unchanged: it still conflicts.

> **Corrected after independent review (M2).** Revision 2 embedded
> `gateway.now()` in the bytes and consulted the clock twice, so "byte-identical
> on every run" was true only under an injected clock; a production retry would
> have produced a different hash and hit a conflict. The prerequisite the
> review asked for — a stable, persisted generation instant — exists without
> widening the data model: `OTFulfillment.createdAt`. The gateway now loads the
> fulfillment row, refuses `FULFILLMENT_NOT_FOUND` / `FULFILLMENT_ORDER_MISMATCH`
> (wrong order or wrong kind) / `GENERATION_INSTANT_UNAVAILABLE`, and a test
> proves identical bytes and provenance across two attempts three days apart.

The manifest preserves everything needed to bind an artifact to how it was made:
policy version, owner decisions, signature date and both thresholds; the
selection rule id, tolerances and an explicit `selectionIsDirectional: false`;
**the candidate pool exactly as selection received it** — raw row count before
any filtering or deduplication (`candidateCount`), accepted count, an
exhaustive zero-filled count of rejections by bounded reason
(`candidateRejectedByReason`), and a domain-separated SHA-256 over the sorted
canonical JSON of every candidate row (`candidatePoolSha256`, domain
`ot-t2-candidate-pool/v1`); the exact comparable PIN list and count; the Rule 15
required and recommended minimums and whether the recommendation was met;
subject and median dollars per square foot and the relative gap; the deadline
source, URL, retrieval instant, close date and business days remaining at
generation; every dataset id, title, URL, retrieval timestamp and — when the
source supplies one — a content SHA-256, with `null` recorded explicitly when it
does not; and the producer and template versions (`1.1.0`). The manifest is
rendered as canonical JSON inside the artifact bytes, so the content hash covers
it. The packet body prints the candidate count and explains what the pool hash
lets a reviewer check.

> **Corrected after independent review (M3).** The value-blind selector
> guarantees that *selection* cannot rank by value; it cannot know what it was
> not shown. Revision 2's manifest recorded nothing about the pool, so a
> gateway that handed over only the lower-valued half of a neighbourhood would
> have produced a packet stating "every property that met those conditions is
> listed" with no evidence trail — the review demonstrated exactly that. The
> pool is now bound (count, rejections, digest), and a test shows the whole
> ten-parcel neighbourhood and its stripped five-parcel subset carry different
> `candidatePoolSha256` values even though only the stripped one yields a
> packet. This makes a pre-filtered pool **detectable**, not impossible: the
> county gateway slice (§7) must hand over the whole neighbourhood, and a
> reviewer holding the county's records can now check that it did.

Two identity notes recorded after review, without behaviour change: the PIN is
the canonical subject identity — township and street address are rendered from
the county record but not cross-checked against the order in the producer,
because the binder separately verifies the order's PIN and normalised address
against provenance (N1); and class 200 (vacant residential land) passes the
coarse class gate and is then refused by the building-area gate, which is the
intended refusal (N2).

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

> **Widened after independent review (L4).** The sweep now walks every shipped
> root — `app/`, `lib/`, `components/`, `content/`, `public/`, `hooks/`,
> `styles/`, `types/` — over `.ts/.tsx/.js/.jsx/.md/.mdx/.json/.html/.txt/.svg/
> .xml/.css`, and matches "24 hours", "24-hour", "24 hrs", "24hrs",
> "twenty-four hours" and "within a day". One file under `public/` matched:
> `public/downloads/landlord-notices/03-entry-notice.md`, an Illinois landlord
> entry-notice template describing customary 24-hour advance notice to a
> tenant. It is statutory-practice content, not an OverTaxed delivery promise,
> and is allow-listed by exact path with that reason rather than by weakening
> the scan. The guard-the-guard test now plants every phrasing. No customer
> delivery promise in any of those forms exists anywhere in the tree.

**Session lifetime versus the cutoff (disclosed after review, L5).** The
three-business-day rule gates the *creation* of a hosted Stripe Checkout
Session. A session created with exactly three business days left remains
payable for its bounded lifetime — the lesser of 24 hours and the Chicago end
of the close day — so a buyer holding that URL can complete payment up to one
calendar day later, with two business days left. The same is true of the
reuse path when a prior session is still open, since reuse sits after the
gate. This is inherent to hosted checkout and is bounded by the session
expiry; checkout timing behaviour is deliberately unchanged in revision 3.

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

Revision 3 touches seven of these and adds none: `t2-artifact-producer.ts`
(stable generation instant, single clock sample, fulfillment lookup),
`t2-artifact-content.ts` (pool provenance, source content hash, control-safe
rendering, version `1.1.0`), `t2-comparables.ts` (bounded reason vocabulary,
pool digest, rejection counts), the producer and copy suites, and — by Prettier
only — `business-days.ts` and its suite. `t2-artifact-producer.ts` and this
report are the two changed files still unclean under Prettier: the producer
module was already unclean at base and is left in the house style of its
neighbours, and the report is prose.

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

Revision 2's figures were produced at `a5628ced` (the header of this section
previously said `4302d8ad`; that was stale). Revision 3's figures below were
produced in the candidate worktree at the remediation commit's exact tree,
immediately before it was committed, with a fresh `npm ci`.

| Check | Result (revision 3) |
|---|---|
| `git diff --check` | clean |
| TypeScript vs base | **82 diagnostics at candidate, 82 at base**, identical set ignoring line/column shifts; zero in any changed file. The baseline was produced from a pristine detached worktree at `ab1a21a` sharing the same `node_modules`. (Revision 2 reported 251/251 from a different environment; the absolute count depends on the generated Prisma client, the candidate-vs-base identity is what is asserted.) |
| Focused suites (normal) | business-days, session-contract-reuse, session-window-gates, delivery-promise, and every `__tests__/fulfillment/` suite — all pass |
| Focused suites (serial) | same, `--runInBand`, all pass |
| Full suite (serial) | **127 suites passed, 2469 tests passed, 77 skipped, 0 failed**, exit 0 (16 new tests over revision 2) |
| Production build | `prisma generate` + `next build`, exit 0, "Compiled successfully" |
| Prisma | no schema, migration, or Prisma file touched — validation not applicable |
| Changed-file secret scan | no secret-shaped addition in the diff |
| Raw PIN / PII scan | every 14-digit PIN added is in the synthetic `99…` block; no owner, buyer, or seller name; no e-mail address |
| Lint | `npm run lint` fails identically at base and candidate (`next lint` removed in Next 16). Pre-existing, unchanged; no changed-file regression is measurable through it. |
| Prettier | **all six candidate-created files are now clean** (`prettier --check` passes). The eight pre-existing files touched by the candidate were already unclean at base and were deliberately not reformatted. |
| Red-first evidence | the revised producer and copy suites were run unchanged against the frozen `a5628ced` tree in a detached review worktree before the implementation landed: **16 producer tests failed** there (missing exports, old blockers, wall-clock bytes) and pass at the remediation tree. The widened copy guard had no live offender to turn red on; its new phrasings are exercised by the guard-the-guard case instead. |

Adversarial probes reproduced in-suite (revision 3): stable replay bytes and
provenance across two attempts three days apart; clock sampled exactly once and
handed to deadline resolution; whole-versus-stripped pool hashes differ while
only the stripped pool yields a packet; exhaustive zero-filled rejection counts
over a twelve-row pool with every rejection reason represented; newline,
carriage return and tab in subject and comparable text rendered as single
spaces with no control character surviving; malformed source content hash
refused; missing / mismatched / wrong-kind / invalid-instant fulfillment all
refused with no bytes; every 24-hour phrasing detected and the approved wording
not.

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

Generated (revision 3, producer `1.1.0`) from the producer suite's synthetic
fixtures — subject `99010010010000` at $25.00/sq ft, six comparables at $20.00/sq
ft, generation instant `2026-06-08T10:15:30Z`; no real parcel, order, or person.
Bytes SHA-256 `f6a012b3aec894f2a331d5d10d11e9317d90077dc6366a455e058caa9ef9f90f`,
8,853 bytes. Reproducible from `lib/fulfillment/t2-artifact-content.ts` with
those inputs on any machine.

```
OVERTAXED IL — ASSESSOR-STAGE EVIDENCE PACKET
=============================================
...
Prepared: 2026-06-08T10:15:30Z          <- fulfillment createdAt, not the clock
Order reference: ord_synthetic_0001
Producer: t2-evidence-packet/1.1.0

1. YOUR PROPERTY, AS THE COUNTY PUBLISHES IT
PIN:                     99010010010000
Building area:           1,200 sq ft
Assessed total value:    $30,000
Assessed value per sq ft: $25.00

2. HOW THE COMPARABLE PROPERTIES WERE CHOSEN
Selection rule: R1-same-neighborhood-class-subtype-sqft25-yrblt15-median-v1
  - same Assessor neighborhood (99010); same class (203); same residence type;
  - building area within 25% (900-1,500 sq ft); year built within 15 years.

Candidate rows handed to selection: 6
  6 qualified; 0 did not, counted by reason in the provenance manifest.
The manifest also carries a SHA-256 over every candidate row exactly as it
was received, so a reviewer holding the county's published neighbourhood
records can confirm that selection was shown the whole neighbourhood and
not a subset of it.

Every candidate row that met those conditions is listed. None was excluded
for having a higher or lower assessment ...

3. THE COMPARABLE PROPERTIES
99010010020001  1 EXAMPLE AVE   1,200   1955     $24,000     $20.00
...
99010010020006  6 EXAMPLE AVE   1,200   1955     $24,000     $20.00

4. THE COMPARISON
Your assessed value per square foot:              $25.00
Median across the 6 comparables above:            $20.00
Difference, as a share of the comparable median:  +25.0%

6. SOURCES BEHIND EVERY FIGURE
Assessor - Assessed Values (uzyt-m557)
  https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json
  retrieved 2026-06-08T12:00:00Z
  content sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Assessor - Single and Multi-Family Improvement Characteristics (x54s-btds)
  ...
  content hash not available from source

8. PROVENANCE MANIFEST
{"businessDaysRemainingAtGeneration":16,"candidateAcceptedCount":6,
 "candidateCount":6,"candidatePoolHashDomain":"ot-t2-candidate-pool/v1",
 "candidatePoolSha256":"60488f5296f9daa3d06a249f9e4f1475f2b8e19fb338a857a0f82d06b3de916a",
 "candidateRejectedByReason":{"building_sqft_out_of_band":0,
 "conflicting_duplicate_rows":0,"different_class":0,"different_neighborhood":0,
 "different_subtype":0,"duplicate_pin":0,"missing_or_invalid_attributes":0,
 "same_parcel_as_subject":0,"year_built_out_of_band":0},
 "comparableCount":6, ... ,"generatedAt":"2026-06-08T10:15:30Z", ...
 "producerVersion":"t2-evidence-packet/1.1.0", ...}
```

(The manifest is printed on one line in the artifact; it is wrapped here for
reading. Sections 5 and 7 carry the filing window with CC-08 provenance and
CC-17/CC-13/CC-14/CC-12, unchanged.)

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
6. **An orchestration caller for `runT2ArtifactBindingWorkflow`.** Nothing
   in the runtime invokes the binding workflow (§2, review finding M1). A
   separate slice must decide who calls it — webhook tail, scheduler, queue, or
   admin action — with what lease, retry and idempotency policy. Until it
   exists, a signed policy, a trusted snapshot and a county gateway together
   fulfil nothing. Deliberately not implemented in revision 3.
7. **Checkout enablement, deployment, environment selection**, then a real
   checkout smoke, each a separate approval.
8. **Condominiums remain unservable** by any per-square-foot rule: 31% of
   class-2 parcels have no published improvement characteristics. They refuse
   with `MISSING_BUILDING_SQFT`, which is honest, but it is a coverage decision
   the owner should see.
9. **Draft argument component** — OD-5, as above.

**Smallest next step:** an independent exact-SHA review of the remediation
commit — the single commit after `9d02ced` on this branch — against the
independent review's finding list (§8c). It needs no owner policy decision,
nothing is deployed or enabled by it, and it is the only gate between this
candidate and being ready to sit behind a future OD-2/OD-3 signature and the
orchestration slice above.

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

Six claims in the first revision of this report were false or overstated. Five
were corrected in place in revision 2: the "no environment variable" claim, the
"before it loads an order" claim, the shuffled-order determinism claim, the
"every remaining 24 hours is enumerated" claim, and the 257-diagnostic count.
Revision 2 also claimed the sixth — the test name asserting the live resolver
was used — had been corrected. **It had not**: a new live-gateway test was
added, but the misnamed test at
`__tests__/fulfillment/t2-artifact-producer.test.ts` kept its name while still
injecting `resolvePolicy: () => null`. The independent review caught this
(L1). Revision 3 renames it to "when an injected resolver returns no policy"
and the comment points at the live-gateway case.

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

## 8c. Response to the independent exact-SHA review of `a5628ced` (2026-09-04)

The review was run in a fresh session that had not authored the candidate,
against a detached checkout at exactly `a5628ced`, with every identity, the
diff hash, PR #38/#39 and the unpushed state verified first. It returned
**`FAIL`** — no HIGH, no safety blocker, every mechanical gate green — on three
MEDIUM findings and a set of LOW/NIT items, and prescribed one bounded
follow-up commit. Its report is at
`~/cc-worktrees/ot-paid-fulfillment-review-20260904-out/REVIEW-ot-paid-fulfillment-a5628ced-20260904.md`.
Revision 3 is that commit. Every finding was reproduced before being acted on.

| Finding | Status | Where |
|---|---|---|
| **M1** report claimed kickoff → workflow wiring; no runtime caller exists | **closed (report only)** — diagram and prose corrected; orchestration slice added to §7; no runtime wiring invented | §2, §7 |
| **M2** bytes embed the wall clock; determinism only under an injected clock | **closed** — `generatedAt` is the fulfillment's immutable `createdAt`; clock sampled once and passed into deadline resolution; manifest business-day figure measured from the generation instant; new blockers for a missing / mismatched / wrong-kind / invalid-instant fulfillment; replay test across two wall clocks | `t2-artifact-producer.ts`, `t2-artifact-content.ts`, §3.1 |
| **M3** manifest cannot evidence the non-directional claim; a stripped pool passes | **closed** — `candidateCount`, `candidateAcceptedCount`, exhaustive `candidateRejectedByReason`, domain-separated `candidatePoolSha256`, per-source `contentSha256` (explicit `null` when unavailable); count rendered in the body; whole-vs-stripped test; producer/template `1.1.0` | `t2-comparables.ts`, `t2-artifact-content.ts`, §3.1 |
| **L1** stale `4302d8ad` references in §5 and §7; §8b's "test renamed" claim untrue | **closed** — both references corrected; the test actually renamed; §8b corrected | §5, §7, §8b, test file |
| **L2** county text rendered raw; newline injects a body line | **closed** — every C0 control and DEL collapses to a single space at render time; manifest JSON untouched; test covers LF, CR, TAB in subject and comparable text | `t2-artifact-content.ts` |
| **L3** six new files unclean under Prettier | **closed** — all six formatted; pre-existing files left as at base | six files |
| **L4** copy sweep skipped `public/` and alternate phrasings | **closed** — eight shipped roots, six phrasings, narrow path-and-reason allow-list for the landlord notice, guard-the-guard for every phrasing | `delivery-promise.test.ts`, §3.3 |
| **L5** Stripe session lifetime can undercut the cutoff by a day | **disclosed** — §3.3; checkout timing unchanged by design | §3.3 |
| **L6** default gateway read a second ambient clock in `resolveDeadline` | **closed** — the single attempt sample is passed in | `t2-artifact-producer.ts` |
| **N1** PIN-only identity cross-check | **recorded**, no change | `t2-artifact-content.ts` comment, §3.1 |
| **N2** class 200 passes the class gate | **recorded**, no change — refused by the building-area gate | `t2-artifact-content.ts` comment, §3.1 |
| **N3** padded date accepted, time-suffixed date refused | **recorded**, no change | review report |
| **N4** no holiday authority | unchanged; already a §7 blocker | §7 |

Not closed, and not attempted, by design: the orchestration caller (M1's
underlying gap, a separate slice), the production county gateway, and every
owner decision. Nothing in revision 3 changes webhook, scheduler, queue,
deployment, checkout timing, or Production behaviour.

---

## 9. Zero-side-effect ledger

| Surface | Action |
|---|---|
| Revision 3 (2026-09-04) | one new local commit after `9d02ced`; `4302d8ad`, `bd49efea`, `a5628ced`, `9d02ced` unchanged; `npm ci` in the candidate worktree (`node_modules` is git-ignored); a detached baseline worktree at `ab1a21a` for the `tsc` comparison, removed after use; a detached review worktree at `a5628ced` used only to run the new tests red, then cleaned. No file outside this worktree and the `-out` handoff directory was written. |
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
