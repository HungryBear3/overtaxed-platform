-- OT Condo Outreach v1 schema (see docs/OT_OUTREACH_V1_RUNBOOK.md)
-- Additive only. Isolated from transactional product tables.

CREATE TABLE IF NOT EXISTS "outreach_campaigns" (
  "id"           TEXT PRIMARY KEY,
  "name"         TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'draft',
  "utm_campaign" TEXT NOT NULL,
  "send_limit"   INTEGER NOT NULL DEFAULT 50,
  "halted_at"    TIMESTAMP(3),
  "halt_reason"  TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "outreach_campaigns_status_idx" ON "outreach_campaigns"("status");

CREATE TABLE IF NOT EXISTS "outreach_prospects" (
  "id"                            TEXT PRIMARY KEY,
  "campaign_id"                   TEXT,
  "board_name"                    TEXT NOT NULL,
  "building_name"                 TEXT,
  "building_address_raw"          TEXT NOT NULL,
  "building_address_normalized"   TEXT NOT NULL,
  "board_email"                   TEXT NOT NULL,
  "board_email_lowercase"         TEXT NOT NULL,
  "source_url"                    TEXT NOT NULL,
  "scraped_at"                    TIMESTAMP(3) NOT NULL,
  "scraper_version"               TEXT NOT NULL,
  "row_status"                    TEXT NOT NULL DEFAULT 'needs_review',
  "raw_payload"                   JSONB NOT NULL,
  "last_contacted_at"             TIMESTAMP(3),
  "last_campaign_id"              TEXT,
  "contact_count"                 INTEGER NOT NULL DEFAULT 0,
  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outreach_prospects_campaign_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_prospects_addr_email_uq"
  ON "outreach_prospects"("building_address_normalized", "board_email_lowercase");
CREATE INDEX IF NOT EXISTS "outreach_prospects_email_lc_idx" ON "outreach_prospects"("board_email_lowercase");
CREATE INDEX IF NOT EXISTS "outreach_prospects_row_status_idx" ON "outreach_prospects"("row_status");
CREATE INDEX IF NOT EXISTS "outreach_prospects_last_contacted_idx" ON "outreach_prospects"("last_contacted_at");

CREATE TABLE IF NOT EXISTS "outreach_sends" (
  "id"                    TEXT PRIMARY KEY,
  "campaign_id"           TEXT NOT NULL,
  "prospect_id"           TEXT NOT NULL,
  "email"                 TEXT NOT NULL,
  "message_id"            TEXT,
  "custom_id"             TEXT NOT NULL UNIQUE,
  "provider"              TEXT NOT NULL DEFAULT 'resend',
  "status"                TEXT NOT NULL DEFAULT 'queued',
  "skipped_reason"        TEXT,
  "sent_at"               TIMESTAMP(3),
  "delivered_at"          TIMESTAMP(3),
  "opened_at"             TIMESTAMP(3),
  "clicked_at"            TIMESTAMP(3),
  "bounced_at"            TIMESTAMP(3),
  "bounce_type"           TEXT,
  "bounce_reason"         TEXT,
  "complained_at"         TIMESTAMP(3),
  "reply_to_address"      TEXT NOT NULL,
  "list_unsubscribe_url"  TEXT NOT NULL,
  "template_version"      TEXT NOT NULL,
  "utm_source"            TEXT NOT NULL,
  "utm_medium"            TEXT NOT NULL,
  "utm_campaign"          TEXT NOT NULL,
  "utm_content"           TEXT,
  "utm_term"              TEXT NOT NULL,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outreach_sends_campaign_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE,
  CONSTRAINT "outreach_sends_prospect_fk"
    FOREIGN KEY ("prospect_id") REFERENCES "outreach_prospects"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "outreach_sends_campaign_status_idx" ON "outreach_sends"("campaign_id", "status");
CREATE INDEX IF NOT EXISTS "outreach_sends_email_idx" ON "outreach_sends"("email");
CREATE INDEX IF NOT EXISTS "outreach_sends_message_id_idx" ON "outreach_sends"("message_id");

CREATE TABLE IF NOT EXISTS "outreach_suppression" (
  "id"              TEXT PRIMARY KEY,
  "email"           TEXT NOT NULL,
  "email_lowercase" TEXT NOT NULL,
  "campaign_id"     TEXT,
  "reason"          TEXT NOT NULL,
  "source"          TEXT NOT NULL,
  "note"            TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "outreach_suppression_email_lc_idx" ON "outreach_suppression"("email_lowercase");
CREATE INDEX IF NOT EXISTS "outreach_suppression_campaign_idx" ON "outreach_suppression"("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_suppression_email_scope_reason_uq"
  ON "outreach_suppression"("email_lowercase", COALESCE("campaign_id", '__GLOBAL__'), "reason");

CREATE TABLE IF NOT EXISTS "outreach_webhook_events" (
  "id"                 TEXT PRIMARY KEY,
  "provider"           TEXT NOT NULL DEFAULT 'resend',
  "provider_event_id"  TEXT NOT NULL,
  "message_id"         TEXT,
  "event_type"         TEXT NOT NULL,
  "payload"            JSONB NOT NULL,
  "received_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"       TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_webhook_events_provider_eventid_uq"
  ON "outreach_webhook_events"("provider", "provider_event_id");
CREATE INDEX IF NOT EXISTS "outreach_webhook_events_message_id_idx" ON "outreach_webhook_events"("message_id");
CREATE INDEX IF NOT EXISTS "outreach_webhook_events_event_type_idx" ON "outreach_webhook_events"("event_type");

CREATE TABLE IF NOT EXISTS "outreach_replies" (
  "id"          TEXT PRIMARY KEY,
  "campaign_id" TEXT,
  "prospect_id" TEXT,
  "email"       TEXT NOT NULL,
  "reply_type"  TEXT NOT NULL,
  "subject"     TEXT,
  "body_text"   TEXT NOT NULL,
  "handled_by"  TEXT,
  "handled_at"  TIMESTAMP(3),
  "status"      TEXT NOT NULL DEFAULT 'new',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outreach_replies_campaign_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE SET NULL,
  CONSTRAINT "outreach_replies_prospect_fk"
    FOREIGN KEY ("prospect_id") REFERENCES "outreach_prospects"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "outreach_replies_email_idx" ON "outreach_replies"("email");
CREATE INDEX IF NOT EXISTS "outreach_replies_status_idx" ON "outreach_replies"("status");

CREATE TABLE IF NOT EXISTS "outreach_leads" (
  "id"                TEXT PRIMARY KEY,
  "prospect_id"       TEXT,
  "campaign_id"       TEXT,
  "email"             TEXT NOT NULL,
  "source"            TEXT NOT NULL,
  "utm_source"        TEXT NOT NULL,
  "utm_medium"        TEXT NOT NULL,
  "utm_campaign"      TEXT NOT NULL,
  "utm_content"       TEXT,
  "utm_term"          TEXT NOT NULL,
  "qualified"         BOOLEAN NOT NULL DEFAULT false,
  "qualified_reason"  TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outreach_leads_campaign_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE SET NULL,
  CONSTRAINT "outreach_leads_prospect_fk"
    FOREIGN KEY ("prospect_id") REFERENCES "outreach_prospects"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "outreach_leads_email_idx" ON "outreach_leads"("email");
CREATE INDEX IF NOT EXISTS "outreach_leads_campaign_idx" ON "outreach_leads"("campaign_id");
CREATE INDEX IF NOT EXISTS "outreach_leads_created_at_idx" ON "outreach_leads"("created_at");
