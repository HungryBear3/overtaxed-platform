-- Additive, private zero-total (legitimate 100% discount) settlement evidence.
-- A fully discounted Checkout Session has no PaymentIntent, so it can never be
-- written to the PI-only payment ledger. This is its truthful counterpart: the
-- server-allowlisted promotion code persisted on the order at checkout, bound to
-- the exact order + session + subtotal it fully discounted. No legacy backfill.
BEGIN;
ALTER TABLE ot_order ADD COLUMN "checkoutDiscountPromotionCodeId" TEXT;
CREATE TABLE ot_zero_total_settlement (
 order_id TEXT PRIMARY KEY REFERENCES ot_order(id),
 session_id TEXT NOT NULL UNIQUE CHECK (session_id LIKE 'cs_%'),
 event_id TEXT NOT NULL,
 promotion_code TEXT NOT NULL CHECK (promotion_code LIKE 'promo_%'),
 coupon TEXT NOT NULL,
 subtotal_cents INTEGER NOT NULL,
 discount_cents INTEGER NOT NULL,
 currency TEXT NOT NULL,
 settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (discount_cents = subtotal_cents AND subtotal_cents > 0)
);
ALTER TABLE ot_zero_total_settlement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ot_zero_total_settlement FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON ot_zero_total_settlement FROM %I',r);
  END IF;
 END LOOP;
END $$;
CREATE TRIGGER ot_zero_total_settlement_immutable BEFORE UPDATE OR DELETE ON ot_zero_total_settlement
 FOR EACH ROW EXECUTE FUNCTION ot_settlement_evidence_immutable();
-- Neutral runtime reads settlement authority only through reservation-scoped views.
CREATE VIEW "ot_neutral_runtime_zero_total_settlement"
WITH (security_barrier = true) AS
SELECT z."order_id", z."session_id", z."promotion_code", z."subtotal_cents", z."discount_cents"
FROM "ot_zero_total_settlement" z
JOIN "ot_neutral_report_reservation" r ON r."order_id" = z."order_id";
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_runtime') THEN
  REVOKE ALL ON TABLE ot_zero_total_settlement FROM ot_neutral_runtime;
  GRANT SELECT ON TABLE "ot_neutral_runtime_zero_total_settlement" TO ot_neutral_runtime;
 END IF;
END $$;
-- Neutral delivery (customer download) authority: same columns, PI branch
-- byte-identical to 20260915220000, plus the exact zero-total settlement.
CREATE OR REPLACE VIEW "ot_neutral_delivery_order" WITH (security_barrier=true) AS
SELECT DISTINCT o."id",o."tier",o."status",o."propertyPin",o."propertyAddress",o."email",
  (EXISTS (SELECT 1 FROM "ot_payment_binding" b WHERE b."order_id"=o."id" AND b."session_id"=o."stripeSessionId" AND b."payment_intent" LIKE 'pi_%' AND NOT EXISTS (SELECT 1 FROM "ot_settlement_reversal" x WHERE x."payment_intent"=b."payment_intent"))
   OR EXISTS (SELECT 1 FROM "ot_zero_total_settlement" z WHERE z."order_id"=o."id" AND z."session_id"=o."stripeSessionId" AND z."discount_cents"=z."subtotal_cents" AND o."settledAmountCents"=0 AND o."checkoutAmountCents"=z."subtotal_cents")) AS "paymentAuthoritative"
FROM "ot_order" o JOIN "ot_fulfillment" f ON f."order_id"=o."id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'
JOIN "ot_neutral_report_reservation" r ON r."order_id"=o."id";
COMMIT;
