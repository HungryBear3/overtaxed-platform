-- The neutral runtime may inspect only commerce rows explicitly designated for
-- the neutral policy (before reservation) or already bound to a neutral
-- reservation. It never receives direct access to the shared commerce tables.
CREATE VIEW "ot_neutral_runtime_order"
WITH (security_barrier = true) AS
SELECT o."id", o."tier", o."propertyPin", o."status", o."stripeSessionId",
       o."checkoutPriceId", o."checkoutProductId", o."checkoutAmountCents",
       o."checkoutCurrency", o."settledAmountCents", o."settledCurrency",
       o."amountPaid", o."eligibilitySnapshot"
FROM "ot_order" o
WHERE o."eligibilitySnapshot"->>'policyVersion' = 'ot-neutral-records-report/2026-09-15'
   OR EXISTS (
     SELECT 1 FROM "ot_neutral_report_reservation" r WHERE r."order_id" = o."id"
   );

CREATE VIEW "ot_neutral_runtime_payment_binding"
WITH (security_barrier = true) AS
SELECT b."order_id", b."session_id", b."payment_intent"
FROM "ot_payment_binding" b
JOIN "ot_neutral_report_reservation" r ON r."order_id" = b."order_id";

CREATE VIEW "ot_neutral_runtime_settlement_reversal"
WITH (security_barrier = true) AS
SELECT x."payment_intent"
FROM "ot_settlement_reversal" x
WHERE EXISTS (
  SELECT 1
  FROM "ot_neutral_runtime_payment_binding" b
  WHERE b."payment_intent" = x."payment_intent"
);

REVOKE ALL ON TABLE "ot_order", "ot_payment_binding", "ot_settlement_reversal"
  FROM ot_neutral_runtime;
DROP POLICY IF EXISTS "ot_neutral_runtime_payment_binding_read" ON "ot_payment_binding";
DROP POLICY IF EXISTS "ot_neutral_runtime_reversal_read" ON "ot_settlement_reversal";
GRANT SELECT ON TABLE "ot_neutral_runtime_order",
  "ot_neutral_runtime_payment_binding",
  "ot_neutral_runtime_settlement_reversal" TO ot_neutral_runtime;

ALTER TABLE "ot_neutral_refund_work"
  ADD COLUMN "provider_lookup_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_provider_lookup_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_provider_lookup_result" TEXT,
  ADD CONSTRAINT "ot_neutral_refund_lookup_audit_shape" CHECK (
    "provider_lookup_attempts" >= 0
    AND (("provider_lookup_attempts" = 0 AND "last_provider_lookup_at" IS NULL AND "last_provider_lookup_result" IS NULL)
      OR ("provider_lookup_attempts" > 0 AND "last_provider_lookup_at" IS NOT NULL AND "last_provider_lookup_result" IN ('RETRYABLE_PROVIDER_FAILURE','PROVIDER_RESPONSE_RECEIVED')))
  );
GRANT UPDATE ("provider_lookup_attempts","last_provider_lookup_at","last_provider_lookup_result","updated_at")
  ON TABLE "ot_neutral_refund_work" TO ot_neutral_runtime;
