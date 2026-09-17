-- OT neutral-report PRODUCTION BASELINE — body.
--
-- WHAT THIS IS
--
-- The exact final schema and security state of the fourteen neutral-report /
-- T2-delivery migrations that are pending against Production, materialized in
-- one transaction by the owner connection. It is NOT a Prisma migration and it
-- must never be placed under prisma/migrations: Prisma would order a new
-- directory AFTER the fourteen it replaces, which is the one ordering that
-- cannot work. The operator runner applies this file and then, only after the
-- postconditions pass, records those fourteen with `prisma migrate resolve`.
--
-- WHAT IT IS NOT
--
--  * It never writes `_prisma_migrations`. The ledger is the runner's job and
--    happens after verification, never inside the same transaction as the DDL.
--  * It never CHANGES an application row. Every statement this transaction
--    executes is DDL, GRANT, REVOKE or POLICY: no INSERT, UPDATE, DELETE or
--    TRUNCATE is ever executed against any table.
--
--    Two things that look like exceptions and are not, stated plainly rather
--    than left for a reader to trip over:
--
--      - Section 13 READS. It asks `pg_stat_xact_all_tables` for this
--        transaction's own insert/update/delete counters across every table in
--        schema `public`, and it issues `SELECT count(*)` against each relation
--        this file created. Both are counts; neither selects a column value of
--        any row, and neither modifies anything.
--      - Two `CREATE FUNCTION` bodies below contain INSERT and UPDATE text.
--        That text is a function definition, not a statement this transaction
--        runs. `ot_publish_commerce_deadline_capture` inserts when an operator
--        later calls it, and `ot_neutral_hold_on_settlement_reversal` updates
--        when a settlement reversal is later recorded. Neither fires here, and
--        neither can fire while every neutral feature flag is off.
--  * It activates nothing. No feature flag is set, no default is flipped on, no
--    row is made visible that was not already.
--
-- HOW IT DIFFERS FROM THE PENDING CHAIN, AND WHY
--
--  1. 20260913170000 demanded `rolsuper` before transferring the capture-table
--     ownership. Production `postgres` has `rolsuper = false` and
--     `rolcreaterole = true`, so that migration can never run there. The
--     ownership transfer below uses the ADMIN OPTION a CREATEROLE role receives
--     on the roles it creates: grant SET/INHERIT to self, transfer, revoke. Same
--     end state, no superuser.
--
--  2. 20260916120000 was a Preview incident reconciliation. It required
--     `ot_preview_app` and two pinned catalog digests captured from Preview
--     fixtures. Nothing is applied in Production, so there is no ledger incident
--     to reconcile; only its MATERIAL effect is kept — removing Supabase API-role
--     privileges from the neutral relations — and it is applied to every relation
--     this file creates rather than to three of them.
--
--  3. 20260916220000 required `public.rls_auto_enable()` to exist. It does not
--     exist in Production, so that precondition would abort the whole chain. The
--     two effects that do apply here — closing the PUBLIC grant on the
--     pg_stat_statements views and FORCEing RLS on the capability table — are
--     carried out directly, and the function is not referenced at all.
--
--  4. Grants and policies that a later migration in the chain revokes or drops
--     are never created. `ot_neutral_runtime` is given the three security-barrier
--     views it ends up with, not the raw commerce tables it would have briefly
--     held.
--
-- PRECONDITIONS are proved by 01_preflight.sql and by the runner before this
-- file is opened. POSTCONDITIONS are proved by 03_postconditions.sql inside this
-- same transaction, before COMMIT.

-- Snapshot this transaction's per-table tuple counters before any baseline
-- statement runs. The runner owns the transaction, but the snapshot makes the
-- proof below a delta attributable to this file rather than to earlier fixture
-- or operator work on the same session.
CREATE TEMP TABLE pg_temp.ot_neutral_baseline_write_snapshot ON COMMIT DROP AS
SELECT relid, n_tup_ins, n_tup_upd, n_tup_del
FROM pg_stat_xact_all_tables
WHERE schemaname = 'public';

-- ===========================================================================
-- 1. Settlement evidence.  (covers 20260912190000_ot_settlement_revocation)
-- ===========================================================================
CREATE TABLE ot_payment_binding (
 order_id TEXT PRIMARY KEY REFERENCES ot_order(id),
 session_id TEXT NOT NULL UNIQUE,
 payment_intent TEXT NOT NULL UNIQUE CHECK (payment_intent LIKE 'pi_%')
);
CREATE TABLE ot_settlement_reversal (
 event_id TEXT PRIMARY KEY,
 event_type TEXT NOT NULL,
 payment_intent TEXT NOT NULL CHECK (payment_intent LIKE 'pi_%'),
 received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON ot_settlement_reversal(payment_intent);
ALTER TABLE ot_payment_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE ot_settlement_reversal ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION ot_preserve_settlement_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status = 'SETTLEMENT_HOLD' AND NEW.status NOT IN ('CANCELLED','REFUNDED') THEN
  NEW.status := 'SETTLEMENT_HOLD';
 ELSIF NEW.status = 'PAID' AND EXISTS (
  SELECT 1 FROM ot_payment_binding b JOIN ot_settlement_reversal r USING(payment_intent) WHERE b.order_id=NEW.id
 ) THEN NEW.status := 'SETTLEMENT_HOLD'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ot_preserve_settlement_hold BEFORE UPDATE ON ot_order
 FOR EACH ROW EXECUTE FUNCTION ot_preserve_settlement_hold();

CREATE FUNCTION ot_settlement_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Settlement evidence is append-only'; END $$;
CREATE TRIGGER ot_payment_binding_immutable BEFORE UPDATE OR DELETE ON ot_payment_binding
 FOR EACH ROW EXECUTE FUNCTION ot_settlement_evidence_immutable();
CREATE TRIGGER ot_settlement_reversal_immutable BEFORE UPDATE OR DELETE ON ot_settlement_reversal
 FOR EACH ROW EXECUTE FUNCTION ot_settlement_evidence_immutable();

-- ===========================================================================
-- 2. Acquisition attribution.  (covers 20260912000000_add_ot_order_attribution)
-- ===========================================================================
CREATE TABLE "ot_order_attribution" (
    "order_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "campaign_code" TEXT,
    "creative_code" TEXT,
    "registry_version" TEXT NOT NULL,
    "bound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ot_order_attribution_pkey" PRIMARY KEY ("order_id")
);
ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "ot_order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_code_shape" CHECK (
        ("campaign_code" IS NULL OR "campaign_code" ~ '^[a-z0-9][a-z0-9_]{1,39}$')
        AND ("creative_code" IS NULL OR "creative_code" ~ '^[a-z0-9][a-z0-9_]{1,39}$')
        AND "registry_version" ~ '^[a-z0-9][a-z0-9_-]{1,79}$'
    );
ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_state_agrees_with_codes" CHECK (
        ("state" = 'campaign' AND "campaign_code" IS NOT NULL)
        OR ("state" IN ('organic', 'legacy_unattributed') AND "campaign_code" IS NULL AND "creative_code" IS NULL)
    );
ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_creative_requires_campaign" CHECK (
        "creative_code" IS NULL OR "campaign_code" IS NOT NULL
    );
CREATE OR REPLACE FUNCTION "ot_order_attribution_reject_update"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ot_order_attribution rows are immutable (order_id=%)', OLD."order_id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ot_order_attribution_no_update"
    BEFORE UPDATE ON "ot_order_attribution"
    FOR EACH ROW EXECUTE FUNCTION "ot_order_attribution_reject_update"();
CREATE INDEX "ot_order_attribution_campaign_code_idx"
    ON "ot_order_attribution"("campaign_code")
    WHERE "campaign_code" IS NOT NULL;
ALTER TABLE "ot_order_attribution" ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 3. Packet download capability + orphan quarantine.
--    (covers 20260912120000 and the corrective 20260912140000)
-- ===========================================================================
CREATE TABLE "ot_packet_download_capability" (
    "id" TEXT NOT NULL,
    "capability_hash" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "artifact_version" INTEGER NOT NULL,
    "artifact_sha256" TEXT NOT NULL,
    "source_order_id" TEXT NOT NULL,
    "property_binding_fingerprint" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ot_packet_download_capability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ot_packet_download_capability_hash_shape" CHECK ("capability_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ot_packet_download_capability_digest_shape" CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ot_packet_download_capability_fingerprint_shape" CHECK ("property_binding_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ot_packet_download_capability_version_positive" CHECK ("artifact_version" >= 1),
    CONSTRAINT "ot_packet_download_capability_uses_bounded" CHECK ("max_uses" BETWEEN 1 AND 1000),
    CONSTRAINT "ot_packet_download_capability_use_count_bounded" CHECK ("use_count" >= 0 AND "use_count" <= "max_uses"),
    CONSTRAINT "ot_packet_download_capability_expiry_after_issue" CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "ot_packet_download_capability_revocation_complete" CHECK (
      ("revoked_at" IS NULL AND "revoked_reason_code" IS NULL)
      OR ("revoked_at" IS NOT NULL AND "revoked_reason_code" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "ot_packet_download_capability_capability_hash_key"
  ON "ot_packet_download_capability"("capability_hash");
CREATE INDEX "ot_packet_download_capability_fulfillment_id_idx"
  ON "ot_packet_download_capability"("fulfillment_id");
CREATE INDEX "ot_packet_download_capability_expires_at_idx"
  ON "ot_packet_download_capability"("expires_at");
ALTER TABLE "ot_packet_download_capability"
  ADD CONSTRAINT "ot_packet_download_capability_fulfillment_id_fkey"
  FOREIGN KEY ("fulfillment_id") REFERENCES "ot_fulfillment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ot_packet_download_capability"
  ADD CONSTRAINT "ot_packet_download_capability_artifact_fkey"
  FOREIGN KEY ("fulfillment_id", "artifact_version")
  REFERENCES "ot_fulfillment_artifact"("fulfillment_id", "version")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "ot_artifact_orphan_quarantine" (
    "id" TEXT NOT NULL,
    "storage_locator" TEXT NOT NULL,
    "artifact_sha256" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "source_order_id" TEXT NOT NULL,
    "upload_outcome" TEXT NOT NULL,
    "first_reason_code" TEXT NOT NULL,
    "last_reason_code" TEXT NOT NULL,
    "observation_count" INTEGER NOT NULL DEFAULT 1,
    "first_observed_at" TIMESTAMP(3) NOT NULL,
    "last_observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ot_artifact_orphan_quarantine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ot_artifact_orphan_quarantine_digest_shape" CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ot_artifact_orphan_quarantine_upload_outcome" CHECK ("upload_outcome" IN ('CONFIRMED', 'UNKNOWN')),
    CONSTRAINT "ot_artifact_orphan_quarantine_observation_count" CHECK ("observation_count" >= 1),
    CONSTRAINT "ot_artifact_orphan_quarantine_observed_order" CHECK ("last_observed_at" >= "first_observed_at"),
    CONSTRAINT "ot_artifact_orphan_quarantine_locator_private" CHECK (
      "storage_locator" ~ '^[A-Za-z0-9._/-]+$'
      AND "storage_locator" NOT LIKE '/%'
      AND char_length("storage_locator") BETWEEN 1 AND 512
    )
);
CREATE UNIQUE INDEX "ot_artifact_orphan_quarantine_fulfillment_locator_digest_key"
  ON "ot_artifact_orphan_quarantine"("fulfillment_id", "storage_locator", "artifact_sha256");
CREATE INDEX "ot_artifact_orphan_quarantine_artifact_sha256_idx"
  ON "ot_artifact_orphan_quarantine"("artifact_sha256");
CREATE INDEX "ot_artifact_orphan_quarantine_last_observed_at_idx"
  ON "ot_artifact_orphan_quarantine"("last_observed_at");
ALTER TABLE "ot_packet_download_capability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_artifact_orphan_quarantine" ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 4. Provider callbacks + attempt/capability association.
--    (covers 20260912160000_add_ot_t2_delivery_callbacks)
-- ===========================================================================
ALTER TABLE "ot_delivery_attempt" ADD COLUMN "download_capability_id" TEXT;
CREATE UNIQUE INDEX "ot_delivery_attempt_download_capability_id_key"
  ON "ot_delivery_attempt"("download_capability_id");
ALTER TABLE "ot_delivery_attempt"
  ADD CONSTRAINT "ot_delivery_attempt_download_capability_id_fkey"
  FOREIGN KEY ("download_capability_id")
  REFERENCES "ot_packet_download_capability"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "ot_delivery_provider_callback" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "event_type" "OTDeliveryEventType" NOT NULL,
    "reason_code" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disposition" TEXT NOT NULL,
    "disposition_code" TEXT,
    "fulfillment_id" TEXT,
    "attempt_number" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "replay_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ot_delivery_provider_callback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ot_delivery_provider_callback_disposition" CHECK ("disposition" IN ('APPLIED', 'UNMATCHED', 'REFUSED')),
    CONSTRAINT "ot_delivery_provider_callback_provider_bounded" CHECK ("provider" ~ '^[A-Za-z0-9._-]{1,64}$'),
    CONSTRAINT "ot_delivery_provider_callback_event_id_bounded" CHECK (char_length("provider_event_id") BETWEEN 1 AND 255),
    CONSTRAINT "ot_delivery_provider_callback_message_id_bounded" CHECK (char_length("provider_message_id") BETWEEN 1 AND 255),
    CONSTRAINT "ot_delivery_provider_callback_reason_bounded" CHECK ("reason_code" IS NULL OR "reason_code" ~ '^[A-Z_]{1,64}$'),
    CONSTRAINT "ot_delivery_provider_callback_disposition_code_bounded" CHECK ("disposition_code" IS NULL OR "disposition_code" ~ '^[A-Z_]{1,64}$'),
    CONSTRAINT "ot_delivery_provider_callback_attempt_positive" CHECK ("attempt_number" IS NULL OR "attempt_number" >= 1),
    CONSTRAINT "ot_delivery_provider_callback_binding_complete" CHECK (
      "attempt_number" IS NULL OR "fulfillment_id" IS NOT NULL
    ),
    CONSTRAINT "ot_delivery_provider_callback_applied_is_bound" CHECK (
      "disposition" <> 'APPLIED'
      OR ("fulfillment_id" IS NOT NULL AND "attempt_number" IS NOT NULL AND "resolved_at" IS NOT NULL)
    ),
    CONSTRAINT "ot_delivery_provider_callback_replay_bounded" CHECK ("replay_count" >= 0 AND "replay_count" <= 1000),
    CONSTRAINT "ot_delivery_provider_callback_received_order" CHECK ("resolved_at" IS NULL OR "resolved_at" >= "received_at")
);
CREATE UNIQUE INDEX "ot_delivery_provider_callback_provider_event_key"
  ON "ot_delivery_provider_callback"("provider", "provider_event_id");
CREATE INDEX "ot_delivery_provider_callback_message_id_idx"
  ON "ot_delivery_provider_callback"("provider_message_id");
CREATE INDEX "ot_delivery_provider_callback_disposition_idx"
  ON "ot_delivery_provider_callback"("disposition", "received_at");
CREATE INDEX "ot_delivery_provider_callback_fulfillment_id_idx"
  ON "ot_delivery_provider_callback"("fulfillment_id");
ALTER TABLE "ot_delivery_provider_callback" ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 5. Admin event vocabulary.  (covers 20260912180000_widen_ot_admin_event_actions)
--    Constraint reshape only. No row is written or revalidated away: shape 1 is
--    byte-for-byte the rule the dropped constraints expressed.
--
--    WHAT MAY BE DROPPED, AND WHY IT IS A CLOSED LIST NOW
--
--    20260808173000 wrote these four CHECKs unnamed, so PostgreSQL named them
--    `<table>_<column>_check`. The migration this section replaces selected them
--    by `conkey` — "any CHECK whose columns are a subset of {action,
--    from_status, to_status, reason_code}" — and dropped whatever it found. That
--    is a DROP with an open-ended target: a CHECK somebody adds later on
--    `reason_code`, or a hardening constraint added out-of-band on `action`,
--    matches the same predicate and would be silently destroyed by a run whose
--    receipt says "constraint reshape only".
--
--    So the four names are pinned. Anything else that overlaps the target column
--    set ABORTS the transaction instead of being dropped: an unrecognised
--    constraint on these columns means this database is not the one the manifest
--    was written against, and a baseline is exactly the wrong place to guess.
-- ===========================================================================
DO $$
DECLARE
  target_columns SMALLINT[];
  expected_names CONSTANT TEXT[] := ARRAY[
    'ot_fulfillment_admin_event_action_check',
    'ot_fulfillment_admin_event_to_status_check',
    'ot_fulfillment_admin_event_reason_code_check',
    'ot_fulfillment_admin_event_from_status_check'
  ];
  unknown_names TEXT[];
  doomed RECORD;
BEGIN
  SELECT array_agg(a.attnum ORDER BY a.attnum) INTO target_columns
  FROM pg_attribute a
  WHERE a.attrelid = '"ot_fulfillment_admin_event"'::regclass
    AND a.attname IN ('action', 'from_status', 'to_status', 'reason_code')
    AND NOT a.attisdropped;

  SELECT array_agg(c.conname ORDER BY c.conname) INTO unknown_names
  FROM pg_constraint c
  WHERE c.conrelid = '"ot_fulfillment_admin_event"'::regclass
    AND c.contype = 'c' AND c.conkey IS NOT NULL AND c.conkey <@ target_columns
    AND NOT (c.conname = ANY(expected_names));
  IF unknown_names IS NOT NULL THEN
    RAISE EXCEPTION
      'ot_fulfillment_admin_event carries unexpected CHECK constraint(s) on the admin-event columns: %',
      array_to_string(unknown_names, ', ');
  END IF;

  FOR doomed IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = '"ot_fulfillment_admin_event"'::regclass
      AND c.contype = 'c' AND c.conname = ANY(expected_names)
  LOOP
    EXECUTE format('ALTER TABLE "ot_fulfillment_admin_event" DROP CONSTRAINT %I', doomed.conname);
  END LOOP;
END $$;

ALTER TABLE "ot_fulfillment_admin_event"
  ADD CONSTRAINT "ot_fulfillment_admin_event_enter_manual_review_shape" CHECK (
    "action" <> 'ENTER_MANUAL_REVIEW'
    OR (
      "to_status" = 'MANUAL_REVIEW'
      AND "reason_code" = 'MANUAL_REVIEW'
      AND "from_status" IN (
        'NOT_STARTED', 'NEEDS_RECONCILIATION', 'INCOMPLETE_INPUT',
        'ARTIFACT_PENDING', 'ARTIFACT_READY'
      )
    )
  );
ALTER TABLE "ot_fulfillment_admin_event"
  ADD CONSTRAINT "ot_fulfillment_admin_event_resolve_unresolved_send_shape" CHECK (
    "action" <> 'RESOLVE_UNRESOLVED_SEND'
    OR (
      "from_status" = 'DELIVERY_PENDING'
      AND "to_status" = 'FAILED'
      AND "reason_code" IN ('PROVIDER_ERROR', 'TIMEOUT', 'INVALID_RECIPIENT', 'MANUAL_REVIEW')
    )
  );
ALTER TABLE "ot_fulfillment_admin_event"
  ADD CONSTRAINT "ot_fulfillment_admin_event_action_closed" CHECK (
    "action" IN ('ENTER_MANUAL_REVIEW', 'RESOLVE_UNRESOLVED_SEND')
  );

-- ===========================================================================
-- 6. Commerce deadline capture.  (REPLACES 20260913170000, superuser-free)
-- ===========================================================================
CREATE TABLE "ot_commerce_deadline_capture" (
  "id" TEXT PRIMARY KEY,
  "retrieved_at" TIMESTAMPTZ NOT NULL,
  "content_sha256" TEXT NOT NULL CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),
  "capture_json" TEXT NOT NULL,
  "source_body" BYTEA NOT NULL CHECK (octet_length("source_body") > 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ot_commerce_deadline_capture_identity_key" UNIQUE ("retrieved_at", "content_sha256")
);
CREATE INDEX "ot_commerce_deadline_capture_latest_idx"
  ON "ot_commerce_deadline_capture" ("retrieved_at" DESC, "id" DESC);
CREATE FUNCTION "ot_commerce_deadline_capture_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commerce deadline captures are append-only';
END;
$$;
CREATE TRIGGER "ot_commerce_deadline_capture_append_only"
  BEFORE UPDATE OR DELETE ON "ot_commerce_deadline_capture"
  FOR EACH ROW EXECUTE FUNCTION "ot_commerce_deadline_capture_append_only"();
ALTER TABLE "ot_commerce_deadline_capture" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION "ot_publish_commerce_deadline_capture"(
  capture_id TEXT,
  capture_retrieved_at TIMESTAMPTZ,
  capture_content_sha256 TEXT,
  capture_json TEXT,
  capture_source_body BYTEA
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE embedded JSONB;
BEGIN
  IF capture_id IS NULL
    OR capture_retrieved_at IS NULL
    OR capture_content_sha256 IS NULL
    OR capture_json IS NULL
    OR capture_source_body IS NULL
  THEN
    RAISE EXCEPTION 'commerce deadline capture binding is invalid';
  END IF;

  embedded := capture_json::jsonb;
  IF (embedded #>> '{snapshot,sources,assessor,retrievedAt}') IS NULL
    OR (embedded #>> '{snapshot,sources,assessor,contentSha256}') IS NULL
    OR (embedded #>> '{sourceBodyBase64}') IS NULL
    OR capture_retrieved_at IS DISTINCT FROM ((embedded #>> '{snapshot,sources,assessor,retrievedAt}')::timestamptz)
    OR capture_content_sha256 IS DISTINCT FROM (embedded #>> '{snapshot,sources,assessor,contentSha256}')
    OR capture_source_body IS DISTINCT FROM decode(embedded #>> '{sourceBodyBase64}', 'base64')
    OR capture_content_sha256 IS DISTINCT FROM encode(sha256(capture_source_body), 'hex')
  THEN
    RAISE EXCEPTION 'commerce deadline capture binding is invalid';
  END IF;

  INSERT INTO public."ot_commerce_deadline_capture"
    ("id", "retrieved_at", "content_sha256", "capture_json", "source_body")
  VALUES
    (capture_id, capture_retrieved_at, capture_content_sha256, capture_json, capture_source_body);
END;
$$;

-- The two owner roles, created here so the CREATEROLE connection holds ADMIN
-- OPTION on both and can lend itself SET/INHERIT for the transfers below.
--
-- A role this block CREATES has its self-grant normalized to
-- `INHERIT FALSE, SET FALSE` immediately. `createrole_self_grant` is a cluster
-- GUC: set to `set,inherit` — which is a documented and reasonable thing for a
-- platform to do — `CREATE ROLE` hands the creating role SET and INHERIT on the
-- new role automatically, and the transfers below would then find they already
-- had what they were about to borrow, borrow nothing, restore nothing, and leave
-- a live SET/INHERIT path from the migration role into a SECURITY DEFINER
-- function owner. Normalizing at creation makes the baseline's own starting
-- point explicit instead of inherited from a setting nobody in this rollout
-- controls. The ADMIN edge is untouched: it is unrevokable by its beneficiary
-- and it is what makes the transfer possible at all.
DO $$
DECLARE owner_name TEXT;
BEGIN
  FOREACH owner_name IN ARRAY ARRAY['ot_commerce_capture_owner','ot_neutral_reversal_guard_owner'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_name) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        owner_name);
      IF EXISTS (
        SELECT 1 FROM pg_auth_members m
        JOIN pg_roles granted ON granted.oid = m.roleid
        JOIN pg_roles member_role ON member_role.oid = m.member
        WHERE granted.rolname = owner_name AND member_role.rolname = current_user
          AND (m.inherit_option OR m.set_option)
      ) THEN
        EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET FALSE', owner_name, current_user);
      END IF;
    ELSE
      -- A pre-existing name is accepted only with pristine attributes. Unlike
      -- 20260913170000 the membership graph is NOT required to be empty: a
      -- CREATEROLE connection on PostgreSQL 16+ always leaves an ADMIN edge it
      -- cannot revoke, and refusing that is refusing the only topology
      -- Production can produce.
      IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = owner_name
          AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
          AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
          AND NOT rolbypassrls
      ) THEN
        RAISE EXCEPTION 'pre-existing role % has unsafe attributes', owner_name;
      END IF;
      -- The transfers below need to SET ROLE to this role, which needs either an
      -- ADMIN edge to grant themselves SET with, or SET already. A role created
      -- by somebody else with neither is un-adoptable, and saying so here beats
      -- a bare "permission denied" forty statements later.
      IF NOT pg_has_role(current_user, owner_name, 'SET')
        AND NOT EXISTS (
          SELECT 1 FROM pg_auth_members m
          JOIN pg_roles granted ON granted.oid = m.roleid
          JOIN pg_roles member_role ON member_role.oid = m.member
          WHERE granted.rolname = owner_name
            AND member_role.rolname = current_user
            AND m.admin_option
        )
      THEN
        RAISE EXCEPTION
          'pre-existing role % cannot be adopted: the migration role holds neither ADMIN nor SET on it',
          owner_name;
      END IF;
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', owner_name);
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', owner_name);
  END LOOP;
END $$;

-- Ownership transfer without superuser, and every ACL that must be issued BY the
-- new owner, in one block.
--
-- PostgreSQL requires the current role to be able to SET ROLE to the incoming
-- owner. A CREATEROLE role receives ADMIN OPTION on the roles it creates but
-- neither INHERIT nor SET. The pending migrations may therefore have already
-- left a membership edge that is usable for ownership transfer but not for
-- SET ROLE. Temporarily enable SET/INHERIT on that edge, then restore it.
--
-- RESTORE MEANS RESTORE, NOT "SET BOTH TO FALSE"
--
-- The original INHERIT/SET flags are read out of `pg_auth_members` BEFORE
-- anything is granted, and the exact pair is written back afterwards. Writing
-- `INHERIT FALSE, SET FALSE` unconditionally — which is what this block used to
-- do — is only correct when the edge happened to start that way. Against a
-- cluster whose `createrole_self_grant` grants `inherit`, or an edge a platform
-- operator provisioned deliberately, it silently REMOVED a privilege the
-- baseline never borrowed, and the removal would be invisible until something
-- unrelated stopped working. Both directions are then asserted — SET and
-- INHERIT, separately — so "the borrow was returned" is a measurement.
--
-- The unrevokable platform ADMIN edge is left alone: it cannot be removed by its
-- beneficiary, and it is not a privilege the application can reach because the
-- role is NOLOGIN NOINHERIT.
--
-- The grants, the policy and the revokes all live here rather than as top-level
-- statements because after the transfer the migration role is NOT the owner any
-- more. A top-level `REVOKE ... FROM PUBLIC` issued by a non-owner does not
-- fail — PostgreSQL warns and revokes nothing — which is exactly how a
-- SECURITY DEFINER function stays executable by PUBLIC while the migration that
-- "closed" it reports success.
DO $$
DECLARE
  target CONSTANT TEXT := 'ot_commerce_capture_owner';
  borrowed BOOLEAN := false;
  had_edge BOOLEAN := false;
  original_inherit BOOLEAN;
  original_set BOOLEAN;
  final_inherit BOOLEAN;
  final_set BOOLEAN;
  migration_role TEXT := current_user;
  api_role TEXT;
BEGIN
  SELECT true, m.inherit_option, m.set_option
    INTO had_edge, original_inherit, original_set
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member_role ON member_role.oid = m.member
  WHERE granted.rolname = target AND member_role.rolname = migration_role;
  had_edge := COALESCE(had_edge, false);

  IF NOT pg_has_role(migration_role, target, 'SET') THEN
    EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE', target, migration_role);
    borrowed := true;
  END IF;

  -- ALTER ... OWNER requires the destination role to have CREATE on the
  -- containing schema. Lend that schema privilege only for the transfer and
  -- revoke it before entering the owner role.
  GRANT CREATE ON SCHEMA public TO ot_commerce_capture_owner;
  ALTER TABLE public."ot_commerce_deadline_capture" OWNER TO ot_commerce_capture_owner;
  ALTER FUNCTION public."ot_commerce_deadline_capture_append_only"() OWNER TO ot_commerce_capture_owner;
  ALTER FUNCTION public."ot_publish_commerce_deadline_capture"(TEXT, TIMESTAMPTZ, TEXT, TEXT, BYTEA)
    OWNER TO ot_commerce_capture_owner;
  REVOKE CREATE ON SCHEMA public FROM ot_commerce_capture_owner;

  EXECUTE 'SET LOCAL ROLE ot_commerce_capture_owner';
  -- The migration role keeps exactly a read, plus publish-only write through the
  -- definer function. No INSERT/UPDATE/DELETE, and no ownership.
  EXECUTE format('GRANT SELECT ON TABLE public."ot_commerce_deadline_capture" TO %I', migration_role);
  EXECUTE format('CREATE POLICY "ot_commerce_deadline_capture_reader" ON public."ot_commerce_deadline_capture" FOR SELECT TO %I USING (true)', migration_role);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."ot_commerce_deadline_capture" FROM %I', migration_role);
  EXECUTE 'REVOKE ALL ON FUNCTION public."ot_publish_commerce_deadline_capture"(TEXT, TIMESTAMPTZ, TEXT, TEXT, BYTEA) FROM PUBLIC';
  EXECUTE format('GRANT EXECUTE ON FUNCTION public."ot_publish_commerce_deadline_capture"(TEXT, TIMESTAMPTZ, TEXT, TEXT, BYTEA) TO %I', migration_role);
  EXECUTE 'REVOKE ALL ON TABLE public."ot_commerce_deadline_capture" FROM PUBLIC';
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."ot_commerce_deadline_capture" FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public."ot_publish_commerce_deadline_capture"(TEXT, TIMESTAMPTZ, TEXT, TEXT, BYTEA) FROM %I', api_role);
    END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';

  IF borrowed THEN
    IF had_edge THEN
      EXECUTE format('GRANT %I TO %I WITH INHERIT %s, SET %s', target, migration_role,
        CASE WHEN original_inherit THEN 'TRUE' ELSE 'FALSE' END,
        CASE WHEN original_set THEN 'TRUE' ELSE 'FALSE' END);
    ELSE
      -- There was no edge at all before this block; the one it created is the
      -- only thing to undo, and it goes away whole.
      EXECUTE format('REVOKE %I FROM %I', target, migration_role);
    END IF;

    IF NOT COALESCE(original_set, false)
      AND pg_has_role(migration_role, target, 'SET') THEN
      RAISE EXCEPTION 'temporary SET privilege for % was not returned', target;
    END IF;
    IF NOT COALESCE(original_inherit, false)
      AND pg_has_role(migration_role, target, 'USAGE') THEN
      RAISE EXCEPTION 'temporary INHERIT privilege for % was not returned', target;
    END IF;
  END IF;

  -- Unconditional, because "we did not borrow" is also a claim worth proving.
  SELECT m.inherit_option, m.set_option INTO final_inherit, final_set
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member_role ON member_role.oid = m.member
  WHERE granted.rolname = target AND member_role.rolname = migration_role;

  IF had_edge THEN
    IF final_inherit IS DISTINCT FROM original_inherit
      OR final_set IS DISTINCT FROM original_set THEN
      RAISE EXCEPTION
        'membership edge for % was not restored to its original shape (inherit %/%, set %/%)',
        target, original_inherit, final_inherit, original_set, final_set;
    END IF;
  ELSIF final_inherit IS NOT NULL OR final_set IS NOT NULL THEN
    RAISE EXCEPTION 'a membership edge for % survived that did not exist before', target;
  END IF;
END $$;

-- ===========================================================================
-- 7. Neutral report repository.  (covers 20260915143000)
--    The commerce-table grants and the two commerce policies that migration
--    created are NOT created here: 20260915230000 removes them, and the final
--    state is the security-barrier views in section 10.
-- ===========================================================================
CREATE TYPE "OTNeutralReservationStatus" AS ENUM ('RESERVED','STAGED','PROMOTED','RECONCILIATION_REQUIRED','QUARANTINED','COMPROMISED','SUPERSEDED','ABANDONED');
CREATE TYPE "OTNeutralBlobAttemptStatus" AS ENUM ('INTENDED','WRITE_CONFIRMED','WRITE_UNKNOWN','QUARANTINED');
CREATE TABLE "ot_neutral_report_reservation" (
 "id" TEXT PRIMARY KEY, "order_id" TEXT NOT NULL, "policy_version" TEXT NOT NULL, "property_fingerprint" TEXT NOT NULL, "reservation_key" TEXT NOT NULL, "checkout_price_id" TEXT NOT NULL, "checkout_product_id" TEXT NOT NULL,
 "admission_sha256" TEXT NOT NULL, "data_evidence_sha256" TEXT NOT NULL, "deadline_evidence_sha256" TEXT NOT NULL, "source_content_sha256" TEXT NOT NULL, "deadline_identity_sha256" TEXT NOT NULL,
 "official_retrieved_at" TIMESTAMPTZ(3) NOT NULL, "official_oldest_retrieved_at" TIMESTAMPTZ(3) NOT NULL, "official_max_age_seconds" INTEGER NOT NULL, "deadline_retrieved_at" TIMESTAMPTZ(3) NOT NULL,
 "cohort_position" INTEGER NOT NULL, "precheckout_lease_expires_at" TIMESTAMPTZ(3) NOT NULL, "paid_cohort_position" INTEGER, "paid_admitted_at" TIMESTAMPTZ(3), "reviewer_key" TEXT NOT NULL, "reviewer_week_start" DATE NOT NULL,
 "qa_target_minutes" INTEGER NOT NULL DEFAULT 12, "qa_hard_stop_minutes" INTEGER NOT NULL DEFAULT 20,
 "qa_started_at" TIMESTAMPTZ(3), "qa_completed_at" TIMESTAMPTZ(3), "qa_minutes" INTEGER,
 "status" "OTNeutralReservationStatus" NOT NULL DEFAULT 'RESERVED', "bundle_sha256" TEXT, "manifest_sha256" TEXT, "pdf_sha256" TEXT, "csv_sha256" TEXT,
 "private_references" JSONB, "staged_at" TIMESTAMPTZ(3), "promoted_at" TIMESTAMPTZ(3), "reconciliation_code" TEXT, "incident_code" TEXT, "superseded_by_sha256" TEXT,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ot_neutral_order_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ot_neutral_digest_shape" CHECK ("property_fingerprint" ~ '^[0-9a-f]{64}$' AND "admission_sha256" ~ '^[0-9a-f]{64}$' AND "data_evidence_sha256" ~ '^[0-9a-f]{64}$' AND "deadline_evidence_sha256" ~ '^[0-9a-f]{64}$' AND "source_content_sha256" ~ '^[0-9a-f]{64}$' AND "deadline_identity_sha256" ~ '^[0-9a-f]{64}$' AND ("bundle_sha256" IS NULL OR "bundle_sha256" ~ '^[0-9a-f]{64}$') AND ("manifest_sha256" IS NULL OR "manifest_sha256" ~ '^[0-9a-f]{64}$') AND ("pdf_sha256" IS NULL OR "pdf_sha256" ~ '^[0-9a-f]{64}$') AND ("csv_sha256" IS NULL OR "csv_sha256" ~ '^[0-9a-f]{64}$')),
 CONSTRAINT "ot_neutral_capacity_shape" CHECK ("cohort_position" BETWEEN 1 AND 10 AND ("paid_cohort_position" IS NULL OR "paid_cohort_position" BETWEEN 1 AND 10) AND (("paid_cohort_position" IS NULL)=("paid_admitted_at" IS NULL)) AND "official_max_age_seconds" BETWEEN 0 AND 86400 AND length("reviewer_key") BETWEEN 1 AND 64 AND "qa_target_minutes"=12 AND "qa_hard_stop_minutes"=20 AND ("qa_minutes" IS NULL OR "qa_minutes" BETWEEN 0 AND 20)),
 CONSTRAINT "ot_neutral_time_shape" CHECK ("official_oldest_retrieved_at" <= "official_retrieved_at" AND "official_retrieved_at" <= "created_at" AND "deadline_retrieved_at" <= "created_at" AND "precheckout_lease_expires_at">"created_at" AND ("qa_completed_at" IS NULL OR ("qa_started_at" IS NOT NULL AND "qa_completed_at">="qa_started_at"))),
 CONSTRAINT "ot_neutral_state_shape" CHECK (("status"='RESERVED' AND "bundle_sha256" IS NULL AND "private_references" IS NULL) OR ("status" IN ('STAGED','PROMOTED') AND "bundle_sha256" IS NOT NULL AND "manifest_sha256" IS NOT NULL AND "pdf_sha256" IS NOT NULL AND "csv_sha256" IS NOT NULL AND "private_references" IS NOT NULL) OR ("status" IN ('RECONCILIATION_REQUIRED','QUARANTINED','COMPROMISED','SUPERSEDED','ABANDONED')))
);
CREATE UNIQUE INDEX "ot_neutral_order_key" ON "ot_neutral_report_reservation"("order_id");
CREATE UNIQUE INDEX "ot_neutral_reservation_key" ON "ot_neutral_report_reservation"("reservation_key");
CREATE UNIQUE INDEX "ot_neutral_cohort_position_key" ON "ot_neutral_report_reservation"("cohort_position") WHERE "status" <> 'ABANDONED';
CREATE UNIQUE INDEX "ot_neutral_paid_cohort_position_key" ON "ot_neutral_report_reservation"("paid_cohort_position") WHERE "paid_cohort_position" IS NOT NULL;
CREATE INDEX "ot_neutral_reviewer_capacity_idx" ON "ot_neutral_report_reservation"("reviewer_key","reviewer_week_start","status");
CREATE INDEX "ot_neutral_status_updated_idx" ON "ot_neutral_report_reservation"("status","updated_at");
CREATE INDEX "ot_neutral_bundle_idx" ON "ot_neutral_report_reservation"("bundle_sha256");
CREATE TABLE "ot_neutral_blob_attempt" (
 "id" TEXT PRIMARY KEY, "reservation_id" TEXT NOT NULL, "attempt_number" INTEGER NOT NULL, "status" "OTNeutralBlobAttemptStatus" NOT NULL DEFAULT 'INTENDED',
 "storage_locator" TEXT NOT NULL, "bundle_sha256" TEXT NOT NULL, "byte_size" INTEGER NOT NULL, "reason_code" TEXT,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "observed_at" TIMESTAMPTZ(3),
 CONSTRAINT "ot_neutral_blob_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ot_neutral_blob_digest_shape" CHECK ("bundle_sha256" ~ '^[0-9a-f]{64}$' AND "storage_locator" = 'ot-neutral-reports/sha256/' || "bundle_sha256" || '.json' AND "byte_size" BETWEEN 1 AND 64000000)
);
CREATE UNIQUE INDEX "ot_neutral_blob_attempt_number_key" ON "ot_neutral_blob_attempt"("reservation_id","attempt_number");
CREATE UNIQUE INDEX "ot_neutral_blob_identity_key" ON "ot_neutral_blob_attempt"("reservation_id","storage_locator","bundle_sha256");
CREATE INDEX "ot_neutral_blob_status_idx" ON "ot_neutral_blob_attempt"("status","created_at");
CREATE TABLE "ot_neutral_checkout_attempt" ("id" TEXT PRIMARY KEY,"reservation_id" TEXT NOT NULL,"order_id" TEXT NOT NULL,"checkout_key" TEXT NOT NULL,"idempotency_key" TEXT NOT NULL,"contract_sha256" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'INTENDED',"stripe_session_id" TEXT,"stripe_status" TEXT,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"observed_at" TIMESTAMPTZ(3),CONSTRAINT "ot_neutral_checkout_attempt_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION,CONSTRAINT "ot_neutral_checkout_attempt_hash" CHECK ("contract_sha256" ~ '^[0-9a-f]{64}$'));
CREATE UNIQUE INDEX "ot_neutral_checkout_attempt_idempotency" ON "ot_neutral_checkout_attempt"("idempotency_key");
CREATE INDEX "ot_neutral_checkout_attempt_status" ON "ot_neutral_checkout_attempt"("status","created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_runtime') THEN
    CREATE ROLE ot_neutral_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ot_neutral_runtime;
REVOKE CREATE ON SCHEMA public FROM ot_neutral_runtime;

ALTER TABLE "ot_neutral_report_reservation" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ot_neutral_report_reservation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_blob_attempt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ot_neutral_blob_attempt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_checkout_attempt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ot_neutral_checkout_attempt" FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON "ot_neutral_report_reservation","ot_neutral_blob_attempt","ot_neutral_checkout_attempt" TO ot_neutral_runtime;
CREATE POLICY "ot_neutral_runtime_reservations" ON "ot_neutral_report_reservation" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);
CREATE POLICY "ot_neutral_runtime_attempts" ON "ot_neutral_blob_attempt" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);
CREATE POLICY "ot_neutral_runtime_checkout_attempts" ON "ot_neutral_checkout_attempt" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);

-- ===========================================================================
-- 8. Neutral QA, customer ZIP, refund work, reversal guard.  (covers 20260915190000)
--
--    The new enum label is added here and is never USED in this transaction:
--    every policy, view and constraint that discriminates on it compares
--    `kind::text`, and the two trigger bodies that name it are plpgsql source,
--    parsed but not planned until they fire after commit.
-- ===========================================================================
ALTER TYPE "OTFulfillmentKind" ADD VALUE IF NOT EXISTS 'NEUTRAL_RECORDS_REPORT';

ALTER TABLE "ot_neutral_report_reservation"
  ADD COLUMN "customer_zip_sha256" TEXT,
  ADD COLUMN "customer_zip_byte_size" INTEGER,
  ADD COLUMN "customer_zip_locator" TEXT,
  ADD COLUMN "customer_zip_media_type" TEXT,
  ADD COLUMN "customer_zip_filename" TEXT,
  ADD CONSTRAINT "ot_neutral_customer_zip_complete" CHECK (
    ("customer_zip_sha256" IS NULL AND "customer_zip_byte_size" IS NULL AND "customer_zip_locator" IS NULL AND "customer_zip_media_type" IS NULL AND "customer_zip_filename" IS NULL)
    OR ("customer_zip_sha256" ~ '^[0-9a-f]{64}$' AND "customer_zip_byte_size" BETWEEN 1 AND 52428800 AND "customer_zip_locator" = 'ot-neutral-customer/sha256/' || "customer_zip_sha256" || '.zip' AND "customer_zip_media_type"='application/zip' AND "customer_zip_filename"='overtaxed-records-report.zip')
  );
CREATE UNIQUE INDEX "ot_neutral_report_reservation_customer_zip_sha256_key" ON "ot_neutral_report_reservation"("customer_zip_sha256");
CREATE UNIQUE INDEX "ot_neutral_report_reservation_customer_zip_locator_key" ON "ot_neutral_report_reservation"("customer_zip_locator");

CREATE TABLE "ot_neutral_customer_zip_attempt" (
 "id" TEXT PRIMARY KEY,"reservation_id" TEXT NOT NULL,"zip_sha256" TEXT NOT NULL,"byte_size" INTEGER NOT NULL,
 "storage_locator" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'INTENDED',"reason_code" TEXT,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"observed_at" TIMESTAMPTZ(3),
 CONSTRAINT "ot_neutral_customer_zip_attempt_reservation_fkey" FOREIGN KEY("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ot_neutral_customer_zip_attempt_identity" CHECK("zip_sha256" ~ '^[0-9a-f]{64}$' AND "byte_size" BETWEEN 1 AND 52428800 AND "storage_locator"='ot-neutral-customer/sha256/'||"zip_sha256"||'.zip'),
 CONSTRAINT "ot_neutral_customer_zip_attempt_status" CHECK("status" IN ('INTENDED','WRITE_CONFIRMED','WRITE_UNKNOWN','READ_CONFIRMED','PROMOTED','QUARANTINED')),
 UNIQUE("reservation_id","zip_sha256")
);
CREATE INDEX "ot_neutral_customer_zip_attempt_status_created_idx" ON "ot_neutral_customer_zip_attempt"("status","created_at");
ALTER TABLE "ot_neutral_customer_zip_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_customer_zip_attempt" FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE "ot_neutral_customer_zip_attempt" TO ot_neutral_runtime;
GRANT INSERT ("id","reservation_id","zip_sha256","byte_size","storage_locator","status") ON TABLE "ot_neutral_customer_zip_attempt" TO ot_neutral_runtime;
GRANT UPDATE ("status","reason_code","observed_at") ON TABLE "ot_neutral_customer_zip_attempt" TO ot_neutral_runtime;
CREATE POLICY "ot_neutral_customer_zip_attempt_runtime" ON "ot_neutral_customer_zip_attempt" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);

CREATE TYPE "OTNeutralQaStatus" AS ENUM (
  'PENDING','IN_REVIEW','APPROVED','REJECTED','HARD_STOP','REFUND_REQUIRED','HELD'
);
CREATE TABLE "ot_neutral_qa_review" (
  "id" TEXT PRIMARY KEY,
  "reservation_id" TEXT NOT NULL UNIQUE,
  "order_id" TEXT NOT NULL UNIQUE,
  "status" "OTNeutralQaStatus" NOT NULL DEFAULT 'PENDING',
  "reviewer_key" TEXT NOT NULL,
  "reviewer_week_start" DATE NOT NULL,
  "started_at" TIMESTAMPTZ(3),
  "decided_at" TIMESTAMPTZ(3),
  "minutes_spent" INTEGER,
  "reason_code" TEXT,
  "policy_version" TEXT NOT NULL,
  "artifact_sha256" TEXT NOT NULL,
  "customer_artifact_sha256" TEXT,
  "evidence_digest_sha256" TEXT NOT NULL,
  "payment_binding_sha256" TEXT NOT NULL,
  "property_binding_fingerprint" TEXT NOT NULL,
  "fulfillment_id" TEXT UNIQUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ot_neutral_qa_review_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_qa_review_order_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_qa_review_fulfillment_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "ot_fulfillment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_qa_review_minutes" CHECK ("minutes_spent" IS NULL OR "minutes_spent" BETWEEN 0 AND 20),
  CONSTRAINT "ot_neutral_qa_review_digests" CHECK (
    "artifact_sha256" ~ '^[0-9a-f]{64}$' AND
    ("customer_artifact_sha256" IS NULL OR "customer_artifact_sha256" ~ '^[0-9a-f]{64}$') AND
    "evidence_digest_sha256" ~ '^[0-9a-f]{64}$' AND
    "payment_binding_sha256" ~ '^[0-9a-f]{64}$' AND
    "property_binding_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ot_neutral_qa_review_decision_complete" CHECK (
    ("status" IN ('PENDING','IN_REVIEW') AND "decided_at" IS NULL)
    OR ("status" NOT IN ('PENDING','IN_REVIEW') AND "decided_at" IS NOT NULL AND "reason_code" IS NOT NULL)
  ),
  CONSTRAINT "ot_neutral_qa_review_approval_minutes" CHECK (
    "status" IN ('PENDING','IN_REVIEW') OR ("minutes_spent" IS NOT NULL AND "minutes_spent" BETWEEN 1 AND 20)
  ),
  CONSTRAINT "ot_neutral_qa_review_reason_semantics" CHECK (
    ("status" IN ('PENDING','IN_REVIEW') AND "reason_code" IS NULL)
    OR ("status"='APPROVED' AND "reason_code"='QA_PASSED')
    OR ("status"='REJECTED' AND "reason_code"='ARTIFACT_DEFECT')
    OR ("status"='REFUND_REQUIRED' AND "reason_code" IN ('REPORT_INCOMPLETE','SOURCE_EVIDENCE_UNAVAILABLE','HARD_STOP_EXCEEDED'))
    OR ("status"='HARD_STOP' AND "reason_code"='HARD_STOP_EXCEEDED')
    OR ("status"='HELD' AND "reason_code" IN ('PAYMENT_REVERSED','SUPERSEDED','DISPUTED','OPERATOR_HOLD'))
  )
);
CREATE INDEX "ot_neutral_qa_review_reviewer_week_status_idx" ON "ot_neutral_qa_review"("reviewer_key","reviewer_week_start","status");
CREATE INDEX "ot_neutral_qa_review_status_updated_idx" ON "ot_neutral_qa_review"("status","updated_at");
ALTER TABLE "ot_neutral_qa_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_qa_review" FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE "ot_neutral_qa_review" TO ot_neutral_runtime;
GRANT INSERT ("id","reservation_id","order_id","status","reviewer_key","reviewer_week_start","started_at","policy_version","artifact_sha256","evidence_digest_sha256","payment_binding_sha256","property_binding_fingerprint","updated_at") ON TABLE "ot_neutral_qa_review" TO ot_neutral_runtime;
GRANT UPDATE ("status","minutes_spent","reason_code","decided_at","fulfillment_id","customer_artifact_sha256","updated_at") ON TABLE "ot_neutral_qa_review" TO ot_neutral_runtime;
CREATE POLICY "ot_neutral_qa_review_runtime" ON "ot_neutral_qa_review" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);
GRANT SELECT ("id","order_id","kind","status","attempt_count") ON TABLE "ot_fulfillment" TO ot_neutral_runtime;
GRANT INSERT ("id","order_id","kind","status","updated_at") ON TABLE "ot_fulfillment" TO ot_neutral_runtime;
GRANT SELECT ("fulfillment_id","version","artifact_sha256","byte_size","storage_locator","generator_version","template_version","source_order_id","property_binding_fingerprint") ON TABLE "ot_fulfillment_artifact" TO ot_neutral_runtime;
GRANT INSERT ("id","fulfillment_id","version","artifact_sha256","byte_size","storage_locator","generator_version","template_version","generated_at","source_order_id","property_binding_fingerprint") ON TABLE "ot_fulfillment_artifact" TO ot_neutral_runtime;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_app_reader') THEN
    CREATE ROLE ot_neutral_app_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ot_neutral_app_reader;
REVOKE CREATE ON SCHEMA public FROM ot_neutral_app_reader;
GRANT SELECT ("id","order_id","status","bundle_sha256","policy_version","property_fingerprint","superseded_by_sha256","customer_zip_sha256","customer_zip_byte_size","customer_zip_locator","customer_zip_media_type","customer_zip_filename") ON TABLE "ot_neutral_report_reservation" TO ot_neutral_app_reader;
GRANT SELECT ("reservation_id","order_id","status","policy_version","artifact_sha256","customer_artifact_sha256","property_binding_fingerprint","fulfillment_id") ON TABLE "ot_neutral_qa_review" TO ot_neutral_app_reader;
CREATE POLICY "ot_neutral_report_reservation_app_read" ON "ot_neutral_report_reservation" FOR SELECT TO ot_neutral_app_reader USING (true);
CREATE POLICY "ot_neutral_qa_review_app_read" ON "ot_neutral_qa_review" FOR SELECT TO ot_neutral_app_reader USING (true);

CREATE TYPE "OTNeutralRefundStatus" AS ENUM ('REFUND_REQUIRED','REFUND_CLAIMED','RECEIPT_RECORDED_PENDING_VERIFICATION','RECEIPT_VERIFICATION_HELD','REFUND_CONFIRMED');
CREATE TABLE "ot_neutral_refund_work" (
  "id" TEXT PRIMARY KEY,
  "qa_review_id" TEXT NOT NULL UNIQUE REFERENCES "ot_neutral_qa_review"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  "order_id" TEXT NOT NULL UNIQUE REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  "status" "OTNeutralRefundStatus" NOT NULL DEFAULT 'REFUND_REQUIRED',
  "reason_code" TEXT NOT NULL CHECK ("reason_code" IN ('REPORT_INCOMPLETE','SOURCE_EVIDENCE_UNAVAILABLE','HARD_STOP_EXCEEDED')),
  "payment_binding_sha256" TEXT NOT NULL CHECK ("payment_binding_sha256" ~ '^[0-9a-f]{64}$'),
  "artifact_sha256" TEXT NOT NULL CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$'),
  "claimed_by" TEXT,"claimed_at" TIMESTAMPTZ(3),"provider_attempt_key" TEXT UNIQUE,
  "provider_receipt_id" TEXT UNIQUE,"provider_receipt_sha256" TEXT UNIQUE,
  "verification_reason" TEXT,"verified_at" TIMESTAMPTZ(3),
  "confirmed_by" TEXT,"confirmed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ot_neutral_refund_work_state" CHECK (
    ("status"='REFUND_REQUIRED' AND "claimed_by" IS NULL AND "claimed_at" IS NULL AND "provider_receipt_id" IS NULL AND "provider_receipt_sha256" IS NULL AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND "verification_reason" IS NULL AND "verified_at" IS NULL)
    OR ("status"='REFUND_CLAIMED' AND "claimed_by" IS NOT NULL AND "claimed_at" IS NOT NULL AND "provider_attempt_key" ~ '^[0-9a-f-]{36}$' AND "provider_receipt_id" IS NULL AND "provider_receipt_sha256" IS NULL AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND "verification_reason" IS NULL AND "verified_at" IS NULL)
    OR ("status" IN ('RECEIPT_RECORDED_PENDING_VERIFICATION','RECEIPT_VERIFICATION_HELD') AND "claimed_by" IS NOT NULL AND "provider_receipt_id" ~ '^re_[A-Za-z0-9]{8,64}$' AND "provider_receipt_sha256" ~ '^[0-9a-f]{64}$' AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND (("status"='RECEIPT_RECORDED_PENDING_VERIFICATION' AND "verification_reason" IS NULL) OR ("status"='RECEIPT_VERIFICATION_HELD' AND "verification_reason" IS NOT NULL)))
    OR ("status"='REFUND_CONFIRMED' AND "claimed_by" IS NOT NULL AND "claimed_at" IS NOT NULL AND "provider_attempt_key" ~ '^[0-9a-f-]{36}$' AND "provider_receipt_id" ~ '^re_[A-Za-z0-9]{8,64}$' AND "provider_receipt_sha256" ~ '^[0-9a-f]{64}$' AND "confirmed_by" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "verification_reason" IS NULL AND "verified_at" IS NOT NULL)
  )
);
CREATE INDEX "ot_neutral_refund_work_status_created_idx" ON "ot_neutral_refund_work"("status","created_at");
ALTER TABLE "ot_neutral_refund_work" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_refund_work" FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE "ot_neutral_refund_work" TO ot_neutral_runtime;
GRANT INSERT ("id","qa_review_id","order_id","status","reason_code","payment_binding_sha256","artifact_sha256","updated_at") ON TABLE "ot_neutral_refund_work" TO ot_neutral_runtime;
GRANT UPDATE ("status","claimed_by","claimed_at","provider_attempt_key","provider_receipt_id","provider_receipt_sha256","verification_reason","verified_at","confirmed_by","confirmed_at","updated_at") ON TABLE "ot_neutral_refund_work" TO ot_neutral_runtime;
CREATE POLICY "ot_neutral_refund_work_runtime" ON "ot_neutral_refund_work" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);

-- The reversal guard's entire grant surface. Four of these six are
-- column-scoped; the fifth is NOT, and saying so here is the point.
--
-- `GRANT SELECT, UPDATE (cols)` binds the column list to UPDATE ONLY. The
-- SELECT in that statement is TABLE-WIDE: ot_neutral_reversal_guard_owner can
-- read every column of ot_neutral_qa_review, including the four digest columns
-- (`artifact_sha256`, `customer_artifact_sha256`, `evidence_digest_sha256`,
-- `payment_binding_sha256`) and `reviewer_key`. The statement reads as though
-- the list governed both, which is exactly why it is spelled out rather than
-- left to a reader to parse.
--
-- It is kept, and it is kept for one reason: this is byte-for-byte the grant
-- 20260915190000 issues, and this file's whole contract is that it materializes
-- the end state of the chain it replaces. Preview applied that chain and holds
-- the table-wide SELECT today; narrowing it here would make the Production ACL
-- diverge from the Preview ACL that every acceptance run was measured against,
-- and an undocumented privilege difference between the two environments is a
-- worse outcome than a wide read held by a NOLOGIN role that nothing can log in
-- as and that is reachable only through one SECURITY DEFINER trigger.
--
-- The trigger body itself needs only `order_id`, `status` and `minutes_spent`.
-- 03_postconditions.sql pins the EXACT scope in both directions — the three
-- columns the hold depends on, the table-wide SELECT as the deliberate fact it
-- is, and the absence of any UPDATE outside the five listed columns — so this
-- grant cannot widen further or silently narrow without a failure.
GRANT SELECT ("order_id","payment_intent") ON "ot_payment_binding" TO ot_neutral_reversal_guard_owner;
GRANT SELECT ("id","order_id","kind") ON "ot_fulfillment" TO ot_neutral_reversal_guard_owner;
GRANT SELECT ("payment_intent") ON "ot_settlement_reversal" TO ot_neutral_reversal_guard_owner;
GRANT SELECT,UPDATE ("status","minutes_spent","reason_code","decided_at","updated_at") ON "ot_neutral_qa_review" TO ot_neutral_reversal_guard_owner;
GRANT SELECT ("fulfillment_id","revoked_at") ON "ot_packet_download_capability" TO ot_neutral_reversal_guard_owner;
GRANT UPDATE ("revoked_at","revoked_reason_code") ON "ot_packet_download_capability" TO ot_neutral_reversal_guard_owner;
CREATE POLICY "ot_neutral_reversal_guard_qa" ON "ot_neutral_qa_review" FOR UPDATE TO ot_neutral_reversal_guard_owner USING (true) WITH CHECK (true);
CREATE POLICY "ot_neutral_reversal_guard_qa_read" ON "ot_neutral_qa_review" FOR SELECT TO ot_neutral_reversal_guard_owner USING (true);
CREATE POLICY "ot_neutral_reversal_guard_payment_read" ON "ot_payment_binding" FOR SELECT TO ot_neutral_reversal_guard_owner USING (true);
CREATE POLICY "ot_neutral_reversal_guard_reversal_read" ON "ot_settlement_reversal" FOR SELECT TO ot_neutral_reversal_guard_owner USING (true);
CREATE POLICY "ot_neutral_reversal_guard_capability_read" ON "ot_packet_download_capability" FOR SELECT TO ot_neutral_reversal_guard_owner
USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f JOIN "ot_payment_binding" b ON b."order_id"=f."order_id" JOIN "ot_settlement_reversal" x ON x."payment_intent"=b."payment_intent" WHERE f."id"="ot_packet_download_capability"."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_reversal_guard_capability_update" ON "ot_packet_download_capability" FOR UPDATE TO ot_neutral_reversal_guard_owner
USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f JOIN "ot_payment_binding" b ON b."order_id"=f."order_id" JOIN "ot_settlement_reversal" x ON x."payment_intent"=b."payment_intent" WHERE f."id"="ot_packet_download_capability"."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'))
WITH CHECK (EXISTS (SELECT 1 FROM "ot_fulfillment" f JOIN "ot_payment_binding" b ON b."order_id"=f."order_id" JOIN "ot_settlement_reversal" x ON x."payment_intent"=b."payment_intent" WHERE f."id"="ot_packet_download_capability"."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));

CREATE OR REPLACE FUNCTION ot_neutral_hold_on_settlement_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
END $$;
CREATE TRIGGER ot_neutral_hold_on_reversal AFTER INSERT ON "ot_settlement_reversal"
FOR EACH ROW EXECUTE FUNCTION ot_neutral_hold_on_settlement_reversal();
-- Same borrow/transfer/return shape as the capture owner, and for the same
-- reason the PUBLIC revoke is issued INSIDE it: once the function belongs to
-- ot_neutral_reversal_guard_owner, a revoke from the migration role would
-- revoke nothing and leave this SECURITY DEFINER function executable by PUBLIC.
DO $$
DECLARE
  target CONSTANT TEXT := 'ot_neutral_reversal_guard_owner';
  borrowed BOOLEAN := false;
  had_edge BOOLEAN := false;
  original_inherit BOOLEAN;
  original_set BOOLEAN;
  final_inherit BOOLEAN;
  final_set BOOLEAN;
  migration_role TEXT := current_user;
  api_role TEXT;
BEGIN
  SELECT true, m.inherit_option, m.set_option
    INTO had_edge, original_inherit, original_set
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member_role ON member_role.oid = m.member
  WHERE granted.rolname = target AND member_role.rolname = migration_role;
  had_edge := COALESCE(had_edge, false);

  IF NOT pg_has_role(migration_role, target, 'SET') THEN
    EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE', target, migration_role);
    borrowed := true;
  END IF;
  GRANT CREATE ON SCHEMA public TO ot_neutral_reversal_guard_owner;
  ALTER FUNCTION ot_neutral_hold_on_settlement_reversal() OWNER TO ot_neutral_reversal_guard_owner;
  REVOKE CREATE ON SCHEMA public FROM ot_neutral_reversal_guard_owner;
  EXECUTE 'SET LOCAL ROLE ot_neutral_reversal_guard_owner';
  EXECUTE 'REVOKE ALL ON FUNCTION public.ot_neutral_hold_on_settlement_reversal() FROM PUBLIC';
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.ot_neutral_hold_on_settlement_reversal() FROM %I', api_role);
    END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';

  IF borrowed THEN
    IF had_edge THEN
      EXECUTE format('GRANT %I TO %I WITH INHERIT %s, SET %s', target, migration_role,
        CASE WHEN original_inherit THEN 'TRUE' ELSE 'FALSE' END,
        CASE WHEN original_set THEN 'TRUE' ELSE 'FALSE' END);
    ELSE
      EXECUTE format('REVOKE %I FROM %I', target, migration_role);
    END IF;

    IF NOT COALESCE(original_set, false)
      AND pg_has_role(migration_role, target, 'SET') THEN
      RAISE EXCEPTION 'temporary SET privilege for % was not returned', target;
    END IF;
    IF NOT COALESCE(original_inherit, false)
      AND pg_has_role(migration_role, target, 'USAGE') THEN
      RAISE EXCEPTION 'temporary INHERIT privilege for % was not returned', target;
    END IF;
  END IF;

  SELECT m.inherit_option, m.set_option INTO final_inherit, final_set
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member_role ON member_role.oid = m.member
  WHERE granted.rolname = target AND member_role.rolname = migration_role;

  IF had_edge THEN
    IF final_inherit IS DISTINCT FROM original_inherit
      OR final_set IS DISTINCT FROM original_set THEN
      RAISE EXCEPTION
        'membership edge for % was not restored to its original shape (inherit %/%, set %/%)',
        target, original_inherit, final_inherit, original_set, final_set;
    END IF;
  ELSIF final_inherit IS NOT NULL OR final_set IS NOT NULL THEN
    RAISE EXCEPTION 'a membership edge for % survived that did not exist before', target;
  END IF;
END $$;

-- ===========================================================================
-- 9. Neutral delivery runtime.  (covers 20260915220000)
-- ===========================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_delivery_runtime') THEN
    CREATE ROLE ot_neutral_delivery_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ot_neutral_delivery_runtime;
REVOKE CREATE ON SCHEMA public FROM ot_neutral_delivery_runtime;
REVOKE ALL ON "ot_order","ot_payment_binding","ot_settlement_reversal" FROM ot_neutral_delivery_runtime;
GRANT SELECT ("id","order_id","kind","status","status_revision","attempt_count") ON "ot_fulfillment" TO ot_neutral_delivery_runtime;
GRANT SELECT ("id","fulfillment_id","version","artifact_sha256","byte_size","storage_locator","template_version","source_order_id","property_binding_fingerprint") ON "ot_fulfillment_artifact" TO ot_neutral_delivery_runtime;
GRANT SELECT ("fulfillment_id","attempt_number","provider","idempotency_key","download_capability_id") ON "ot_delivery_attempt" TO ot_neutral_delivery_runtime;
GRANT UPDATE ("download_capability_id") ON "ot_delivery_attempt" TO ot_neutral_delivery_runtime;
GRANT SELECT ("id","capability_hash","fulfillment_id","artifact_id","artifact_version","artifact_sha256","source_order_id","property_binding_fingerprint","expires_at","max_uses","use_count","revoked_at") ON "ot_packet_download_capability" TO ot_neutral_delivery_runtime;
GRANT INSERT ("id","capability_hash","fulfillment_id","artifact_id","artifact_version","artifact_sha256","source_order_id","property_binding_fingerprint","issued_at","expires_at","max_uses","use_count") ON "ot_packet_download_capability" TO ot_neutral_delivery_runtime;
GRANT UPDATE ("use_count","last_used_at","revoked_at","revoked_reason_code") ON "ot_packet_download_capability" TO ot_neutral_delivery_runtime;
GRANT SELECT ("id","order_id","status","bundle_sha256","policy_version","property_fingerprint","superseded_by_sha256") ON "ot_neutral_report_reservation" TO ot_neutral_delivery_runtime;
GRANT SELECT ("reservation_id","order_id","status","policy_version","artifact_sha256","customer_artifact_sha256","property_binding_fingerprint","fulfillment_id") ON "ot_neutral_qa_review" TO ot_neutral_delivery_runtime;

ALTER TABLE "ot_delivery_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_fulfillment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_fulfillment_artifact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ot_neutral_runtime_fulfillment_all" ON "ot_fulfillment" FOR ALL TO ot_neutral_runtime USING ("kind"::text='NEUTRAL_RECORDS_REPORT') WITH CHECK ("kind"::text='NEUTRAL_RECORDS_REPORT');
CREATE POLICY "ot_neutral_runtime_artifact_all" ON "ot_fulfillment_artifact" FOR ALL TO ot_neutral_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT')) WITH CHECK (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_reversal_guard_fulfillment_read" ON "ot_fulfillment" FOR SELECT TO ot_neutral_reversal_guard_owner USING ("kind"::text='NEUTRAL_RECORDS_REPORT');
CREATE POLICY "ot_neutral_delivery_fulfillment_read" ON "ot_fulfillment" FOR SELECT TO ot_neutral_delivery_runtime USING ("kind"::text='NEUTRAL_RECORDS_REPORT');
CREATE POLICY "ot_neutral_delivery_artifact_read" ON "ot_fulfillment_artifact" FOR SELECT TO ot_neutral_delivery_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_delivery_attempt_read" ON "ot_delivery_attempt" FOR SELECT TO ot_neutral_delivery_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_delivery_attempt_update" ON "ot_delivery_attempt" FOR UPDATE TO ot_neutral_delivery_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT')) WITH CHECK (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_delivery_capability_all" ON "ot_packet_download_capability" FOR ALL TO ot_neutral_delivery_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT')) WITH CHECK (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_delivery_reservation_read" ON "ot_neutral_report_reservation" FOR SELECT TO ot_neutral_delivery_runtime USING (true);
CREATE POLICY "ot_neutral_delivery_qa_read" ON "ot_neutral_qa_review" FOR SELECT TO ot_neutral_delivery_runtime USING (true);

CREATE VIEW "ot_neutral_delivery_order" WITH (security_barrier=true) AS
SELECT DISTINCT o."id",o."tier",o."status",o."propertyPin",o."propertyAddress",o."email",
  EXISTS (SELECT 1 FROM "ot_payment_binding" b WHERE b."order_id"=o."id" AND b."session_id"=o."stripeSessionId" AND b."payment_intent" LIKE 'pi_%' AND NOT EXISTS (SELECT 1 FROM "ot_settlement_reversal" x WHERE x."payment_intent"=b."payment_intent")) AS "paymentAuthoritative"
FROM "ot_order" o JOIN "ot_fulfillment" f ON f."order_id"=o."id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'
JOIN "ot_neutral_report_reservation" r ON r."order_id"=o."id";
GRANT SELECT ON "ot_neutral_delivery_order" TO ot_neutral_delivery_runtime;
CREATE VIEW "ot_fulfillment_kind_authority" WITH (security_barrier=true) AS SELECT "id","kind"::text "kind" FROM "ot_fulfillment";
CREATE VIEW "ot_packet_capability_kind_authority" WITH (security_barrier=true) AS SELECT c."capability_hash",f."kind"::text "kind" FROM "ot_packet_download_capability" c JOIN "ot_fulfillment" f ON f."id"=c."fulfillment_id";
GRANT SELECT ON "ot_fulfillment_kind_authority","ot_packet_capability_kind_authority" TO ot_neutral_app_reader;

CREATE FUNCTION ot_enforce_neutral_capability_single_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "ot_fulfillment" f WHERE f."id"=NEW."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT') AND NEW."max_uses"<>1 THEN RAISE EXCEPTION 'neutral capability must be single-use'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ot_neutral_capability_single_use BEFORE INSERT OR UPDATE OF "max_uses","fulfillment_id" ON "ot_packet_download_capability" FOR EACH ROW EXECUTE FUNCTION ot_enforce_neutral_capability_single_use();

-- ===========================================================================
-- 10. Constrained runtime commerce reads.  (covers 20260915230000)
-- ===========================================================================
CREATE VIEW "ot_neutral_runtime_order"
WITH (security_barrier = true) AS
SELECT o."id", o."tier", o."propertyPin", o."status", o."stripeSessionId",
       o."checkoutPriceId", o."checkoutProductId", o."checkoutAmountCents",
       o."checkoutCurrency", o."settledAmountCents", o."settledCurrency",
       o."amountPaid", o."eligibilitySnapshot"
FROM "ot_order" o
WHERE o."eligibilitySnapshot"->>'policyVersion' = 'ot-neutral-records-report/2026-09-15'
   OR EXISTS (
     SELECT 1 FROM "ot_neutral_report_reservation" r WHERE r."order_id" = o."id"
   );
CREATE VIEW "ot_neutral_runtime_payment_binding"
WITH (security_barrier = true) AS
SELECT b."order_id", b."session_id", b."payment_intent"
FROM "ot_payment_binding" b
JOIN "ot_neutral_report_reservation" r ON r."order_id" = b."order_id";
CREATE VIEW "ot_neutral_runtime_settlement_reversal"
WITH (security_barrier = true) AS
SELECT x."payment_intent"
FROM "ot_settlement_reversal" x
WHERE EXISTS (
  SELECT 1
  FROM "ot_neutral_runtime_payment_binding" b
  WHERE b."payment_intent" = x."payment_intent"
);
REVOKE ALL ON TABLE "ot_order", "ot_payment_binding", "ot_settlement_reversal" FROM ot_neutral_runtime;
GRANT SELECT ON TABLE "ot_neutral_runtime_order",
  "ot_neutral_runtime_payment_binding",
  "ot_neutral_runtime_settlement_reversal" TO ot_neutral_runtime;

ALTER TABLE "ot_neutral_refund_work"
  ADD COLUMN "provider_lookup_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_provider_lookup_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_provider_lookup_result" TEXT,
  ADD CONSTRAINT "ot_neutral_refund_lookup_audit_shape" CHECK (
    "provider_lookup_attempts" >= 0
    AND (("provider_lookup_attempts" = 0 AND "last_provider_lookup_at" IS NULL AND "last_provider_lookup_result" IS NULL)
      OR ("provider_lookup_attempts" > 0 AND "last_provider_lookup_at" IS NOT NULL AND "last_provider_lookup_result" IN ('RETRYABLE_PROVIDER_FAILURE','PROVIDER_RESPONSE_RECEIVED')))
  );
GRANT UPDATE ("provider_lookup_attempts","last_provider_lookup_at","last_provider_lookup_result","updated_at")
  ON TABLE "ot_neutral_refund_work" TO ot_neutral_runtime;

-- ===========================================================================
-- 11. Production login -> functional role bindings.
--
--     WHY THE BASELINE OWNS THE EDGE AND NOT THE LOGIN
--
--     The three restricted logins are a PROVISIONING prerequisite: they are
--     minted through the protected Supabase Management API flow and never by
--     anything in this repository, because creating a login means choosing a
--     password and a migration that can mint a Production credential can mint a
--     back door.
--
--     The membership edge is a different kind of object. It is not a
--     credential, it is a privilege statement about two roles that already
--     exist, and it is exactly the sort of thing 03_postconditions.sql can
--     prove. Leaving it to the same out-of-band flow meant the apply's own
--     binding proof could only ever confirm something nobody in this
--     transaction had written — a check that passes because an operator did the
--     right thing by hand is not a check, it is a hope. So: the logins are
--     somebody else's to create, the three edges are ours to create, and each
--     half is proved by whoever owns it.
--
--     EXACTLY THREE EDGES, AND AN EDGE IS A CATALOG ROW
--
--     "Exactly this edge and no other" is not provable by adding one. It is
--     only provable by refusing while another exists, so every pre-existing
--     membership on any of the three logins ABORTS the transaction and names
--     itself. The same goes for a login that is absent, that carries ambient
--     authority, that cannot inherit (the grants below are
--     `INHERIT TRUE, SET FALSE`, so inheritance is the only path to the
--     functional role), or that holds a direct CREATE on schema public.
--
--     The pre-existing check used to exclude the designed functional role from
--     what it looked at — it asked only for memberships `<> functional` — and
--     that exclusion was a bypass. `pg_auth_members` is keyed on (roleid,
--     member, GRANTOR), so a platform operator can record
--     `GRANT ot_neutral_app_reader TO ot_prod_app WITH SET TRUE` and the
--     baseline can then record its own `INHERIT TRUE, SET FALSE` edge for the
--     same pair. Two rows, unioned privileges, and every check phrased as "an
--     edge with the right shape EXISTS" passes while the login can SET ROLE to
--     its functional role and shed the identity the audit trail is keyed on.
--
--     So: ANY pre-existing edge on any of the three logins is refused,
--     including one to the role this section is about to grant. After the
--     grant, the end state is MEASURED rather than assumed — exactly one edge
--     on the login in total, exactly `ADMIN FALSE, INHERIT TRUE, SET FALSE`,
--     and `pg_has_role(login, functional, 'SET')` false.
--
--     Nothing here is repaired in place. A login that is wrong is a
--     provisioning decision made outside this rollout, and a baseline is
--     exactly the wrong place to quietly correct one.
-- ===========================================================================
DO $$
DECLARE
  binding RECORD;
  extra TEXT[];
  edge_total INTEGER;
  edge_exact INTEGER;
BEGIN
  FOR binding IN
    SELECT * FROM (VALUES
      ('ot_prod_app', 'ot_neutral_app_reader'),
      ('ot_prod_neutral_runtime', 'ot_neutral_runtime'),
      ('ot_prod_neutral_delivery', 'ot_neutral_delivery_runtime')
    ) AS t(login, functional)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = binding.login) THEN
      RAISE EXCEPTION
        'Production login % does not exist; the three restricted logins are a provisioning prerequisite this baseline binds but never creates',
        binding.login;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = binding.login
        AND rolcanlogin AND rolinherit
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
        AND NOT rolreplication AND NOT rolbypassrls
    ) THEN
      RAISE EXCEPTION
        'Production login % is not a pristine restricted login: it must be able to log in and to inherit, and must hold no superuser, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION authority',
        binding.login;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
      JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public' AND r.rolname = binding.login
        AND acl.privilege_type = 'CREATE'
    ) THEN
      RAISE EXCEPTION
        'Production login % holds a direct CREATE on schema public', binding.login;
    END IF;

    -- EVERY edge, including one to `binding.functional` itself. A second
    -- grantor's edge on the designed pair is precisely the bypass described in
    -- the header, and excluding the designed role from this query is what used
    -- to let it through.
    SELECT array_agg(
             granted.rolname || ' (granted by ' || grantor.rolname
               || ', inherit=' || m.inherit_option::text
               || ', set=' || m.set_option::text
               || ', admin=' || m.admin_option::text || ')'
             ORDER BY granted.rolname, grantor.rolname) INTO extra
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles grantor ON grantor.oid = m.grantor
    WHERE member_role.rolname = binding.login;
    IF extra IS NOT NULL THEN
      RAISE EXCEPTION
        'Production login % already reaches role(s) this rollout did not design: %',
        binding.login, array_to_string(extra, ', ');
    END IF;

    -- A CREATEROLE connection may only grant a role it holds ADMIN on. It holds
    -- ADMIN on every role it created moments ago; a functional role adopted from
    -- a platform operator is the case that can fail, and saying so beats a bare
    -- "must have admin option on role" from the GRANT itself.
    IF NOT EXISTS (
      SELECT 1 FROM pg_auth_members m
      JOIN pg_roles granted ON granted.oid = m.roleid
      JOIN pg_roles member_role ON member_role.oid = m.member
      WHERE granted.rolname = binding.functional
        AND member_role.rolname = current_user
        AND m.admin_option
    ) THEN
      RAISE EXCEPTION
        'the migration role holds no ADMIN on % and therefore cannot bind % to it',
        binding.functional, binding.login;
    END IF;

    -- SET FALSE on purpose: the login reaches its functional role's privileges
    -- by inheritance and cannot SET ROLE to it, so there is no way to shed the
    -- login identity the audit trail is keyed on.
    EXECUTE format(
      'GRANT %I TO %I WITH ADMIN FALSE, INHERIT TRUE, SET FALSE',
      binding.functional, binding.login);

    -- The end state, measured. Counts rather than EXISTS, because the whole
    -- defect this replaces was an EXISTS that a second grantor's edge could
    -- satisfy alongside a SET-carrying one.
    SELECT count(*) INTO edge_total
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname = binding.login;

    SELECT count(*) INTO edge_exact
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname = binding.login
      AND granted.rolname = binding.functional
      AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option;

    IF edge_total <> 1 OR edge_exact <> 1 THEN
      RAISE EXCEPTION
        'Production login % did not end with exactly one ADMIN FALSE, INHERIT TRUE, SET FALSE edge to % (total edges %, exact edges %)',
        binding.login, binding.functional, edge_total, edge_exact;
    END IF;

    -- And the consequence that actually matters, asked of the server rather
    -- than inferred from the options: no SET ROLE path exists.
    IF pg_has_role(binding.login, binding.functional, 'SET') THEN
      RAISE EXCEPTION
        'Production login % can SET ROLE to %; the binding must be reachable by inheritance only',
        binding.login, binding.functional;
    END IF;
  END LOOP;
END $$;

-- ===========================================================================
-- 12. Exposure control.  (REPLACES the material effects of 20260916120000 and
--     20260916220000, and carries 20260916121000's schema-CREATE strip, which
--     is already applied above at each role's creation.)
--
--     Supabase's default privileges grant the PostgREST API roles broad access
--     to every new relation in `public`. Every relation this file created is
--     closed to PUBLIC and to all three API roles — not the three the Preview
--     reconciliation happened to touch.
-- ===========================================================================
DO $$
DECLARE
  target TEXT;
  api_role TEXT;
  targets TEXT[] := ARRAY[
    'ot_payment_binding','ot_settlement_reversal','ot_order_attribution',
    'ot_packet_download_capability','ot_artifact_orphan_quarantine',
    'ot_delivery_provider_callback',
    'ot_neutral_report_reservation','ot_neutral_blob_attempt','ot_neutral_checkout_attempt',
    'ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work',
    'ot_neutral_delivery_order','ot_fulfillment_kind_authority','ot_packet_capability_kind_authority',
    'ot_neutral_runtime_order','ot_neutral_runtime_payment_binding','ot_neutral_runtime_settlement_reversal'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', target);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', target, api_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- pg_stat_statements exposes every statement text the database has executed to
-- anyone who can connect, including the restricted neutral logins. It is closed
-- here WITHOUT reference to `public.rls_auto_enable()`, which does not exist in
-- this deployment and whose mandatory presence is what made 20260916220000
-- abort before its first statement.
--
-- The revoke runs as the exact view owner. On the verified Production topology
-- that owner IS `postgres`; the SET LOCAL ROLE path exists for a Supabase-managed
-- owner and refuses rather than guesses when the role cannot be assumed.
--
-- The guard asks for 'SET', not 'MEMBER'. Since PostgreSQL 16 those are separate
-- privileges on a membership edge: 'MEMBER' means the membership exists at all,
-- 'SET' means `SET ROLE` to it is permitted. A role holding MEMBER without SET
-- passes a 'MEMBER' check and then fails on the very next statement, which turns
-- a designed refusal with a readable message into a raw permission error partway
-- through a transaction. This is precisely the topology a non-superuser
-- CREATEROLE connection produces, so it is not a hypothetical.
DO $$
DECLARE
  stats_owner NAME;
  info_owner NAME;
BEGIN
  IF to_regclass('extensions.pg_stat_statements') IS NULL
    OR to_regclass('extensions.pg_stat_statements_info') IS NULL
  THEN
    RAISE EXCEPTION 'OT Supabase statistics-view topology is invalid';
  END IF;
  SELECT pg_get_userbyid(relowner) INTO STRICT stats_owner
  FROM pg_class WHERE oid = 'extensions.pg_stat_statements'::regclass;
  SELECT pg_get_userbyid(relowner) INTO STRICT info_owner
  FROM pg_class WHERE oid = 'extensions.pg_stat_statements_info'::regclass;
  IF stats_owner <> info_owner THEN
    RAISE EXCEPTION 'OT Supabase statistics views have different owners';
  END IF;
  IF stats_owner <> current_user THEN
    IF NOT pg_has_role(current_user, stats_owner, 'SET') THEN
      RAISE EXCEPTION 'OT migration role cannot SET ROLE to statistics-view owner %', stats_owner;
    END IF;
    EXECUTE format('SET LOCAL ROLE %I', stats_owner);
  END IF;
  EXECUTE 'REVOKE ALL ON TABLE extensions.pg_stat_statements, extensions.pg_stat_statements_info FROM PUBLIC';
  EXECUTE 'RESET ROLE';
END $$;

ALTER TABLE public."ot_packet_download_capability" FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- 13. Zero rows written, anywhere.
--
-- "Additive, backfills nothing" is a claim, so it is proved rather than
-- asserted. It is proved in two pieces, because the two pieces say different
-- things and only one of them used to be here:
--
--   13a. This transaction inserted, updated and deleted ZERO rows in EVERY
--        table in schema `public` — the fourteen relations this file creates
--        and, far more importantly, the pre-existing application tables it does
--        not: `ot_order`, `ot_fulfillment`, `ot_fulfillment_artifact`,
--        `ot_delivery_attempt`, `ot_fulfillment_admin_event` and every other
--        one. Counting rows in newly created tables could only ever prove
--        something about tables that were empty by construction; the claim
--        operators actually need is about the tables that were NOT.
--
--        `pg_stat_xact_all_tables` reports the current transaction's own
--        tuple counters. It is the right instrument precisely because it reads
--        no customer data at all: the proof is three integers per relation, and
--        not one column value of one row is selected to obtain them. A counter
--        that is only trustworthy when the server is collecting it, so
--        `track_counts` is required to be on rather than assumed — an
--        unsatisfiable proof must fail, not pass quietly.
--
--        What it does NOT cover, stated rather than implied: TRUNCATE has no
--        tuple counter, so 13a cannot see one. 13b covers the relations this
--        file created, and 03_postconditions.sql proves every pre-existing
--        relation still exists with its constraints, indexes, triggers and
--        policies intact — a truncated application table would still pass both,
--        and the honest statement of this section's guarantee is therefore
--        "no row was inserted, updated or deleted", not "nothing was removed".
--        No statement in this file is a TRUNCATE, and the file is pinned by
--        checksum, which is where that gap is actually closed.
--
--   13b. Every relation this file created is empty at the end of the same
--        transaction that created it.
--
-- Both live in the body and not in the postconditions because emptiness and
-- "this transaction wrote nothing" are properties of a FRESH apply — a replay
-- against a database that has since been used must not be required to be empty.
-- ===========================================================================
DO $$
DECLARE
  offender RECORD;
  written TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF coalesce(current_setting('track_counts', true), 'off') <> 'on' THEN
    RAISE EXCEPTION
      'OT Production baseline cannot prove it wrote no application rows: track_counts is not on';
  END IF;
  FOR offender IN
    SELECT s.relname,
      s.n_tup_ins - coalesce(b.n_tup_ins, 0) AS n_tup_ins,
      s.n_tup_upd - coalesce(b.n_tup_upd, 0) AS n_tup_upd,
      s.n_tup_del - coalesce(b.n_tup_del, 0) AS n_tup_del
    FROM pg_stat_xact_all_tables s
    LEFT JOIN pg_temp.ot_neutral_baseline_write_snapshot b USING (relid)
    WHERE s.schemaname = 'public'
      AND (s.n_tup_ins <> coalesce(b.n_tup_ins, 0)
        OR s.n_tup_upd <> coalesce(b.n_tup_upd, 0)
        OR s.n_tup_del <> coalesce(b.n_tup_del, 0))
    ORDER BY relname
  LOOP
    written := written || format('%s(inserted=%s,updated=%s,deleted=%s)',
      offender.relname, offender.n_tup_ins, offender.n_tup_upd, offender.n_tup_del);
  END LOOP;
  IF array_length(written, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'OT Production baseline modified application rows: %',
      array_to_string(written, ', ');
  END IF;
END $$;

DO $$
DECLARE
  rel_name TEXT;
  n BIGINT;
BEGIN
  FOREACH rel_name IN ARRAY ARRAY[
    'ot_payment_binding','ot_settlement_reversal','ot_order_attribution',
    'ot_packet_download_capability','ot_artifact_orphan_quarantine',
    'ot_delivery_provider_callback','ot_commerce_deadline_capture',
    'ot_neutral_report_reservation','ot_neutral_blob_attempt','ot_neutral_checkout_attempt',
    'ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', rel_name) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'OT Production baseline wrote % rows into %', n, rel_name;
    END IF;
  END LOOP;
END $$;
