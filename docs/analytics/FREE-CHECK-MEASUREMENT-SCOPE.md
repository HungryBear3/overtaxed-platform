# Bounded free-check request-completion measurement — local draft

No deployment, migration, campaign approval or ad spend is authorized by this
implementation. Default OFF: `OT_FREE_CHECK_MEASUREMENT_ENABLED=1` is the sole
independent persistence gate. It does not activate order attribution or checkout.
Existing attribution and experiment registries remain unchanged/empty.

## Existing flow and scope

Three browser surfaces POST property input to `/api/free-check`. The route
resolves county evidence and evaluates the canonical outcome, including a separate
no-assessed-value success branch. Existing GA4 behavior events are client-side,
not durable server evidence. This slice adds a standalone raw-SQL table and
server hook at those two authoritative success branches. No client outcome or
result-ingestion endpoint is accepted. Errors/ambiguity are not completed checks.
Forced sample, sample-address and all non-Production environments are excluded.

Code pairs use the existing finite server registry. Unknown/malformed/null/code
objects never persist their submitted values and become `unknown`. An explicit
client observation without codes becomes `untagged_request`, **not organic** or
proven first touch. Older clients with no observation become `unknown`. Current
URL dedicated codes precede existing approved stored codes; this is request
attribution, not a new immutable first-touch system. No raw UTM, URL, referrer,
PIN, address, email, IP, browser id or property-derived hash is stored. Losing
storage or rejecting capture cannot be reconstructed and is not called organic.
Only current known code references or fixed markers leave the new client helper.
Existing raw-UTM capture elsewhere is not a measurement input and is unchanged.

## Semantics and failures

Each successful server evaluation gets a fresh server UUID. Repeated HTTP
requests/retries count as separate evaluations, even for the same property.
There is no unique-homeowner, unique-lead, unique-result or cross-browser claim.
One invocation attempts ONE INSERT, with no automatic write retry. A 750ms wait
budget prevents analytics storage from holding the result response hostage.
A timeout/connection failure reports `measurement: unavailable`, not success;
the insert may still commit after a timeout, so this status means persistence
was not confirmed, not proof of no row. No exactly-once HTTP-delivery promise.
The row records server completion, not that a browser received/read the result.
No backfill, global kill of the free check, payment mutation or provider call.

## Export and interpretation

`npx --no-install tsx scripts/ot-free-check-measurement-export.ts 2026-11-03 2026-11-04`
(UTC inclusive/exclusive dates) reads aggregate rows only when gate is on.
This is a diagnostic request-completion export with source table, registry
version, interval and unit provenance, not a new decision-packet schema.
Completed, supportive and allowCheckout counts stay separate. Supportive with
closed/unverified window must not become checkout-eligible. Missing measurement
and organic counts are null, never inferred as zero. Empty rows mean no
persisted rows, not no traffic. Error/disabled export returns groups null.
Rows alone cannot establish full coverage or ad conversion rates: reconcile with
GA4 behavior and ad click/session denominators and account for capture gaps.
No false join to decision packet's MAC-keyed unique conversion references.

## Release prerequisites

1. Independent code/schema/privacy review; owner approval of exact release.
2. Apply ONLY the dedicated additive migration using approved owner identity,
   test RLS/ACL on isolated database, verify raw SQL role and read-only export.
   No Prisma schema edits or paid-order table changes.
3. Rehearse successful writes, timeout/failure semantics, sample exclusion and
   real three-surface transport on isolated environment before Production.
4. Separately approve/activate the flag, verify live evidence, recording start
   time and capture health externally (the ledger cannot count its failed writes).
5. Separately approve campaign codes/creative pair, experiment, actual landing
   eligibility, budget, run dates and stop rules. Empty registries authorize none.
6. Verify GA4 read access, sanitized source mapping and ad-account readback; no
   claim that this request ledger alone makes a trial measurement-ready.

Migration has NOT been executed; no live database/network/provider test occurred.

## Local verification

- 17 targeted Jest suites, 369 tests passed (new route/storage/client/report
  cases plus existing address, funnel/surface and attribution suites).
- `tsc --noEmit` and `git diff --check` passed.
- Disabled CLI export returned `status: disabled, groups: null` with no DB import.
- Existing surface tests print jsdom `window.scrollTo` not-implemented notices;
  tests still pass. No production/provider requests or actual SQL execution.
- SQL role/ACL/constraint execution is explicitly unverified until an approved
  isolated-DB rehearsal; mocked Prisma statements are not migration acceptance.
