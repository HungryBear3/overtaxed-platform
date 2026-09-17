-- OT T2 delivery recovery — admit RESOLVE_UNRESOLVED_SEND to the admin audit log.
--
-- THE DEFECT THIS FIXES
--
-- `20260808173000_add_ot_fulfillment_admin_events` created
-- `ot_fulfillment_admin_event` for exactly one action and pinned four columns to
-- it with CHECK constraints:
--
--     CHECK ("action"      = 'ENTER_MANUAL_REVIEW')
--     CHECK ("to_status"   = 'MANUAL_REVIEW')
--     CHECK ("reason_code" = 'MANUAL_REVIEW')
--     CHECK ("from_status" IN ('NOT_STARTED', 'NEEDS_RECONCILIATION',
--                              'INCOMPLETE_INPUT', 'ARTIFACT_PENDING',
--                              'ARTIFACT_READY'))
--
-- `runT2DeliveryRecovery` writes an attributed audit row for its second action:
-- action 'RESOLVE_UNRESOLVED_SEND', from_status 'DELIVERY_PENDING', to_status
-- 'FAILED', reason_code one of four resolve codes. Every one of those four
-- values violates one of the constraints above. Against a real database the
-- INSERT raises 23514, the recovery transaction rolls back, and the operator
-- control simply does not work — the status advance, the revocation and the
-- audit row all unwind together. It is caught by nothing in the application,
-- because the application is not wrong: the schema is.
--
-- WHAT THIS DOES
--
-- Replaces the four column-scoped constraints with two SHAPE-scoped ones, so
-- the action and the transition it may describe stay coupled. Widening each
-- column independently would have admitted the cross-products — an
-- 'ENTER_MANUAL_REVIEW' row claiming DELIVERY_PENDING → FAILED, or a
-- 'RESOLVE_UNRESOLVED_SEND' row claiming ARTIFACT_READY → MANUAL_REVIEW — and
-- this table is audit evidence, where a row that cannot be true must not be
-- storable.
--
-- ADDITIVE IN EFFECT. No column is dropped or retyped, no index or foreign key
-- changes, and no row is inserted, updated or deleted. Shape 1 below is exactly
-- the old rule, so every row already in the table satisfies the new constraint
-- and `ALTER TABLE ... ADD CONSTRAINT` validates without rewriting anything.
--
-- Deploying this activates nothing: OT_T2_DELIVERY_RECOVERY_ENABLED is a strict
-- exact-"true" switch and is absent in every environment.

-- ---------------------------------------------------------------------------
-- 1. Drop the old constraints BY DISCOVERY, not by guessed name.
--
-- The originals were written unnamed, so their names were assigned by
-- PostgreSQL ("<table>_<column>_check", with numeric suffixes on collision).
-- Hard-coding those would be a guess about an implementation detail that also
-- differs if any of them was ever renamed by hand or recreated by a tool.
--
-- Selection is on `conkey` — the columns a constraint actually references —
-- rather than on its definition text. A CHECK whose column set is a subset of
-- {action, from_status, to_status, reason_code} is one of the four being
-- replaced. The three that are NOT replaced are excluded by construction:
-- ("from_revision") and ("from_revision","to_revision") and ("actor_user_id")
-- are each outside that set.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  target_columns SMALLINT[];
  doomed RECORD;
BEGIN
  SELECT array_agg(a.attnum ORDER BY a.attnum) INTO target_columns
  FROM pg_attribute a
  WHERE a.attrelid = '"ot_fulfillment_admin_event"'::regclass
    AND a.attname IN ('action', 'from_status', 'to_status', 'reason_code')
    AND NOT a.attisdropped;

  FOR doomed IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = '"ot_fulfillment_admin_event"'::regclass
      AND c.contype = 'c'
      AND c.conkey IS NOT NULL
      AND c.conkey <@ target_columns
  LOOP
    EXECUTE format(
      'ALTER TABLE "ot_fulfillment_admin_event" DROP CONSTRAINT %I',
      doomed.conname
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. One named constraint per legal shape.
--
-- Named explicitly this time, so the next migration that needs to touch them
-- does not have to rediscover them.
-- ---------------------------------------------------------------------------

-- Shape 1: the existing one-way manual-review hold. Byte-for-byte the same rule
-- the four dropped constraints expressed together.
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

-- Shape 2: ending an unresolved send, on an operator's attributed assertion of
-- definite no-in-flight evidence.
--
-- DELIVERY_PENDING is the only from_status: PROVIDER_ACCEPTED means the
-- provider took custody and is expected to report, and every other status
-- either has no send in flight or is already terminal. The four reason codes
-- are the closed subset an operator may assert; BOUNCED and COMPLAINED are
-- absent on purpose, because those arrive as authenticated provider evidence
-- and are not something a human types in.
ALTER TABLE "ot_fulfillment_admin_event"
  ADD CONSTRAINT "ot_fulfillment_admin_event_resolve_unresolved_send_shape" CHECK (
    "action" <> 'RESOLVE_UNRESOLVED_SEND'
    OR (
      "from_status" = 'DELIVERY_PENDING'
      AND "to_status" = 'FAILED'
      AND "reason_code" IN (
        'PROVIDER_ERROR', 'TIMEOUT', 'INVALID_RECIPIENT', 'MANUAL_REVIEW'
      )
    )
  );

-- Shape 3 (closure): the action vocabulary itself stays closed. Without this,
-- dropping the old `"action" = 'ENTER_MANUAL_REVIEW'` constraint would have
-- left the column free-text, and the two shape constraints above are both
-- vacuously true for any third action.
ALTER TABLE "ot_fulfillment_admin_event"
  ADD CONSTRAINT "ot_fulfillment_admin_event_action_closed" CHECK (
    "action" IN ('ENTER_MANUAL_REVIEW', 'RESOLVE_UNRESOLVED_SEND')
  );
