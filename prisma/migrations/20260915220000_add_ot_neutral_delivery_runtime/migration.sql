-- Dedicated least-privilege identity for neutral delivery/capability work.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_delivery_runtime') THEN
    CREATE ROLE ot_neutral_delivery_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ot_neutral_delivery_runtime;

REVOKE ALL ON "ot_order","ot_payment_binding","ot_settlement_reversal" FROM ot_neutral_delivery_runtime;
GRANT SELECT ("id","order_id","kind","status","status_revision","attempt_count") ON "ot_fulfillment" TO ot_neutral_delivery_runtime;
GRANT SELECT ("id","fulfillment_id","version","artifact_sha256","byte_size","storage_locator","template_version","source_order_id","property_binding_fingerprint") ON "ot_fulfillment_artifact" TO ot_neutral_delivery_runtime;
GRANT SELECT ("fulfillment_id","attempt_number","provider","idempotency_key","download_capability_id") ON "ot_delivery_attempt" TO ot_neutral_delivery_runtime;
GRANT UPDATE ("download_capability_id") ON "ot_delivery_attempt" TO ot_neutral_delivery_runtime;
GRANT SELECT ("id","capability_hash","fulfillment_id","artifact_id","artifact_version","artifact_sha256","source_order_id","property_binding_fingerprint","expires_at","max_uses","use_count","revoked_at") ON "ot_packet_download_capability" TO ot_neutral_delivery_runtime;
GRANT INSERT ("id","capability_hash","fulfillment_id","artifact_id","artifact_version","artifact_sha256","source_order_id","property_binding_fingerprint","issued_at","expires_at","max_uses","use_count") ON "ot_packet_download_capability" TO ot_neutral_delivery_runtime;
GRANT UPDATE ("use_count","last_used_at","revoked_at","revoked_reason_code") ON "ot_packet_download_capability" TO ot_neutral_delivery_runtime;
GRANT SELECT ("id","order_id","status","bundle_sha256","policy_version","property_fingerprint","superseded_by_sha256") ON "ot_neutral_report_reservation" TO ot_neutral_delivery_runtime;
GRANT SELECT ("reservation_id","order_id","status","policy_version","artifact_sha256","customer_artifact_sha256","property_binding_fingerprint","fulfillment_id") ON "ot_neutral_qa_review" TO ot_neutral_delivery_runtime;

ALTER TABLE "ot_delivery_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_fulfillment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_fulfillment_artifact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ot_neutral_runtime_fulfillment_all" ON "ot_fulfillment" FOR ALL TO ot_neutral_runtime USING ("kind"::text='NEUTRAL_RECORDS_REPORT') WITH CHECK ("kind"::text='NEUTRAL_RECORDS_REPORT');
CREATE POLICY "ot_neutral_runtime_artifact_all" ON "ot_fulfillment_artifact" FOR ALL TO ot_neutral_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT')) WITH CHECK (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_reversal_guard_fulfillment_read" ON "ot_fulfillment" FOR SELECT TO ot_neutral_reversal_guard_owner USING ("kind"::text='NEUTRAL_RECORDS_REPORT');
CREATE POLICY "ot_neutral_delivery_fulfillment_read" ON "ot_fulfillment" FOR SELECT TO ot_neutral_delivery_runtime USING ("kind"::text='NEUTRAL_RECORDS_REPORT');
CREATE POLICY "ot_neutral_delivery_artifact_read" ON "ot_fulfillment_artifact" FOR SELECT TO ot_neutral_delivery_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_delivery_attempt_read" ON "ot_delivery_attempt" FOR SELECT TO ot_neutral_delivery_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_delivery_attempt_update" ON "ot_delivery_attempt" FOR UPDATE TO ot_neutral_delivery_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT')) WITH CHECK (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_delivery_capability_all" ON "ot_packet_download_capability" FOR ALL TO ot_neutral_delivery_runtime USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT')) WITH CHECK (EXISTS (SELECT 1 FROM "ot_fulfillment" f WHERE f."id"="fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_delivery_reservation_read" ON "ot_neutral_report_reservation" FOR SELECT TO ot_neutral_delivery_runtime USING (true);
CREATE POLICY "ot_neutral_delivery_qa_read" ON "ot_neutral_qa_review" FOR SELECT TO ot_neutral_delivery_runtime USING (true);

CREATE VIEW "ot_neutral_delivery_order" WITH (security_barrier=true) AS
SELECT DISTINCT o."id",o."tier",o."status",o."propertyPin",o."propertyAddress",o."email",
  EXISTS (SELECT 1 FROM "ot_payment_binding" b WHERE b."order_id"=o."id" AND b."session_id"=o."stripeSessionId" AND b."payment_intent" LIKE 'pi_%' AND NOT EXISTS (SELECT 1 FROM "ot_settlement_reversal" x WHERE x."payment_intent"=b."payment_intent")) AS "paymentAuthoritative"
FROM "ot_order" o JOIN "ot_fulfillment" f ON f."order_id"=o."id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'
JOIN "ot_neutral_report_reservation" r ON r."order_id"=o."id";
REVOKE ALL ON "ot_neutral_delivery_order" FROM PUBLIC;
GRANT SELECT ON "ot_neutral_delivery_order" TO ot_neutral_delivery_runtime;
CREATE VIEW "ot_fulfillment_kind_authority" WITH (security_barrier=true) AS SELECT "id","kind"::text "kind" FROM "ot_fulfillment";
CREATE VIEW "ot_packet_capability_kind_authority" WITH (security_barrier=true) AS SELECT c."capability_hash",f."kind"::text "kind" FROM "ot_packet_download_capability" c JOIN "ot_fulfillment" f ON f."id"=c."fulfillment_id";
REVOKE ALL ON "ot_fulfillment_kind_authority","ot_packet_capability_kind_authority" FROM PUBLIC;
GRANT SELECT ON "ot_fulfillment_kind_authority","ot_packet_capability_kind_authority" TO ot_neutral_app_reader;

CREATE FUNCTION ot_enforce_neutral_capability_single_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "ot_fulfillment" f WHERE f."id"=NEW."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT') AND NEW."max_uses"<>1 THEN RAISE EXCEPTION 'neutral capability must be single-use'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ot_neutral_capability_single_use BEFORE INSERT OR UPDATE OF "max_uses","fulfillment_id" ON "ot_packet_download_capability" FOR EACH ROW EXECUTE FUNCTION ot_enforce_neutral_capability_single_use();
