-- Additive only. No existing payment/order/eligibility state changes.
CREATE TABLE ot_factual_result (
 id text PRIMARY KEY CHECK (id ~ '^res_[a-z0-9]{24}$'),
 snapshot_id text NOT NULL UNIQUE CHECK (snapshot_id ~ '^snap_[a-z0-9]{24}$'),
 subject_key text NOT NULL,
 version integer NOT NULL CHECK (version > 0),
 canonical text NOT NULL CHECK (octet_length(canonical) BETWEEN 1 AND 3000000),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 capture text,
 capture_sha256 text CHECK (capture_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(subject_key,version),
 CHECK ((capture IS NULL) = (capture_sha256 IS NULL)),
 CHECK (capture IS NULL OR octet_length(capture) <= 40000000)
);
CREATE TABLE ot_factual_latest (
 subject_key text PRIMARY KEY,
 version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
 result_id text UNIQUE REFERENCES ot_factual_result(id) ON DELETE RESTRICT,
 CHECK ((version = 0) = (result_id IS NULL))
);
CREATE TABLE ot_factual_disclosure (
 token_sha256 text PRIMARY KEY CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
 result_id text NOT NULL REFERENCES ot_factual_result(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 consumed_at timestamptz
);
CREATE FUNCTION ot_factual_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FACTUAL_RESULT_IMMUTABLE'; END $$;
CREATE TRIGGER ot_factual_result_immutable BEFORE UPDATE OR DELETE ON ot_factual_result
 FOR EACH ROW EXECUTE FUNCTION ot_factual_immutable();
