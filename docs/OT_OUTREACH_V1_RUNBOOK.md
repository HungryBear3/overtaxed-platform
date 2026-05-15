# OT Condo Outreach v1 Runbook

Goal: launch the Overtaxed condo-board outreach pilot safely, with real deliverability controls, legal/compliance basics, suppression handling, scrape QA, and a measurable 50-email pilot.

Status: Do not send live outreach until every item in Section 10 is true.

Primary owner
- Ops owner: Alexy
- Engineering owner: assigned implementer
- Kill-switch authority: Alexy or whoever he explicitly delegates in writing

Core rule
- If complaint rate, bounce rate, unsubscribe flow, reply handling, or suppression is not working, stop. No “soft launch” exceptions.

------------------------------------------------------------------
1. Scope
------------------------------------------------------------------

This runbook covers:
- outreach subdomain + deliverability setup
- reply mailbox setup
- OT outreach data model
- Resend webhook ingestion
- one-click unsubscribe
- suppression enforcement
- scrape QA + 50-row pilot cohort export
- send pacing and halt rules
- week-1 reporting
- launch checklist

This runbook does not cover:
- redesigning the OT site
- broad marketing strategy
- scaling beyond the 50-send pilot

------------------------------------------------------------------
2. Repo-specific implementation targets
------------------------------------------------------------------

Use these files/areas in the existing OT repo.

Existing files to extend
- `prisma/schema.prisma`
  - add outreach models/tables
- `app/api/leads/capture/route.ts`
  - reference for existing lead capture and Resend usage pattern
- `lib/email/resend.ts`
  - do not reuse current transactional sender as-is; create outreach-specific sender config alongside or below this pattern
- `lib/analytics/utm-tracking.ts`
  - extend/reuse for UTMs landing on OT intake pages
- `docs/EMAIL_SETUP.md`
  - existing email setup context; outreach uses separate Resend subdomain rules from the older SMTP doc

Recommended new files
- `prisma/migrations/<timestamp>_add_ot_outreach_tables/migration.sql`
- `app/api/outreach/webhooks/resend/route.ts`
- `app/u/[token]/route.ts`
- `lib/outreach/config.ts`
- `lib/outreach/suppression.ts`
- `lib/outreach/webhooks.ts`
- `lib/outreach/send.ts`
- `lib/outreach/unsubscribe.ts`
- `lib/outreach/types.ts`
- `docs/OT_OUTREACH_WEEK1_REPORT_TEMPLATE.md`

Optional but useful
- `scripts/outreach/verify-pilot-gates.sql`
- `scripts/outreach/export-pilot-cohort.sql`
- `scripts/outreach/check-deliverability.sh`

If `tools/ot-condo-scraper/build-db.py` is outside this repo, keep its source-of-truth there, but require it to write into the schema defined in this document.

------------------------------------------------------------------
3. Domain and deliverability
------------------------------------------------------------------

Required sending domain
- Use `outreach.overtaxed-il.com`
- Do not send this pilot from `overtaxed-il.com`
- Do not send this pilot from any transactional-mail subdomain

Required mailbox identities
- From: `Alexy Kaplun <alexy@outreach.overtaxed-il.com>`
- Reply-To: `appeals@outreach.overtaxed-il.com`
- The reply mailbox must exist before first send

DNS records
- SPF on `outreach.overtaxed-il.com`
- DKIM record(s) exactly as provided by Resend
- DMARC on `_dmarc.outreach.overtaxed-il.com`

Minimum verification sequence
1. Add domain in Resend
2. Publish SPF/DKIM/DMARC in DNS
3. `dig TXT outreach.overtaxed-il.com`
4. `dig CNAME resend._domainkey.outreach.overtaxed-il.com`
5. `dig TXT _dmarc.outreach.overtaxed-il.com`
6. Send test to a Gmail inbox you control
7. Gmail → Show Original → SPF PASS, DKIM PASS, DMARC PASS
8. Send same message to mail-tester.com → score >= 9/10
9. Warm-up: 10 sends/day for 3 days to owned seed inboxes at Gmail, Outlook, Yahoo, iCloud

Pilot blocker
- If any auth check fails, no pilot

------------------------------------------------------------------
4. Data model
------------------------------------------------------------------

Add these tables in Prisma + SQL migration.

4.1 prospects
Purpose
- one row per outreachable condo/board contact candidate

Required fields
- `id`
- `campaign_id` nullable
- `board_name`
- `building_name` nullable
- `building_address_raw`
- `building_address_normalized`
- `board_email`
- `board_email_lowercase`
- `source_url`
- `scraped_at`
- `scraper_version`
- `row_status` (`ok`, `needs_review`, `rejected`)
- `raw_payload` JSON
- `last_contacted_at` nullable
- `last_campaign_id` nullable
- `contact_count` default 0
- `created_at`
- `updated_at`

Constraints / indexes
- unique on `(building_address_normalized, board_email_lowercase)`
- index on `board_email_lowercase`
- index on `row_status`
- index on `last_contacted_at`

4.2 campaigns
Purpose
- defines a specific outreach run, including halt state

Required fields
- `id`
- `name`
- `status` (`draft`, `ready`, `running`, `paused`, `completed`, `halted`)
- `utm_campaign`
- `send_limit`
- `halted_at` nullable
- `halt_reason` nullable
- `created_at`
- `updated_at`

Constraint
- before each send, code must re-read campaign status from DB

4.3 sends
Purpose
- immutable per-send record and delivery state

Required fields
- `id`
- `campaign_id`
- `prospect_id`
- `email`
- `message_id` nullable
- `custom_id`
- `provider` default `resend`
- `status` (`queued`, `sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened`, `clicked`, `suppressed`)
- `sent_at` nullable
- `delivered_at` nullable
- `opened_at` nullable
- `clicked_at` nullable
- `bounced_at` nullable
- `complained_at` nullable
- `reply_to_address`
- `list_unsubscribe_url`
- `template_version`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content` nullable
- `utm_term`
- `created_at`
- `updated_at`

Constraints / indexes
- unique on `custom_id`
- index on `campaign_id, status`
- index on `email`
- index on `message_id`

4.4 suppression
Purpose
- global or scoped do-not-contact list

Recommended shape
- `id` bigserial/cuid primary key
- `email`
- `email_lowercase`
- `campaign_id` nullable
- `reason` (`HARD_BOUNCED`, `SOFT_BOUNCED_REPEATED`, `COMPLAINED`, `MANUAL_OPT_OUT`, `ONE_CLICK_UNSUB`, `LEGAL_HOLD`, `ALREADY_CONTACTED_30D`)
- `source` (`webhook`, `manual`, `unsubscribe`, `preflight`)
- `note` nullable
- `created_at`

Constraints / indexes
- index on `email_lowercase`
- unique on `(email_lowercase, coalesce(campaign_id,'GLOBAL'), reason)` at SQL level or equivalent modeled uniqueness

Rule
- suppression is terminal for mailing decisions

4.5 webhook_events
Purpose
- idempotent event ledger

Required fields
- `id`
- `provider`
- `provider_event_id`
- `message_id` nullable
- `event_type`
- `payload` JSON
- `received_at`

Constraint
- unique on `(provider, provider_event_id)`

4.6 replies
Purpose
- human-managed inbox workflow log

Required fields
- `id`
- `campaign_id` nullable
- `prospect_id` nullable
- `email`
- `reply_type` (`opt_out`, `neutral`, `interested`, `legal`, `other`)
- `subject` nullable
- `body_text`
- `handled_by` nullable
- `handled_at` nullable
- `status` (`new`, `handled`, `escalated`)
- `created_at`

4.7 leads
Purpose
- qualified leads from outreach traffic/replies

Required fields
- `id`
- `prospect_id` nullable
- `campaign_id` nullable
- `email`
- `source` (`outreach_email`, `reply`, `appeal_bulk`, `manual`)
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content` nullable
- `utm_term`
- `qualified` boolean default false
- `qualified_reason` nullable
- `created_at`

------------------------------------------------------------------
5. Webhooks and unsubscribe behavior
------------------------------------------------------------------

5.1 Resend webhook endpoint
Create
- `app/api/outreach/webhooks/resend/route.ts`

Must handle at minimum
- `email.delivered`
- `email.delivery_delayed`
- `email.opened`
- `email.clicked`
- `email.bounced`
- `email.complained`

Rules
- insert raw event into `webhook_events` first
- if duplicate `(provider, provider_event_id)`, no-op safely
- update matching `sends` row by `message_id` or `custom_id`

Complaint rule
- in one transaction:
  - write webhook event
  - mark send complained
  - insert suppression row for email
  - halt campaign if complaint threshold breached

Bounce rule
- hard bounce → immediate suppression
- soft bounce → count rolling 30-day soft bounces
- 3 soft bounces in 30 days → suppression

5.2 One-click unsubscribe
Create
- `app/u/[token]/route.ts`
- helper in `lib/outreach/unsubscribe.ts`

Requirements
- every outbound message includes:
  - `List-Unsubscribe: <mailto:unsub@outreach.overtaxed-il.com>, <https://outreach.overtaxed-il.com/u/{token}>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- GET `/u/{token}`:
  - validate token
  - insert suppression row
  - render simple success page
- invalid/expired token:
  - return safe friendly page
  - never 500

Footer requirement
- footer unsubscribe link points to same `/u/{token}` URL

------------------------------------------------------------------
6. Send-time enforcement rules
------------------------------------------------------------------

Immediately before every Resend API call:
1. reload campaign row
2. if campaign.status != `running`, skip send
3. check suppression by lowercase email
4. check `last_contacted_at >= now() - 30 days`
5. check syntax regex
6. check MX if you have an email verifier in pipeline
7. reject role-addresses (`info@`, `admin@`, `contact@`, `board@`, `help@`, `support@`, `postmaster@`, `noreply@`)
8. reject property-manager heuristic (`same email on >= 3 buildings`)

If any check fails
- skip send
- log skipped reason
- do not attempt provider call

------------------------------------------------------------------
7. Scraper / audience quality gates
------------------------------------------------------------------

Required scraper behavior
- checkpoint every 50 rows
- resume from next URL after checkpoint
- per-row commit atomicity
- write `source_url`, `scraped_at`, `scraper_version`, `row_status`, `raw_payload`

Manual QA before export
- hand-verify 20 random rows against source
- 20/20 for contactability-critical fields:
  - address
  - email
  - source URL
  - board identity/context
- if not 20/20, fix scraper before pilot

SQL preflight gates
- invalid email syntax count = 0
- `row_status != 'ok'` count = 0 in send-ready export
- duplicate emails = empty
- role addresses = empty
- suppression overlap = empty
- recontacted within 30 days = empty

Pilot export
- exactly 50 rows
- all from `send_ready`
- no already-contacted rows
- no suppressed rows

------------------------------------------------------------------
8. Send controls
------------------------------------------------------------------

Pilot pacing
- Tuesday: 20 emails
- Wednesday: 20 emails
- Thursday: 10 emails
- business hours only
- no weekend sends
- no overnight sends

Stop / auto-pause thresholds
- any complaint before 20 sends → pause
- complaint rate >= 0.1% → halt
- hard bounce rate >= 5% → halt
- delivery rate after first 10 sends < 70% → pause and inspect
- 3+ explicit opt-outs in first 20 → pause and inspect copy/list quality
- any legal threat / C&D → immediate halt and escalate within 1 hour

Kill switch
- DB-backed `campaigns.status = 'halted'`
- checked before every send and again before each sleep interval in sender loop
- manual backup: pause/suspend in Resend dashboard

------------------------------------------------------------------
9. UTM and attribution rules
------------------------------------------------------------------

Use this scheme
- `utm_source=ot_condo_email`
- `utm_medium=outreach`
- `utm_campaign=<campaign-slug>`
- `utm_content=<template-version>`
- `utm_term=<opaque-prospect-id>`

Rules
- `utm_term` is not human-readable address text
- `custom_id` on send must map back to `prospect_id`
- reply-to may use plus addressing for easier attribution if mailbox supports it
- `/appeal-bulk` or the chosen intake path must persist UTMs into DB

Extend as needed
- `lib/analytics/utm-tracking.ts`
- any intake route/page that currently drops UTMs

------------------------------------------------------------------
10. Week-1 reporting
------------------------------------------------------------------

Create report after pilot completion with these fields.

Campaign summary
- campaign id
- send window
- total attempted
- total suppressed/skipped
- total sent
- delivered
- delayed
- bounced hard
- bounced soft
- complained
- unsubscribed
- opened
- clicked
- replied
- qualified leads

Rates
- delivery rate
- hard bounce rate
- soft bounce rate
- complaint rate
- unsubscribe rate
- open rate
- click-through rate
- reply rate
- qualified lead rate

Lead quality
- count of replies tagged interested
- count of completed intake forms
- count of booked consults
- count of qualified leads
- count of disqualified leads + reason buckets

Decision buckets
- Green: complaint < 0.1%, hard bounce < 3%, reply >= 2%, qualified lead >= 1
- Yellow: no complaints, but weak clicks/replies; revise copy or list and rerun at same volume
- Red: any complaint threshold breach, bounce threshold breach, legal issue, or obvious list-quality failure

------------------------------------------------------------------
11. Immediate next actions (execution queue)
------------------------------------------------------------------

1. Register `outreach.overtaxed-il.com` in Resend and publish SPF/DKIM/DMARC
- Owner: Ops
- Effort: 1 hr
- Dependency: DNS access
- Done when: Resend shows verified, `dig` returns all records, Gmail Show Original passes SPF/DKIM/DMARC

2. Create `appeals@outreach.overtaxed-il.com` mailbox and assign human owner with 24-hour reply SLA
- Owner: Ops
- Effort: 1 hr
- Dependency: #1
- Done when: test email lands and owner is named in runbook

3. Add outreach tables to Prisma and create migration
- Owner: Eng
- Effort: 3 hrs
- Dependency: none
- Done when: migration applied, unique/index constraints verified, rollback plan documented

4. Build Resend webhook endpoint
- Owner: Eng
- Effort: 4 hrs
- Dependency: #3
- Done when: test bounce and complaint create rows, complaint can halt campaign, retries are idempotent

5. Build one-click unsubscribe route and send headers
- Owner: Eng
- Effort: 3 hrs
- Dependency: #3
- Done when: `/u/{token}` inserts suppression, invalid token does not 500, Gmail Show Original shows unsubscribe headers

6. Hand-verify 20 random scraper rows
- Owner: Ops
- Effort: 3 hrs
- Dependency: scraper runnable locally
- Done when: 20/20 pass on contactability-critical fields

7. Run full Chicago scrape with resume state and SQL QA gates
- Owner: Ops
- Effort: 4 hrs
- Dependency: #6
- Done when: 50-row pilot cohort exported from clean send-ready dataset

8. Warm subdomain for 3 days on owned seed list
- Owner: Ops
- Effort: 30 min/day x 3 days
- Dependency: #1, #2
- Done when: inbox placement confirmed daily

9. Send 50-email pilot on 20/20/10 schedule
- Owner: Ops
- Effort: 3 business days
- Dependency: #1 through #8
- Done when: all 50 are sent or campaign halted by threshold rule

10. Write week-1 report and make go/no-go call
- Owner: Ops
- Effort: 1 hr
- Dependency: #9
- Done when: campaign categorized Green/Yellow/Red

------------------------------------------------------------------
12. Launch checklist (all must be true)
------------------------------------------------------------------

Deliverability
- [ ] outreach subdomain verified in Resend
- [ ] SPF PASS
- [ ] DKIM PASS
- [ ] DMARC PASS
- [ ] mail-tester >= 9/10
- [ ] warm-up complete

Mailbox and compliance
- [ ] monitored reply inbox exists
- [ ] owner assigned
- [ ] 24-hour SLA documented
- [ ] one-click unsubscribe works
- [ ] List-Unsubscribe headers present
- [ ] suppression table enforced before send

Data quality
- [ ] scraper resume/checkpoint works
- [ ] 20-row audit passed
- [ ] SQL QA gates all pass
- [ ] 50-row pilot cohort exported cleanly

Engineering
- [ ] outreach tables migrated
- [ ] webhook route live
- [ ] webhook idempotency verified
- [ ] complaint suppresses recipient
- [ ] bounce suppresses recipient appropriately
- [ ] campaign halt path works

Operational safety
- [ ] stop thresholds documented
- [ ] kill switch owner named
- [ ] manual dashboard pause available
- [ ] legal escalation rule documented

If any item above is false, do not send the pilot.

------------------------------------------------------------------
13. Recommended build order for engineering
------------------------------------------------------------------

Day 1
- schema + migration
- suppression helper
- webhook event ledger
- unsubscribe token helper

Day 2
- webhook route
- unsubscribe route
- send helper with preflight suppression checks
- UTM persistence into intake path

Day 3
- manual end-to-end tests
- complaint/bounce simulations
- Gmail header verification
- docs + runbook confirmation

------------------------------------------------------------------
14. Operator commands / checks
------------------------------------------------------------------

DNS
- `dig TXT outreach.overtaxed-il.com`
- `dig CNAME resend._domainkey.outreach.overtaxed-il.com`
- `dig TXT _dmarc.outreach.overtaxed-il.com`

Mail auth
- Gmail → Show Original
- mail-tester.com inbox score

Build / migrate
- `npx prisma migrate dev`
- `npx prisma generate`
- project test/build commands after implementation

Pilot QA
- SQL gates from Section 7
- spot-check exported 50-row CSV before any send

------------------------------------------------------------------
15. Final operating rule
------------------------------------------------------------------

This pilot is not “send 50 and see what happens.”
It is “prove deliverability, prove compliance basics, prove list quality, then send 50 under kill-switch control.”

If the system cannot suppress, halt, unsubscribe, attribute, and report cleanly, it is not ready.
