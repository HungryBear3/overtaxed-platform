BEGIN;
DROP POLICY IF EXISTS ot_measurement_prod_insert ON public.ot_free_check_completion;
DROP POLICY IF EXISTS ot_measurement_prod_select ON public.ot_free_check_completion;
REVOKE INSERT (completion_id, attribution_state, campaign_code, creative_code, registry_version, outcome_code, outcome_reason, allow_checkout, window_status), SELECT (completion_id, completed_at, attribution_state, campaign_code, creative_code, registry_version, outcome_code, outcome_reason, allow_checkout, window_status) ON public.ot_free_check_completion FROM ot_prod_app;
COMMIT;
