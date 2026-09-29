# OT analytics Phase B — contracts, governance, Meta candidate

Stacked on Phase A (`a60a49d`, draft PR #232). Everything here is local code,
checked-in artifacts and tests. Nothing is activated: no GA4, Meta, Stripe or
Vercel setting was changed, no credential was read, and no live event was sent.

## What ships

| Area | Module | Checked-in artifact |
|---|---|---|
| Decision-grade funnel contract | `lib/analytics/funnel-contract.ts` | — |
| GA4 Admin checklist + readback verifier | `lib/analytics/ga4-admin-checklist.ts` | `data/analytics/ot-ga4-admin-checklist.v1.json` |
| Purchase dedup report (read-only) | `lib/analytics/purchase-dedup-report.ts` | — |
| Canonical campaign naming | `lib/analytics/campaign-governance.ts` | — |
| Experiment registry + linter | `lib/analytics/experiment-registry.ts` | `data/analytics/ot-experiment-registry.v1.json` (empty) |
| Decision-packet export contract | `lib/analytics/decision-export.ts` | `data/analytics/ot-decision-export-mapping.v1.json`, `fixtures/analytics/decision-packet/*.synthetic.json` |
| Meta Pixel candidate | `lib/analytics/meta-pixel-policy.ts`, `components/analytics/meta-pixel.tsx` | — |
| Meta CAPI posture | `lib/analytics/meta-capi.ts` (DEFERRED) | — |

Regenerate the export artifacts with `npx tsx scripts/write-decision-export-artifacts.ts`;
the tests fail whenever the files and the code disagree.

### Funnel contract

Decision-grade events: `free_check_completed`, `free_check_qualified` (the one
qualified outcome: canonical outcome code `supportive`, live lookup only),
`begin_checkout`, `purchase`. `free_check_started` stays diagnostic. Browser
events carry closed parameters and explicitly empty `page_location` /
`page_referrer`; the sensitive boundary refuses any payload the contract does
not describe. `purchase`/`refund` are server-only: the browser emitters refuse
them, and the webhook's Measurement Protocol body is itself validated (no
`user_id`, `user_properties` or `user_data`). GA4 is behavioral evidence; paid
revenue is the Stripe/order record.

### GA4 Admin checklist

Two event-scoped custom dimensions — `surface` (free-check entry point) and
`plan` (checkout tier) — and two key events — `free_check_qualified`
(once per session) and `purchase` (once per event). Readback is two read-only
Admin API list calls compared as exact sets; pagination or malformed input
fails closed.

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
UUID…), unknown keys (by category), bad dates/status/decisions, decisions
before completion, float literals, mixed/unknown currencies, and any two
experiments on one segment that share a day (as the decision-packet tool does).

### Decision-packet export

Written against the offline tool at `d64d095f361dc10b939289a8787f25dc6d5d925c`.
Raw GA4 values map into the tool's vocabulary or its sentinels and are never
passed through. The generated synthetic fixtures were accepted by that tool
(`validate`: 4/4 ACCEPTED, `completeness=complete`; `build` exit 0).

### Meta

The Pixel loads only with a well-formed `NEXT_PUBLIC_META_PIXEL_ID`, a
production build, the canonical host and an explicit current
`ot_marketing_consent_v1` grant — and only while the page it would report is an
exact static path with governed query values and a safe referrer, because the
Pixel sends the URL and referrer by itself. Automatic configuration and
pushState page views are off, there is no Advanced Matching and no
`<noscript>` image, and PageView waits for the script to load. The writer
allows `PageView` and `InitiateCheckout` only. There is no browser Purchase.
CAPI is DEFERRED with no send path and reads no environment variable.

## Behavior changes against Phase A

1. Free-check events now carry explicit empty `page_location`/`page_referrer`
   (previously omitted, which lets gtag fall back to the browser URL), and a
   surface or input mode outside the closed sets is no longer sent.
2. The server purchase sends `currency` as ISO 4217 upper case (`USD`).
3. `trackGA4Event`/`trackEvent` refuse `purchase` and `refund`.
4. The Meta Pixel no longer loads without consent. There is no consent surface
   yet, so **if `NEXT_PUBLIC_META_PIXEL_ID` is set in Production today, Meta
   Pixel collection stops on deploy.** Lead, CompleteRegistration and every
   custom Meta event are refused.
5. Expired or tampered touch records are removed when read (compare-and-remove:
   a value another tab wrote meanwhile is kept). An unreadable, empty or
   half-written legacy `utm_params` record is cleared, and a partly hostile one
   is rewritten to its valid values.

## Activation HOLDs

- **Meta Pixel** — needs an approved consent surface and copy that writes
  `ot_marketing_consent_v1`, Events Manager *Automatic advanced matching* OFF
  (read back), and an owner decision on `NEXT_PUBLIC_META_PIXEL_ID`.
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
