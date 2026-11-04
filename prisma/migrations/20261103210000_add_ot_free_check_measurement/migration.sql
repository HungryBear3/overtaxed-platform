-- DRAFT ONLY: additive standalone request-completion ledger, no backfill.
-- Apply ONLY after separately approved owner-role migration/release review.
CREATE TABLE ot_free_check_completion (
  completion_id UUID PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attribution_state TEXT NOT NULL CHECK (attribution_state IN ('campaign', 'untagged_request', 'unknown')),
  campaign_code TEXT CHECK (campaign_code ~ '^[a-z0-9][a-z0-9_]{1,39}$'),
  creative_code TEXT CHECK (creative_code ~ '^[a-z0-9][a-z0-9_]{1,39}$'),
  registry_version TEXT NOT NULL CHECK (registry_version ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  outcome_code TEXT NOT NULL CHECK (outcome_code IN ('supportive','not_supportive','insufficient_evidence','unsupported_property')),
  outcome_reason TEXT NOT NULL CHECK (outcome_reason IN ('none','property_class_unsupported','multiple_pins','outside_cook_county','no_assessed_value','no_comparables','no_comparable_level','window_unverified','window_not_open','eligibility_policy_unsigned','below_min_comparable_count','below_evidence_threshold')),
  allow_checkout BOOLEAN NOT NULL,
  window_status TEXT NOT NULL CHECK (window_status IN ('open','closed','upcoming','unknown')),
  CHECK ((attribution_state = 'campaign' AND campaign_code IS NOT NULL) OR (attribution_state IN ('untagged_request','unknown') AND campaign_code IS NULL AND creative_code IS NULL)),
  CHECK (creative_code IS NULL OR campaign_code IS NOT NULL),
  CHECK (NOT allow_checkout OR (outcome_code = 'supportive' AND outcome_reason = 'none' AND window_status = 'open'))
);
CREATE INDEX ot_free_check_completion_time ON ot_free_check_completion(completed_at);
ALTER TABLE ot_free_check_completion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ot_free_check_completion FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE ot_free_check_completion FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
-- API roles have no policies and no grants. service_role is BYPASSRLS, so only
-- this REVOKE keeps it out. Application owning role bypasses RLS.
-- Application writes INSERT only; no UPDATE/DELETE path. Owner retention cleanup
-- remains a separate operational approval, not an automatic task here.
