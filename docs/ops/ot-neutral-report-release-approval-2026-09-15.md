# OT neutral report release approval packet — 2026-09-15

## Current candidate

- Product: **Cook County Assessment Records & Matching Property Report**
- Price: **$69 USD**
- Canonical merge chain: the exact 122-PR main-rooted chain in `docs/ops/ot-neutral-canonical-equivalence-2026-09-15.md`.
- Current implementation tip: PR #210, `32a70273bec8675feb6d2aa01e036f62147a9f09`.
- The evidence-only documentation update is the next stacked PR and is bound
  to its exact head by the GitHub PR record after commit.
- Approved aggregate reference: PR #47, `2203e06d995a29d928ee9efae81771efb00fcbcf`; preserved as a noncanonical reference/fallback.
- Exact excluded PRs: `docs/ops/ot-neutral-noncanonical-pr-disposition-2026-09-15.md`.
- Strict automated qualification remains separate, unsigned, and inactive.

## Implemented controls

1. Exact-byte official county/calendar evidence and neutral PDF/CSV generation.
2. Current-year, single-PIN, single-card, class-2, open-window pre-payment gate.
3. Order/PIN/payment/policy/evidence binding and ten-paid-order pilot cohort.
4. Separate restricted database identities for migration, app read-side, neutral repository, and neutral delivery.
5. Durable checkout, Blob, QA, ZIP, delivery, capability, and refund ledgers.
6. QA-only review with a 20-minute hard stop and 25 opened reviews per reviewer/week.
7. Deterministic private customer ZIP with only `report.pdf` and `report.csv`.
8. POST-only one-use capability with reversal/dispute/supersession checks.
9. Operator-gated refund verification requiring the exact successful $69 USD provider receipt; no automatic refund creation.
10. Neutral customer copy with no eligibility, savings, or outcome promise.
11. All neutral runtime feature switches default-off and guarded in Preview.

## Review remediation now bound to the candidate

- Dependent PRs receive real pull-request CI rather than manual-only workflow runs.
- Oversized PR #89 is removed from canonical ancestry and replaced by compile-safe PRs #87-#88.
- The hardened migration continues to revoke direct neutral-runtime access to `ot_order`, `ot_payment_binding`, and `ot_settlement_reversal`.
- The mandatory post-migration preflight now proves SELECT on only the three constrained neutral views, actively proves direct shared-table reads fail, and never restores a shared-table grant.
- The complete canonical and excluded-PR sets are durably bound by exact PR/base/head/SHA manifests.
- Zero-diff PR #200 is explicitly excluded.

## Verification

- Focused post-migration/entrypoint suites: 47/47 passed.
- Fresh disposable PostgreSQL 18 proof: all 35 migrations applied; the
  hardened four-role post-migration preflight passed; Phase 3 native acceptance
  passed while direct shared-commerce SELECTs were denied.
- TypeScript: passed.
- The pre-remediation canonical implementation passed 204 suites / 4,114 tests and a production build.
- Exact-head attached CI and Vercel must return terminal green on the rewritten ancestry and PR #210 before independent review can pass.
- Features remain disabled. No Preview database has been migrated.

## Current hard gate

The code/document candidate is not authorized for merge or Production. Preview database work requires all of the following before any migration command:

1. A separately provisioned, provably isolated Preview PostgreSQL database.
2. The durable non-Production Preview database marker.
3. Four distinct protected credentials: migration owner, app reader, neutral repository, neutral delivery.
4. All neutral feature flags disabled.
5. Use only `npm run neutral-report:preview-migrate`, followed by `npm run neutral-report:migration-preflight`.
6. Stop on any failed proof.

## Canonical Preview database identity design

The isolated Supabase Preview database uses the existing `postgres` owner only
for `DIRECT_URL`. The other three credentials are dedicated logins with fixed
names; no operator may substitute aliases or reuse a password:

| Environment variable | PostgreSQL login | Authority before migrations | Authority after migrations |
| --- | --- | --- | --- |
| `DIRECT_URL` | `postgres` | Existing Preview owner; must have public-schema CREATE plus role-management authority | Migration/ownership only |
| `DATABASE_URL` | `ot_preview_app` | LOGIN+INHERIT only; no superuser, BYPASSRLS, CREATEROLE, CREATEDB, replication, or public-schema CREATE | Member of read-only `ot_neutral_app_reader` only |
| `OT_NEUTRAL_DATABASE_URL` | `ot_preview_neutral_runtime` | Same restricted LOGIN baseline | Member of non-login `ot_neutral_runtime` only |
| `OT_NEUTRAL_DELIVERY_DATABASE_URL` | `ot_preview_neutral_delivery` | Same restricted LOGIN baseline | Member of non-login `ot_neutral_delivery_runtime` only |

The three restricted passwords are unique protected secrets named
`OT_PREVIEW_APP_DATABASE_PASSWORD`, `OT_PREVIEW_NEUTRAL_DATABASE_PASSWORD`, and
`OT_PREVIEW_DELIVERY_DATABASE_PASSWORD`. They must enter the process through a
masked secret store; they must never appear in chat, command arguments, files,
SQL history, logs, or generated evidence. Connection URLs must likewise be
assembled and stored only in the protected secret flow. For the mandatory
pre-migration proof, all four URLs use the same Preview database endpoint and
database name while declaring the four exact usernames above.

The repository command `npm run neutral-report:preview-bootstrap-identities` is
deliberately disabled and always fails closed. A direct PostgreSQL client cannot
prove that server statement/parameter logging will never retain a role
password. Bootstrap must therefore use the protected Supabase Management API
flow, scoped to `api.supabase.com`. Before any write, that flow must prove both
project ref `iyaxdrehtxsfkaexgxls` and the expected database marker through a
read-only query. It must create only the three canonical restricted logins via
protected bound parameters and must verify their attributes/membership graph
afterward. The disabled command still rejects any URL whose accepted Supabase
host/pooler and username do not jointly encode the canonical project ref.
After URLs are assembled, run
`npm run neutral-report:pre-migration-identity-preflight` before any migration.

The already-applied migrations `20260913170000` and `20260915190000` are
immutable. Hosted-Supabase compatibility and the migration-33 partial-object
incident are handled only by forward migrations `20260916120000` and
`20260916121000`. The reconciliation migration refuses an incomplete object
fingerprint and never edits `_prisma_migrations`. It is not validation-only: it
performs one narrowly scoped, transactional repair by revoking direct Supabase
API-role privileges from the three incident-created relations before proving
the normalized final state. Any later failed check aborts the `DO` statement
and rolls those revocations back. The scoped approval authorizes only that ACL
repair plus validation; it does not authorize feature activation, application
data changes, or direct ledger writes. The hardening migration
accepts only an empty native-PostgreSQL membership graph or Supabase's single
exact platform-admin edge, removes an interrupted temporary `SET` edge, and
revokes permanent `CREATE` on `public` from both NOLOGIN owners.
Because reconciliation executes after `20260915230000`, its refund-work
fingerprint validates the final 21-column relation, including that migration's
`provider_lookup_attempts`, `last_provider_lookup_at`, and
`last_provider_lookup_result` audit fields and their shape constraint. It does
not attempt to validate the earlier 18-column intermediate state.
The executable reconciliation proof models the complete migration-33 state and
the exact migration-34/35 deltas that touch its catalog-proof scope: the
delivery-runtime QA/reservation policies and QA grant, plus the provider lookup
audit delta. Migration-34 surfaces outside that scope (delivery authority
views, functions, triggers, and grants on other tables) are proved separately
by the executable post-migration preflight and its source-contract tests; they
are not claimed as part of the reconciliation digest. Before final-state comparison, reconciliation
revokes Supabase's broad default table privileges from `anon`, `authenticated`,
and `service_role` on the three incident-created relations, then checks their
effective table and column privileges so inherited authority cannot survive.
The remaining
catalog proof is normalized across native PostgreSQL and hosted Supabase by
excluding host-specific ACL grantor identities and checking the sole allowed
platform membership edge separately for both the object-owner and app-reader
NOLOGIN roles. The app-reader graph must also contain exactly one canonical
membership edge to the restricted `ot_preview_app` LOGIN (granted by
`postgres`, without admin, with inheritance and SET); the Supabase platform
edge is optional independently for each custom role (`ot_neutral_app_reader`
and `ot_preview_app`), and each must exactly use `postgres` as member,
`supabase_admin` as grantor, admin=true, inherit=false, and set=false. Every
other edge is rejected. Both the group role and
login role attributes are validated fail-closed. `ot_preview_app` uses INHERIT
to match the canonical login posture and hosted compatibility; the membership
edge's independent `inherit_option=true` is what confers reader authority. The
NOLOGIN `ot_neutral_app_reader` group remains NOINHERIT. The graph scan covers every
incoming and outgoing membership involving either role, including privileges
granted to `ot_preview_app` and any role granted outward by that login. The post-migration preflight independently
requires that no Supabase API-role ACL remains on those relations.
After all portable structural and security checks pass, the final catalog
comparison accepts exactly two pinned digests: native PostgreSQL 18
`8782889552b478d71c5ab63e2bace721` and hosted Supabase
`27b99eb0aada08c4a93990a35f2d0e1c`. Two pins are necessary because hosted
Supabase and native PostgreSQL render pre-existing reservation column ordinals
and constraint/policy expressions differently even when the verified security
state is equivalent. An arbitrary third rendering still fails closed. The
post-migration preflight re-proves the portable invariants rather than deriving
or accepting another host-specific digest.

### Migration-33 missing-ledger resolution gate

Do not silently insert or update `_prisma_migrations`. The immutable original
`20260915190000_add_ot_neutral_qa_delivery/migration.sql` must first hash to
`0fa316caf8b70620fbc411180f87b40105b821287b14da62361bb05b7bdb4194` (SHA-256).
An operator must then capture the scoped transactional ACL-repair/validation
forward migration result and
the post-migration preflight proving the expected relations, RLS/forced-RLS,
policies, reversal function/trigger, NOLOGIN owner, grants, and ownership.
Only with an explicit scoped approval may the operator run:

`npx prisma migrate resolve --applied 20260915190000_add_ot_neutral_qa_delivery`

The receipt must bind the exact checksum, project ref, database marker, object
fingerprint evidence, command timestamp, and operator. Without every item, HOLD
and do not run `migrate deploy`; the forward reconciliation migration performs
no direct ledger mutation. Its only repair is the approved, scoped,
transactional ACL revocation described above. Its exact catalog digest also binds relation,
enum-type, and scoped-sequence ownership; complete non-owner table/column ACLs;
and the complete scoped policy set. The owner hardening/preflight separately
binds the capture table, append-only function, publisher function, and reversal
guard function to their exact NOLOGIN owners.

## Not authorized

No merge, PR cleanup, Production deployment/migration, feature activation, live charge, real order, customer contact, email, refund, marketing, or protected-secret disclosure is authorized by this packet.
