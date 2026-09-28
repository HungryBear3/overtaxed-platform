# OT official-calendar isolated Preview qualification — operator packet (2026-09-27)

Scope: the review-only consumer added by PR #228 (controlled copy) and PR #229
(`POST /api/internal/official-calendar-preview`, separate approval authority).
This packet prepares the **isolated-Supabase Preview proof** that must pass
before either PR advances. It does not claim that proof has passed. Only the
credentialed run below, executed by the owner or an owner-approved operator,
can produce qualification evidence (`"qualificationEvidence": true` in the
receipt). Everything in this branch was proved against local loopback
PostgreSQL only.

Harness: `lib/social/official-calendar-qualification.ts` (+ `-pg.ts`, `-cli.ts`),
entry `scripts/official-calendar-preview-qualification.ts`,
npm script `official-calendar:preview-qualification`.

## What one run does

| Phase       | Effect                                                                                                                                                                                                                                                         | Writes                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| preflight   | Resolves exactly one target from the environment; refuses Production, ambiguity and partial credentials before any socket; checks database name, durable isolated marker, `SystemConfig` schema and privileges; requires both snapshot keys absent             | none                                                                               |
| seed        | Pinned fixture bytes (sha256 `bb3b7a87…48ca`) through the real collector, parser, snapshot store and refresh barrier; verifies the pinned canonical digest before and after                                                                                    | exactly 2 `SystemConfig` rows: `ot:informational-assessor:2026:v1` and `…:attempt` |
| proof       | Invokes the real route handler in-process with `VERCEL_ENV=preview` and freshly generated capability/approval keys that exist only in memory; runs 4 hostile controls then one signed render; checks the pinned rendered text, binding and `postAllowed:false` | none (route is read-only)                                                          |
| cleanup     | Deletes only the (key, id) rows this run recorded, created at/after its own intent clock; proves absence on a fresh connection; never deletes a row it did not create                                                                                          | deletes its own 2 rows                                                             |
| default-off | Flags gone from the process, route returns 404 `not_found`, store factory returns null, both keys absent                                                                                                                                                       | none                                                                               |

Hostile controls inside the proof (all must hold): wrong capability → 401;
unsigned approval → 403; forged signature → 403; the valid signed request
replayed after rotating the approval key → 403.

Never done: Vercel/Supabase configuration or env changes, deployments, network
fetches of county sources, customer/payment/email/social actions, posting.
Credentials are read from the environment only. Child processes (git) get
`PATH` alone. Every journal/receipt write is scanned for the credential and the
ephemeral keys and refused if any appear. Refusals print a code and a static
message; driver errors print only an error class and SQLSTATE-style code.

Disclosure: the canonical decoder only admits `synthetic: false`, so the seeded
snapshot carries that flag and a `retrievedAt` equal to the seed instant. It is
fixture data, not a county retrieval; the receipt says so. This is why a
Production target is refused before connecting and why cleanup is mandatory.

## Pinned expectations

- Fixture: `__tests__/fixtures/deadlines/assessor-calendar-20260827.html`, sha256 `bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca`
- Canonical content digest (snapshot minus `retrievedAt`): `2e7c06f59aa4d8b232149eee9ef30a2b15d8b29c6cc7f85a43ee55ff73391190`
- Candidate: `occ_a702c9386291b1d2544b5d84` / `a702c9386291b1d2544b5d842fcacc6b943e70653f4baebaa815419b9662689d` (Calumet, assessor, `official_dates_v1`)
- Rendered text: `Official Cook County dates. Notice date: 2026-08-20. Filing window opens: 2026-08-20. Last day to file: 2026-10-02.`

## Owner decisions required before the credentialed run (blockers)

1. **Which isolated Supabase project.** Must not be Production
   (`kdvjiijzgflumgkndxsl`, refused by the harness). Must have the
   `20250306000001_add_system_config` migration applied, must hold neither
   snapshot key, and must not be the database behind the shared Vercel Preview.
   If the existing neutral-report Preview project is chosen, confirm no
   informational refresh cron writes to it.
2. **Durable marker.** The database must carry a `COMMENT ON DATABASE` marker
   installed by the owner: `schema "ot.database-environment.v1"`, `purpose`
   `"ot-neutral-report"` or `"ot-official-calendar-preview"`,
   `environment "preview"`, `isolated true`, `production false`, and the
   `instanceId` UUID the operator will enter. The harness never writes it.
3. **Database reachability.** The harness accepts either the direct
   `db.<ref>.supabase.co:5432` identity (`postgres`) or the project's included
   Free-tier us-east-2 **session** pooler on port `5432`
   (`postgres.<ref>`). Transaction pooling on `6543`, another region, a user
   without the exact project suffix, query options, and every other pooler are
   refused before connecting. Both paths verify TLS against the supplied
   Supabase CA; the durable database marker remains the final project identity
   proof. This keeps qualification on Supabase Free without weakening the
   Production, ambiguity, marker, schema, or cleanup gates.
4. **Deployed-Preview proof is out of scope.** This harness runs the exact route
   handler in-process against the isolated database. Proving the same through
   a deployed Vercel Preview requires a dedicated Preview deployment whose
   environment is bound to the isolated database — a Vercel configuration
   change this task was not permitted to make. If owners require it, it is a
   separate approved step.
5. **Exact commit.** Qualification mode refuses a dirty tree. The receipt
   records `commit`/`tree`; owners confirm they are the PR head under review.

## 0. Optional: credential-free local rehearsal

Uses a throwaway loopback cluster; the harness only accepts loopback hosts and
`ot_calendar_rehearsal_*` databases in this mode, and receipts are marked
`qualificationEvidence: false`. Requires PostgreSQL 17+ binaries.

```sh
export OCQ_REHEARSAL="$(mktemp -d)"
openssl rand -hex 24 > "$OCQ_REHEARSAL/pw" && chmod 600 "$OCQ_REHEARSAL/pw"
initdb -D "$OCQ_REHEARSAL/data" -U ot_rehearsal --pwfile="$OCQ_REHEARSAL/pw" -A scram-sha-256 >/dev/null
pg_ctl -D "$OCQ_REHEARSAL/data" -o "-p 55432 -k $OCQ_REHEARSAL -c listen_addresses=127.0.0.1" -l "$OCQ_REHEARSAL/log" -w start
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=ot_rehearsal PGPASSWORD="$(cat "$OCQ_REHEARSAL/pw")"
createdb ot_calendar_rehearsal_local
psql -X -q -v ON_ERROR_STOP=1 -d ot_calendar_rehearsal_local -f prisma/migrations/20250306000001_add_system_config/migration.sql
export OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID="$(uuidgen | tr 'A-Z' 'a-z')"
psql -X -q -v ON_ERROR_STOP=1 -d ot_calendar_rehearsal_local -c "comment on database ot_calendar_rehearsal_local is '{\"schema\":\"ot.database-environment.v1\",\"purpose\":\"ot-official-calendar-preview\",\"environment\":\"preview\",\"isolated\":true,\"production\":false,\"instanceId\":\"$OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID\"}'"
export OT_CALENDAR_PREVIEW_DATABASE_URL="postgresql://ot_rehearsal:$PGPASSWORD@127.0.0.1:55432/ot_calendar_rehearsal_local"
unset PGHOST PGPORT PGUSER PGPASSWORD
mkdir -p -m 700 "$OCQ_REHEARSAL/evidence"
npm run -s official-calendar:preview-qualification -- preflight --mode local-rehearsal
npm run -s official-calendar:preview-qualification -- run --mode local-rehearsal --run-dir "$OCQ_REHEARSAL/evidence"
```

Teardown:

```sh
unset OT_CALENDAR_PREVIEW_DATABASE_URL OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID
pg_ctl -D "$OCQ_REHEARSAL/data" -m fast stop
rm -rf "$OCQ_REHEARSAL" && unset OCQ_REHEARSAL
```

The real-PostgreSQL integration suite can run against the same rehearsal
database (it is skipped unless the variable is set):

```sh
read -rs OT_CALENDAR_QUALIFICATION_TEST_DATABASE_URL && export OT_CALENDAR_QUALIFICATION_TEST_DATABASE_URL
npx jest __tests__/integration/official-calendar-qualification-postgresql.test.ts
unset OT_CALENDAR_QUALIFICATION_TEST_DATABASE_URL
```

## 1. Preflight (credentialed, read-only)

Work from a clean checkout of the exact commit under review, in a shell that
has never loaded application env files.

```sh
git status --porcelain
git rev-parse HEAD HEAD^{tree}
npm ci
```

`git status --porcelain` must print nothing. Record the two hashes.

Environment hygiene — this must print nothing; if it prints names, run the
`unset` line and re-check:

```sh
env | cut -d= -f1 | grep -E '^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|POSTGRES_URL_NON_POOLING|SHADOW_DATABASE_URL|DATABASE_INSECURE_TLS|DATABASE_SSL|NODE_TLS_REJECT_UNAUTHORIZED|VERCEL|VERCEL_ENV|VERCEL_URL|OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED|OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY|OT_OFFICIAL_CALENDAR_PREVIEW_APPROVAL_SECRET|OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED|OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED)$'
unset DATABASE_URL DIRECT_URL POSTGRES_URL POSTGRES_PRISMA_URL POSTGRES_URL_NON_POOLING SHADOW_DATABASE_URL DATABASE_INSECURE_TLS DATABASE_SSL NODE_TLS_REJECT_UNAUTHORIZED VERCEL VERCEL_ENV VERCEL_URL OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED OT_OFFICIAL_CALENDAR_PREVIEW_CAPABILITY OT_OFFICIAL_CALENDAR_PREVIEW_APPROVAL_SECRET OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED
```

Inject inputs. Each `read` waits for one line of input; `-s` keeps the
credential off the screen and out of shell history. Nothing goes in argv.

```sh
read -rs OT_CALENDAR_PREVIEW_DATABASE_URL && export OT_CALENDAR_PREVIEW_DATABASE_URL
read -r OT_CALENDAR_PREVIEW_PROJECT_REF && export OT_CALENDAR_PREVIEW_PROJECT_REF
read -r OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID && export OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID
read -r OCQ_CA_FILE && export SUPABASE_CA_PEM="$(cat "$OCQ_CA_FILE")"
export OCQ_EVIDENCE="$HOME/ot-evidence/calendar-preview-qualification"
mkdir -p -m 700 "$OCQ_EVIDENCE"
```

- Database URL form: `postgresql://USER:PASSWORD@db.REF.supabase.co:5432/postgres`,
  no query string (percent-encode special characters in the password).
- Project ref: the isolated project's 20-letter reference.
- Marker ID: the UUID in the owner-installed database marker.
- CA file: path to the project's Supabase CA certificate (public, not secret).
- `OCQ_EVIDENCE` must be outside the repository; the CLI refuses otherwise.

```sh
npm run -s official-calendar:preview-qualification -- preflight
```

Expected: `preflight: PASS mode=isolated-preview fingerprint=…` (the
fingerprint hashes mode, host, port, database, user, project ref and marker ID;
no credential). Any `FAIL <code>` stops the procedure — see the refusal table.

## 2. Run

```sh
npm run -s official-calendar:preview-qualification -- run --run-dir "$OCQ_EVIDENCE"
```

Expected output, in order: `run-id: ocq-…`, `preflight: PASS`, `seed: PASS`,
`proof: PASS`, `cleanup: PASS`, `default-off: PASS`,
`run: PASS phase=complete receipt=<sha256> dir=…`. Exit code 0.

Capture the run ID for the following steps:

```sh
read -r OCQ_RUN_ID && export OCQ_RUN_ID
```

## 3. Verify (offline, no database)

```sh
npm run -s official-calendar:preview-qualification -- verify --run-dir "$OCQ_EVIDENCE" --run-id "$OCQ_RUN_ID"
npm run -s official-calendar:preview-qualification -- status --run-dir "$OCQ_EVIDENCE" --run-id "$OCQ_RUN_ID"
(cd "$OCQ_EVIDENCE/$OCQ_RUN_ID" && shasum -a 256 -c receipt.sha256)
```

`verify: PASS` checks the receipt digest, its binding to the journal, the
pinned rendered text and source digest, the fresh-connection absence proof and
all default-off checks. Hand `receipt.json` and `receipt.sha256` (and the
journal if requested) to the owner; they contain run/row IDs, project ref,
marker ID and hashes only.

Owner review checklist for the receipt: `mode: "isolated-preview"`,
`qualificationEvidence: true`, `source.clean: true` with the expected commit and
tree, `target.projectRef` is the approved isolated project, all four controls
blocked (401/403/403/403), `rendered.status: 200`, `postAllowed: false`,
`cleanup.deleted: 2`, every `defaultOff.checks` value true / 404, `failures: []`.

## 4. Resume after interruption

If the process was killed or the connection dropped, rerun with the same run ID.
Journaled phases are skipped; a partial seed of this run's own rows is removed
and redone; once cleanup has started the run never seeds or proves again; a
completed run is reported without touching the database.

```sh
npm run -s official-calendar:preview-qualification -- resume --run-dir "$OCQ_EVIDENCE" --run-id "$OCQ_RUN_ID"
```

A run whose proof failed ends cleaned and cannot be resumed into a pass
(`FAIL proof_failed`); start a new `run`. Resuming against a different target,
or with a different run ID, is refused before connecting.

## 5. Cleanup / rollback

Preferred — removes only this run's recorded rows, proves absence on a fresh
connection, re-proves default-off, and removes temporary `*.tmp` files:

```sh
npm run -s official-calendar:preview-qualification -- cleanup --run-dir "$OCQ_EVIDENCE" --run-id "$OCQ_RUN_ID"
```

`FAIL foreign_rows_present` means a row this run did not create sits under a
snapshot key. It is deliberately left untouched; stop and escalate to the owner.

Manual fallback, only if the harness itself cannot run. Inspect first
(read-only), with the password entered silently and never in argv:

```sh
export PGHOST="db.$OT_CALENDAR_PREVIEW_PROJECT_REF.supabase.co" PGPORT=5432 PGDATABASE=postgres PGSSLMODE=verify-full PGSSLROOTCERT="$OCQ_CA_FILE"
read -r PGUSER && export PGUSER
read -rs PGPASSWORD && export PGPASSWORD
psql -X -v ON_ERROR_STOP=1 -c "select \"key\", \"id\", \"createdAt\" from \"SystemConfig\" where \"key\" in ('ot:informational-assessor:2026:v1', 'ot:informational-assessor:2026:v1:attempt') order by 1"
```

Delete only the IDs this run journaled (`phases.seeded.rows`):

```sh
export OCQ_SNAPSHOT_ID="$(python3 -c 'import json,os,sys; j=json.load(open(os.path.join(os.environ["OCQ_EVIDENCE"],os.environ["OCQ_RUN_ID"],"journal.json"))); print(next(r["id"] for r in j["phases"]["seeded"]["rows"] if r["key"]=="ot:informational-assessor:2026:v1"))')"
export OCQ_ATTEMPT_ID="$(python3 -c 'import json,os,sys; j=json.load(open(os.path.join(os.environ["OCQ_EVIDENCE"],os.environ["OCQ_RUN_ID"],"journal.json"))); print(next(r["id"] for r in j["phases"]["seeded"]["rows"] if r["key"]=="ot:informational-assessor:2026:v1:attempt"))')"
psql -X -v ON_ERROR_STOP=1 -v snapshot_id="$OCQ_SNAPSHOT_ID" -v attempt_id="$OCQ_ATTEMPT_ID" <<'SQL'
begin;
delete from "SystemConfig" where "key" = 'ot:informational-assessor:2026:v1' and "id" = :'snapshot_id';
delete from "SystemConfig" where "key" = 'ot:informational-assessor:2026:v1:attempt' and "id" = :'attempt_id';
select count(*) as remaining from "SystemConfig" where "key" in ('ot:informational-assessor:2026:v1', 'ot:informational-assessor:2026:v1:attempt');
commit;
SQL
unset PGHOST PGPORT PGDATABASE PGSSLMODE PGSSLROOTCERT PGUSER PGPASSWORD OCQ_SNAPSHOT_ID OCQ_ATTEMPT_ID
```

If the journal has no `seeded` phase, the run never recorded row IDs; do not
delete anything by key alone — escalate. Then rerun the harness `cleanup`
command to record the fresh-connection absence and default-off proofs.

Rollback of the feature itself: nothing to roll back. The route stays 404
unless a deployment sets both `VERCEL_ENV=preview` and
`OT_OFFICIAL_CALENDAR_PREVIEW_ENABLED=true`; this harness sets them only inside
its own process for the proof and restores them before cleanup completes.

## 6. Close the session

```sh
unset OT_CALENDAR_PREVIEW_DATABASE_URL OT_CALENDAR_PREVIEW_PROJECT_REF OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID SUPABASE_CA_PEM OCQ_CA_FILE OCQ_RUN_ID
env | cut -d= -f1 | grep -E '^(OT_CALENDAR_PREVIEW_|OT_OFFICIAL_CALENDAR_PREVIEW_|SUPABASE_CA_PEM$|PGPASSWORD$)'
```

The second command must print nothing.

## Exit codes and refusals

Exit `0` pass, `1` refusal or failure, `2` usage (argv refused before the
environment is read).

| Code                                                   | Meaning                                                                             | Database touched?       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------- |
| `ambient_env`                                          | A database/feature variable is already set in the shell                             | no                      |
| `credentials_missing` / `credentials_partial`          | URL unset, or missing user or password                                              | no                      |
| `target_invalid`                                       | Unparseable URL, query string/fragment, bad port                                    | no                      |
| `production_target`                                    | Production project ref anywhere in the URL, or declared                             | no                      |
| `target_not_isolated_preview`                          | Not `db.<declared ref>.supabase.co:5432/postgres`                                   | no                      |
| `rehearsal_target_invalid`                             | Rehearsal target not loopback + `ot_calendar_rehearsal_*`                           | no                      |
| `tls_ca_missing`                                       | `SUPABASE_CA_PEM` absent in isolated-preview mode                                   | no                      |
| `marker_expected_missing` / `marker_invalid`           | Expected marker ID missing; database marker absent, Production, or other instance   | read only               |
| `database_mismatch` / `schema_invalid`                 | Wrong database; `SystemConfig` columns, unique key index or privileges incompatible | read only               |
| `target_not_clean`                                     | A snapshot key already exists                                                       | read only               |
| `source_tree_dirty`                                    | Qualification mode on an uncommitted tree                                           | no                      |
| `fixture_digest_mismatch` / `snapshot_digest_mismatch` | Pinned bytes or canonical digest differ                                             | none / own rows cleaned |
| `seed_refused` / `store_unavailable`                   | Store or barrier refused                                                            | own rows cleaned        |
| `proof_failed[:status:reason]`                         | Consumer proof did not produce the pinned outcome                                   | own rows cleaned        |
| `cleanup_incomplete` / `foreign_rows_present`          | Own rows remain (resume) / a foreign row exists (escalate)                          | foreign rows untouched  |
| `default_off_failed`                                   | A flag remained set, route not 404, store on, or key present                        | —                       |
| `journal_missing` / `journal_mismatch`                 | Unknown run, or journal for another run/target/harness                              | no                      |
| `secret_leak_blocked`                                  | A write would have contained secret material                                        | no further writes       |
