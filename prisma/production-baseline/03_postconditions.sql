-- OT neutral-report PRODUCTION BASELINE — postconditions.
--
-- Runs inside the SAME transaction as the body, before COMMIT. Every check that
-- fails appends to one list and the whole list is raised at the end, so an
-- operator gets the complete picture from a single rolled-back attempt instead
-- of discovering defects one re-run at a time.
--
-- Diagnostics are non-secret by construction: catalog names, privilege names and
-- role names only. No connection string, no password, no application value.
--
-- This file is ALSO run by itself on an idempotent replay, where the body was
-- skipped because the preflight classified the database COMPLETE. That is what
-- makes "already applied" a verified no-op rather than an assumed one, and it is
-- why nothing here asserts row counts: emptiness is a property of a fresh apply
-- and is proved at the end of 02_baseline.sql, not of a database that has since
-- been used.

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  owner_role TEXT := current_user;
  item RECORD;
  api_role TEXT;
  role_name TEXT;
  rel_name TEXT;
  policy_key TEXT;
  extra_binding TEXT;
  edge_total INTEGER;
  edge_exact INTEGER;

  forced_rls TEXT[] := ARRAY[
    'ot_neutral_report_reservation','ot_neutral_blob_attempt','ot_neutral_checkout_attempt',
    'ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work',
    'ot_packet_download_capability'
  ];
  enabled_rls TEXT[] := ARRAY[
    'ot_payment_binding','ot_settlement_reversal','ot_order_attribution',
    'ot_artifact_orphan_quarantine','ot_delivery_provider_callback',
    'ot_commerce_deadline_capture','ot_delivery_attempt','ot_fulfillment',
    'ot_fulfillment_artifact'
  ];
  baseline_tables TEXT[] := ARRAY[
    'ot_payment_binding','ot_settlement_reversal','ot_order_attribution',
    'ot_packet_download_capability','ot_artifact_orphan_quarantine',
    'ot_delivery_provider_callback','ot_commerce_deadline_capture',
    'ot_neutral_report_reservation','ot_neutral_blob_attempt','ot_neutral_checkout_attempt',
    'ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work'
  ];
  baseline_views TEXT[] := ARRAY[
    'ot_neutral_delivery_order','ot_fulfillment_kind_authority',
    'ot_packet_capability_kind_authority','ot_neutral_runtime_order',
    'ot_neutral_runtime_payment_binding','ot_neutral_runtime_settlement_reversal'
  ];
  functional_roles TEXT[] := ARRAY[
    'ot_neutral_runtime','ot_neutral_app_reader','ot_neutral_delivery_runtime',
    'ot_neutral_reversal_guard_owner','ot_commerce_capture_owner'
  ];
  commerce_tables TEXT[] := ARRAY['ot_order','ot_payment_binding','ot_settlement_reversal'];
  policy_hosts TEXT[];
  expected_policies TEXT[];
  all_privileges CONSTANT TEXT := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
BEGIN
  policy_hosts := baseline_tables || ARRAY['ot_fulfillment','ot_fulfillment_artifact','ot_delivery_attempt'];
  -- `table|policy|cmd|role`. The owner policy is keyed on the connected
  -- migration role, because that role is the one the capture table reads through.
  expected_policies := ARRAY[
    'ot_commerce_deadline_capture|ot_commerce_deadline_capture_reader|SELECT|' || owner_role,
    'ot_neutral_report_reservation|ot_neutral_runtime_reservations|ALL|ot_neutral_runtime',
    'ot_neutral_blob_attempt|ot_neutral_runtime_attempts|ALL|ot_neutral_runtime',
    'ot_neutral_checkout_attempt|ot_neutral_runtime_checkout_attempts|ALL|ot_neutral_runtime',
    'ot_neutral_customer_zip_attempt|ot_neutral_customer_zip_attempt_runtime|ALL|ot_neutral_runtime',
    'ot_neutral_qa_review|ot_neutral_qa_review_runtime|ALL|ot_neutral_runtime',
    'ot_neutral_refund_work|ot_neutral_refund_work_runtime|ALL|ot_neutral_runtime',
    'ot_neutral_report_reservation|ot_neutral_report_reservation_app_read|SELECT|ot_neutral_app_reader',
    'ot_neutral_qa_review|ot_neutral_qa_review_app_read|SELECT|ot_neutral_app_reader',
    'ot_neutral_qa_review|ot_neutral_reversal_guard_qa|UPDATE|ot_neutral_reversal_guard_owner',
    'ot_neutral_qa_review|ot_neutral_reversal_guard_qa_read|SELECT|ot_neutral_reversal_guard_owner',
    'ot_payment_binding|ot_neutral_reversal_guard_payment_read|SELECT|ot_neutral_reversal_guard_owner',
    'ot_settlement_reversal|ot_neutral_reversal_guard_reversal_read|SELECT|ot_neutral_reversal_guard_owner',
    'ot_packet_download_capability|ot_neutral_reversal_guard_capability_read|SELECT|ot_neutral_reversal_guard_owner',
    'ot_packet_download_capability|ot_neutral_reversal_guard_capability_update|UPDATE|ot_neutral_reversal_guard_owner',
    'ot_fulfillment|ot_neutral_runtime_fulfillment_all|ALL|ot_neutral_runtime',
    'ot_fulfillment_artifact|ot_neutral_runtime_artifact_all|ALL|ot_neutral_runtime',
    'ot_fulfillment|ot_neutral_reversal_guard_fulfillment_read|SELECT|ot_neutral_reversal_guard_owner',
    'ot_fulfillment|ot_neutral_delivery_fulfillment_read|SELECT|ot_neutral_delivery_runtime',
    'ot_fulfillment_artifact|ot_neutral_delivery_artifact_read|SELECT|ot_neutral_delivery_runtime',
    'ot_delivery_attempt|ot_neutral_delivery_attempt_read|SELECT|ot_neutral_delivery_runtime',
    'ot_delivery_attempt|ot_neutral_delivery_attempt_update|UPDATE|ot_neutral_delivery_runtime',
    'ot_packet_download_capability|ot_neutral_delivery_capability_all|ALL|ot_neutral_delivery_runtime',
    'ot_neutral_report_reservation|ot_neutral_delivery_reservation_read|SELECT|ot_neutral_delivery_runtime',
    'ot_neutral_qa_review|ot_neutral_delivery_qa_read|SELECT|ot_neutral_delivery_runtime'
  ];

  -- -------------------------------------------------------------------------
  -- 1. Relations, kinds and owners.
  -- -------------------------------------------------------------------------
  FOR item IN
    SELECT * FROM (VALUES
      ('ot_payment_binding','r'),('ot_settlement_reversal','r'),('ot_order_attribution','r'),
      ('ot_packet_download_capability','r'),('ot_artifact_orphan_quarantine','r'),
      ('ot_delivery_provider_callback','r'),('ot_commerce_deadline_capture','r'),
      ('ot_neutral_report_reservation','r'),('ot_neutral_blob_attempt','r'),
      ('ot_neutral_checkout_attempt','r'),('ot_neutral_customer_zip_attempt','r'),
      ('ot_neutral_qa_review','r'),('ot_neutral_refund_work','r'),
      ('ot_neutral_delivery_order','v'),('ot_fulfillment_kind_authority','v'),
      ('ot_packet_capability_kind_authority','v'),('ot_neutral_runtime_order','v'),
      ('ot_neutral_runtime_payment_binding','v'),('ot_neutral_runtime_settlement_reversal','v')
    ) AS t(name, kind)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = to_regclass('public.' || quote_ident(item.name))
        AND c.relkind = item.kind::"char"
    ) THEN
      failures := failures || format('relation %s is missing or has the wrong kind', item.name);
    END IF;
  END LOOP;

  IF to_regclass('public.ot_commerce_deadline_capture') IS NULL
    OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.ot_commerce_deadline_capture'::regclass)) <> 'ot_commerce_capture_owner'
  THEN
    failures := failures || 'ot_commerce_deadline_capture is not owned by ot_commerce_capture_owner';
  END IF;

  FOREACH rel_name IN ARRAY baseline_tables || baseline_views LOOP
    IF rel_name <> 'ot_commerce_deadline_capture'
      AND to_regclass('public.' || quote_ident(rel_name)) IS NOT NULL
      AND pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = to_regclass('public.' || quote_ident(rel_name)))) <> owner_role
    THEN
      failures := failures || format('relation %s is not owned by the migration role', rel_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 1b. `security_barrier` on all six views.
  --
  -- Every restricted read of commerce data goes through these. Without the
  -- barrier PostgreSQL is free to push a caller-supplied qualifier BELOW the
  -- view's own WHERE clause, and a cheap leakproof-looking operator or a
  -- user-defined function in that qualifier then sees rows the view exists to
  -- keep it away from. The views would still be present, still be readable by
  -- exactly the intended role, and still pass every other check in this file —
  -- which is why "the view exists" was never the proof, and why the option is
  -- asserted on each of the six by name.
  --
  -- `ALTER VIEW ... SET (security_barrier = false)` is one statement and leaves
  -- no other trace, so this is the check that notices.
  -- -------------------------------------------------------------------------
  FOREACH rel_name IN ARRAY baseline_views LOOP
    IF to_regclass('public.' || quote_ident(rel_name)) IS NULL THEN
      CONTINUE;  -- already reported as missing above
    END IF;
    -- Read through `pg_options_to_table` and compared on VALUE, not on the
    -- literal array element. PostgreSQL stores a boolean reloption as whatever
    -- spelling was written — `true`, `on`, `yes`, `1` are all accepted and all
    -- stored verbatim — so matching the array against the one string this file
    -- happens to emit would be a predicate that stops meaning what it says the
    -- moment somebody re-sets the option a different way.
    IF coalesce((
      SELECT lower(o.option_value)
      FROM pg_class c
      CROSS JOIN LATERAL pg_options_to_table(c.reloptions) o
      WHERE c.oid = to_regclass('public.' || quote_ident(rel_name))
        AND o.option_name = 'security_barrier'
      LIMIT 1
    ), 'absent') NOT IN ('true', 'on', 'yes', '1') THEN
      failures := failures || format('view %s is not security_barrier=true', rel_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 2. RLS and FORCE.
  -- -------------------------------------------------------------------------
  FOREACH rel_name IN ARRAY forced_rls LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE oid = to_regclass('public.' || quote_ident(rel_name))
        AND relrowsecurity AND relforcerowsecurity
    ) THEN
      failures := failures || format('relation %s is not ENABLE + FORCE row level security', rel_name);
    END IF;
  END LOOP;
  FOREACH rel_name IN ARRAY enabled_rls LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE oid = to_regclass('public.' || quote_ident(rel_name)) AND relrowsecurity
    ) THEN
      failures := failures || format('relation %s does not have row level security enabled', rel_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 3. Types, the new enum label, and the new column on a pre-existing table.
  -- -------------------------------------------------------------------------
  FOREACH rel_name IN ARRAY ARRAY[
    'OTNeutralReservationStatus','OTNeutralBlobAttemptStatus','OTNeutralQaStatus','OTNeutralRefundStatus'
  ] LOOP
    IF to_regtype('public.' || quote_ident(rel_name)) IS NULL THEN
      failures := failures || format('enum type %s is missing', rel_name);
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'OTFulfillmentKind' AND e.enumlabel = 'NEUTRAL_RECORDS_REPORT'
  ) THEN
    failures := failures || 'OTFulfillmentKind is missing the NEUTRAL_RECORDS_REPORT label';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.ot_delivery_attempt'::regclass
      AND attname = 'download_capability_id' AND attnum > 0 AND NOT attisdropped
  ) THEN
    failures := failures || 'ot_delivery_attempt.download_capability_id is missing';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. Named constraints.
  -- -------------------------------------------------------------------------
  FOREACH rel_name IN ARRAY ARRAY[
    'ot_order_attribution_pkey','ot_order_attribution_order_id_fkey',
    'ot_order_attribution_code_shape','ot_order_attribution_state_agrees_with_codes',
    'ot_order_attribution_creative_requires_campaign',
    'ot_packet_download_capability_pkey','ot_packet_download_capability_hash_shape',
    'ot_packet_download_capability_uses_bounded','ot_packet_download_capability_use_count_bounded',
    'ot_packet_download_capability_expiry_after_issue',
    'ot_packet_download_capability_revocation_complete',
    'ot_packet_download_capability_fulfillment_id_fkey','ot_packet_download_capability_artifact_fkey',
    'ot_artifact_orphan_quarantine_pkey','ot_artifact_orphan_quarantine_locator_private',
    'ot_delivery_attempt_download_capability_id_fkey',
    'ot_delivery_provider_callback_pkey','ot_delivery_provider_callback_applied_is_bound',
    'ot_fulfillment_admin_event_enter_manual_review_shape',
    'ot_fulfillment_admin_event_resolve_unresolved_send_shape',
    'ot_fulfillment_admin_event_action_closed',
    'ot_commerce_deadline_capture_identity_key',
    'ot_neutral_order_fkey','ot_neutral_digest_shape','ot_neutral_capacity_shape',
    'ot_neutral_time_shape','ot_neutral_state_shape','ot_neutral_customer_zip_complete',
    'ot_neutral_blob_reservation_fkey','ot_neutral_blob_digest_shape',
    'ot_neutral_checkout_attempt_reservation_fkey','ot_neutral_checkout_attempt_hash',
    'ot_neutral_customer_zip_attempt_reservation_fkey','ot_neutral_customer_zip_attempt_identity',
    'ot_neutral_customer_zip_attempt_status',
    'ot_neutral_qa_review_reservation_fkey','ot_neutral_qa_review_order_fkey',
    'ot_neutral_qa_review_fulfillment_fkey','ot_neutral_qa_review_minutes',
    'ot_neutral_qa_review_digests','ot_neutral_qa_review_decision_complete',
    'ot_neutral_qa_review_approval_minutes','ot_neutral_qa_review_reason_semantics',
    'ot_neutral_refund_work_state','ot_neutral_refund_lookup_audit_shape'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = rel_name AND connamespace = 'public'::regnamespace
    ) THEN
      failures := failures || format('constraint %s is missing', rel_name);
    END IF;
  END LOOP;

  -- The pinned single-action constraints that 20260912180000 replaced must be
  -- gone, or the widened audit vocabulary is unusable.
  --
  -- THIS PREDICATE USED TO BE DEAD, WHICH IS WORSE THAN ABSENT
  --
  -- It anchored on `^CHECK \(\(action = ...\)\)$` — TWO pairs of parentheses —
  -- while asking `pg_get_constraintdef(oid, pretty := true)`, which renders the
  -- constraint with ONE: `CHECK (action = 'ENTER_MANUAL_REVIEW'::text)`. The two
  -- parenthesizations belong to the two different renderings, so the regex could
  -- never match any input this query produces. A database that still carried the
  -- superseded constraint passed the postconditions, and the receipt said the
  -- widening had been proved.
  --
  -- The rendering is now normalized before it is matched: whitespace is squeezed
  -- out, and both the pretty and non-pretty parenthesizations are accepted, as is
  -- the `(action)::text` spelling PostgreSQL emits when the column is not already
  -- `text`. `ot_fulfillment_admin_event."action"` is `TEXT` today, so only one of
  -- those four is live — but a predicate that silently stops matching when a
  -- rendering detail changes is exactly the defect being fixed, and pinning it to
  -- today's detail would reintroduce it.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.ot_fulfillment_admin_event'::regclass
      AND c.contype = 'c'
      AND regexp_replace(pg_get_constraintdef(c.oid, true), '\s', '', 'g')
          ~ '^CHECK\(\(*\(?action\)?(::text)?=''ENTER_MANUAL_REVIEW''::text\)*\)$'
  ) THEN
    failures := failures || 'the superseded single-action admin-event CHECK is still present';
  END IF;

  -- -------------------------------------------------------------------------
  -- 5. Named indexes.
  -- -------------------------------------------------------------------------
  FOREACH rel_name IN ARRAY ARRAY[
    'ot_order_attribution_campaign_code_idx',
    'ot_packet_download_capability_capability_hash_key',
    'ot_packet_download_capability_fulfillment_id_idx',
    'ot_packet_download_capability_expires_at_idx',
    'ot_artifact_orphan_quarantine_fulfillment_locator_digest_key',
    'ot_artifact_orphan_quarantine_artifact_sha256_idx',
    'ot_artifact_orphan_quarantine_last_observed_at_idx',
    'ot_delivery_attempt_download_capability_id_key',
    'ot_delivery_provider_callback_provider_event_key',
    'ot_delivery_provider_callback_message_id_idx',
    'ot_delivery_provider_callback_disposition_idx',
    'ot_delivery_provider_callback_fulfillment_id_idx',
    'ot_commerce_deadline_capture_latest_idx',
    'ot_neutral_order_key','ot_neutral_reservation_key','ot_neutral_cohort_position_key',
    'ot_neutral_paid_cohort_position_key','ot_neutral_reviewer_capacity_idx',
    'ot_neutral_status_updated_idx','ot_neutral_bundle_idx',
    'ot_neutral_blob_attempt_number_key','ot_neutral_blob_identity_key','ot_neutral_blob_status_idx',
    'ot_neutral_checkout_attempt_idempotency','ot_neutral_checkout_attempt_status',
    'ot_neutral_report_reservation_customer_zip_sha256_key',
    'ot_neutral_report_reservation_customer_zip_locator_key',
    'ot_neutral_customer_zip_attempt_status_created_idx',
    'ot_neutral_qa_review_reviewer_week_status_idx','ot_neutral_qa_review_status_updated_idx',
    'ot_neutral_refund_work_status_created_idx'
  ] LOOP
    IF to_regclass('public.' || quote_ident(rel_name)) IS NULL THEN
      failures := failures || format('index %s is missing', rel_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 6. Functions, owners, SECURITY DEFINER posture, and PUBLIC execution.
  -- -------------------------------------------------------------------------
  FOR item IN
    SELECT * FROM (VALUES
      ('ot_preserve_settlement_hold()', NULL::TEXT, false),
      ('ot_settlement_evidence_immutable()', NULL, false),
      ('ot_order_attribution_reject_update()', NULL, false),
      ('ot_enforce_neutral_capability_single_use()', NULL, false),
      ('ot_commerce_deadline_capture_append_only()', 'ot_commerce_capture_owner', false),
      ('ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)', 'ot_commerce_capture_owner', true),
      ('ot_neutral_hold_on_settlement_reversal()', 'ot_neutral_reversal_guard_owner', true)
    ) AS t(signature, expected_owner, definer)
  LOOP
    IF to_regprocedure('public.' || item.signature) IS NULL THEN
      failures := failures || format('function %s is missing', item.signature);
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = to_regprocedure('public.' || item.signature)
          AND prosecdef = item.definer
          AND pg_get_userbyid(proowner) = coalesce(item.expected_owner, owner_role)
      ) THEN
        failures := failures || format('function %s has the wrong owner or SECURITY DEFINER flag', item.signature);
      END IF;
      -- A SECURITY DEFINER function executable by PUBLIC is the whole attack.
      IF item.definer AND has_function_privilege('public', to_regprocedure('public.' || item.signature), 'EXECUTE') THEN
        failures := failures || format('SECURITY DEFINER function %s is still executable by PUBLIC', item.signature);
      END IF;
      FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role)
          AND item.definer
          AND has_function_privilege(api_role, to_regprocedure('public.' || item.signature), 'EXECUTE')
        THEN
          failures := failures || format('SECURITY DEFINER function %s is executable by %s', item.signature, api_role);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 7. Triggers.
  -- -------------------------------------------------------------------------
  FOR item IN
    SELECT * FROM (VALUES
      ('ot_order','ot_preserve_settlement_hold'),
      ('ot_payment_binding','ot_payment_binding_immutable'),
      ('ot_settlement_reversal','ot_settlement_reversal_immutable'),
      ('ot_settlement_reversal','ot_neutral_hold_on_reversal'),
      ('ot_order_attribution','ot_order_attribution_no_update'),
      ('ot_commerce_deadline_capture','ot_commerce_deadline_capture_append_only'),
      ('ot_packet_download_capability','ot_neutral_capability_single_use')
    ) AS t(table_name, trigger_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = to_regclass('public.' || quote_ident(item.table_name))
        AND tgname = item.trigger_name AND NOT tgisinternal AND tgenabled = 'O'
    ) THEN
      failures := failures || format('trigger %s on %s is missing or disabled', item.trigger_name, item.table_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 8. Policies — exactly these, on exactly these relations.
  -- -------------------------------------------------------------------------
  FOREACH policy_key IN ARRAY expected_policies LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = split_part(policy_key, '|', 1)
        AND p.policyname = split_part(policy_key, '|', 2)
        AND p.cmd = split_part(policy_key, '|', 3)
        AND split_part(policy_key, '|', 4) = ANY(p.roles)
        AND p.permissive = 'PERMISSIVE'
        AND p.qual IS NOT NULL
        AND (p.cmd NOT IN ('ALL','UPDATE') OR p.with_check IS NOT NULL)
    ) THEN
      failures := failures || format('policy %s is missing or does not bind as expected', policy_key);
    END IF;
  END LOOP;

  FOR item IN
    SELECT p.tablename, p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = ANY(policy_hosts)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(expected_policies) AS e(key)
        WHERE split_part(e.key, '|', 1) = p.tablename
          AND split_part(e.key, '|', 2) = p.policyname
      )
  LOOP
    failures := failures || format('unexpected policy %s on %s', item.policyname, item.tablename);
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 9. Functional role attributes. None logs in, none inherits, none carries
  --    ambient authority, and none holds a direct CREATE on the public schema.
  -- -------------------------------------------------------------------------
  FOREACH role_name IN ARRAY functional_roles LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = role_name
        AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
        AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
    ) THEN
      failures := failures || format('functional role %s is missing or has unsafe attributes', role_name);
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
      JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public' AND r.rolname = role_name AND acl.privilege_type = 'CREATE'
    ) THEN
      failures := failures || format('functional role %s holds a direct CREATE grant on schema public', role_name);
    END IF;
    IF NOT has_schema_privilege(role_name, 'public', 'USAGE') THEN
      failures := failures || format('functional role %s cannot USAGE schema public', role_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 10. Positive grants the runtime identities actually need.
  -- -------------------------------------------------------------------------
  FOR item IN
    SELECT * FROM (VALUES
      ('ot_neutral_runtime','ot_neutral_report_reservation','SELECT'),
      ('ot_neutral_runtime','ot_neutral_report_reservation','INSERT'),
      ('ot_neutral_runtime','ot_neutral_report_reservation','UPDATE'),
      ('ot_neutral_runtime','ot_neutral_blob_attempt','SELECT'),
      ('ot_neutral_runtime','ot_neutral_checkout_attempt','INSERT'),
      ('ot_neutral_runtime','ot_neutral_qa_review','SELECT'),
      ('ot_neutral_runtime','ot_neutral_refund_work','SELECT'),
      ('ot_neutral_runtime','ot_neutral_runtime_order','SELECT'),
      ('ot_neutral_runtime','ot_neutral_runtime_payment_binding','SELECT'),
      ('ot_neutral_runtime','ot_neutral_runtime_settlement_reversal','SELECT'),
      ('ot_neutral_app_reader','ot_fulfillment_kind_authority','SELECT'),
      ('ot_neutral_app_reader','ot_packet_capability_kind_authority','SELECT'),
      ('ot_neutral_delivery_runtime','ot_neutral_delivery_order','SELECT')
    ) AS t(role_name, table_name, privilege)
  LOOP
    IF NOT has_table_privilege(item.role_name, format('public.%I', item.table_name), item.privilege) THEN
      failures := failures || format('%s is missing %s on %s', item.role_name, item.privilege, item.table_name);
    END IF;
  END LOOP;

  FOR item IN
    SELECT * FROM (VALUES
      ('ot_neutral_runtime','ot_neutral_customer_zip_attempt','zip_sha256','INSERT'),
      ('ot_neutral_runtime','ot_neutral_qa_review','status','UPDATE'),
      ('ot_neutral_runtime','ot_neutral_refund_work','provider_lookup_attempts','UPDATE'),
      ('ot_neutral_runtime','ot_fulfillment','kind','INSERT'),
      ('ot_neutral_runtime','ot_fulfillment_artifact','artifact_sha256','INSERT'),
      ('ot_neutral_app_reader','ot_neutral_report_reservation','bundle_sha256','SELECT'),
      ('ot_neutral_app_reader','ot_neutral_qa_review','fulfillment_id','SELECT'),
      ('ot_neutral_delivery_runtime','ot_packet_download_capability','capability_hash','INSERT'),
      ('ot_neutral_delivery_runtime','ot_delivery_attempt','download_capability_id','UPDATE'),
      ('ot_neutral_reversal_guard_owner','ot_neutral_qa_review','status','UPDATE'),
      ('ot_neutral_reversal_guard_owner','ot_packet_download_capability','revoked_at','UPDATE')
    ) AS t(role_name, table_name, column_name, privilege)
  LOOP
    IF NOT has_column_privilege(item.role_name, format('public.%I', item.table_name), item.column_name, item.privilege) THEN
      failures := failures || format('%s is missing %s on %s.%s', item.role_name, item.privilege, item.table_name, item.column_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 10b. The reversal guard's grant surface, EXACTLY, in both directions.
  --
  -- This role is excluded from the commerce-table sweep in section 11 below,
  -- and an exclusion has to be paid for with a pin or it is just a hole. Its
  -- six grants are therefore enumerated here: what it must hold, and — the part
  -- that was previously unstated anywhere — what it must NOT.
  --
  -- THE TABLE-WIDE SELECT IS REAL AND IT IS DELIBERATE
  --
  -- `GRANT SELECT, UPDATE (cols) ON ot_neutral_qa_review` binds the column list
  -- to UPDATE only. The SELECT is table-wide, so this role can read every
  -- column of ot_neutral_qa_review including its four digest columns and
  -- `reviewer_key`. That is byte-for-byte the grant migration 20260915190000
  -- issues and that Preview holds today, and the baseline's contract is to
  -- materialize that chain's end state rather than to improve on it, so it is
  -- kept — and asserted as the true statement it is rather than described as a
  -- narrow read it is not. The trigger body needs `order_id`, `status` and
  -- `minutes_spent`; those three are pinned separately so a future narrowing
  -- that broke the hold would fail here and not in Production.
  --
  -- The UPDATE is the half that must stay narrow, so a column OUTSIDE the five
  -- listed ones is checked for explicitly. `has_table_privilege(..., 'UPDATE')`
  -- must be false: a table-wide UPDATE would let the hold rewrite a digest.
  -- -------------------------------------------------------------------------
  FOR item IN
    SELECT * FROM (VALUES
      -- Must hold: the three columns the atomic hold actually reads.
      ('ot_neutral_qa_review','order_id','SELECT',true),
      ('ot_neutral_qa_review','status','SELECT',true),
      ('ot_neutral_qa_review','minutes_spent','SELECT',true),
      -- Must hold, and is the deliberate table-wide half.
      ('ot_neutral_qa_review','payment_binding_sha256','SELECT',true),
      ('ot_neutral_qa_review','reviewer_key','SELECT',true),
      -- The five UPDATE columns, and nothing outside them.
      ('ot_neutral_qa_review','status','UPDATE',true),
      ('ot_neutral_qa_review','minutes_spent','UPDATE',true),
      ('ot_neutral_qa_review','reason_code','UPDATE',true),
      ('ot_neutral_qa_review','decided_at','UPDATE',true),
      ('ot_neutral_qa_review','updated_at','UPDATE',true),
      ('ot_neutral_qa_review','artifact_sha256','UPDATE',false),
      ('ot_neutral_qa_review','payment_binding_sha256','UPDATE',false),
      ('ot_neutral_qa_review','order_id','UPDATE',false),
      ('ot_neutral_qa_review','fulfillment_id','UPDATE',false),
      -- The two commerce reads section 11 excuses, pinned column by column.
      ('ot_payment_binding','order_id','SELECT',true),
      ('ot_payment_binding','payment_intent','SELECT',true),
      ('ot_payment_binding','session_id','SELECT',false),
      ('ot_settlement_reversal','payment_intent','SELECT',true),
      ('ot_settlement_reversal','event_id','SELECT',false),
      ('ot_settlement_reversal','received_at','SELECT',false),
      -- The fulfillment and capability reads, and their bounds.
      ('ot_fulfillment','kind','SELECT',true),
      ('ot_packet_download_capability','revoked_at','SELECT',true),
      ('ot_packet_download_capability','revoked_reason_code','SELECT',false),
      ('ot_packet_download_capability','capability_hash','SELECT',false),
      ('ot_packet_download_capability','revoked_at','UPDATE',true),
      ('ot_packet_download_capability','use_count','UPDATE',false)
    ) AS t(table_name, column_name, privilege, expected)
  LOOP
    IF has_column_privilege('ot_neutral_reversal_guard_owner',
         format('public.%I', item.table_name), item.column_name, item.privilege)
       <> item.expected
    THEN
      failures := failures || format(
        'ot_neutral_reversal_guard_owner %s %s on %s.%s',
        CASE WHEN item.expected THEN 'is missing' ELSE 'unexpectedly holds' END,
        item.privilege, item.table_name, item.column_name);
    END IF;
  END LOOP;

  FOR item IN
    SELECT * FROM (VALUES
      -- The deliberate one: table-wide SELECT on the QA review table.
      ('ot_neutral_qa_review','SELECT',true),
      -- Everything else the role must never hold table-wide.
      ('ot_neutral_qa_review','UPDATE',false),
      ('ot_neutral_qa_review','INSERT',false),
      ('ot_neutral_qa_review','DELETE',false),
      ('ot_payment_binding','SELECT',false),
      ('ot_settlement_reversal','SELECT',false),
      ('ot_fulfillment','SELECT',false),
      ('ot_packet_download_capability','SELECT',false),
      ('ot_packet_download_capability','UPDATE',false),
      ('ot_order','SELECT',false)
    ) AS t(table_name, privilege, expected)
  LOOP
    IF has_table_privilege('ot_neutral_reversal_guard_owner',
         format('public.%I', item.table_name), item.privilege) <> item.expected
    THEN
      failures := failures || format(
        'ot_neutral_reversal_guard_owner %s table-wide %s on %s',
        CASE WHEN item.expected THEN 'is missing' ELSE 'unexpectedly holds' END,
        item.privilege, item.table_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 11. Negative grants. The three restricted functional roles reach commerce
  --     data only through the security-barrier views, never directly.
  --
  --     The reversal guard is excluded from this sweep by design, because the
  --     atomic hold depends on two column reads against commerce tables:
  --     `ot_payment_binding(order_id, payment_intent)` and
  --     `ot_settlement_reversal(payment_intent)`. That exclusion is paid for in
  --     section 10b, which pins every grant this role holds — including the
  --     table-wide SELECT it holds on ot_neutral_qa_review, which is NOT a
  --     commerce table and was therefore never in this sweep's scope to begin
  --     with.
  -- -------------------------------------------------------------------------
  FOREACH role_name IN ARRAY ARRAY['ot_neutral_runtime','ot_neutral_delivery_runtime','ot_neutral_app_reader'] LOOP
    FOREACH rel_name IN ARRAY commerce_tables LOOP
      IF has_table_privilege(role_name, format('public.%I', rel_name), all_privileges)
        OR has_any_column_privilege(role_name, format('public.%I', rel_name), 'SELECT,INSERT,UPDATE,REFERENCES') THEN
        failures := failures || format('%s retains direct access to %s', role_name, rel_name);
      END IF;
    END LOOP;
  END LOOP;

  FOREACH role_name IN ARRAY functional_roles LOOP
    FOREACH rel_name IN ARRAY baseline_tables LOOP
      IF rel_name <> 'ot_commerce_deadline_capture'
        AND has_table_privilege(role_name, format('public.%I', rel_name), 'DELETE,TRUNCATE,TRIGGER') THEN
        failures := failures || format('%s holds a destructive privilege on %s', role_name, rel_name);
      END IF;
    END LOOP;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 12. PUBLIC and Supabase API-role revocation across every created relation.
  -- -------------------------------------------------------------------------
  FOREACH rel_name IN ARRAY baseline_tables || baseline_views LOOP
    IF has_table_privilege('public', format('public.%I', rel_name), all_privileges)
      OR has_any_column_privilege('public', format('public.%I', rel_name), 'SELECT,INSERT,UPDATE,REFERENCES') THEN
      failures := failures || format('PUBLIC retains access to %s', rel_name);
    END IF;
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role)
        AND (has_table_privilege(api_role, format('public.%I', rel_name), all_privileges)
          OR has_any_column_privilege(api_role, format('public.%I', rel_name), 'SELECT,INSERT,UPDATE,REFERENCES'))
      THEN
        failures := failures || format('Supabase API role %s retains access to %s', api_role, rel_name);
      END IF;
    END LOOP;
  END LOOP;

  IF to_regclass('extensions.pg_stat_statements') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    WHERE ns.nspname = 'extensions'
      AND c.relname IN ('pg_stat_statements','pg_stat_statements_info')
      AND acl.grantee = 0 AND acl.privilege_type = 'SELECT'
  ) THEN
    failures := failures || 'extensions.pg_stat_statements is still readable by PUBLIC';
  END IF;

  -- -------------------------------------------------------------------------
  -- 13. The migration role holds NO SET and NO INHERIT on either owner role.
  --
  -- Stated as the end state rather than as a claim about how it was reached,
  -- because there are two ways to violate it and only one of them is a bug in
  -- 02_baseline.sql. Either the transfer borrowed SET/INHERIT and failed to
  -- return it, or the edge already carried SET/INHERIT before the baseline ran
  -- — an operator grant, or a cluster whose `createrole_self_grant` hands them
  -- out at CREATE ROLE time. The baseline normalizes its own freshly created
  -- roles and restores a pre-existing edge to exactly the shape it found, so a
  -- failure here means a SET/INHERIT path into a SECURITY DEFINER function
  -- owner that somebody outside this rollout put there. Either way it is
  -- refused, and either way an operator has to look at it.
  --
  -- PostgreSQL 16+ leaves the CREATEROLE creator an ADMIN-only membership edge;
  -- that edge is expected and cannot be removed by its beneficiary.
  -- -------------------------------------------------------------------------
  FOREACH role_name IN ARRAY ARRAY['ot_commerce_capture_owner','ot_neutral_reversal_guard_owner'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_auth_members m
      JOIN pg_roles granted ON granted.oid = m.roleid
      JOIN pg_roles member_role ON member_role.oid = m.member
      WHERE granted.rolname = role_name
        AND member_role.rolname = owner_role
        AND (m.set_option OR m.inherit_option)
    ) THEN
      failures := failures || format('the migration role holds SET or INHERIT on %s; no such membership option may survive the ownership transfer', role_name);
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 14. The three Production login -> functional role bindings, exactly.
  --
  -- Section 11 of 02_baseline.sql creates these and refuses on anything else.
  -- Proving them here rather than only in the TypeScript verifier is what makes
  -- the claim survive the paths that run this file directly: the idempotent
  -- replay, and the disposable-cluster integration fixture.
  --
  -- `INHERIT TRUE, SET FALSE` is asserted as a pair. INHERIT is how the login
  -- reaches its functional role at all; the absence of SET is what stops it
  -- shedding the identity the audit trail is keyed on.
  --
  -- COUNTED, NOT EXISTS-TESTED — THE TWO-GRANTOR BYPASS
  --
  -- This block used to ask `NOT EXISTS (… inherit AND NOT set AND NOT admin)`
  -- and then, separately, for memberships on roles `<> functional`. Both halves
  -- are satisfiable while the login can SET ROLE to its functional role.
  -- `pg_auth_members` is keyed on (roleid, member, GRANTOR): a platform
  -- operator records `GRANT ot_neutral_app_reader TO ot_prod_app WITH SET TRUE`,
  -- the baseline records its own `INHERIT TRUE, SET FALSE` edge for the same
  -- pair, and there are now TWO rows. The EXISTS finds the baseline's row and
  -- passes. The `<> functional` loop never looks at the pair at all. The
  -- privileges the two rows confer are unioned, `pg_has_role(login, functional,
  -- 'SET')` is true, and the receipt says the binding was proved.
  --
  -- So the shape is COUNTED — exactly one edge on the login in total, exactly
  -- one edge on the designed pair with exactly the designed options — and the
  -- consequence is asked of the server directly: `pg_has_role(..., 'SET')` must
  -- be false. Three independent statements, because the defect was a single
  -- statement that could be true for the wrong reason.
  -- -------------------------------------------------------------------------
  FOR item IN
    SELECT * FROM (VALUES
      ('ot_prod_app','ot_neutral_app_reader'),
      ('ot_prod_neutral_runtime','ot_neutral_runtime'),
      ('ot_prod_neutral_delivery','ot_neutral_delivery_runtime')
    ) AS t(login, functional)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = item.login) THEN
      failures := failures || format('Production login %s is missing', item.login);
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = item.login
        AND rolcanlogin AND rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    ) THEN
      failures := failures || format('Production login %s has unsafe attributes', item.login);
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
      JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public' AND r.rolname = item.login
        AND acl.privilege_type = 'CREATE'
    ) THEN
      failures := failures || format('Production login %s holds a direct CREATE grant on schema public', item.login);
    END IF;
    SELECT count(*) INTO edge_total
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname = item.login;

    SELECT count(*) INTO edge_exact
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE granted.rolname = item.functional
      AND member_role.rolname = item.login
      AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option;

    IF edge_exact <> 1 THEN
      failures := failures || format(
        'Production login %s is not bound to %s by exactly one ADMIN FALSE, INHERIT TRUE, SET FALSE edge (found %s)',
        item.login, item.functional, edge_exact);
    END IF;
    IF edge_total <> 1 THEN
      failures := failures || format(
        'Production login %s holds %s membership edges; exactly one is designed',
        item.login, edge_total);
    END IF;
    IF pg_has_role(item.login, item.functional, 'SET') THEN
      failures := failures || format(
        'Production login %s can SET ROLE to %s; the binding must be reachable by inheritance only',
        item.login, item.functional);
    END IF;

    -- Every edge on this login that is not the designed pair, named with its
    -- grantor — and every DUPLICATE edge on the designed pair, which is the
    -- shape `<> functional` could never see.
    FOR extra_binding IN
      SELECT granted.rolname || ' (granted by ' || grantor.rolname
               || ', inherit=' || m.inherit_option::text
               || ', set=' || m.set_option::text
               || ', admin=' || m.admin_option::text || ')'
      FROM pg_auth_members m
      JOIN pg_roles granted ON granted.oid = m.roleid
      JOIN pg_roles member_role ON member_role.oid = m.member
      JOIN pg_roles grantor ON grantor.oid = m.grantor
      WHERE member_role.rolname = item.login
        AND (
          granted.rolname <> item.functional
          OR NOT (m.inherit_option AND NOT m.set_option AND NOT m.admin_option)
        )
      ORDER BY granted.rolname, grantor.rolname
    LOOP
      failures := failures || format(
        'Production login %s reaches %s, which this rollout did not design',
        item.login, extra_binding);
    END LOOP;
  END LOOP;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'OT Production baseline postconditions failed: %', array_to_string(failures, '; ');
  END IF;
END $$;
