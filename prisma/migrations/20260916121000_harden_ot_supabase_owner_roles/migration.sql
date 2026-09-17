-- Forward-only hosted-Supabase hardening. The applied migrations that created
-- these owners remain immutable; this migration accepts only PostgreSQL's
-- empty membership graph or Supabase's exact platform-admin edge, removes any
-- interrupted temporary SET grant, and strips permanent schema CREATE.
DO $$
DECLARE
  owner_name TEXT;
  owner_oid OID;
  attrs_safe BOOLEAN;
  unexpected_edges INTEGER;
  platform_edges INTEGER;
  temporary_edges INTEGER;
BEGIN
  -- Validate every role before the first mutation, so an unsafe pre-existing
  -- role aborts without partially hardening another role.
  FOREACH owner_name IN ARRAY ARRAY[
    'ot_commerce_capture_owner',
    'ot_neutral_reversal_guard_owner'
  ] LOOP
    SELECT oid,
      NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
        AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
    INTO STRICT owner_oid, attrs_safe
    FROM pg_roles
    WHERE rolname = owner_name;
    IF NOT attrs_safe THEN
      RAISE EXCEPTION 'owner role % has unsafe attributes', owner_name;
    END IF;

    SELECT
      count(*) FILTER (WHERE
        m.roleid = owner_oid
        AND member_role.rolname = 'postgres'
        AND grantor_role.rolname = 'supabase_admin'
        AND m.admin_option = true
        AND m.inherit_option = false
        AND m.set_option = false
      ),
      count(*) FILTER (WHERE
        m.roleid = owner_oid
        AND member_role.rolname = 'postgres'
        AND grantor_role.rolname = 'postgres'
        AND m.admin_option = false
        AND m.inherit_option = false
        AND m.set_option = true
      ),
      count(*) FILTER (WHERE NOT (
        m.roleid = owner_oid
        AND member_role.rolname = 'postgres'
        AND (
          (grantor_role.rolname = 'supabase_admin' AND m.admin_option = true AND m.inherit_option = false AND m.set_option = false)
          OR
          (grantor_role.rolname = 'postgres' AND m.admin_option = false AND m.inherit_option = false AND m.set_option = true)
        )
      ))
    INTO platform_edges, temporary_edges, unexpected_edges
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles grantor_role ON grantor_role.oid = m.grantor
    WHERE m.roleid = owner_oid OR m.member = owner_oid;

    IF platform_edges > 1 OR temporary_edges > 1 OR unexpected_edges <> 0 THEN
      RAISE EXCEPTION 'owner role % has an unexpected membership graph', owner_name;
    END IF;
  END LOOP;

  -- Prove the complete ownership targets before the first REVOKE/GRANT. Any
  -- partial migration-33 topology is a no-mutation HOLD.
  IF to_regclass('public.ot_commerce_deadline_capture') IS NULL
    OR to_regprocedure('public.ot_commerce_deadline_capture_append_only()') IS NULL
    OR to_regprocedure('public.ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)') IS NULL
    OR to_regprocedure('public.ot_neutral_hold_on_settlement_reversal()') IS NULL
    OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.ot_commerce_deadline_capture'::regclass)) <> 'ot_commerce_capture_owner'
    OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.ot_commerce_deadline_capture_append_only()'::regprocedure)) <> 'ot_commerce_capture_owner'
    OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)'::regprocedure)) <> 'ot_commerce_capture_owner'
    OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.ot_neutral_hold_on_settlement_reversal()'::regprocedure)) <> 'ot_neutral_reversal_guard_owner'
  THEN
    RAISE EXCEPTION 'owner role pre-mutation object topology is invalid';
  END IF;

  FOREACH owner_name IN ARRAY ARRAY[
    'ot_commerce_capture_owner',
    'ot_neutral_reversal_guard_owner'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles member_role ON member_role.oid = m.member
      JOIN pg_roles grantor_role ON grantor_role.oid = m.grantor
      JOIN pg_roles owner_role ON owner_role.oid = m.roleid
      WHERE owner_role.rolname = owner_name
        AND member_role.rolname = 'postgres'
        AND grantor_role.rolname = 'postgres'
        AND m.admin_option = false
        AND m.inherit_option = false
        AND m.set_option = true
    ) THEN
      EXECUTE format('REVOKE %I FROM postgres GRANTED BY postgres', owner_name);
    END IF;
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', owner_name);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', owner_name);
  END LOOP;
END $$;

DO $$
DECLARE
  owner_name TEXT;
  owner_oid OID;
  edge_count INTEGER;
BEGIN
  FOREACH owner_name IN ARRAY ARRAY[
    'ot_commerce_capture_owner',
    'ot_neutral_reversal_guard_owner'
  ] LOOP
    SELECT oid INTO STRICT owner_oid FROM pg_roles WHERE rolname = owner_name;
    IF has_schema_privilege(owner_name, 'public', 'CREATE') THEN
      RAISE EXCEPTION 'owner role % retained public schema CREATE', owner_name;
    END IF;
    SELECT count(*) INTO edge_count
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles grantor_role ON grantor_role.oid = m.grantor
    WHERE (m.roleid = owner_oid OR m.member = owner_oid)
      AND NOT (
        m.roleid = owner_oid
        AND member_role.rolname = 'postgres'
        AND grantor_role.rolname = 'supabase_admin'
        AND m.admin_option = true
        AND m.inherit_option = false
        AND m.set_option = false
      );
    IF edge_count <> 0 THEN
      RAISE EXCEPTION 'owner role % final membership graph is unsafe', owner_name;
    END IF;
  END LOOP;

  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.ot_commerce_deadline_capture'::regclass)) <> 'ot_commerce_capture_owner'
    OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.ot_commerce_deadline_capture_append_only()'::regprocedure)) <> 'ot_commerce_capture_owner'
    OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)'::regprocedure)) <> 'ot_commerce_capture_owner'
    OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.ot_neutral_hold_on_settlement_reversal()'::regprocedure)) <> 'ot_neutral_reversal_guard_owner'
  THEN
    RAISE EXCEPTION 'owner role final object topology is invalid';
  END IF;
END $$;
