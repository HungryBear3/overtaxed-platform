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
So are Production-env requests on any host outside the existing marketing gate
(`overtaxed-il.com`, `www.overtaxed-il.com`), including `*.vercel.app` deployment
URLs, and requests with no host header, in both success branches. Those requests
still get their result, with `measurement: excluded`. The route reads
`x-forwarded-host`, then `host`, through the existing `hostFromRequest`; what
Vercel actually sends in those headers has not been observed.

Code pairs use the existing finite server registry. Unknown/malformed/null/code
objects never persist their submitted values and become `unknown`. An explicit
client observation without codes becomes `untagged_request`, **not organic** or
proven first touch. Older clients with no observation become `unknown`. Current
URL dedicated codes precede existing approved stored codes; this is request
attribution, not a new immutable first-touch system. No raw UTM, URL, referrer,
PIN, address, email, IP, browser id or property-derived hash is stored.

`unknown` also covers a stored reference that cannot be used: storage that cannot
be read, a corrupt record, or a record the current registry rejects (including a
withdrawn code). Only the presence of the record is checked, by a helper used
solely here; its value is not forwarded, and checkout attribution is unchanged.

`untagged_request` means "no readable sign of a tag on this request", NOT "arrived
without a campaign". It can still hold real campaign visitors, because these
leave no local trace and adding one would be new state:
- a capture write that failed at landing;
- a tag rejected at landing, once the visitor has navigated away from that URL;
- a touch older than the 30-day expiry, which is removed by design;
- a tag reached only by client navigation. Capture runs once on mount, so the tag
  counts while its URL is current and is lost after the next navigation.

The last case does not affect a direct hard landing on `/check`, the proposed
trial shape: capture runs and the tag is also on the URL at submit. It would
affect internal links carrying tags, so the trial must not use them. Capture
stays mount-only because changing it would also change checkout attribution.
Attribution loss undercounts campaign rows, so cost per completed request can
read high. None of this is called organic.

Only current known code references or fixed markers leave the new client helper.
Existing raw-UTM capture elsewhere is not a measurement input and is unchanged.

## Internal tests (default OFF)

`OT_FREE_CHECK_INTERNAL_TEST_CLASSIFICATION_ENABLED=1` is a separate switch,
unset everywhere. When on, a request is an internal test only if it carries the
fixed body marker `freeCheckInternalTest: "requested"` (sent by the three
surfaces when the page URL has exactly one `ot_internal_test=1`; duplicates or
any other value request nothing) AND the existing signed
NextAuth session has role `ADMIN` with an id. The marker alone is ignored; a
non-admin, missing or unreadable session is measured exactly as before. The
result is unchanged; the response says `measurement: internal_test`, no ledger
row is written, and the browser skips `free_check_completed`/`qualified`
(`free_check_started` fires before the verdict and still counts).

No schema change, relabel or backfill. Rows persisted before this switch was
active, including the first Production completions, keep their recorded
attribution state; the export reports
`customerProvenance: unverified_rows_may_include_unclassified_tests` and never
calls them customer or organic. Enabling requires config review; GA4 internal
traffic filters are not configured by this change.

## Semantics and failures

Each successful server evaluation gets a fresh server UUID. Repeated HTTP
requests/retries count as separate evaluations, even for the same property.
The owner-accepted unit is completed requests, not unique leads. There is no
unique-homeowner, unique-lead, unique-result or cross-browser claim, and no
unique-tracking or fingerprinting system is part of this slice.
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
   No Prisma schema edits or paid-order table changes. The migration revokes ALL
   from PUBLIC, `anon`, `authenticated` and `service_role`. The intended runtime
   and export identity is the restricted, non-owning `ot_prod_app`, authorized
   only by the separately approved binding in `prisma/measurement-production-binding`.
   Without that binding, the restricted runtime returns `measurement: unavailable`.
   Do not make the runtime the table owner. Production's actual runtime identity
   is unverified and must be confirmed before release.
3. Rehearse successful writes, timeout/failure semantics, sample exclusion and
   real three-surface transport on isolated environment before Production.
4. Separately approve/activate the flag, verify live evidence, recording start
   time and capture health externally (the ledger cannot count its failed writes).
5. Separately approve campaign codes/creative pair, experiment, actual landing
   eligibility, budget, run dates and stop rules. Empty registries authorize none.
6. Verify GA4 read access, sanitized source mapping and ad-account readback; no
   claim that this request ledger alone makes a trial measurement-ready.

As written before release: the migration had not been executed on any live or
hosted database, and no network/provider test had occurred. Status 2026-11-09:
coordinator-supplied release evidence records the dedicated measurement
runtime released to Production on 2026-11-04 (see
`docs/ops/ot-measurement-dedicated-runtime-result.md`). That is cited, not
re-verified by a hosted read. The internal-test switch above is not part of
that release and remains unset.

## Local verification

Exact results for the current revision are in the correction `RESULT.md`.

- The migration's ACLs run in an automated suite on a disposable socket-only
  PostgreSQL cluster with Supabase-style default grants, and it skips itself if
  `initdb`/`pg_ctl` are absent. This proves the migration against that fixture,
  not Production's hosted ACLs or default privileges.
- Mocked Prisma statements in the route and storage suites are not migration
  acceptance.
- Existing surface tests print jsdom `window.scrollTo` not-implemented notices;
  tests still pass.
