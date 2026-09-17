# OT neutral-report — Production rollout packet (2026-09-17)

**Target:** Supabase project `kdvjiijzgflumgkndxsl`, PostgreSQL 17.6.
**Scope:** database schema and database security state only.

## What this rollout does NOT do

Stated first, because it is the part that must not drift.

- It does **not** activate any feature. Every neutral and T2 flag stays absent.
  Each phase below refuses to run while any of them is set to its activating
  value, and the baseline SQL contains none of their names.
- It does **not** create, modify or delete any **customer**, **order**,
  **payment**, **refund** or **outreach** row. Every statement the baseline
  transaction executes is DDL, GRANT, REVOKE or POLICY: no `INSERT`, `UPDATE`,
  `DELETE` or `TRUNCATE` is ever executed. It does **read** row counts — the
  final section issues `SELECT count(*)` against each relation it created, which
  is how "backfills nothing" is proved rather than asserted. Two function bodies
  it defines contain `INSERT`/`UPDATE` text; those are definitions that fire
  later, if ever, and never during this transaction.
- It does **not** send anything to a customer, a payment provider or a mail
  provider.
- It does **not** write `_prisma_migrations` from SQL. The ledger is written by
  `prisma migrate resolve`, in Phase 6, after the schema has been verified twice.
- It does **not** switch the application's database credential. The app keeps
  connecting exactly as it does today; moving it to `ot_prod_app` is a separate,
  later change with its own packet. It *does* grant `ot_prod_app` the
  `ot_neutral_app_reader` membership that later change will rely on — see
  prerequisite 3 — which changes nothing while nothing connects as that login.
- It does **not** create a database login, and it contains no `CREATE ROLE … LOGIN`.
  Every role it creates is `NOLOGIN NOINHERIT`.
- It does **not** install an extension. If `extensions.pg_stat_statements` or
  `extensions.pg_stat_statements_info` is missing, the rollout **refuses** rather
  than running `CREATE EXTENSION` on the way past.

## Why a baseline instead of `prisma migrate deploy`

Fourteen migrations are pending against Production. Three of them cannot run
there at all:

| Migration | Why Production refuses it |
| --- | --- |
| `20260913170000_add_ot_commerce_deadline_capture` | Requires `rolsuper` on the migration connection **and** a completely empty membership graph on `ot_commerce_capture_owner`. Production `postgres` has `rolsuper = false`, and a non-superuser `CREATEROLE` connection on PostgreSQL 16+ always leaves an ADMIN edge on any role it creates. The two preconditions cannot both hold. |
| `20260916120000_reconcile_ot_neutral_qa_delivery_forward` | Preview-only. Requires a role named `ot_preview_app` with an exact membership graph, and accepts only two catalog digests captured from Preview fixtures. |
| `20260916220000_harden_ot_supabase_public_acl` | Aborts before its first statement unless `public.rls_auto_enable()` exists. It does not exist in Production. |

`prisma migrate deploy` applies pending migrations in order and stops at the
first failure, so migration 7 would halt the run with six applied and eight not.
A new migration directory cannot fix this either: Prisma orders directories
lexicographically, so anything added today would run *after* the three that
cannot run.

The replacement is a Production-only baseline that materializes the exact final
state of all fourteen in one transaction, verifies it, and only then records the
fourteen as applied. The complete disposition list, with reasons and expected
pre/post state, is `lib/fulfillment/neutral-production-baseline-manifest.ts`;
the SQL is `prisma/production-baseline/`.

## Prerequisites — all of them, before Phase 1

1. **Point-in-time recovery must be enabled and confirmed.** Record the PITR
   retention window and a restore target timestamp taken immediately before
   Phase 5. This is the only rollback that covers a committed schema change, and
   it is the reason Phase 5 is the single irreversible step in the packet.
   **Do not begin Phase 5 without a confirmed PITR timestamp written into the
   receipt.**
2. **A durable Production database marker.** A `COMMENT ON DATABASE` carrying
   `{"schema":"ot.database-environment.v1","purpose":"ot-neutral-report","environment":"production","production":true,"projectRef":"kdvjiijzgflumgkndxsl","instanceId":"<uuid>"}`.
   Record the `instanceId`; every later phase is bound to it.
3. **Four provisioned Production logins**, through the protected Supabase
   Management API flow — never through a script in this repository:
   `postgres` (owner, existing), `ot_prod_app`, `ot_prod_neutral_runtime`,
   `ot_prod_neutral_delivery`. The three new ones are `LOGIN` and `INHERIT`, not
   superuser, no `BYPASSRLS`, no `CREATEROLE`, no `CREATEDB`, no `REPLICATION`,
   no direct `CREATE` on schema `public`, **and no role membership of any kind**.

   Hand them over holding nothing. The baseline **grants the memberships
   itself** — exactly three edges, `INHERIT TRUE, SET FALSE`:

   | Login | Functional role |
   | --- | --- |
   | `ot_prod_app` | `ot_neutral_app_reader` |
   | `ot_prod_neutral_runtime` | `ot_neutral_runtime` |
   | `ot_prod_neutral_delivery` | `ot_neutral_delivery_runtime` |

   The split is deliberate. Creating a login means choosing a password, and a
   migration that can mint a Production credential can mint a back door — so the
   logins are provisioned out-of-band. A membership edge is not a credential: it
   is a privilege statement about two roles that already exist, and it is exactly
   what the postconditions can prove. When it was also provisioned out-of-band,
   the apply's own binding proof could only confirm something nobody in the
   transaction had written, which is a hope rather than a check. The baseline
   refuses outright if any of the three logins is absent, is not pristine, or
   already reaches *any* other role; it never repairs one in place.
4. **`REVOKE CREATE ON SCHEMA public FROM PUBLIC;`** as a separate, reviewed
   operator statement. Production currently grants it, which would give all three
   restricted logins the ability to create objects in `public` no matter what the
   baseline revokes from them by name. The baseline **refuses to run** while this
   is outstanding rather than silently changing a database-wide default.
5. **Environment variables**, set for the operator session only:
   `DIRECT_URL` (owner, session mode, port 5432, `sslmode=verify-full`),
   `DATABASE_URL` (`ot_prod_app`), `OT_NEUTRAL_PRODUCTION_DATABASE_URL`,
   `OT_NEUTRAL_PRODUCTION_DELIVERY_DATABASE_URL`,
   `OT_NEUTRAL_PRODUCTION_PROJECT_REF=kdvjiijzgflumgkndxsl`,
   `OT_NEUTRAL_PRODUCTION_MARKER_INSTANCE_ID=<uuid from step 2>`.
   All four URLs must be distinct.
6. **Every neutral and T2 flag absent.** Confirm in the Vercel Production
   environment, not only in the shell.

## Phases

Each phase has a stop gate. A stop gate is a refusal, not a warning: if it does
not pass, the rollout stops there and nothing later is attempted.

### Phase 1 — artifact integrity (local, no database)

```
npm run neutral-report:production-check-checksums
```

**Stop gate:** exits 0. Any drift means the SQL on disk is not the SQL that was
reviewed, and the rest of the packet is void until the diff is explained.

**Receipt:** command output, plus the `resolve-manifest.json` digests.

### Phase 2 — four-role identity preflight (read-only)

```
npm run neutral-report:production-identity-preflight
```

Proves, on four separate connections: the same marked Production database and
marker instance; each credential connected as its declared role; four distinct
roles and four distinct URLs; no Preview login name anywhere; the owner has
schema and role authority; the three restricted logins have none; every neutral
feature flag off.

**Stop gate:** prints `PASS`. It does **not** require the owner to be a
superuser — Production `postgres` is not one, and that is expected.

**Receipt:** command output. Diagnostics are catalog and role names only; URLs
and passwords are redacted.

**Rollback state:** nothing has been changed. Stop and fix the environment.

### Phase 3 — baseline rehearsal (transactional, rolled back)

```
npm run neutral-report:production-baseline-rehearsal
```

This is a **different script** from Phase 5, not the same script with a variable
unset (`scripts/rehearse-neutral-production-baseline.ts`). The first thing it
does is delete `OT_NEUTRAL_PRODUCTION_APPLY_CONFIRMATION` and
`OT_NEUTRAL_PRODUCTION_RESOLVE_CONFIRMATION` from its own process environment, so
a token still exported from an earlier shell cannot turn a rehearsal into a
mutation, and no child process can inherit one.

It connects on `DIRECT_URL`, opens a transaction, runs the real preflight against
the real catalog, applies the entire baseline, proves **every** postcondition —
the postcondition SQL, the role inventory and the login→functional-role binding
graph, the same set Phase 5 and Phase 7 prove — and then **rolls the transaction
back**. It is a full dress rehearsal against Production that leaves Production
unchanged.

**Stop gate:** prints `PASS mode=rehearsal action=APPLY committed=false` followed
by `rehearsal only`. Anything else — especially `REFUSE` — stops the rollout.

Expected refusals and what they mean:

- `the neutral schema is partially present` — a previous attempt left partial
  state. **Do not retry.** This is a PITR decision, not a re-run.
- `PUBLIC still holds CREATE on schema public` — prerequisite 4 was skipped.
- `server version … is not supported` — the baseline supports PostgreSQL 17 and
  18 only.
- `pre-existing roles carry unsafe attributes: …` — one of the five functional
  roles already exists and can log in, inherits, or carries ambient authority.
  Roles are cluster-global; a *pristine* pre-created role is fine and is adopted,
  this one is somebody else's. Do not "fix" it without finding out whose it is.
- `… cannot be adopted: the migration role holds neither ADMIN nor SET on it` —
  one of the two owner roles was created by a different role. The ownership
  transfers cannot `SET ROLE` to it. A platform operator has to grant `ADMIN` on
  that role to `postgres`, or drop it so the baseline creates it.
- `Durable Production marker does not match the approved instance` — the
  database on the other end of `DIRECT_URL` is not the one prerequisite 2 named.
  The token is not the proof; the marker is.
- `restricted Production logins are not provisioned: …` — prerequisite 3 is
  incomplete. The baseline binds these logins and never creates one; go back to
  the Management API flow.
- `restricted Production logins are not pristine: …` — a login cannot log in,
  cannot inherit, carries ambient authority, or holds a direct `CREATE` on schema
  `public`. Inheritance is not optional: the bindings are granted
  `INHERIT TRUE, SET FALSE`, so a `NOINHERIT` login reaches nothing.
- `restricted Production logins already reach roles this rollout did not design:
  …` — the named login is already a member of something. "Exactly three edges"
  is only provable by refusing while a fourth exists, so find out who granted it
  before removing it.
- `the Supabase statistics views the baseline closes to PUBLIC are absent:
  extensions.pg_stat_statements[, extensions.pg_stat_statements_info]` — the
  baseline revokes the PUBLIC `SELECT` on both views, because
  `pg_stat_statements` exposes every statement text the database has executed to
  anyone who can connect, including the three restricted logins. If either view
  is missing, that revoke has nothing to act on and the rollout would commit a
  posture it cannot prove.

  **This is a refusal, not something the baseline fixes.** Installing
  `pg_stat_statements` is `CREATE EXTENSION` — a platform operation with its own
  review, run by a role this connection is not — and a schema baseline that
  quietly installed an extension would be doing something its receipt does not
  say. Either the extension is genuinely absent (have a platform operator install
  it under prerequisite 4's process, then re-run Phase 3), or this is not the
  database you think it is, which the marker check will also tell you. It used to
  surface as a mid-transaction `OT Supabase statistics-view topology is invalid`
  once the body was already forty statements in; it is classified before the
  transaction opens now.

**Receipt:** command output including `mode`, `action`, `committed`, the
preflight's `present_objects`/`expected_objects`, the present/missing functional
roles, and the `createrole_self_grant` + owner-role membership-edge diagnostics
the SET/INHERIT borrow depends on.

**Rollback state:** nothing has been changed. The transaction was rolled back.

### Phase 4 — PITR checkpoint

Record the restore target timestamp. Confirm the retention window covers it.
Write both into the receipt.

**Stop gate:** a named human confirms the timestamp is recorded.

### Phase 5 — apply (the one irreversible step)

```
OT_NEUTRAL_PRODUCTION_APPLY_CONFIRMATION="apply-production-baseline:<marker instance id>" \
  npm run neutral-report:production-baseline-apply
```

The confirmation token embeds the approved marker instance id, so a token copied
from a rehearsal against a different database cannot authorize this one. The
token is necessary and **not** sufficient: the instance id in it is a value you
typed, so the runner also reads the durable `COMMENT ON DATABASE` marker off this
connection and refuses unless its `projectRef` **and** `instanceId` are exactly
the approved pair. A correct token pointed at the wrong database stops here.

This entrypoint **refuses to start** without the exact token. It does not fall
back to a rehearsal — rehearsing is Phase 3's command, and an apply command that
sometimes rehearses produces two receipts nobody can tell apart.

The run proves every postcondition inside the transaction, commits, and then
re-verifies on a **separate** connection. The ledger is not touched.

**Stop gate:** prints `PASS mode=apply action=APPLY committed=true resolved=false`.

**Receipt:** command output, plus:

```
OT_NEUTRAL_PRODUCTION_EXPECT_LEDGER=absent npm run neutral-report:production-verify
```

**Rollback state:** the schema is committed. The only rollback is PITR to the
Phase 4 timestamp. The application is unaffected: every relation the baseline
created is empty, every feature flag is still off, and the application still
connects as the owner, which bypasses the RLS this migration enabled.

### Phase 6 — ledger resolve

```
OT_NEUTRAL_PRODUCTION_APPLY_CONFIRMATION="apply-production-baseline:<marker instance id>" \
OT_NEUTRAL_PRODUCTION_RESOLVE_CONFIRMATION="resolve-production-ledger:<marker instance id>" \
  npm run neutral-report:production-baseline-apply
```

On a database the baseline has already been applied to, the preflight classifies
`COMPLETE`, the body is skipped, the postconditions are re-proved, and only then
are the fourteen `prisma migrate resolve --applied <name>` commands run in
manifest order. Each is spawned with an argument array and `shell: false`, using
the Prisma CLI in this checkout's `node_modules/.bin` — **never** `npx`, which
would fetch and execute a binary from the network in the middle of the rollout.
Child output is captured and redacted rather than inherited, because Prisma
echoes the datasource URL (and therefore the owner password) when a connection
fails.

After the last resolve the run proves ledger exactness twice: directly, and again
through the read-only verification on a separate connection.

**Stop gate:** prints `PASS mode=apply action=REPLAY committed=true resolved=true`.

#### If Phase 6 is interrupted part-way

`prisma migrate resolve` is one process per migration, so an interrupted run
leaves the ledger genuinely half-written — say seven of fourteen recorded. **This
is recoverable and does not need PITR, a hand-edit of `_prisma_migrations`, or a
`--rolled-back`.**

Re-run the **same Phase 6 command, unchanged**. The runner re-reads the ledger
before it touches anything, splits the covered migrations into "already recorded
cleanly" and "still pending", skips the former (re-issuing `resolve --applied`
for a migration Prisma already records is an error) and resumes at the first of
the latter. The output says how many it skipped:

```
ledger resume: 7 covered migration(s) were already recorded; 7 remained
```

Two states are **not** resumable and stop the rollout instead:

- `… is in the ledger but is not recorded as cleanly applied` — an entry is
  unfinished or marked rolled back. A human decides what it meant.
- `… the schema is not complete; this is a mismatch, not a resumable resolve` —
  the ledger names covered migrations whose objects are not in the database.

**Receipt:**

```
npm run neutral-report:production-verify
```

which additionally proves ledger exactness: every covered migration present
exactly once, cleanly applied, nothing rolled back.

**Rollback state:** ledger only. `prisma migrate resolve --rolled-back <name>`
reverses a ledger entry without touching the schema. This repository never issues
that command automatically.

### Phase 7 — steady-state confirmation

```
npm run neutral-report:production-verify
```

**Stop gate:** prints `PASS ledger=resolved marker=verified`.

This command needs `OT_NEUTRAL_PRODUCTION_PROJECT_REF` and
`OT_NEUTRAL_PRODUCTION_MARKER_INSTANCE_ID` from prerequisite 5, and it reads them
before it opens a socket. Everything else it proves — roles, policies, grants,
bindings, ledger rows — is a statement about catalog *contents*, and every one of
those is equally true of a restored copy, of a Supabase branch of the same
project, and of a Staging database somebody once applied the baseline to. Without
the marker check its `PASS` could be filed as this rollout's receipt while
describing a different database, so it now parses the durable
`COMMENT ON DATABASE` marker and requires **both** its `projectRef` and its
`instanceId` to be exactly the approved pair — before any other proof runs, and
long before anything prints `PASS`. `marker=verified` on the line is that check
having passed.

Confirm again that every neutral and T2 flag is absent in the Vercel Production
environment. **Activation is not part of this packet and has no phase here.**

## Receipts to file

1. Phase 1 checksum output and the committed `resolve-manifest.json`.
2. Phase 2 preflight `PASS` line.
3. Phase 3 rehearsal output with `committed=false`.
4. Phase 4 PITR timestamp and retention window, with the confirming name.
5. Phase 5 apply output with `committed=true`, and the pre-ledger verification.
6. Phase 6 resolve output and the full verification with
   `ledger=resolved marker=verified`.
7. A screenshot or export showing every neutral and T2 flag still absent.

## Rollback states, summarised

| After | State | Rollback |
| --- | --- | --- |
| Phase 1–3 | Nothing changed | Stop |
| Phase 4 | Nothing changed | Stop |
| Phase 5 | Schema committed, ledger untouched, all features off | PITR to the Phase 4 timestamp |
| Phase 6 interrupted | Schema committed, ledger partially written | **Re-run the same Phase 6 command.** It resumes and skips what is recorded. |
| Phase 6 | Schema committed, ledger resolved | `prisma migrate resolve --rolled-back` per entry for the ledger; PITR for the schema |
| Partial **schema** state observed at any point | Unknown | **Do not re-run.** PITR. |

## Known residuals

- **`ot_fulfillment`, `ot_fulfillment_artifact` and `ot_delivery_attempt` gain
  RLS.** They have no policy for the owner role, which is what the application
  connects as today, and an owner bypasses non-FORCE RLS. There is no behaviour
  change now. When the application is later moved to `ot_prod_app`, its access to
  those relations will be governed by the neutral policies, and that move needs
  its own rehearsal.
- **The platform ADMIN edge on the two owner roles is not removable.** A
  `CREATEROLE` connection on PostgreSQL 16+ records an ADMIN grant it cannot
  revoke. The baseline accepts it, proves it grants neither `INHERIT` nor `SET`,
  and proves no borrowed membership survived the transfers. Both roles are
  `NOLOGIN NOINHERIT`, so nothing that can log in reaches them.
- **`createrole_self_grant` is reported, not depended on.** If the cluster is set
  to `set,inherit`, `CREATE ROLE` hands the creating role `SET` and `INHERIT` on
  every role it creates. The baseline normalizes the roles *it* creates back to
  `INHERIT FALSE, SET FALSE` immediately, and restores any *pre-existing* edge to
  exactly the flags it found rather than forcing both to false. The rehearsal
  receipt prints the setting and the edge shapes so the postcondition that
  forbids a surviving `SET`/`INHERIT` can be read against them.
- **The three login bindings are granted, not verified-only.** The restricted
  logins arrive from the Management API holding nothing and the baseline grants
  them one membership each, `INHERIT TRUE, SET FALSE`. `SET FALSE` is the point:
  a login reaches its functional role's privileges by inheritance and cannot
  `SET ROLE` away from the identity the audit trail is keyed on. Nothing connects
  as any of the three yet, so the edges change no behaviour today.
- **Migrations after the baseline have a declared home, and it is not the
  manifest.** `OT_NEUTRAL_PRODUCTION_DEPLOYABLE_AFTER_BASELINE` is empty; there
  is no migration after `20260916220000`. Future migrations go through
  `prisma migrate deploy` normally, once their independence from the baseline
  state is proved. It is a separate list rather than a manifest disposition
  because everything in the manifest is covered, pinned, forbidden in the ledger
  beforehand, required afterwards, and resolved — and an entry that was some of
  those but not others made those lists contradict each other.
