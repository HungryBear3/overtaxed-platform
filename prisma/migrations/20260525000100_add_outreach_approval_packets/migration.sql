-- Internal OT outreach approval review queue.
-- Review-only: this schema stores admin decisions and safe export state; it does not send email.

CREATE TABLE "outreach_approval_packets" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "township" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "owner_count_note" TEXT NOT NULL,
    "drafted_by" TEXT NOT NULL,
    "updated_label" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "blockers" JSONB,
    "reply_snippet" TEXT,
    "source" TEXT NOT NULL DEFAULT 'workspace-docs',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_approval_packets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outreach_approval_events" (
    "id" TEXT NOT NULL,
    "packet_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'admin',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_approval_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outreach_approval_packets_external_id_key" ON "outreach_approval_packets"("external_id");
CREATE INDEX "outreach_approval_packets_status_updated_at_idx" ON "outreach_approval_packets"("status", "updated_at");
CREATE INDEX "outreach_approval_packets_source_idx" ON "outreach_approval_packets"("source");
CREATE INDEX "outreach_approval_events_packet_id_created_at_idx" ON "outreach_approval_events"("packet_id", "created_at");
CREATE INDEX "outreach_approval_events_action_created_at_idx" ON "outreach_approval_events"("action", "created_at");

ALTER TABLE "outreach_approval_events" ADD CONSTRAINT "outreach_approval_events_packet_id_fkey" FOREIGN KEY ("packet_id") REFERENCES "outreach_approval_packets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
