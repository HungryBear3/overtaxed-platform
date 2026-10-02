# CC — OT campaign attribution infrastructure (implementation)

Date: 2026-10-02
Worktree: `/Users/abigailclaw/cc-worktrees/ot-attribution-campaign-implementation-20261002`
Branch: `rex/ot-attribution-campaign-implementation-20261002`
Audit implemented from: `/Users/abigailclaw/cc-worktrees/ot-analytics-resume-20261002/CC-OT-CAMPAIGN-ATTRIBUTION-READINESS.md` (slices S-3, S-5, S-6; findings H-2, M-1 (Stripe side), M-2, part of M-5)

## Verdict

**`CHECKPOINTED_LOCAL` — live GA4 configuration and complete readback remain pending.**

The reviewed implementation was committed locally as `8e1d9aa286c8b2f3ad11d569d6327bbe215ace91`; it has not been pushed or deployed. The owner then selected `off` for outbound clicks, form interactions, and file downloads. In the signed-in GA4 Admin UI, the controller verified property **Overtaxed IL** (`524756528`) and web stream **Overtaxed IL** (`13608120040`, measurement ID `G-4GKQSKZD73`, URL `https://www.overtaxed-il.com`). The checklist now pins `properties/524756528/dataStreams/13608120040/enhancedMeasurementSettings` independently of any supplied readback.

The live mutation was not saved. Background control turned outbound clicks and form interactions off in the open sheet, but could not switch file downloads; the separate foreground-consent request timed out. Escape closed the sheet and discarded those unsaved changes. Live settings and all complete readback captures remain pending. No campaign slug or registry entry was added.

All three implementation slices are present in the checkpoint. Before that checkpoint, the focused seven suites passed 384/384 tests and the broad 65-suite selection passed 2095 tests with 1 skipped; TypeScript exited 0. Those figures identify the implementation checkpoint, not the later owner-posture/resource follow-up.

## 1. Identity

| | Start | End |
|---|---|---|
| HEAD | `1205fe0611c8f58699fdc0afecc2daad42e6e6b7` | `1205fe0611c8f58699fdc0afecc2daad42e6e6b7` (no commit) |
| `git status --porcelain -uall` | clean | 16 tracked diff paths (rename counted once), plus this untracked report |

The untracked `node_modules` symlink points to `/Users/abigailclaw/overtaxed-platform/node_modules`. Both it and `graphify-out/` are gitignored.

### Files

| Path | Change |
|---|---|
| `lib/analytics/campaign-governance.ts` | **+** `CampaignTuple`, `campaignTupleIssues(tuple, origin)`. `APPROVED_CAMPAIGN_SLUGS` is untouched (still `[]`). |
| `lib/attribution/touch-contract.ts` | Stripe projection governed as a whole tuple; `term` is never projected; header doc updated |
| `lib/analytics/campaign-link-builder.ts` | **new** pure builder `buildCampaignLink(registryText, experimentId)` |
| `scripts/ot-campaign-link.ts` | **new** CLI `--experiment <id>` |
| `lib/analytics/ga4-admin-checklist.ts` | schema v4; owner postures, independently configured target, exact complete capture evidence for all three calls, closed list envelopes and property-bound item names |
| `app/api/checkout/session/route.ts` | comment-only correction describing the governed four-field tuple and excluded `utm_term`; execution unchanged |
| `data/analytics/ot-ga4-admin-checklist.v3.json` → `.v4.json` | `git mv`, `schema_version: 4`; follow-up records all three `owner_posture: "off"` values and pins the owner-verified Enhanced Measurement resource |
| `__tests__/analytics/campaign-governance.test.ts` | + tuple tests |
| `__tests__/attribution/touch-contract.test.ts` | projection expectations changed to fail-closed |
| `__tests__/attribution/touch-governance-approved.test.ts` | **new** positive path, with an approval simulated |
| `__tests__/attribution/checkout-session-touch-metadata.test.ts` | route expectations changed to fail-closed |
| `__tests__/analytics/campaign-link-builder.test.ts` | **new** real governance, plus the CLI |
| `__tests__/analytics/campaign-link-builder-approved.test.ts` | **new** positive path, with an approval simulated |
| `__tests__/analytics/ga4-admin-checklist.test.ts` | v4, posture and adversarial evidence/target tests; 186 tests pass |
| `docs/analytics/OT-FUNNEL-DROPOFF.md`, `docs/analytics/OT-ANALYTICS-PHASE-B.md` | v3→v4 references, EM posture table, Stripe-touch and link-builder notes |

`git diff --stat HEAD`: 16 files, +1226 / −121 (excludes this untracked report). The second narrow fix cycle changes only the GA4 verifier, its test suite, `OT-FUNNEL-DROPOFF.md`, and this report; the gitignored graph was refreshed.

SHA-256 of the current candidate production files and narrow-fix test/doc bytes (report excluded):

```
c87129001805c0b65e0d8bb0c39b51c390e9a454587b0dee42d6c152322de3b1  lib/attribution/touch-contract.ts
71a9735e9b0a35cdc7e9862873571b0fad371aa379bd75c4bad361c89e384cad  lib/analytics/campaign-governance.ts
35af3b764f18a81cbf3455aa0af5812d691033b2e24e19bdc34664a7e575eaaa  lib/analytics/campaign-link-builder.ts
50eae5d3d7c0448b7660abe975868dcad76cc642956fe5ca7bd56c18924c8884  lib/analytics/ga4-admin-checklist.ts
b1644bc001f4257544ab44232603c968aa66c2e617510cd11cba321845af74d1  scripts/ot-campaign-link.ts
549e4e0c7fe736d8f7c3397fb9423a218f7b963e8909d599ae00bad0db734c69  data/analytics/ot-ga4-admin-checklist.v4.json
92be2784ae97e65b282983403488986a6647b87c101beedb816f2eca0a6dcfce  data/analytics/ot-experiment-registry.v1.json   (unchanged)
9f702542cd2d97a4e455db1c83b71bbbd5be017b5f0a45adb38918c8862d1597  app/api/checkout/session/route.ts
fcba3a827d561fbdfb96677bc6355171be97b189c0ecb512752a4d2107216e17  __tests__/analytics/ga4-admin-checklist.test.ts
361a82715195a8e22e897b2e372cddb11f20b931e75aff2e55ec9c4d92269c72  docs/analytics/OT-FUNNEL-DROPOFF.md
```

## 2. What changed, by slice

### Slice 1 — Stripe touches governed fail-closed as one tuple

- `campaignTupleIssues` judges source, medium, campaign and content together. It reuses `sourceIssues`, `mediumIssues`, `campaignIssues(origin)` and `contentIssues`, so there is no second vocabulary.
  - Source, medium and campaign are required.
  - Content may be absent (the registry's `"none"`). A content value that is present must be governed.
  - Each issue is prefixed with its field (`campaign:CAMPAIGN_SLUG`, `source:MISSING`, …).
- `touchesToStripeMetadata` runs each touch through `governedTouch` before projecting it:
  - **Direct touch** (no UTM fields): projected as landing and `At`, same as before.
  - **Campaign touch**: `term` is stripped. The touch is projected only if `campaignTupleIssues(…, "owner_approved")` is empty. Otherwise **nothing** of it is projected: no partial tuple, and no leftover landing/`At` that would make an ungoverned visit look direct.
  - `term` is also gone from the projection field list and suffix map, so it is excluded at two layers.
- The production path is pinned to `"owner_approved"`. There is no origin parameter or test seam in production code.
- Revalidation (`revalidateCheckoutAttribution`) and the checkout route call site are unchanged. A failing touch degrades to "no touch keys", and checkout still returns 200 (route test).

### Slice 2 — Registry-bound link builder and CLI

`buildCampaignLink(registryText, experimentId)` runs these steps in order. Each refusal is a code and never echoes a value:

1. `lintExperimentRegistryText` must pass. Otherwise it returns `REGISTRY_INVALID` plus the linter's value-free `{code, path}` findings. The linter already enforces owner-approved slugs and governed source/medium/content/landing for an `owner_approved` registry, and refuses duplicate ids.
2. `registry_origin` must be `owner_approved`. Otherwise `REGISTRY_NOT_OWNER_APPROVED`, because a `synthetic_fixture` registry lints with synthetic slugs.
3. The id must be a string (`EXPERIMENT_ID_INVALID`). Matching is exact `===`, with no trimming or case folding: zero matches gives `EXPERIMENT_NOT_FOUND`, more than one gives `EXPERIMENT_AMBIGUOUS`.
4. Status must be `planned` or `running`. Otherwise `EXPERIMENT_NOT_ACTIVE`.
5. A landing that is a dynamic template (`[`) gives `LANDING_NOT_CONCRETE`.
6. The URL is `https://www.overtaxed-il.com<landing>?utm_source=…&utm_medium=…&utm_campaign=…[&utm_content=…]`. Content `"none"` omits `utm_content`, and `utm_term` never appears.
7. Round trip: `governedPageLocation(url) === url`, and `touchesToStripeMetadata(touchFromLanding(url))` must equal exactly the entry's tuple, landing and instant. Otherwise `ROUND_TRIP_MISMATCH`.

CLI `scripts/ot-campaign-link.ts`:
- It reads only `data/analytics/ot-experiment-registry.v1.json`. There is no `--registry` flag.
- It prints exactly one URL plus a newline on stdout and exits 0.
- A refusal prints `refused: <CODE>[ <code>@<path>…]` on stderr, nothing on stdout, and exits 2.
- Usage errors exit 64.

### Slice 3 — GA4 Admin checklist v4: Enhanced Measurement posture

- These are unchanged: the 5 dimensions, `purchase` as the only key event, `browser_history`/`site_search` fixed OFF (`required_value: false`), the readback calls, the scope and the pagination fail-closed behavior.
- There are three new owner-decided items. Each has `owner_posture` ∈ `undecided | off | on_accepted` instead of `required_value`. The key set is closed per item kind, so a fixed setting cannot be given a posture and an owner item cannot use `required_value`.

  | Setting | Field |
  |---|---|
  | `outbound_clicks` | `outboundClicksEnabled` |
  | `form_interactions` | `formInteractionsEnabled` |
  | `file_downloads` | `fileDownloadsEnabled` |

- **Current checked-in posture is `off` for all three owner-decided settings.** The verifier still preserves the full posture contract: `undecided` fails with `ENHANCED_MEASUREMENT_POSTURE_UNDECIDED:<setting>` even on an all-OFF stream; `off` rejects ON readback; `on_accepted` permits either value.
- Each owner item's rationale ends "Recommended posture: OFF." (pinned by a test).
- Proto3 omitted false settings are accepted only with an independently configured target and complete unfiltered capture evidence. Name-only Enhanced Measurement bodies, unknown fields, non-booleans and null fail closed. Missing target gives `ENHANCED_MEASUREMENT_TARGET_REQUIRED`; a malformed configured target gives `INVALID_CHECKLIST`.
- A missing owner item gives `ENHANCED_MEASUREMENT_REQUIRED:<setting>`, so the checklist is invalid and the verifier returns `INVALID_CHECKLIST`.

### Final fix-cycle evidence/target contract

- Configure `readback.enhanced_measurement_resource` independently; never infer the target from supplied evidence. The property prefix of that resource binds both lists.
- The readback has exactly six keys: `customDimensions`, `keyEvents`, `enhancedMeasurementSettings`, and their separate `customDimensionsEvidence`, `keyEventsEvidence`, `enhancedMeasurementEvidence` objects.
- Each evidence object has exactly `{ request, complete: true }`. List requests must be exactly `GET /v1beta/properties/<configured-id>/customDimensions` and `GET /v1beta/properties/<configured-id>/keyEvents`; Enhanced Measurement uses the exact configured resource with `GET /v1alpha/`. No query string, filter, field mask, partial marker or unknown metadata is accepted.
- Each list envelope permits only its own array and optional string `nextPageToken`. Omitted arrays mean proto3 empty; explicit null/nonarrays fail. Each item must have its required string fields and an Admin API `name` under the same configured property and correct collection with a numeric resource ID.
- Nonempty pagination tokens remain FAIL even with `complete: true`. No page aggregation or partial-field reconstruction is performed. Malformed evidence/envelopes/item targets return only `MALFORMED_READBACK`, with no supplied values echoed.
- The offline check validates evidence shape and target consistency, not the truth of the operator's attestation. No live property was queried or verified.

## 3. Commands and results

All runs were local. The original implementation runs below used `TMPDIR=/tmp`; the final fix-cycle runs use the configured Hermes scratch TMPDIR. Historical results are retained explicitly as history, not claimed for current bytes.

| Command | Result |
|---|---|
| Baseline at start: `npx jest __tests__/analytics __tests__/attribution __tests__/billing/webhook-purchase-continuity.test.ts __tests__/billing/webhook-approved-notice-settlement.test.ts __tests__/referrals` | 50/50 suites; 1778 passed, 1 skipped (matches the audit §9) |
| RED, slice 1 (4 suites) | failed: first `campaignTupleIssues is not a function`, then 21 assertion failures on the ungoverned projection |
| RED, slice 2 (2 suites) | failed: `Cannot find module …/campaign-link-builder` |
| RED, slice 3 (1 suite) | failed: missing v4 JSON, then 34 assertion failures against the v3 validator |
| **Focused, final:** `npx jest` on the 7 changed/new suites (`campaign-governance`, `touch-contract`, `touch-governance-approved`, `checkout-session-touch-metadata`, `campaign-link-builder`, `campaign-link-builder-approved`, `ga4-admin-checklist`) | **7/7 suites; 384/384** (second fix cycle, `--runInBand`) |
| Historical broad, before fix cycles: same command as the baseline | **53/53 suites; 1867 passed, 1 skipped** (+89 tests over baseline) |
| **Broad, final:** baseline selection plus `__tests__/campaign-attribution.test.ts __tests__/checkout`, `--runInBand` | **65/65 suites; 2095 passed, 1 skipped** |
| Historical **full** `npx jest` (not rerun after fix cycles) | 285 passed, 9 skipped, **1 failed** (`__tests__/ci-recovery-runtime-contract.test.ts`, 1 test); 6858 passed, 84 skipped |
| That failing suite at **base** `1205fe0`, in a temporary detached worktree (removed afterwards) | **fails identically** (1 failed / 6 passed, "prepares a Linux-shaped synthetic runtime…", `status` 1 ≠ 0). It also fails with the default TMPDIR. Pre-existing and environmental; not caused by this change. |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `git diff --check` | clean |
| `npx tsx scripts/ot-campaign-link.ts --experiment ot_exp_2026_001` (shipped registry) | stderr `refused: EXPERIMENT_NOT_FOUND`, exit 2, stdout empty |
| `npx tsx scripts/ot-campaign-link.ts` | usage, exit 64 |
| `graphify update .` (second fix cycle, AST-only) | exit 0; 3163 nodes, 5274 edges, 382 communities written to the worktree's gitignored `graphify-out/` |

Formatting: the repo has no Prettier config. Every pre-existing file this change touches already fails `prettier --check` at base, because the repo is no-semicolon with ~120-column lines. Prettier is therefore not a usable gate here. New code follows the surrounding style. Lint was not run (`next lint` is unrunnable on Next 16 in this repo).

The full jest run temporarily created `.ot-native-vault-*` / `.ot-recovery-gate-*` directories in the worktree (neutral-production suites). They were gone when the run finished.

### Second narrow fix-cycle regression evidence

- Before production edits, wrong-property item names and unknown/partial list-envelope metadata reproduced **12 failures / 90 passes**, each false PASS where FAIL was expected.
- Adding the six-key evidence contract produced **19 failures / 165 passes** against the prior implementation, including conforming-readback controls rejected by the old top-level shape.
- Final GA4-only suite: **186/186 passed**. Covers each list's wrong property, jointly retargeted evidence/body, absent/malformed evidence, nonboolean completeness, filtered/nonexact GETs, partial/unknown metadata, malformed resources/lists/tokens, value-free pagination, and conforming proto3/readback controls.
- Final focused and broad counts above come from actual reruns, not extrapolation. Full-suite and old mutation results below were not rerun in this narrow cycle.

### Historical mutation probes (local, each file restored; diff stat verified unchanged afterwards)

| Mutation | Result |
|---|---|
| S1: no tuple governance; production origin `synthetic_fixture`; keep the landing of a refused touch; source, medium or campaign made optional; content unchecked; content required; approval ignored | all **killed** |
| S1: `const kept = touch` (term not stripped) | survived: an equivalent mutant, because `term` is also absent from the projection list |
| S1: term re-added at **both** layers | **killed** |
| S2: `paused` active; `planned` inactive; origin check removed; lint removed; case-insensitive or trimmed id; prefix id; template landing allowed; `utm_term` emitted; content `none` emitted; CLI accepts extra args | all **killed** |
| S3: undecided passes; `on_accepted` treated as off; `off` not enforced; owner items not required; posture enum opened; new readback fields not parsed; a fixed setting may take a posture | all **killed** |

Coverage was 27/27 non-equivalent mutants killed.

## 4. Known limitations

1. **The positive paths are proven under a simulated approval.** `APPROVED_CAMPAIGN_SLUGS` ships empty, so the two `*-approved.test.ts` suites `jest.mock` the governance module. In those suites `campaignIssues`/`campaignTupleIssues` judge the fixture slugs as approved; everything else is real (lists, grammar, linter, GA4 page context, projection). The real-list suites prove the same inputs are refused today.
2. **Today, no campaign touch reaches Stripe at all.** This is intended (fail-closed), and it is a behavior change: before this change, ungoverned values were projected. Only direct first touches (landing and `At`) are stamped until S-1 approves a slug.
3. **Two refusal codes are unreachable after a passing lint:**
   - `EXPERIMENT_AMBIGUOUS`: the linter refuses duplicate ids first. The ambiguity test therefore observes `REGISTRY_INVALID / DUPLICATE_EXPERIMENT_ID`.
   - `ROUND_TRIP_MISMATCH`: every static landing round-trips by construction.

   Both are kept as defense in depth. Neither can be killed in isolation.
4. **The GA4 page context is unchanged.** It still degrades per field (audit M-1). Only the Stripe side is whole-tuple now, so for an ungoverned or partial visit GA4 may keep source/content while Stripe keeps nothing. They agree on every builder-emitted link (round-trip tested).
5. **`touch-contract.ts` now imports `campaign-governance.ts`.** That module is pure, but it now enters the client bundle wherever the touch contract does (touch store/capture). No build was run: `next build` breaks on the symlinked `node_modules` and runs migrations.
6. **Dynamic landing templates can't be linked.** A registry entry whose `landing_path` is a template can't produce a URL; the owner must register a static route.
7. **The builder does not check the date window.** It gates on `status` only, not `start_date`/`end_date` against today.
8. **The CLI has no `--list` mode.** "Yields no links" for the empty registry is shown by lint `{ok:true, experiments:0}` plus `EXPERIMENT_NOT_FOUND`.
9. **The checklist moved from v3 to v4.** Any operator-held copy of v3 now validates as `SCHEMA`. The owner postures and exact Enhanced Measurement target are now recorded, but G-7 remains blocked until the live settings conform and all three complete unfiltered captures are supplied.

## 5. Boundaries kept

- No slug was added; `APPROVED_CAMPAIGN_SLUGS` is untouched. `data/analytics/ot-experiment-registry.v1.json` is unchanged (still `experiments: []`).
- No change to `app/privacy`, `lib/analytics/ga4.ts`, API executable behavior, checkout commercial semantics, pricing, offers, fulfillment, schema, migrations or env.
- `OT_ORDER_ATTRIBUTION_ENABLED` was not touched. No Meta, CAPI, Ads tag or pixel work.
- No DB, network, provider, GA4, Stripe or Vercel calls. All fixtures are synthetic.
- No commit, push, PR, merge or deploy.

## 6. Required privacy-disclosure topics (for owner/legal; no copy was edited)

`app/privacy/page.tsx` still says "no cookies" (audit H-1). Approved text must cover:

1. **Google Analytics 4** on the production site, with Google as processor. It sets the `_ga` and `_ga_<id>` cookies.
2. **Campaign attribution in browser localStorage.** `ot_touch_first_v1` and `ot_touch_last_v1` hold UTM source, medium, campaign and content, the landing route and the capture time. They are kept up to 30 days.
3. **Data sent to Stripe at checkout.** The GA client and session identifiers, and the governed campaign fields above (no search term), are copied into Stripe Checkout Session metadata. Name what this is used for (attributing paid orders to campaigns) and how long it is kept.
4. **Approved-code referral attribution** (`ot_campaign`/`ot_creative`) if it is ever activated. It is currently off.
5. **Opt-out and controls.** Cover how to block or clear cookies and localStorage, and a link to Google's opt-out.
6. **No search terms or personal data in campaign links.** State it if desired: links are built only from closed lists.

## 7. Next steps (owner)

1. Finish the approved live Enhanced Measurement changes, save, reopen, and verify all five governed settings.
2. Capture complete unfiltered Admin API evidence for custom dimensions, key events, and Enhanced Measurement; run G-7.
3. S-1: name the pilot slug(s) in a reviewed change.
4. S-2: add one `planned` registry entry, then G-6 via `scripts/ot-campaign-link.ts`.
5. S-4: approve the privacy copy.
