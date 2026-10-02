# OT funnel drop-off — instrumentation, report and how to read it

Local code, checked-in artifacts and tests only. Nothing is activated: no GA4,
Meta, Stripe or Vercel setting was changed, no credential was read, and no
report was run against a live property.

## The funnel

| # | Step | GA4 event(s) | Owner of the event |
|---|---|---|---|
| 1 | Landing / session | `session_start` (GA4 automatic) + `page_view` | gtag, with governed page context |
| 2 | Free check started | `free_check_started` | browser, closed contract |
| 3 | Free check completed | `free_check_completed` | browser, closed contract |
| 4 | Qualified outcome | `free_check_qualified` (outcome `supportive`) | browser, closed contract |
| 5 | Checkout attempt | `begin_checkout` + `checkout_blocked` | browser, one per intent |
| 6 | Checkout handed to Stripe | `begin_checkout` | browser, only when the server returned a hosted URL |
| 7 | Purchase | `purchase` | **server only** — the signed webhook's durable claim winner |

One checkout intent (one user-initiated submission on `/checkout`) ends in
exactly one of `begin_checkout` and `checkout_blocked`. An intent abandoned
while its request is in flight, a stale response after a back/forward restore,
and a duplicate submit emit nothing. `purchase` and `refund` cannot be written
by any browser path.

### What was already there and reused

`free_check_started`, `free_check_completed`, `free_check_qualified`,
`begin_checkout` and the server `purchase` were already wired with closed
contracts (Phase A/B). They are unchanged except that `free_check_started` is
now decision-grade (it is a required funnel step and carries the input-mode
breakdown).

### What is new

- **`checkout_blocked`** (`lib/analytics/checkout-funnel.ts`): `plan` (`T2`/`T3`)
  and `blocked_reason`, one of eleven values: `acknowledgment_required`,
  `address_ambiguous`, `property_not_found`, `window_blocked`,
  `notice_review_required`, `invalid_input`, `already_started`, `rate_limited`,
  `unavailable`, `network_error`, `unknown`. The server's `code` is only a
  lookup key (own keys only); its `error` sentence, the gate's window and
  candidate list, the HTTP status and everything the buyer typed are never
  sent. Empty `page_location`/`page_referrer`, like every funnel event. No Meta
  event.
- **Governed page context** (`lib/analytics/ga4.ts`) for `page_view`, the gtag
  `config` and every generic event:
  - `page_location` = origin + the approved landing route
    (`lib/attribution/landing-paths`; dynamic segments become their template,
    e.g. `/blog/[slug]`) or `/(other)` for any other path, plus a UTM query
    rebuilt only from governed values: `utm_source` from the closed source
    list (no query at all otherwise), then `utm_medium`, `utm_campaign`
    (owner-approved slugs only — the list is empty today) and `utm_content`,
    each only if governed. `utm_term`, click ids and every other parameter are
    dropped.
  - `page_referrer` = an allowlisted search/social host's origin (`https://www.google.com/`),
    this site's governed path, or `""`. Any other referrer is sent as direct.
  - `page_path` passed by a caller is re-governed the same way.

  **Behavior change:** account, appeal, property and checkout-success pages now
  report as `/(other)`; partner referrals from unlisted hosts report as direct;
  and `gclid`/`fbclid` are not forwarded (they were already stripped before).
  Tag partner links with governed UTM values instead.

## Campaign attribution

GA4 derives the session source/medium/campaign/content from the governed UTM
query on the landing `page_view`. The breakdowns therefore show only governed
values. **Until the owner approves campaign slugs** (`APPROVED_CAMPAIGN_SLUGS`
in `lib/analytics/campaign-governance.ts`), `utm_campaign` is never sent and
`sessionCampaignName` shows GA4 placeholders only. Source, medium and content
work today.

The first/last touches stamped into Stripe Checkout Session metadata
(`firstTouch*`/`lastTouch*`, `lib/attribution/touch-contract.ts`) are stricter
than the page context: a campaign touch is projected only when its whole
source/medium/campaign tuple (plus content, when present) passes the same
owner-approved governance, and otherwise not at all — no partial tuple and no
leftover landing. `utm_term` is never projected. A direct first touch still
stamps its landing and instant. Until a slug is approved, no campaign touch
reaches Stripe.

Campaign URLs come from the experiment registry, not by hand:
`npx tsx scripts/ot-campaign-link.ts --experiment <id>` prints the canonical
URL for one `planned` or `running` entry of an owner-approved registry, after
checking that GA4's governed page context and the Stripe projection both keep
it unchanged. It refuses anything else, and yields nothing while the registry
is empty.

## GA4 owner actions (all pending)

Machine-readable: `data/analytics/ot-ga4-admin-checklist.v4.json`, validated by
`validateGa4AdminChecklist`, verified after the fact by
`verifyGa4AdminReadback` against a read-only Admin API readback.

Event-scoped custom dimensions to create:

| Parameter | Display name | Events |
|---|---|---|
| `surface` | OT free check surface | started, completed, qualified |
| `input_mode` | OT free check input mode | started |
| `outcome_code` | OT free check outcome | completed, qualified |
| `plan` | OT checkout plan | begin_checkout, checkout_blocked |
| `blocked_reason` | OT checkout blocked reason | checkout_blocked |

Key events: **`purchase` only** (once per event). If `free_check_qualified`
was already marked as a key event from the Phase-B checklist, un-mark it — the
readback verifier reports it as `UNEXPECTED_KEY_EVENT`.

Enhanced Measurement on the web stream (Admin → Data streams → web stream →
Enhanced measurement → gear). These two are always **OFF**:

| Setting | Readback field | Why |
|---|---|---|
| `browser_history` — "Page changes based on browser history events" | `pageChangesEnabled` | The app sends its own SPA `page_view` with a governed page context; the automatic one duplicates it and carries the raw URL. |
| `site_search` — "Site search" | `siteSearchEnabled` | Lifts raw query-string values into `view_search_results`, outside the funnel contract. |

These three are the owner's decision, recorded as `owner_posture` in the
checklist: `off` (recommended) or `on_accepted`. The owner recorded `off` for
all three on 2026-10-02. If any posture is changed to `undecided`, readback fails with
`ENHANCED_MEASUREMENT_POSTURE_UNDECIDED:<setting>` whatever the stream reads.

| Setting | Readback field | Why OFF is recommended |
|---|---|---|
| `outbound_clicks` — "Outbound clicks" | `outboundClicksEnabled` | Sends `click` with the raw destination `link_url`, outside the funnel contract. |
| `form_interactions` — "Form interactions" | `formInteractionsEnabled` | Sends `form_start`/`form_submit` with form ids, names and the raw `form_destination`; the free check and checkout already report through governed funnel events. |
| `file_downloads` — "File downloads" | `fileDownloadsEnabled` | Sends `file_download` with the raw `link_url` and file name; a delivered report or packet link can identify the order. |

Readback uses read-only scope `analytics.readonly`. Independently configure
`checklist.readback.enhanced_measurement_resource` as
`properties/{property_id}/dataStreams/{data_stream_id}/enhancedMeasurementSettings`
from the intended property/stream configuration, never from a supplied response.
The checked-in target is the owner-verified Overtaxed IL property and web stream.
The checklist still cannot PASS until complete unfiltered readbacks show that the
live settings and exact custom-definition/key-event sets conform.

Pass exactly these six entries to `verifyGa4AdminReadback`:

| Unmodified Admin API response body | Separate capture evidence | Exact `request` |
|---|---|---|
| `customDimensions` | `customDimensionsEvidence` | `GET /v1beta/properties/{property_id}/customDimensions` |
| `keyEvents` | `keyEventsEvidence` | `GET /v1beta/properties/{property_id}/keyEvents` |
| `enhancedMeasurementSettings` | `enhancedMeasurementEvidence` | `GET /v1alpha/properties/{property_id}/dataStreams/{data_stream_id}/enhancedMeasurementSettings` |

Each evidence object contains **only** `request` and `complete: true` (boolean).
Requests must match exactly, with no query parameters, filters, field masks or
other metadata. Both list requests derive their property from the configured
Enhanced Measurement target. Every list item's Admin API `name` must be
`properties/{property_id}/customDimensions/{numeric_id}` or
`properties/{property_id}/keyEvents/{numeric_id}`, respectively, for that same
property. Retargeting both a response and its evidence does not change the target.

List envelopes allow only their respective array and optional string
`nextPageToken`. An omitted array is proto3 empty; an explicit null or nonarray
is malformed. A nonempty token always fails with
`PAGINATION_INCOMPLETE:<list>`: `complete: true` does not override pagination,
and this verifier does not aggregate pages. Unknown envelope/evidence keys,
including `partial`, `partialResponse`, `fields` and `fieldMask`, fail closed.
Target, envelope or evidence failures return `MALFORMED_READBACK` without echoing
resource names, capture strings, metadata values or page tokens.

The Enhanced Measurement body must name the exact configured resource and use
only recognized, correctly typed fields. A name-only body is insufficient.
Omitted proto3 false settings are accepted only with complete unfiltered capture
evidence. A setting ON when required (or owner-recorded) OFF produces
`ENHANCED_MEASUREMENT_ON:<setting>`; `on_accepted` passes either value.
This offline verifier validates the supplied evidence contract, not the truth
of the operator's completeness attestation; it performs no API request. Every
item stays `pending`; only a passing readback supports a property-match claim.

Vercel Web Analytics is removed from the app and its package metadata (its
beacon sent the raw landing URL and external referrer). If the Vercel project
still shows Web Analytics as enabled, disabling it there is an owner action;
no client in the build sends to it. `npx tsx scripts/vercel-analytics-bundle-scan.ts .next`
checks a fresh build for its client, endpoint and queue markers.

Custom dimensions only collect from the day they are created; the report's
custom-parameter slices are empty (or the Data API refuses the request) before
then.

## Running the report (read-only)

```
npx tsx scripts/ot-funnel-dropoff-report.ts requests \
  --property-id <GA4 property id> --start 2026-09-01 --end 2026-09-28 > bundle.json
# Operator: POST each bundle.requests[i].body to bundle.requests[i].url with a
# token for https://www.googleapis.com/auth/analytics.readonly, and save the
# response bodies, in the same order, as one JSON array in responses.json.
npx tsx scripts/ot-funnel-dropoff-report.ts report \
  --bundle bundle.json --responses responses.json > report.json
```

The script makes no request and reads no credential. Exit `0` OK, `1`
INCONCLUSIVE, `2` invalid input/response, `64` usage. Wait at least 48 hours
after the end date for GA4 processing before reading a range.

## Reading the report

`ot.funnel_dropoff_report` / `ot-funnel-dropoff-report-v1`. Every label is from
a closed list; a GA4 value outside it is `other`, never echoed.

- `slices[]` — `overall` and one per breakdown: `campaign_source`,
  `campaign_medium`, `campaign_name`, `campaign_content`, `landing_route`,
  `device_category` (all seven steps), `free_check_surface` (steps 2–4),
  `free_check_input_mode` (step 2), `free_check_outcome` (steps 3–4),
  `checkout_plan` (steps 5–6), `checkout_blocked_reason` (step 5, the blocked
  share by reason).
- Per step: `users`, `events`, `conversion_from_previous`,
  `conversion_from_first`, `dropoff_users`, `dropoff_rate`, `state`.
- `state`:
  - `OK` / `FIRST_STEP`.
  - `INSUFFICIENT_EVIDENCE` — the previous step has fewer than 30 users; no rate is stated.
  - `STEP_EXCEEDS_PREVIOUS` — more users at this step than the one before
    (for example checkout reached without a free check). The steps are
    aggregate counts, not paths (`step_basis: aggregate_counts_not_paths`), so
    this is not a negative drop-off and no drop-off is stated.
  - `USERS_NOT_ADDITIVE` — the bucket merged several raw GA4 values (usually
    `other`); users cannot be summed, events can.
  - `SLICE_INCONCLUSIVE` — GA4 thresholded, sampled, collapsed rows into
    `(other)`, truncated this slice, or returned it empty with a stated
    `emptyReason`; counts are shown, rates are not.
- Report `status`: `OK`, `INCONCLUSIVE` (some slice is), or `INVALID_RESPONSE`
  (any response the request could not have produced — the whole report is
  refused, never partial). That includes quality evidence of the wrong shape:
  `metadata` missing or not an object, a metadata key outside GA4's
  `ResponseMetaData`, a non-boolean thresholding or `(other)` flag, a
  malformed `samplingMetadatas` entry, an active metric restriction, a missing
  `rowCount` when rows are present, a foreign `kind`, a `propertyQuota`, or
  non-empty `totals`/`maximums`/`minimums`. Save responses exactly as the API
  returned them; a tool that stringifies or drops fields makes the report
  refuse, not pass.

**Purchase is not revenue.** `payment_authority:
stripe_order_ledger_not_included`: GA4 can miss a purchase (claim-then-fail is
never retried) and never states revenue here. Paid orders and revenue are the
Stripe/order ledger. Reconcile counts with the ledger before trusting step 7,
and use `lib/analytics/purchase-dedup-report.ts` for per-transaction checks.

## Choosing friction experiments

The report is observational (`causal_claims: none`). It says where people
stop, not why, and not what would change it. A difference between segments
(mobile vs desktop, one source vs another) can be the audience rather than the
page.

1. Find the step with the largest `dropoff_users` (not rate) among slices whose
   evidence is `OK`, and confirm it holds across at least two date ranges.
2. Look for a concentrated cause in the breakdowns: one `blocked_reason`
   dominating step 5, one `surface` or `input_mode` lagging at step 2→3, one
   `device_category` or `landing_route` diverging.
3. Separate evidence from friction: completed→qualified is mostly the county
   evidence (`free_check_outcome`), not the page. Do not optimize a step whose
   drop is the honest outcome.
4. State one hypothesis, one change and one primary metric, and register it in
   `data/analytics/ot-experiment-registry.v1.json` (approved slugs only) before
   changing anything. Only a randomized comparison supports a causal claim.
5. Never trade away a gate for conversion: acknowledgment, ambiguity, window
   and notice gates are eligibility and truthfulness controls, not friction to
   remove.
