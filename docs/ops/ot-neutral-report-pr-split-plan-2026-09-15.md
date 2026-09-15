# OT neutral report PR split plan — 2026-09-15

## Implemented replacement stack (owner-approved 2026-09-15)

The approved six-PR concept was refined after independent review into twenty
linear, independently buildable layers. PR #47 remains open and unmodified
until this replacement stack and fresh reviews pass.

| Order | PR | Scope | Exact head before this status refresh | Files | + / - | Attached CI |
|---:|---:|---|---|---:|---:|---|
| 1 | #54 | artifact core + credential-free stacked-PR CI | `8966655` | 17 | 5341 / 39 | `34990939227` |
| 2 | #55 | gated orchestration | `a151706` | 8 | 864 / 3 | `34991160964` |
| 3 | #56 | PDF/private storage | `6a7a44d` | 9 | 542 / 25 | `34990965369` |
| 4 | #57 | bounded official county gateway | `55eed74` | 3 | 2099 / 16 | `34990983598` |
| 5 | #58 | privacy-safe attribution | `035baf2` | 12 | 2635 / 28 | `34990990744` |
| 6 | #59 | packet download authority | `7a00fc3` | 24 | 5811 / 64 | `34991011840` |
| 7 | #60 | packet authority fence | `bc17cf0` | 11 | 185 / 35 | `34991018512` |
| 8 | #61 | delivery callbacks/issuance | `2d6cccc` | 32 | 7014 / 23 | `34991058084` |
| 9 | #62 | delivery safety remediation | `a4f4244` | 29 | 3417 / 260 | `34991067825` |
| 10 | #63 | private-surface isolation | `990d705` | 13 | 1194 / 38 | `34991092202` |
| 11 | #64 | payment/reversal authority | `1891cad` | 23 | 663 / 383 | `34991099427` |
| 12 | #65 | deadline authority | `3dd51c8` | 21 | 1244 / 95 | `34991107462` |
| 13 | #48 | owner decision records | `fc4a037` | 2 | 56 / 0 | `34991134495` |
| 14 | #49 | neutral evidence artifact | `6fb863f` | 13 | 1096 / 4 | `34991134702` |
| 15 | #50 | neutral commerce admission | `133d84a` | 28 | 951 / 51 | `34991153692` |
| 16 | #51 | neutral QA/refund | `6abdcaf` | 14 | 845 / 7 | `34991155102` |
| 17 | #66 | deterministic customer artifact | `d63a938` | 14 | 372 / 9 | `34991928807` plus latest-head rerun |
| 18 | #67 | restricted delivery authority | `155a563` | 22 | 655 / 71 | `34992228383` |
| 19 | #52 | customer surfaces/journey | `8422fbb` | 22 | 746 / 313 | `34992250866` |
| 20 | #53 | Preview controls/constrained-view proof | `ceeb93a` | 13 | 1195 / 80 | `34992250174` before this status-only refresh |

Every layer is below 30 files except #61. Its two-file exception is the
generated schema/migration and evidence record inseparable from the callback
state machine. Line-envelope exceptions are limited to deterministic parsers,
state machines, migrations, and exhaustive fixtures; each is called out in the
corresponding PR description. All branches passed local production build and
TypeScript before their current push. CI is read-only, has no credentials, and
now attaches automatically to any pull-request base.

## Finding

PR #47 is 215 files, 36,137 additions, and 545 deletions against `origin/main` before the final access remediation. This is not generated-file noise. Its branch descends from an unmerged September 3–13 T2 delivery stack. The neutral-report commits depend on that stack's schemas, payment binding, fulfillment/artifact tables, capability machinery, and packet download route.

The neutral-only range beginning with owner approval `a4a6dd2^` is still 112 files, 5,722 additions, and 423 deletions before the final access remediation. It cannot meet the normal 30-file/800-line review envelope as one independently deployable change without removing required end-to-end functionality.

Rebasing/cherry-picking only the neutral commits onto current `origin/main` is unsafe: it would either fail to apply or silently omit reviewed payment/artifact/delivery dependencies. No history rewrite was performed.

## Coherent dependent split

Use stacked PRs, each based on the preceding exact reviewed head:

1. **Foundation / shared paid authority** — payment binding and reversal containment, fulfillment/artifact schema, capability/download safety, private-surface telemetry isolation, and restricted runtime identities.
2. **Neutral evidence artifact** — official-source gateway, neutral content/PDF/CSV generation, ambiguity disclosures, and deterministic evidence tests.
3. **Neutral commerce admission** — deadline authority, `$69` contract, reservation/checkout-attempt repository, capacity constraints, and reconciliation.
4. **Neutral QA/refund** — QA ledger, 12/20-minute rules, 25/week cap, refund-required queue, receipt verification, transient-provider retry audit, and constrained commerce projections.
5. **Neutral delivery/customer surfaces** — deterministic customer ZIP, promotion, restricted delivery projection, one-use capability, checkout/success/email/terms copy, browser and native owner-journey tests.
6. **Preview release controls** — four-identity database marker/preflight, composed migration entrypoint, complete disabled-feature registry, and release evidence.

Each stack member needs its own exact-SHA independent review, focused/native tests, and green CI. Database migrations remain cumulative and may only be rehearsed on a provably isolated Preview database through the composed entrypoint.

## Required decision

PR #47 must not be merged at its current size without either approval to replace it with the six stacked PRs above (recommended), or an explicit owner exception accepting the large review surface and naming the compensating review standard. This record requests neither merge nor exception; it records the blocker and safe split.
