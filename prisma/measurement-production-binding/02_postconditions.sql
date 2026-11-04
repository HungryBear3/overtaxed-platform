-- Separately approved Production-only binding. Run as migration owner with psql -v ON_ERROR_STOP=1.
-- Never part of shared migrations; no runtime URL or identity cutover implied.
DO $$ DECLARE r pg_roles; t oid := 'public.ot_free_check_completion'::regclass; BEGIN
 SELECT * INTO r FROM pg_roles WHERE rolname='ot_prod_app';
 IF NOT FOUND OR NOT r.rolcanlogin OR NOT r.rolinherit OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls THEN RAISE EXCEPTION 'unsafe/missing production app'; END IF;
 IF EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o') THEN RAISE EXCEPTION 'app owns objects'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE member=r.oid)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid AND parent.rolname='ot_neutral_app_reader' AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option) OR pg_has_role(r.oid,'ot_neutral_app_reader','SET') THEN RAISE EXCEPTION 'membership mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=t AND relrowsecurity AND relowner<>r.oid) THEN RAISE EXCEPTION 'ledger ownership/RLS mismatch'; END IF;
END $$;
DO $$ DECLARE r text; priv text; col text; t oid := 'public.ot_free_check_completion'::regclass; BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','ot_neutral_app_reader') LOOP
 FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
 IF has_table_privilege(r,t,priv) THEN RAISE EXCEPTION 'unexpected effective table grant % %',r,priv; END IF;
 IF priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(r,t,priv) THEN RAISE EXCEPTION 'unexpected effective column grant % %',r,priv; END IF;
 END LOOP; END LOOP;
 FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
 IF has_table_privilege('ot_prod_app',t,priv) THEN RAISE EXCEPTION 'app table grant %',priv; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=t AND a.grantee=0) OR EXISTS(SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE c.attrelid=t AND a.grantee=0) THEN RAISE EXCEPTION 'PUBLIC ledger ACL'; END IF;
 FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=t AND attnum>0 AND NOT attisdropped LOOP
 FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
 IF has_column_privilege('ot_prod_app',t,col,priv) <> (priv='SELECT' OR (priv='INSERT' AND col<>'completed_at')) OR has_column_privilege('ot_prod_app',t,col,priv||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'app column ACL mismatch % %',col,priv; END IF;
 END LOOP; END LOOP;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid=t)<>2 OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=t AND polname='ot_measurement_prod_insert' AND polcmd='a' AND polpermissive AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='ot_prod_app')] AND polqual IS NULL AND pg_get_expr(polwithcheck,polrelid)='true') OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=t AND polname='ot_measurement_prod_select' AND polcmd='r' AND polpermissive AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='ot_prod_app')] AND pg_get_expr(polqual,polrelid)='true' AND polwithcheck IS NULL) THEN RAISE EXCEPTION 'policy mismatch'; END IF;
END $$;
