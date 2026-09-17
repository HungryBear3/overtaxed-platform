-- Forward-only reconciliation for the Preview incident where migration
-- 20260915190000 created objects but its ledger write was not observed. Never
-- edit or synthesize the earlier ledger row here: require its durable object
-- fingerprint, and repair only the narrow owner-role topology needed by the
-- following hardening migration.
DO $$
DECLARE
  required_relation TEXT;
  catalog_hash TEXT;
  required_relations TEXT[] := ARRAY[
    'ot_neutral_customer_zip_attempt',
    'ot_neutral_qa_review',
    'ot_neutral_refund_work'
  ];
BEGIN
  FOREACH required_relation IN ARRAY required_relations LOOP
    IF to_regclass(format('public.%I', required_relation)) IS NULL THEN
      RAISE EXCEPTION 'migration 33 reconciliation refused: missing relation %', required_relation;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = ANY(ARRAY[
      'public.ot_neutral_customer_zip_attempt'::regclass,
      'public.ot_neutral_qa_review'::regclass,
      'public.ot_neutral_refund_work'::regclass
    ])
      AND (relkind <> 'r' OR NOT relrowsecurity OR NOT relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: relation kind or RLS mismatch';
  END IF;

  -- Exact column count plus security-critical type/null/default checks prevents
  -- a same-name partial table from satisfying the incident fingerprint.
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.ot_neutral_customer_zip_attempt'::regclass AND attnum>0 AND NOT attisdropped) <> 9
    OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.ot_neutral_qa_review'::regclass AND attnum>0 AND NOT attisdropped) <> 19
    OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.ot_neutral_refund_work'::regclass AND attnum>0 AND NOT attisdropped) <> 21
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_customer_zip_attempt' AND column_name='status' AND data_type='text' AND is_nullable='NO' AND column_default LIKE '%INTENDED%')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_customer_zip_attempt' AND column_name='byte_size' AND data_type='integer' AND is_nullable='NO')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_qa_review' AND column_name='status' AND udt_name='OTNeutralQaStatus' AND is_nullable='NO' AND column_default LIKE '%PENDING%')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_qa_review' AND column_name='payment_binding_sha256' AND data_type='text' AND is_nullable='NO')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_refund_work' AND column_name='status' AND udt_name='OTNeutralRefundStatus' AND is_nullable='NO' AND column_default LIKE '%REFUND_REQUIRED%')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_refund_work' AND column_name='provider_receipt_sha256' AND data_type='text' AND is_nullable='YES')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_refund_work' AND column_name='provider_lookup_attempts' AND data_type='integer' AND is_nullable='NO' AND column_default='0')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_refund_work' AND column_name='last_provider_lookup_at' AND data_type='timestamp with time zone' AND is_nullable='YES')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ot_neutral_refund_work' AND column_name='last_provider_lookup_result' AND data_type='text' AND is_nullable='YES')
  THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: column fingerprint mismatch';
  END IF;

  IF EXISTS (
    SELECT expected.name FROM (VALUES
      ('ot_neutral_customer_zip_attempt_pkey'),
      ('ot_neutral_customer_zip_attempt_reservation_fkey'),
      ('ot_neutral_customer_zip_attempt_identity'),
      ('ot_neutral_customer_zip_attempt_status'),
      ('ot_neutral_qa_review_pkey'),
      ('ot_neutral_qa_review_reservation_fkey'),
      ('ot_neutral_qa_review_order_fkey'),
      ('ot_neutral_qa_review_fulfillment_fkey'),
      ('ot_neutral_qa_review_minutes'),
      ('ot_neutral_qa_review_digests'),
      ('ot_neutral_qa_review_decision_complete'),
      ('ot_neutral_qa_review_approval_minutes'),
      ('ot_neutral_qa_review_reason_semantics'),
      ('ot_neutral_refund_work_pkey'),
      ('ot_neutral_refund_work_qa_review_id_fkey'),
      ('ot_neutral_refund_work_order_id_fkey'),
      ('ot_neutral_refund_work_state'),
      ('ot_neutral_refund_lookup_audit_shape')
    ) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname=expected.name)
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: constraint fingerprint mismatch';
  END IF;

  IF EXISTS (
    SELECT expected.name FROM (VALUES
      ('ot_neutral_customer_zip_attempt_status_created_idx'),
      ('ot_neutral_qa_review_reviewer_week_status_idx'),
      ('ot_neutral_qa_review_status_updated_idx'),
      ('ot_neutral_refund_work_status_created_idx'),
      ('ot_neutral_report_reservation_customer_zip_sha256_key'),
      ('ot_neutral_report_reservation_customer_zip_locator_key')
    ) AS expected(name)
    WHERE to_regclass('public.'||expected.name) IS NULL
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: index fingerprint mismatch';
  END IF;

  IF EXISTS (
    SELECT * FROM (VALUES
      ('ot_neutral_customer_zip_attempt','ot_neutral_customer_zip_attempt_runtime','ALL','ot_neutral_runtime'),
      ('ot_neutral_qa_review','ot_neutral_qa_review_runtime','ALL','ot_neutral_runtime'),
      ('ot_neutral_report_reservation','ot_neutral_report_reservation_app_read','SELECT','ot_neutral_app_reader'),
      ('ot_neutral_qa_review','ot_neutral_qa_review_app_read','SELECT','ot_neutral_app_reader'),
      ('ot_neutral_refund_work','ot_neutral_refund_work_runtime','ALL','ot_neutral_runtime'),
      ('ot_neutral_qa_review','ot_neutral_reversal_guard_qa','UPDATE','ot_neutral_reversal_guard_owner'),
      ('ot_neutral_qa_review','ot_neutral_reversal_guard_qa_read','SELECT','ot_neutral_reversal_guard_owner'),
      ('ot_payment_binding','ot_neutral_reversal_guard_payment_read','SELECT','ot_neutral_reversal_guard_owner'),
      ('ot_settlement_reversal','ot_neutral_reversal_guard_reversal_read','SELECT','ot_neutral_reversal_guard_owner'),
      ('ot_packet_download_capability','ot_neutral_reversal_guard_capability_read','SELECT','ot_neutral_reversal_guard_owner'),
      ('ot_packet_download_capability','ot_neutral_reversal_guard_capability_update','UPDATE','ot_neutral_reversal_guard_owner')
    ) expected(tablename, policyname, cmd, role_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname='public' AND p.tablename=expected.tablename
        AND p.policyname=expected.policyname AND p.cmd=expected.cmd
        AND expected.role_name=ANY(p.roles)
        AND p.qual IS NOT NULL
        AND (p.cmd NOT IN ('ALL','UPDATE') OR p.with_check IS NOT NULL)
    )
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: policy fingerprint mismatch';
  END IF;
  IF to_regprocedure('public.ot_neutral_hold_on_settlement_reversal()') IS NULL THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: missing reversal guard function';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='public.ot_neutral_hold_on_settlement_reversal()'::regprocedure
      AND r.rolname='ot_neutral_reversal_guard_owner'
      AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, public']
      AND p.prosrc=$function$
BEGIN
 UPDATE public.ot_neutral_qa_review q
 SET status='HELD',minutes_spent=COALESCE(q.minutes_spent,1),reason_code='PAYMENT_REVERSED',decided_at=clock_timestamp(),updated_at=clock_timestamp()
 FROM public.ot_payment_binding b
 WHERE b.payment_intent=NEW.payment_intent AND b.order_id=q.order_id
   AND q.status IN ('PENDING','IN_REVIEW','APPROVED');
 UPDATE public.ot_packet_download_capability c
 SET revoked_at=clock_timestamp(),revoked_reason_code='REFUNDED'
 FROM public.ot_fulfillment f, public.ot_payment_binding b
 WHERE b.payment_intent=NEW.payment_intent AND f.order_id=b.order_id
   AND f.kind='NEUTRAL_RECORDS_REPORT' AND c.fulfillment_id=f.id AND c.revoked_at IS NULL;
 RETURN NEW;
END $function$
      AND NOT has_function_privilege('public','public.ot_neutral_hold_on_settlement_reversal()','EXECUTE')
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: reversal function fingerprint mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'ot_neutral_hold_on_reversal'
      AND tgrelid = 'public.ot_settlement_reversal'::regclass
      AND NOT tgisinternal
      AND tgenabled='O'
      AND tgtype=5
      AND tgfoid='public.ot_neutral_hold_on_settlement_reversal()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: missing reversal guard trigger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ot_neutral_reversal_guard_owner') THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: missing reversal guard owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname='ot_neutral_app_reader'
      AND NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
      AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication
      AND NOT r.rolbypassrls
      AND has_schema_privilege(r.rolname,'public','USAGE')
      AND NOT has_schema_privilege(r.rolname,'public','CREATE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname='ot_preview_app'
      AND r.rolcanlogin AND r.rolinherit AND NOT r.rolsuper
      AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication
      AND NOT r.rolbypassrls
      AND has_schema_privilege(r.rolname,'public','USAGE')
      AND NOT has_schema_privilege(r.rolname,'public','CREATE')
  ) OR (SELECT count(*) FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE r.rolname='ot_neutral_app_reader' AND member_role.rolname='ot_preview_app'
      AND grantor_role.rolname='postgres' AND NOT m.admin_option
      AND m.inherit_option AND m.set_option) <> 1
  OR (SELECT count(*) FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE r.rolname='ot_neutral_app_reader' AND member_role.rolname='postgres'
      AND grantor_role.rolname='supabase_admin' AND m.admin_option
      AND NOT m.inherit_option AND NOT m.set_option) > 1
  OR (SELECT count(*) FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE r.rolname='ot_preview_app' AND member_role.rolname='postgres'
      AND grantor_role.rolname='supabase_admin' AND m.admin_option
      AND NOT m.inherit_option AND NOT m.set_option) > 1
  OR EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE (r.rolname IN ('ot_neutral_app_reader','ot_preview_app')
        OR member_role.rolname IN ('ot_neutral_app_reader','ot_preview_app'))
      AND NOT (
        (r.rolname='ot_neutral_app_reader' AND member_role.rolname='ot_preview_app'
          AND grantor_role.rolname='postgres' AND NOT m.admin_option AND m.inherit_option AND m.set_option)
        OR (r.rolname='ot_neutral_app_reader' AND member_role.rolname='postgres'
          AND grantor_role.rolname='supabase_admin' AND m.admin_option
          AND NOT m.inherit_option AND NOT m.set_option)
        OR (r.rolname='ot_preview_app' AND member_role.rolname='postgres'
          AND grantor_role.rolname='supabase_admin' AND m.admin_option
          AND NOT m.inherit_option AND NOT m.set_option)
      )
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: app reader role fingerprint mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname='ot_neutral_reversal_guard_owner'
      AND NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
      AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication
      AND NOT r.rolbypassrls
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.roleid
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE (r.rolname='ot_neutral_reversal_guard_owner' OR member_role.rolname='ot_neutral_reversal_guard_owner')
      AND NOT (r.rolname='ot_neutral_reversal_guard_owner' AND member_role.rolname='postgres'
        AND grantor_role.rolname='supabase_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option)
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: owner role fingerprint mismatch';
  END IF;
  IF NOT has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','status','SELECT')
    OR NOT has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','status','UPDATE')
    OR NOT has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_payment_binding','payment_intent','SELECT')
    OR NOT has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_settlement_reversal','payment_intent','SELECT')
    OR NOT has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_packet_download_capability','revoked_at','UPDATE')
  THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: grant fingerprint mismatch';
  END IF;

  -- Supabase applies broad default table privileges to API roles. They are
  -- never part of the neutral QA/refund authority model, so remove them from
  -- the three incident-created relations before evaluating their final ACLs.
  -- Role existence is host-specific; native PostgreSQL fixtures need not
  -- create Supabase API roles.
  FOR required_relation IN SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon','authenticated','service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.ot_neutral_customer_zip_attempt, public.ot_neutral_qa_review, public.ot_neutral_refund_work FROM %I',
      required_relation
    );
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'),('authenticated'),('service_role')) api(role_name)
    CROSS JOIN (VALUES
      ('ot_neutral_customer_zip_attempt'),
      ('ot_neutral_qa_review'),
      ('ot_neutral_refund_work')
    ) scoped(table_name)
    WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api.role_name)
      AND (
        has_table_privilege(api.role_name,format('public.%I',scoped.table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(api.role_name,format('public.%I',scoped.table_name),'SELECT,INSERT,UPDATE,REFERENCES')
      )
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: Supabase API role retains effective QA/refund privileges';
  END IF;

  -- One normalized catalog digest binds names to definitions and rejects both
  -- missing and excess state. Host-owned membership edges are checked above;
  -- ACL grantors are deliberately omitted because Supabase and native
  -- PostgreSQL use different owner/grantor identities. API-role ACLs have
  -- already been revoked, leaving the same least-privilege grantee surface on
  -- both hosts.
  SELECT md5(jsonb_build_object(
    'relation_owners', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.relation_name) FROM (
      SELECT c.relname relation_name,r.rolname owner,c.relkind
      FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
      WHERE c.relnamespace='public'::regnamespace AND c.relname IN (
        'ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work',
        'ot_neutral_report_reservation','ot_payment_binding','ot_fulfillment',
        'ot_fulfillment_artifact','ot_settlement_reversal','ot_packet_download_capability')
    ) x),
    'type_owners', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.type_name) FROM (
      SELECT t.typname type_name,r.rolname owner
      FROM pg_type t JOIN pg_roles r ON r.oid=t.typowner
      WHERE t.typnamespace='public'::regnamespace
        AND t.typname IN ('OTNeutralQaStatus','OTNeutralRefundStatus','OTFulfillmentKind')
    ) x),
    'sequences', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sequence_name) FROM (
      SELECT c.relname sequence_name,r.rolname owner
      FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
      WHERE c.relnamespace='public'::regnamespace AND c.relkind='S'
        AND c.relname LIKE 'ot_neutral_%'
    ) x),
    'columns', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.ordinal_position) FROM (
      SELECT table_name,ordinal_position,column_name,data_type,udt_name,is_nullable,column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND (
        table_name IN ('ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work')
        OR (table_name='ot_neutral_report_reservation' AND column_name IN (
          'customer_zip_sha256','customer_zip_byte_size','customer_zip_locator','customer_zip_media_type','customer_zip_filename')))
    ) x),
    'constraints', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.name) FROM (
      SELECT c.conrelid::regclass::text table_name,c.conname name,c.contype,
        pg_get_constraintdef(c.oid,true) definition
      FROM pg_constraint c
      WHERE c.connamespace='public'::regnamespace AND (
        c.conrelid IN ('public.ot_neutral_customer_zip_attempt'::regclass,'public.ot_neutral_qa_review'::regclass,'public.ot_neutral_refund_work'::regclass)
        OR c.conname='ot_neutral_customer_zip_complete')
    ) x),
    'indexes', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (
      SELECT indexrelid::regclass::text name,indrelid::regclass::text table_name,
        indisunique,pg_get_indexdef(indexrelid,0,true) definition,
        pg_get_expr(indpred,indrelid,true) predicate
      FROM pg_index WHERE indexrelid::regclass::text IN (
        'ot_neutral_report_reservation_customer_zip_sha256_key',
        'ot_neutral_report_reservation_customer_zip_locator_key',
        'ot_neutral_customer_zip_attempt_status_created_idx',
        'ot_neutral_qa_review_reviewer_week_status_idx',
        'ot_neutral_qa_review_status_updated_idx',
        'ot_neutral_refund_work_status_created_idx')
    ) x),
    'policies', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tablename,x.policyname) FROM (
      SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
      FROM pg_policies WHERE schemaname='public' AND tablename IN (
        'ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work',
        'ot_neutral_report_reservation','ot_payment_binding','ot_settlement_reversal',
        'ot_packet_download_capability')
    ) x),
    'enums', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.type_name,x.sort_order) FROM (
      SELECT t.typname type_name,e.enumsortorder sort_order,e.enumlabel label
      FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
      WHERE t.typname IN ('OTNeutralQaStatus','OTNeutralRefundStatus')
    ) x),
    'fulfillment_kind_value', EXISTS (
      SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
      WHERE t.typname='OTFulfillmentKind' AND e.enumlabel='NEUTRAL_RECORDS_REPORT'
    ),
    'app_reader', (SELECT to_jsonb(x) FROM (
      SELECT rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
        has_schema_privilege('ot_neutral_app_reader','public','USAGE') schema_usage,
        has_schema_privilege('ot_neutral_app_reader','public','CREATE') schema_create
      FROM pg_roles r WHERE rolname='ot_neutral_app_reader'
    ) x),
    'table_acl', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.grantee,x.privilege_type) FROM (
      SELECT c.relname table_name,
        CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END grantee,
        acl.privilege_type,acl.is_grantable
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee
      JOIN pg_roles grantor_role ON grantor_role.oid=acl.grantor
      WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')
        AND c.relname IN ('ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work')
        AND acl.grantee<>c.relowner
    ) x),
    'column_acl', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.column_name,x.grantee,x.privilege_type) FROM (
      SELECT c.relname table_name,a.attname column_name,
        CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END grantee,
        acl.privilege_type,acl.is_grantable
      FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
      LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee
      JOIN pg_roles grantor_role ON grantor_role.oid=acl.grantor
      WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped
        AND c.relname IN ('ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work')
        AND acl.grantee<>c.relowner
    ) x),
    'function', (SELECT to_jsonb(x) FROM (
      SELECT r.rolname owner,p.prosecdef,p.proconfig,p.prosrc,p.proacl,
        has_function_privilege('public','public.ot_neutral_hold_on_settlement_reversal()','EXECUTE') public_execute
      FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
      WHERE p.oid='public.ot_neutral_hold_on_settlement_reversal()'::regprocedure
    ) x),
    'public_access', jsonb_build_object(
      'zip', has_table_privilege('public','public.ot_neutral_customer_zip_attempt','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      'qa', has_table_privilege('public','public.ot_neutral_qa_review','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      'refund', has_table_privilege('public','public.ot_neutral_refund_work','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      'function_execute', has_function_privilege('public','public.ot_neutral_hold_on_settlement_reversal()','EXECUTE')
    ),
    'trigger', (SELECT to_jsonb(x) FROM (
      SELECT t.tgname,t.tgenabled,t.tgtype,t.tgrelid::regclass::text table_name,
        t.tgfoid::regprocedure::text function_name,pg_get_triggerdef(t.oid,true) definition
      FROM pg_trigger t WHERE t.tgname='ot_neutral_hold_on_reversal' AND NOT t.tgisinternal
    ) x)
  )::text) INTO catalog_hash;

  -- PostgreSQL 18 native and hosted Supabase render some pre-existing column
  -- ordinals and constraint/policy expressions differently. All portable
  -- structural, ACL, role, ownership, and effective-privilege checks above
  -- must pass first; then accept only these two independently captured exact
  -- final-state digests. No third/unpinned catalog rendering is accepted.
  IF catalog_hash NOT IN (
    '8782889552b478d71c5ab63e2bace721', -- native PostgreSQL 18 fixture
    '27b99eb0aada08c4a93990a35f2d0e1c'  -- hosted Supabase after scoped ACL revocation
  ) THEN
    RAISE EXCEPTION 'migration 33 reconciliation refused: exact catalog hash mismatch (%)', catalog_hash;
  END IF;
END $$;
