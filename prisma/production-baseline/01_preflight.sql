-- OT neutral-report PRODUCTION BASELINE — preflight classification.
--
-- Read-only. It executes no DDL, no DML and no GRANT, and the only rows it
-- reads are catalog rows: it never selects from an application relation. It
-- returns exactly one row describing the target database well enough for the
-- operator runner to decide between three outcomes and nothing else:
--
--   ABSENT    none of the baseline's database-local objects exist -> apply
--   COMPLETE  every one of them exists                            -> verified replay
--   PARTIAL   some do                                             -> REFUSE, mutate nothing
--
-- PARTIAL is the important one. A half-applied neutral schema is exactly the
-- state the pending migration chain would leave behind on its first failure, and
-- "just run it again" against that state is how a security posture ends up
-- half-installed. There is deliberately no repair path here: partial state is an
-- operator decision made with the rollback packet open, not something a script
-- resolves on its own.
--
-- WHY ROLES ARE COUNTED SEPARATELY FROM THE DATABASE-LOCAL OBJECTS
--
-- Roles are cluster-global. They outlive a dropped schema, a platform operator
-- can create them ahead of time, and on Supabase they routinely are. Counting
-- them into the ABSENT/PARTIAL/COMPLETE tally meant that a database with none of
-- the baseline's tables, but with the five functional roles already present,
-- classified PARTIAL and was refused permanently — while 02_baseline.sql is
-- written to ACCEPT a pristine pre-created role and adopt it. The classification
-- and the body disagreed, and the half that refused was the half an operator
-- met first.
--
-- So `state` is computed from database-local objects only, and roles are
-- reported as what they are: which exist, which do not, and which of the
-- existing ones are NOT pristine. A pre-created role is acceptable. A
-- pre-created role that can log in, inherits, or carries ambient authority is
-- somebody else's role, and the runner refuses on it.
--
-- THE THREE RESTRICTED LOGINS ARE THE MIRROR IMAGE
--
-- `ot_prod_app`, `ot_prod_neutral_runtime` and `ot_prod_neutral_delivery` are
-- minted through the protected Supabase Management API flow and never by
-- anything in this repository — creating a login means choosing a password, and
-- a migration that can mint a Production credential can mint a back door. They
-- must therefore ALREADY exist, pristine, before the baseline runs, and the one
-- thing the baseline does own is the single membership edge that binds each to
-- its functional role. They are reported here so the rehearsal receipt names a
-- provisioning gap before the transaction opens, rather than the operator
-- meeting it as an abort forty statements into the body.

with expected(kind, name) as (values
  -- settlement evidence (covers 20260912190000)
  ('relation', 'ot_payment_binding'),
  ('relation', 'ot_settlement_reversal'),
  ('function', 'ot_preserve_settlement_hold()'),
  ('function', 'ot_settlement_evidence_immutable()'),
  -- acquisition attribution (covers 20260912000000)
  ('relation', 'ot_order_attribution'),
  ('function', 'ot_order_attribution_reject_update()'),
  -- packet download + orphan quarantine (covers 20260912120000, 20260912140000)
  ('relation', 'ot_packet_download_capability'),
  ('relation', 'ot_artifact_orphan_quarantine'),
  -- provider callbacks (covers 20260912160000)
  ('relation', 'ot_delivery_provider_callback'),
  ('column',   'ot_delivery_attempt.download_capability_id'),
  -- admin event vocabulary (covers 20260912180000)
  ('constraint', 'ot_fulfillment_admin_event_action_closed'),
  ('constraint', 'ot_fulfillment_admin_event_resolve_unresolved_send_shape'),
  -- commerce deadline capture (replaces 20260913170000)
  ('relation', 'ot_commerce_deadline_capture'),
  ('function', 'ot_commerce_deadline_capture_append_only()'),
  ('function', 'ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)'),
  -- neutral repository (covers 20260915143000)
  ('type',     'OTNeutralReservationStatus'),
  ('type',     'OTNeutralBlobAttemptStatus'),
  ('relation', 'ot_neutral_report_reservation'),
  ('relation', 'ot_neutral_blob_attempt'),
  ('relation', 'ot_neutral_checkout_attempt'),
  -- neutral QA / refund / reversal guard (covers 20260915190000)
  ('enumvalue', 'OTFulfillmentKind.NEUTRAL_RECORDS_REPORT'),
  ('column',   'ot_neutral_report_reservation.customer_zip_sha256'),
  ('relation', 'ot_neutral_customer_zip_attempt'),
  ('type',     'OTNeutralQaStatus'),
  ('relation', 'ot_neutral_qa_review'),
  ('type',     'OTNeutralRefundStatus'),
  ('relation', 'ot_neutral_refund_work'),
  ('function', 'ot_neutral_hold_on_settlement_reversal()'),
  -- neutral delivery runtime (covers 20260915220000)
  ('relation', 'ot_neutral_delivery_order'),
  ('relation', 'ot_fulfillment_kind_authority'),
  ('relation', 'ot_packet_capability_kind_authority'),
  ('function', 'ot_enforce_neutral_capability_single_use()'),
  -- runtime commerce read constraint (covers 20260915230000)
  ('relation', 'ot_neutral_runtime_order'),
  ('relation', 'ot_neutral_runtime_payment_binding'),
  ('relation', 'ot_neutral_runtime_settlement_reversal'),
  ('column',   'ot_neutral_refund_work.provider_lookup_attempts')
),
-- Cluster-global, and therefore not part of `state`. See the header.
expected_role(name) as (values
  ('ot_commerce_capture_owner'),
  ('ot_neutral_runtime'),
  ('ot_neutral_app_reader'),
  ('ot_neutral_reversal_guard_owner'),
  ('ot_neutral_delivery_runtime')
),
-- The only shape 02_baseline.sql will adopt: no login, no inherit, and no
-- ambient authority of any kind.
role_state(name, present, pristine) as (
  select r.name,
    exists (select 1 from pg_roles g where g.rolname = r.name),
    exists (
      select 1 from pg_roles g
      where g.rolname = r.name
        and not g.rolcanlogin and not g.rolinherit and not g.rolsuper
        and not g.rolcreaterole and not g.rolcreatedb and not g.rolreplication
        and not g.rolbypassrls
    )
  from expected_role r
),
-- login -> the ONE functional role 02_baseline.sql binds it to. Any other
-- membership edge is a privilege path nobody in this rollout designed.
--
-- AN EDGE IS A CATALOG ROW, AND THERE CAN BE MORE THAN ONE PER PAIR
--
-- `pg_auth_members` is keyed on (roleid, member, GRANTOR). Two different
-- grantors can therefore record two different edges for the SAME
-- login -> functional pair, with different INHERIT/SET/ADMIN options on each,
-- and PostgreSQL unions the privileges they confer. That is the bypass this
-- block exists to name: a platform operator grants
-- `ot_neutral_app_reader TO ot_prod_app WITH SET TRUE`, the baseline then adds
-- its own `INHERIT TRUE, SET FALSE` edge, and every check written as "an edge
-- with the right shape EXISTS" passes while `pg_has_role(login, functional,
-- 'SET')` is true and the login can shed the identity the audit trail is keyed
-- on.
--
-- So edges are reported one CATALOG ROW at a time, with their grantor, and the
-- duplicate/unsafe/SET-reachable cases are each called out by name rather than
-- collapsed into an existence test.
expected_login(name, functional) as (values
  ('ot_prod_app', 'ot_neutral_app_reader'),
  ('ot_prod_neutral_runtime', 'ot_neutral_runtime'),
  ('ot_prod_neutral_delivery', 'ot_neutral_delivery_runtime')
),
-- Pristine here means the opposite of pristine for a functional role: a login
-- MUST be able to log in and MUST inherit (the binding is granted
-- `INHERIT TRUE, SET FALSE`, so inheritance is the only way it reaches its
-- functional role at all), and must carry no ambient authority and no direct
-- CREATE on schema public.
login_state(name, present, pristine, foreign_memberships) as (
  select l.name,
    exists (select 1 from pg_roles g where g.rolname = l.name),
    exists (
      select 1 from pg_roles g
      where g.rolname = l.name
        and g.rolcanlogin and g.rolinherit
        and not g.rolsuper and not g.rolcreaterole and not g.rolcreatedb
        and not g.rolreplication and not g.rolbypassrls
        and not exists (
          select 1 from pg_namespace n
          cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
          where n.nspname = 'public' and acl.grantee = g.oid
            and acl.privilege_type = 'CREATE'
        )
    ),
    coalesce((
      select array_agg(granted.rolname order by granted.rolname)
      from pg_auth_members m
      join pg_roles granted on granted.oid = m.roleid
      join pg_roles member_role on member_role.oid = m.member
      where member_role.rolname = l.name and granted.rolname <> l.functional
    ), array[]::text[])
  from expected_login l
),
-- ONE ROW PER CATALOG EDGE on the designed login -> functional pair. Not an
-- EXISTS, not a boolean: the count and the per-grantor shape are the facts the
-- runner classifies on.
login_binding_edge(name, functional, grantor, inherit_option, set_option, admin_option) as (
  select l.name, l.functional, grantor.rolname,
         m.inherit_option, m.set_option, m.admin_option
  from expected_login l
  join pg_roles member_role on member_role.rolname = l.name
  join pg_auth_members m on m.member = member_role.oid
  join pg_roles granted on granted.oid = m.roleid and granted.rolname = l.functional
  join pg_roles grantor on grantor.oid = m.grantor
),
prerequisite(kind, name) as (values
  ('relation', 'ot_order'),
  ('relation', 'ot_fulfillment'),
  ('relation', 'ot_fulfillment_artifact'),
  ('relation', 'ot_delivery_attempt'),
  ('relation', 'ot_delivery_event'),
  ('relation', 'ot_fulfillment_admin_event'),
  ('type',     'OTFulfillmentKind'),
  ('type',     'OTDeliveryEventType')
),
candidate(class, kind, name) as (
  select 'expected', kind, name from expected
  union all
  select 'prerequisite', kind, name from prerequisite
),
-- One inline probe per object kind. No helper function is created: the preflight
-- must be able to run against a database it is not yet allowed to change.
probe(class, kind, name, present) as (
  select c.class, c.kind, c.name,
    case c.kind
      when 'relation' then to_regclass('public.' || quote_ident(c.name)) is not null
      when 'type' then to_regtype('public.' || quote_ident(c.name)) is not null
      when 'function' then to_regprocedure('public.' || c.name) is not null
      when 'constraint' then exists (
        select 1 from pg_constraint
        where conname = c.name and connamespace = 'public'::regnamespace
      )
      when 'column' then exists (
        select 1 from pg_attribute a
        where a.attrelid = to_regclass('public.' || quote_ident(split_part(c.name, '.', 1)))
          and a.attname = split_part(c.name, '.', 2)
          and a.attnum > 0 and not a.attisdropped
      )
      when 'enumvalue' then exists (
        select 1 from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        where t.typnamespace = 'public'::regnamespace
          and t.typname = split_part(c.name, '.', 1)
          and e.enumlabel = split_part(c.name, '.', 2)
      )
    end
  from candidate c
)
select
  (select count(*)::int from probe where class = 'expected' and present) as present_objects,
  (select count(*)::int from probe where class = 'expected') as expected_objects,
  case
    when (select count(*) from probe where class = 'expected' and present) = 0 then 'ABSENT'
    when (select count(*) from probe where class = 'expected' and not present) = 0 then 'COMPLETE'
    else 'PARTIAL'
  end as state,
  coalesce((select array_agg(kind || ':' || name order by name) from probe where class = 'expected' and not present), array[]::text[]) as missing_objects,
  coalesce((select array_agg(kind || ':' || name order by name) from probe where class = 'expected' and present), array[]::text[]) as present_object_names,
  coalesce((select array_agg(kind || ':' || name order by name) from probe where class = 'prerequisite' and not present), array[]::text[]) as missing_prerequisites,
  coalesce((select array_agg(name order by name) from role_state where present), array[]::text[]) as present_roles,
  coalesce((select array_agg(name order by name) from role_state where not present), array[]::text[]) as missing_roles,
  coalesce((select array_agg(name order by name) from role_state where present and not pristine), array[]::text[]) as unsafe_preexisting_roles,
  coalesce((select array_agg(name order by name) from login_state where not present), array[]::text[]) as missing_login_roles,
  coalesce((select array_agg(name order by name) from login_state where present and not pristine), array[]::text[]) as unsafe_login_roles,
  coalesce((
    select array_agg(l.name || '->' || edge order by l.name, edge)
    from login_state l, unnest(l.foreign_memberships) as edge
    where l.present
  ), array[]::text[]) as unexpected_login_memberships,
  -- Every catalog edge on the designed pair, with its grantor. On an ABSENT
  -- database this must be empty — the baseline is about to create the only edge
  -- there is, and "exactly this edge and no other" is not provable by adding one
  -- on top of somebody else's. On a COMPLETE database there must be exactly one
  -- per login, and it must be the baseline's.
  coalesce((
    select array_agg(
      e.name || '->' || e.functional
        || ':grantor=' || e.grantor
        || ',inherit=' || e.inherit_option::text
        || ',set=' || e.set_option::text
        || ',admin=' || e.admin_option::text
      order by e.name, e.grantor)
    from login_binding_edge e
  ), array[]::text[]) as login_binding_edges,
  -- Any edge whose options are not exactly INHERIT TRUE, SET FALSE, ADMIN FALSE,
  -- whoever granted it.
  coalesce((
    select array_agg(
      e.name || '->' || e.functional
        || ':grantor=' || e.grantor
        || ',inherit=' || e.inherit_option::text
        || ',set=' || e.set_option::text
        || ',admin=' || e.admin_option::text
      order by e.name, e.grantor)
    from login_binding_edge e
    where not (e.inherit_option and not e.set_option and not e.admin_option)
  ), array[]::text[]) as unsafe_login_binding_edges,
  -- The multi-grantor case, stated as itself.
  coalesce((
    select array_agg(d.name || '->' || d.functional || ' x' || d.n::text order by d.name)
    from (
      select e.name, e.functional, count(*) as n
      from login_binding_edge e group by e.name, e.functional having count(*) > 1
    ) d
  ), array[]::text[]) as duplicate_login_bindings,
  coalesce((
    select array_agg(l.name || '->' || l.functional order by l.name)
    from expected_login l
    where not exists (select 1 from login_binding_edge e where e.name = l.name)
  ), array[]::text[]) as missing_login_bindings,
  -- The end state that actually matters, asked of the server rather than derived
  -- from the options above: can this login SET ROLE to its functional role. It
  -- must be false on every path, before and after the baseline.
  coalesce((
    select array_agg(l.name || '->' || l.functional order by l.name)
    from expected_login l
    join pg_roles lr on lr.rolname = l.name
    join pg_roles fr on fr.rolname = l.functional
    where pg_has_role(lr.oid, fr.oid, 'SET')
  ), array[]::text[]) as login_binding_set_paths,
  current_user as owner_role,
  current_database() as database_name,
  current_setting('server_version_num')::int as server_version_num,
  shobj_description(d.oid, 'pg_database') as database_marker,
  (select rolsuper from pg_roles where rolname = current_user) as owner_is_superuser,
  (select rolcreaterole from pg_roles where rolname = current_user) as owner_can_create_role,
  has_schema_privilege(current_user, 'public', 'CREATE') as owner_can_create_schema,
  has_schema_privilege('public', 'public', 'CREATE') as public_schema_public_create,
  to_regprocedure('public.rls_auto_enable()') is not null as rls_auto_enable_present,
  -- Both views, separately. Section 11 of 02_baseline.sql closes the PUBLIC
  -- grant on the pair and aborts the transaction if either is absent; reporting
  -- them here is what turns that abort into a refusal an operator reads off the
  -- rehearsal receipt before anything is opened.
  to_regclass('extensions.pg_stat_statements') is not null as pg_stat_statements_present,
  to_regclass('extensions.pg_stat_statements_info') is not null as pg_stat_statements_info_present,
  coalesce((select array_agg(rolname order by rolname) from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin')), array[]::text[]) as platform_roles,
  -- Diagnostics for the SET/INHERIT borrow in 02_baseline.sql. Nothing branches
  -- on either of these; they exist so that when a restoration assertion fires,
  -- the rehearsal receipt already says what the edge looked like going in and
  -- whether the cluster auto-grants SET/INHERIT at CREATE ROLE time.
  coalesce(current_setting('createrole_self_grant', true), '') as createrole_self_grant,
  coalesce((
    select array_agg(
      granted.rolname
        || ':inherit=' || m.inherit_option::text
        || ',set=' || m.set_option::text
        || ',admin=' || m.admin_option::text
      order by granted.rolname)
    from pg_auth_members m
    join pg_roles granted on granted.oid = m.roleid
    join pg_roles member_role on member_role.oid = m.member
    where granted.rolname in ('ot_commerce_capture_owner','ot_neutral_reversal_guard_owner')
      and member_role.rolname = current_user
  ), array[]::text[]) as owner_role_grant_options
from pg_database d
where d.datname = current_database();
