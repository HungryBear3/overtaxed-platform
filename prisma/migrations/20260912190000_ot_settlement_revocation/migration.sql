-- Additive, private settlement evidence. No legacy replay/backfill.
CREATE TABLE ot_payment_binding (
 order_id TEXT PRIMARY KEY REFERENCES ot_order(id),
 session_id TEXT NOT NULL UNIQUE,
 payment_intent TEXT NOT NULL UNIQUE CHECK (payment_intent LIKE 'pi_%')
);
CREATE TABLE ot_settlement_reversal (
 event_id TEXT PRIMARY KEY,
 event_type TEXT NOT NULL,
 payment_intent TEXT NOT NULL CHECK (payment_intent LIKE 'pi_%'),
 received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON ot_settlement_reversal(payment_intent);
ALTER TABLE ot_payment_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE ot_settlement_reversal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ot_payment_binding, ot_settlement_reversal FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON ot_payment_binding, ot_settlement_reversal FROM %I',r);
  END IF;
 END LOOP;
END $$;
-- Never let late settlement/recovery writes reopen a held order. This also
-- protects administrative code paths which know nothing about the new ledger.
CREATE FUNCTION ot_preserve_settlement_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status = 'SETTLEMENT_HOLD' AND NEW.status NOT IN ('CANCELLED','REFUNDED') THEN
  NEW.status := 'SETTLEMENT_HOLD';
 ELSIF NEW.status = 'PAID' AND EXISTS (
  SELECT 1 FROM ot_payment_binding b JOIN ot_settlement_reversal r USING(payment_intent) WHERE b.order_id=NEW.id
 ) THEN NEW.status := 'SETTLEMENT_HOLD'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ot_preserve_settlement_hold BEFORE UPDATE ON ot_order
 FOR EACH ROW EXECUTE FUNCTION ot_preserve_settlement_hold();

CREATE FUNCTION ot_settlement_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Settlement evidence is append-only'; END $$;
CREATE TRIGGER ot_payment_binding_immutable BEFORE UPDATE OR DELETE ON ot_payment_binding
 FOR EACH ROW EXECUTE FUNCTION ot_settlement_evidence_immutable();
CREATE TRIGGER ot_settlement_reversal_immutable BEFORE UPDATE OR DELETE ON ot_settlement_reversal
 FOR EACH ROW EXECUTE FUNCTION ot_settlement_evidence_immutable();
