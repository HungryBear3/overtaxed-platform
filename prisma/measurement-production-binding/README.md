# Separately gated Production measurement binding

This is **not a shared migration**, is never invoked automatically, and must not
be applied to Preview. Common migration remains default-deny; no flags, registry,
roles, membership edges, datasource URL or hosted identity are changed here.

Release ingredients (separate owner-approved release, not performed locally):

1. Confirm exact deployed `OT_FREE_CHECK_MEASUREMENT_DATABASE_URL` identity is the existing safe nonowner
   `ot_prod_app`, not merely a role with that name in source. Current hosted
   identity is **unverified**; purpose-bound restricted connection setup remains separate. Never change shared `DATABASE_URL`.
2. Run unchanged Production baseline verifier and its pinned SQL first. Retain
   exact membership/ownership evidence. Apply the approved common measurement
   migration, then explicitly run `01_bind.sql` with owner credentials and
   `psql -X -v ON_ERROR_STOP=1`. Its transaction checks preconditions and exact
   postconditions; absent/unsafe roles, unexpected effective API/inherited grants
   or policies abort rather than silently skip.
3. Run `02_postconditions.sql` again as owner. Existing Production role/baseline
   checks stay mandatory and unchanged. The dedicated check covers this ledger;
   the old paid baseline alone does not. Preview acceptance's global exact ACL
   inventory is deliberately unchanged: **no Preview binding is provided**.
4. Only after separate activation approval enable measurement and check the real
   completion/export path. No ad-spend authorization is implied.

Only nine INSERT columns and all ten non-PII SELECT columns are granted directly
to app; no table-wide grants, no grant options, no authority for functional
reader/API roles. Two role-specific RLS policies. No SECURITY DEFINER routines.

Rollback: disable measurement via separately approved operational change, then
run `03_rollback.sql` as owner. It revokes only these exact column grants and drops
only these two policies. It does not drop data/table or alter memberships. Check
runtime no longer has ledger access and paid baseline still passes. If unrelated
pre-existing grants/policies exist, diagnose separately; rollback is not a global
ACL scrubber.

Local disposable PG17 integration executes the dedicated measurement pg writer and
aggregate exporter as `ot_prod_app`, proves destructive/API denials, detects an
inherited API grant, verifies unchanged memberships and data-preserving rollback.
It is not evidence of actual hosted identity or live deployment.

Runtime uses only `OT_FREE_CHECK_MEASUREMENT_DATABASE_URL`; missing/invalid configuration reports unavailable without importing shared Prisma. Remote connections require `SUPABASE_CA_PEM` and strict certificate verification. Runtime checks exact current/session identity, safe flags, exact neutral-reader membership, and no ownership before each operation. Connection/statement/query timeouts are bounded; no retry. The shared Prisma URL and all paid connections remain untouched.

For canonical Supabase pooler URLs using `ot_prod_app.<projectRef>`, also set `OT_FREE_CHECK_MEASUREMENT_SUPABASE_PROJECT_REF` to the independently verified exact project ref. Arbitrary hosts/suffixes are rejected; actual SQL current/session identity must still be `ot_prod_app`. Read-only preflight: `npx tsx scripts/ot-free-check-measurement-preflight.ts`.
