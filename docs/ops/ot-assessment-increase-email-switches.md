# Assessment-increase email switches

Scope: the single "recorded assessment change" email that
`runAssessmentChecks` (`lib/monitoring/assessment-check.ts`) can send when a
monitored property's latest published assessed value is higher than the value
previously stored. Policy lives in
`lib/monitoring/assessment-increase-email-policy.ts` and is evaluated at the
send seam, so every caller of `runAssessmentChecks` (today only
`/api/cron/assessment-checks`) is covered.

**This document does not activate anything.** Shipping this code sends nothing
new: with no switches set, the email is off.

## Switches

Both are compared exactly (case-sensitive, no whitespace trimming).

| Variable | Required value to send | Anything else (incl. missing) |
| --- | --- | --- |
| `OT_ASSESSMENT_INCREASE_EMAIL_ENABLED` | `true` | disabled — no log, no send |
| `OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN` | `false` | dry-run — logs property id + tax year, never calls the email provider |

Additionally, when `VERCEL_ENV` is `preview` the email is **never** sent, even
with both switches armed (logged as "blocked on preview").

A real send also still requires the pre-existing conditions: an increase was
detected against a stored prior value, email is configured, and the owner has an
email address. Otherwise the result is recorded as `skipped`.

Each `AssessmentCheckResult` with `increaseDetected: true` carries
`increaseEmail`: `disabled` | `dry_run` | `preview_blocked` | `skipped` | `sent`
(`sent` = handed to `sendEmail`; delivery is fire-and-forget). The cron route's
JSON response is unchanged and does not expose this field.

## What is not affected

- Assessment history upserts and property value updates run identically in
  every mode.
- The appeal-decision email in the same loop is not gated by these switches.
- No other email, reminder, consent, checkout or cron schedule is changed.

## Copy

The email states the recorded change factually (previously recorded vs newly
recorded value, tax year, PIN) and links to the recorded property page. It does
not invite an appeal, cite a deadline, or include a purchase call to action.

## Activation (not authorized by this change)

Turning this on is a separate, owner-approved production step: set
`OT_ASSESSMENT_INCREASE_EMAIL_ENABLED=true` first and review dry-run logs from a
cron run; only then set `OT_ASSESSMENT_INCREASE_EMAIL_DRY_RUN=false`. To stop
sending, unset either switch (or set dry-run to anything other than `false`).
