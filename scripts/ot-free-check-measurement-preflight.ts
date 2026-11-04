/** Read-only dedicated runtime identity and ledger-read qualification. No writes. */
import { withMeasurementClient } from "../lib/analytics/free-check-measurement-runtime";
async function main() {
  await withMeasurementClient(async (db) => {
    await db.$queryRaw`SELECT completion_id, completed_at, attribution_state, campaign_code, creative_code,
      registry_version, outcome_code, outcome_reason, allow_checkout, window_status
      FROM public.ot_free_check_completion LIMIT 0`;
  });
  console.log(
    JSON.stringify({
      schema: "ot.free_check_measurement_runtime_preflight.v1",
      status: "passed",
      identity: "ot_prod_app",
      scope: "identity_and_read_only_not_write_or_whole_app_qualification",
    }),
  );
}
main().catch(() => {
  console.error("measurement_runtime_preflight_failed");
  process.exitCode = 1;
});
