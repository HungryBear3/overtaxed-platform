-- Forward-only hosted-Supabase hardening. These catalog objects are part of
-- the qualified OT environment; fail closed if the target topology drifts.
-- The platform views/functions can be owned by a Supabase-managed role, so
-- every revoke executes as the exact object owner after proving SET authority.
DO $$
DECLARE
  stats_owner NAME;
  stats_info_owner NAME;
  rls_owner NAME;
  capability_owner NAME;
BEGIN
  IF to_regclass('extensions.pg_stat_statements') IS NULL
    OR to_regclass('extensions.pg_stat_statements_info') IS NULL
    OR to_regprocedure('public.rls_auto_enable()') IS NULL
    OR to_regclass('public.ot_packet_download_capability') IS NULL
  THEN
    RAISE EXCEPTION 'OT Supabase PUBLIC-ACL hardening target topology is invalid';
  END IF;

  SELECT pg_get_userbyid(c.relowner)
  INTO STRICT stats_owner
  FROM pg_class c
  WHERE c.oid = 'extensions.pg_stat_statements'::regclass;

  SELECT pg_get_userbyid(c.relowner)
  INTO STRICT stats_info_owner
  FROM pg_class c
  WHERE c.oid = 'extensions.pg_stat_statements_info'::regclass;

  SELECT pg_get_userbyid(p.proowner)
  INTO STRICT rls_owner
  FROM pg_proc p
  WHERE p.oid = 'public.rls_auto_enable()'::regprocedure;

  SELECT pg_get_userbyid(c.relowner)
  INTO STRICT capability_owner
  FROM pg_class c
  WHERE c.oid = 'public.ot_packet_download_capability'::regclass;

  IF stats_owner <> stats_info_owner THEN
    RAISE EXCEPTION 'OT Supabase statistics views have different owners';
  END IF;
  IF stats_owner <> current_user AND NOT pg_has_role(current_user, stats_owner, 'SET') THEN
    RAISE EXCEPTION 'OT Supabase migration role cannot SET statistics-view owner %', stats_owner;
  END IF;
  IF rls_owner <> current_user AND NOT pg_has_role(current_user, rls_owner, 'SET') THEN
    RAISE EXCEPTION 'OT Supabase migration role cannot SET rls_auto_enable owner %', rls_owner;
  END IF;
  IF capability_owner <> current_user AND NOT pg_has_role(current_user, capability_owner, 'SET') THEN
    RAISE EXCEPTION 'OT Supabase migration role cannot SET capability-table owner %', capability_owner;
  END IF;

  IF stats_owner <> current_user THEN
    EXECUTE format('SET LOCAL ROLE %I', stats_owner);
  END IF;
  EXECUTE 'REVOKE SELECT ON TABLE extensions.pg_stat_statements, extensions.pg_stat_statements_info FROM PUBLIC';
  RESET ROLE;

  IF rls_owner <> current_user THEN
    EXECUTE format('SET LOCAL ROLE %I', rls_owner);
  END IF;
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC';
  RESET ROLE;

  IF capability_owner <> current_user THEN
    EXECUTE format('SET LOCAL ROLE %I', capability_owner);
  END IF;
  EXECUTE 'ALTER TABLE public.ot_packet_download_capability FORCE ROW LEVEL SECURITY';
  RESET ROLE;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    WHERE n.nspname = 'extensions'
      AND c.relname IN ('pg_stat_statements', 'pg_stat_statements_info')
      AND acl.grantee = 0
      AND acl.privilege_type = 'SELECT'
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE n.nspname = 'public'
      AND p.proname = 'rls_auto_enable'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) OR NOT (
    SELECT c.relrowsecurity AND c.relforcerowsecurity
    FROM pg_class c
    WHERE c.oid = 'public.ot_packet_download_capability'::regclass
  ) THEN
    RAISE EXCEPTION 'OT Supabase PUBLIC-ACL hardening verification failed';
  END IF;
END $$;
