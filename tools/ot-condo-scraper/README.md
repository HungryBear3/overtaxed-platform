# OT Condo Scraper — Chicago Revival

Single source of truth: `docs/OT_OUTREACH_V1_RUNBOOK.md`. This README only
explains how to use the scraper that feeds the existing TS sender path. Do
not introduce a parallel send pipeline.

## Pipeline shape (no duplicate stack)

```
realie.io ── tools/ot-condo-scraper/scrape.ts ──> outreach_prospects (Prisma)
                                                        │
                                                        ▼
                                       lib/outreach/send.ts (preflight)
                                                        │
                                                        ▼
                                                Resend (outreach subdomain)
                                                        │
                                                        ▼
                  webhooks → /api/outreach/webhooks/resend → outreach_suppression
```

## Scraper usage

```bash
# Dry run, 10 rows, prints what would land in outreach_prospects
pnpm tsx tools/ot-condo-scraper/scrape.ts --city chicago --limit 10 --dry-run

# Dry run at full size (no DB writes)
pnpm tsx tools/ot-condo-scraper/scrape.ts --city chicago --full --dry-run

# Real run, full Chicago (writes outreach_prospects)
pnpm tsx tools/ot-condo-scraper/scrape.ts --city chicago --full
```

Required env: `DATABASE_URL`, `OT_REALIE_API_KEY`.

### What the scraper does

- Filters: `type=condo`, `city=chicago`, `beds>=2`, `assessedValue>=300_000`, max `2000` rows
- Skips rows with no `ownerEmail` (no contact path, not a candidate)
- Detects role-address pattern (`info@`, `admin@`, `contact@`, `board@`, `help@`, `support@`, `postmaster@`, `noreply@`) → `row_status='needs_review'`
- Detects property-manager-style owner names (Mgmt, LLC, Inc, Properties, Realty, Holdings, etc.) → `row_status='needs_review'`
- Otherwise `row_status='ok'`
- Upserts on `(building_address_normalized, board_email_lowercase)` — idempotent re-run
- Resume-safe: each row commits independently; mid-run crash leaves no partial rows
- Backoff on 429/5xx with 3 retries

### Manual QA (runbook §3.C — required before any send)

1. Run `--limit 20 --dry-run` against Chicago.
2. Hand-verify 100% of those 20 rows against the original Realie property pages.
3. If <20/20 are correct, fix the scraper before promoting to a real run.
4. Only then run `--full` for real.

After a real run:

```sql
-- Should all be 0 / empty before you promote send_ready
SELECT count(*) FROM outreach_prospects WHERE row_status = 'rejected';
SELECT board_email_lowercase, count(*) FROM outreach_prospects
  GROUP BY board_email_lowercase HAVING count(*) > 1;
SELECT count(*) FROM outreach_prospects WHERE board_email_lowercase ~* '^(info|admin|contact|board|help|support|postmaster|noreply)@';
```

## Sender prep (no new code; uses existing TS path)

This is **not** a runnable command yet. The runbook §10 go/no-go gate must
be passing first. Below is the operator one-liner to use **after** the gate is
green.

### Hard gate (set on Preview / Prod env, all five must be true)

```bash
echo "OUTREACH_RESEND_API_KEY=${OUTREACH_RESEND_API_KEY:+set}"           # required
echo "OUTREACH_RESEND_WEBHOOK_SECRET=${OUTREACH_RESEND_WEBHOOK_SECRET:+set}"  # required
echo "OUTREACH_UNSUBSCRIBE_SECRET=${OUTREACH_UNSUBSCRIBE_SECRET:+set}"   # required
echo "OUTREACH_FROM_EMAIL=${OUTREACH_FROM_EMAIL:-default}"
dig +short TXT outreach.overtaxed-il.com           # SPF must be present
dig +short CNAME resend._domainkey.outreach.overtaxed-il.com  # DKIM CNAME must resolve
dig +short TXT _dmarc.overtaxed-il.com             # DMARC must be present
```

If any of those are empty, **stop**.

### Operator one-liner (when gate is green)

```bash
# 1) Create a draft campaign
curl -sS -X POST "$APP_URL/api/outreach/campaigns" \
  -H "Content-Type: application/json" \
  -H "x-ot-admin-key: $OT_ADMIN_KEY" \
  -d '{"name":"chicago-condo-pilot-w1-v1","utmCampaign":"chicago-condo-pilot-w1-v1"}'
# Note the returned campaign id, then preflight the cohort:

# 2) Pick the top 30 prospects (NOT in suppression, NOT recently contacted)
psql "$DATABASE_URL" <<SQL
SELECT id, board_email_lowercase
FROM outreach_prospects p
WHERE row_status = 'ok'
  AND last_contacted_at IS NULL OR last_contacted_at < now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM outreach_suppression s
    WHERE s.email_lowercase = p.board_email_lowercase
      AND (s.campaign_id IS NULL OR s.campaign_id = '<CAMPAIGN_ID>')
  )
ORDER BY p.created_at DESC
LIMIT 30;
SQL

# 3) Warm-up first (runbook §10): send 30+ to friendly seed inboxes over 3 days
#    via the existing sender. Confirm Gmail/Outlook/iCloud inbox placement.

# 4) Pilot batches per runbook §6 (Tue 20 / Wed 20 / Thu 10, business hours):
#    POST /api/outreach/send-batch with { campaignId, prospectIds: [...], dryRun: false }
#    Each send must:
#      - check suppression
#      - include List-Unsubscribe + List-Unsubscribe-Post headers
#      - include physical postal address footer
#      - link to /appeal-bulk with full UTM set:
#        utm_source=email&utm_medium=cold-outreach
#        &utm_campaign=condo-boards-2026-04
#        &utm_content=pilot-w1-v1
#        &utm_term=<board_id>
#
# Auto-pause thresholds (runbook §6):
#   bounce rate >= 5%       → halt
#   complaint rate >= 0.1%  → halt (in pilot of 30, any single complaint = halt)
#   3+ "stop emailing me" replies → halt
#   any legal/C&D reply → halt + escalate <1 hr
#   delivery rate after first 10 sends < 70% → pause + investigate
```

**The "alert if opens > 5%" idea is wrong and explicitly rejected by the
runbook.** Use the bounce/complaint kill-switch above.

## What this revival did NOT do (intentional)

- No Python files
- No Supabase tables (uses existing `outreach_prospects` Prisma model)
- No new send pipeline (uses existing `lib/outreach/send.ts` + `/api/outreach/webhooks/resend`)
- No cron — operator runs scrape on demand; pilot send is one-shot under runbook §6 pacing
- No emails sent in this PR
- No commit / no PR — diff sits in working tree for review

## Open blockers before any send

1. `OUTREACH_RESEND_API_KEY`, `OUTREACH_RESEND_WEBHOOK_SECRET`, `OUTREACH_UNSUBSCRIBE_SECRET` not set in any environment we can verify from this session.
2. `outreach.overtaxed-il.com` SPF / DKIM / DMARC records not verifiable (dig produced no output here — confirm separately).
3. Realie email coverage unknown until first real `--full` run; if email column is sparse, an enrichment step (Hunter.io / Apollo / similar) is needed BEFORE the send phase, not after.
