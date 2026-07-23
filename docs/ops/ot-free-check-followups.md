# OT free-check follow-ups

Status: deployed code is safe to ship, but automated delivery is disabled by default.

## Activation and kill switch

The only delivery flag is the server-only `OT_FREE_CHECK_FOLLOWUPS_ENABLED`.
Delivery runs only when `NODE_ENV=production` and its value is exactly `true`.
Missing, blank, `1`, or any differently-cased value is disabled. Turning the flag
off is the immediate kill switch. This change does not add the variable.

The scheduled endpoint is `GET /api/cron/free-check-followups`. It requires an
exact `Authorization: Bearer $CRON_SECRET` header and fails closed if
`CRON_SECRET` is missing. When disabled it returns aggregate zeros before
querying recipients or calling a transport.

## Consent and suppression

- Email enrollment requires the unchecked email-consent box.
- SMS uses a separate unchecked box and a validated E.164 U.S. mobile number.
- Consent timestamp, source, and copy version are stored.
- Email consent never implies SMS consent.
- One-click email unsubscribe immediately suppresses pending email messages.
- SMS STOP/START/HELP parsing and a provider-neutral webhook contract exist, but
  the webhook cannot mutate consent without an approved provider signature and
  verified phone identity.
- Re-submitting the form does not silently undo an unsubscribe.
- A paid/completed/fulfilled OT order exits remaining messages.

## Sequence and deadline source

The sequence is result confirmation, day 1 education, day 3 process education,
and a final reminder two days before a useful, currently published 2026
Assessor deadline. Optional SMS shares that final time. Final reminders use
`getOfficial2026Deadline`; no prior-year or pending township date is allowed.
At send time, closed or unpublished windows cancel non-result messages.

## Deployment order

1. Deploy application code with delivery flag absent/off.
2. Apply the additive Prisma migration.
3. Confirm the endpoint returns `status: disabled`.
4. Run authenticated `?dryRun=1`; review aggregate due/skipped reasons only.
5. Verify unsubscribe, paid-order exit, current official deadline data, Resend
   sender configuration, and suppression handling.
6. Separately select and approve an SMS provider/signature contract if SMS is
   desired. SMS cannot send in this release.
7. Obtain explicit approval for the exact production audience/cadence, then set
   the delivery flag to exactly `true`.

## Rollback

Set `OT_FREE_CHECK_FOLLOWUPS_ENABLED=false` or remove it. This stops all external
delivery immediately. The migration is additive and can remain in place while
code is rolled back. Do not delete consent or suppression records.

## Privacy and observability

Cron and dry-run responses contain aggregate counts and reason codes only. Logs
must not contain email, phone, address, unsubscribe token, or provider payload.

Delivery remains disabled.
