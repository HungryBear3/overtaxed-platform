# OT analytics Phase B — contracts, governance, Meta candidate

Stacked on Phase A (`a60a49d`, draft PR #232). Everything here is local code,
checked-in artifacts and tests. Nothing is activated: no GA4, Meta, Stripe or
Vercel setting was changed, no credential was read, and no live event was sent.

## What ships

| Area | Module | Checked-in artifact |
|---|---|---|
| Decision-grade funnel contract | `lib/analytics/funnel-contract.ts` | — |
| Server purchase ownership (at most once) | `lib/analytics/ga4-purchase-claim.ts`, `lib/analytics/ga4-measurement.ts` | — |
| GA4 Admin checklist + readback verifier | `lib/analytics/ga4-admin-checklist.ts` | `data/analytics/ot-ga4-admin-checklist.v4.json` |
| Purchase dedup report (read-only) | `lib/analytics/purchase-dedup-report.ts` | — |
| Canonical campaign naming | `lib/analytics/campaign-governance.ts` | — |
| Experiment registry + linter | `lib/analytics/experiment-registry.ts` | `data/analytics/ot-experiment-registry.v1.json` (empty) |
| Registry-bound campaign link builder (`npx tsx scripts/ot-campaign-link.ts --experiment <id>`) | `lib/analytics/campaign-link-builder.ts`, `scripts/ot-campaign-link.ts` | the registry above; yields no link while it is empty |
| Decision-packet export contract | `lib/analytics/decision-export.ts` | `data/analytics/ot-decision-export-mapping.v1.json`, `fixtures/analytics/decision-packet/*.synthetic.json` |
| Meta Pixel candidate (unmounted, HOLD) | `lib/analytics/meta-pixel-policy.ts`, `components/analytics/meta-pixel.tsx`, HOLD in `next.config.mjs` | — |
| Meta CAPI posture | `lib/analytics/meta-capi.ts` (DEFERRED) | — |

Regenerate the export artifacts with `npx tsx scripts/write-decision-export-artifacts.ts`;
the tests fail whenever the files and the code disagree.

### Funnel contract

Decision-grade events (contract v2, see `OT-FUNNEL-DROPOFF.md`):
`free_check_started`, `free_check_completed`, `free_check_qualified` (the one
qualified outcome: canonical outcome code `supportive`, live lookup only),
`begin_checkout`, `checkout_blocked`, `purchase`. Browser
events carry closed parameters and explicitly empty `page_location` /
`page_referrer`; the sensitive boundary refuses any payload the contract does
not describe. `purchase`/`refund` are server-only: the browser emitters refuse
them, and the webhook validates its Measurement Protocol body against
`validateServerPurchasePayload` at runtime, before claiming or sending (no
`user_id`, `user_properties` or `user_data`; a Checkout Session id as the
transaction id; `USD`; `T2`/`T3`). A body the contract refuses is not sent.
Validators read own keys only: a parameter named `constructor` or `__proto__`
is an unknown parameter. GA4 is behavioral evidence; paid revenue is the
Stripe/order record.

### Server purchase: at most once

The webhook reaches the purchase send more than once for one Checkout Session
by design: a redelivery re-enters to retry T2 evidence, a retry follows a
released event claim, and another event can name an already-paid session.
Before transport, after every gate and the contract pass, the webhook inserts a
claim row keyed by the session id into its existing idempotency table
(`stripe_event`, unique primary key, `ga4_purchase:` prefix, never an `evt_`
id). Only the inserter sends; the row is never released. No migration.

- One transport per session at most, across every event, retry and concurrent
  delivery.
- A crash or timeout after the claim, or a provider error, leaves the purchase
  claimed and unsent. It is never retried: GA can miss a purchase, never count
  one twice.
- A claim store that cannot record the claim means no send.
- None of it is fatal to settlement, notifications or T2 evidence retry.

Exactly-once delivery to GA is not claimed. A purchase lost this way is still
paid revenue in the Stripe/order record.

### GA4 Admin checklist

Superseded by checklist v2 (`OT-FUNNEL-DROPOFF.md`): five event-scoped custom
dimensions and `purchase` as the only key event, every item `pending`.
Readback is two read-only Admin API list calls compared as exact sets;
pagination or malformed input fails closed.

### Purchase dedup report

Exact GA4 Data API `runReport` request (eventName EXACT `purchase` AND
transactionId IN the named ids, case-sensitive) under the read-only scope, and
a deterministic verdict per transaction: UNIQUE, DUPLICATE, NOT_FOUND;
thresholded/sampled/(other) reports are INCONCLUSIVE.

### Campaign governance and registry

`ot_<yyyymm>_<objective>_<slug>`, `<format>_<variant>`, closed source/medium
lists, Phase-A landing values. No `utm_term`. Every canonical value is also a
valid Phase-A UTM token and approved-code shape. The approved slug list is
**empty**; synthetic slugs are accepted only in synthetic fixtures. The linter
rejects free text, URLs/query/hash, identifiers (email, phone, PIN, Stripe, GA,
UUID…), unknown keys (by category), missing keys (own keys only — nothing is
read from a prototype), bad status/decisions, dates that are not days of the
decision-packet tool's calendar (`0001-01-01`…`9999-12-31`: no year `0000`,
no rolled-over `2026-02-30`), decisions
before completion, float literals, mixed/unknown currencies, and any two
experiments on one segment that share a day (as the decision-packet tool does).

### Decision-packet export

Written against the offline tool at `d64d095f361dc10b939289a8787f25dc6d5d925c`.
Raw GA4 values map into the tool's vocabulary or its sentinels and are never
passed through. Alias tables are read by own key only, so a raw `constructor`
or `__proto__` maps to `other`, never to an inherited member. Timestamps must
be exact `YYYY-MM-DDTHH:MM:SSZ` instants that survive a round trip — no
rolled-over `2026-02-30`, no `24:00`, no year `0000` — as the tool's calendar
requires. Zoned day starts are proleptic Gregorian at both ends of that
calendar: years `0001`–`0099` are not read as the 1900s (as `Date.UTC` would),
and a day before 1883 begins at the zone's local mean time, as in the tool's
zoneinfo. A coverage end that does not begin strictly before `generated_at`,
or whose start cannot be computed, is `COVERAGE_AFTER_GENERATED_AT`. The tool
settles each attested GA4 day at its next local midnight plus 48 hours and
raises `OverflowError` when that instant falls past `9999-12-31`, whatever
`generated_at` says; so an attested range whose last day is later than
`9999-12-28` (in every packet timezone) is refused as
`ATTESTED_RANGE_UNSETTLEABLE` at that range. Unattested coverage through
`9999-12-31` is still exported, because the tool accepts it.
Each exporter reads its input exactly once, as plain JSON, and both
checks and output come from that one read: a getter or Proxy cannot answer one
value to validation and another to the document, an array hole is refused
(never skipped and then written as `null`), and an input that cannot be read
(a cycle, a BigInt, a throwing getter) is refused as `TYPE_OBJECT` at `$`. The
registry linter also visits every array slot. The generated synthetic fixtures were accepted by that tool
(`validate`: 4/4 ACCEPTED, `completeness=complete`; `build` exit 0).

### Meta

`MetaPixelCandidate` is mounted nowhere. The live analytics tree renders no
Pixel, and `next.config.mjs` refuses to build while `NEXT_PUBLIC_META_PIXEL_ID`
is set (`META_PIXEL_ACTIVATION_HOLD`). A deployment that would change Meta
behavior is therefore never built; the current one keeps serving.

The candidate itself loads only with a well-formed pixel id, a production
build, the canonical host and an explicit current `ot_marketing_consent_v1`
grant. It also requires that the page it would report be safe as raw bytes:

- a canonical `https` origin and an exact static path, with the raw
  `location.href` exactly that origin, path and query put back together — no
  URL username or password (which `location.origin` never shows) and no empty
  `?` or `#` (which an empty `search`/`hash` never shows);
- no fragment, and no query at all except the literal `?plan=diy` on
  `/checkout`. A `fbclid` or UTM value that fits a pattern can still be a PIN,
  a name or a Stripe id, so those pages are not reported;
- a referrer that is empty or a static page of the same origin with nothing
  after the path. Another origin never qualifies.

Nothing is ever queued for the vendor script. The bootstrap stub drops calls
until fbevents.js has taken over dispatch. `init` and PageView run only on
load, if the SDK is ready, a mount is live and every gate still holds. Each
later hit is re-authorized — after the caller's parameters are read, each
exactly once, so the value that passed the allowlist is the value sent — when it
is handed to the SDK, and only an `fbq` this module installed is ever written
to. Each effect run of the mount owns the installation until its cleanup: a
script load, an SDK that became ready, a consent change or a navigation that
arrives after the mount is gone sends nothing, not even `init`. A later mount
adopts the one installed script and is judged on the page as it is then. Once handed over, a hit is inside the SDK;
anything the SDK buffers internally is not controllable from here.

Automatic configuration and pushState page views are off, and there is no
Advanced Matching and no `<noscript>` image. The writer allows `PageView` and
`InitiateCheckout` only; there is no browser Purchase. CAPI is DEFERRED with no
send path and reads no environment variable.

## Behavior changes against Phase A

1. Free-check events now carry explicit empty `page_location`/`page_referrer`
   (previously omitted, which lets gtag fall back to the browser URL), and a
   surface or input mode outside the closed sets is no longer sent.
2. The server purchase sends `currency` as ISO 4217 upper case (`USD`), is
   validated against the funnel contract at runtime, and is sent at most once
   per Checkout Session. A new event for an already-paid order, and an evidence
   retry, no longer re-send it, and a failed send is not retried (see *Server
   purchase: at most once*).
3. `trackGA4Event`/`trackEvent` refuse `purchase` and `refund`.
4. The Phase-A Meta Pixel, which loaded without consent, is no longer
   mounted, and nothing replaces it in the live tree. So that this cannot
   silently stop Meta collection, **a build with `NEXT_PUBLIC_META_PIXEL_ID`
   set fails** (`META_PIXEL_ACTIVATION_HOLD`). With the variable unset, as with
   the variable unset in Phase A, no Meta script loads. Lead,
   CompleteRegistration and every custom Meta event are refused.
5. Expired or tampered touch records are removed when read (compare-and-remove:
   a value another tab wrote meanwhile is kept). An unreadable, empty or
   half-written legacy `utm_params` record is cleared, and a partly hostile one
   is rewritten to its valid values.

## Activation HOLDs

- **Meta Pixel** — enforced by the build: while `NEXT_PUBLIC_META_PIXEL_ID`
  is set in an environment, that environment cannot build this code. The
  owner's migration decision is either to unset the variable, explicitly
  accepting that the Pixel stops (it will not be restored without consent), or
  to keep the current deployment. Activation later needs an approved consent
  surface and copy that writes `ot_marketing_consent_v1`, a reviewed change
  that mounts the candidate and lifts the build HOLD, and Events Manager
  *Automatic advanced matching* OFF (read back).
- **Meta CAPI** — DEFERRED. Needs durable marketing consent and consented,
  bounded `fbp`/`fbc` carried through signed checkout metadata, plus a policy
  review. A new design, not a flag.
- **GA4 Admin** — apply the checklist in the property, then verify with a
  read-only readback through `verifyGa4AdminReadback`.
- **Purchase dedup** — operator runs the request with real Checkout Session ids
  after GA4's freshness window, under read-only credentials held outside the
  repo.
- **Campaign slugs** — the owner approves slugs (reviewed change to
  `APPROVED_CAMPAIGN_SLUGS`), and the same slugs are added to the
  decision-packet tool's vocabulary. Until then real campaign rows export as
  `other`.
- **Decision-packet landings** — only `/` is representable downstream; the
  mapping contract lists the rest under `pending_downstream_extension`.
- **Real app outcomes and payment ledger exports** — need an owner-defined OT
  qualified action, operator-keyed `conversion_ref` key custody and a
  read-only order/ledger source.
- **Experiment registry** — ships empty; entries need approved slugs and an
  owner decision.
- **Transaction id** — remains the Stripe Checkout Session id (Phase-A
  decision). An opaque keyed id would need a secret and an owner decision.
