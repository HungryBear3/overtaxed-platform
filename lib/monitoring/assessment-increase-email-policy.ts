/**
 * Delivery policy for the assessment-increase email sent by
 * `runAssessmentChecks`. Default-off; see
 * docs/ops/ot-assessment-increase-email-switches.md.
 *
 * Both switches are compared exactly, with no fallback that can arm a send:
 *   - OT_ASSESSMENT_INCREASE_EMAIL_ENABLED must be exactly "true", else
 *     nothing happens at all;
 *   - OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN must be exactly "false" to leave
 *     dry-run. Missing or any other value stays in dry-run, which logs and
 *     never reaches the email provider.
 * A Vercel Preview deployment never sends, whatever the switches say.
 *
 * Scope is this one email. The appeal-decision email and assessment
 * persistence do not consult it.
 */
export const ASSESSMENT_INCREASE_EMAIL_ENABLED_FLAG = "OT_ASSESSMENT_INCREASE_EMAIL_ENABLED"
export const ASSESSMENT_INCREASE_EMAIL_DRY_RUN_FLAG = "OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN"

export type AssessmentIncreaseEmailMode = "disabled" | "preview_blocked" | "dry_run" | "send"

export function assessmentIncreaseEmailMode(
  env: NodeJS.ProcessEnv = process.env
): AssessmentIncreaseEmailMode {
  if (env[ASSESSMENT_INCREASE_EMAIL_ENABLED_FLAG] !== "true") return "disabled"
  if (env.VERCEL_ENV === "preview") return "preview_blocked"
  if (env[ASSESSMENT_INCREASE_EMAIL_DRY_RUN_FLAG] !== "false") return "dry_run"
  return "send"
}
