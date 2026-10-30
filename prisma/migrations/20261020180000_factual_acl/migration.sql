-- Additive, factual tables only. Existing paid tables, roles and checkout are unchanged.
-- Deployment prerequisite: the server connection must use (or be explicitly
-- granted) ot_factual_app. Never grant this role to API/browser roles.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ot_factual_app') THEN
    CREATE ROLE ot_factual_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_factual_app'
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'UNSAFE_FACTUAL_APP_ROLE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN
      ('public.ot_factual_result'::regclass, 'public.ot_factual_latest'::regclass, 'public.ot_factual_disclosure'::regclass)
      AND pg_has_role('ot_factual_app', relowner, 'MEMBER')) THEN
    RAISE EXCEPTION 'UNSAFE_FACTUAL_APP_OWNERSHIP';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'UNSAFE_FACTUAL_API_ROLE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated')
      AND pg_has_role(oid, 'ot_factual_app', 'MEMBER')) THEN
    RAISE EXCEPTION 'UNSAFE_FACTUAL_API_MEMBERSHIP';
  END IF;
END $$;

-- Remove ALL pre-existing/default/inherited ACL routes on these exact tables,
-- not merely direct anon grants. Do not change global default privileges.
DO $$
DECLARE t text; g record;
BEGIN
  FOREACH t IN ARRAY ARRAY['ot_factual_result','ot_factual_latest','ot_factual_disclosure'] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', t);
    FOR g IN
      SELECT DISTINCT roles.rolname
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      JOIN pg_roles roles ON roles.oid=a.grantee
      WHERE c.oid=format('public.%I',t)::regclass AND a.grantee<>c.relowner
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I CASCADE',t,g.rolname);
    END LOOP;
    -- Table REVOKE does not remove separately granted column privileges.
    FOR g IN
      SELECT DISTINCT a.attname, acl.grantee, roles.rolname
      FROM pg_attribute a
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
      LEFT JOIN pg_roles roles ON roles.oid=acl.grantee
      JOIN pg_class c ON c.oid=a.attrelid
      WHERE a.attrelid=format('public.%I',t)::regclass AND acl.grantee<>c.relowner
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE public.%I FROM %s CASCADE',
        g.attname,t,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(g.rolname) END);
    END LOOP;
    FOR g IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',t,g.rolname);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    -- Restrictive boundary remains load-bearing if a future grant/permissive
    -- policy is introduced. Table owners and superusers are deployment admins,
    -- not supported application or public identities.
    EXECUTE format('CREATE POLICY factual_app_boundary ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (current_user = ''ot_factual_app'') WITH CHECK (current_user = ''ot_factual_app'')',t);
    EXECUTE format('CREATE POLICY factual_app_access ON public.%I FOR ALL TO ot_factual_app USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO ot_factual_app;
GRANT SELECT, INSERT ON public.ot_factual_result TO ot_factual_app;
GRANT SELECT, INSERT ON public.ot_factual_latest TO ot_factual_app;
GRANT UPDATE (version, result_id) ON public.ot_factual_latest TO ot_factual_app;
GRANT SELECT, INSERT ON public.ot_factual_disclosure TO ot_factual_app;
GRANT UPDATE (consumed_at) ON public.ot_factual_disclosure TO ot_factual_app;
REVOKE ALL ON FUNCTION public.ot_factual_immutable() FROM PUBLIC;
COMMIT;
