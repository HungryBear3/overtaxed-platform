-- Recovery-rehearsal catalog fixture for supabase/vault v0.3.1.
--
-- Object shape follows upstream commit
-- 6e0cd916242d922a646e4d611cc215e09dd429f4: the 0.3.0 base SQL
-- (SHA-256 c3739f80d19e1fc18d114705a07ed9fc7c8e3750762abe51f8e9999716fdaff6)
-- plus the no-op 0.3.0--0.3.1 upgrade
-- (SHA-256 c601f01c7d384054536fafd5ebd5d570542360bdcf2f14bfafd4876aaa5d174a).
-- The three native crypto
-- functions are deliberately inert: this fixture exists only in a disposable,
-- empty restore cluster and must never be used to read or write secrets. The
-- rehearsal proves extension identity, version, schema, member objects, table
-- shape, view definition, privileges and restored config-table data; it does
-- not claim to emulate Supabase Vault cryptography.

CREATE FUNCTION vault._crypto_aead_det_encrypt(
  message bytea,
  additional bytea,
  key_id bigint,
  context bytea DEFAULT 'pgsodium',
  nonce bytea DEFAULT NULL
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
COST 1
AS 'SELECT NULL::bytea';

CREATE FUNCTION vault._crypto_aead_det_decrypt(
  message bytea,
  additional bytea,
  key_id bigint,
  context bytea DEFAULT 'pgsodium',
  nonce bytea DEFAULT NULL
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
COST 1
AS 'SELECT NULL::bytea';

CREATE FUNCTION vault._crypto_aead_det_noncegen()
RETURNS bytea
LANGUAGE sql
IMMUTABLE
COST 1
AS 'SELECT decode(repeat(''00'', 24), ''hex'')';

CREATE TABLE vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  key_id uuid,
  nonce bytea DEFAULT vault._crypto_aead_det_noncegen(),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vault.secrets IS
  'Table with encrypted `secret` column for storing sensitive information on disk.';

CREATE UNIQUE INDEX ON vault.secrets USING btree (name) WHERE name IS NOT NULL;

CREATE VIEW vault.decrypted_secrets AS
SELECT s.id,
  s.name,
  s.description,
  s.secret,
  convert_from(
    vault._crypto_aead_det_decrypt(
      message := decode(s.secret, 'base64'::text),
      additional := convert_to(s.id::text, 'utf8'),
      key_id := 0,
      context := 'pgsodium'::bytea,
      nonce := s.nonce
    ),
    'utf8'::name
  ) AS decrypted_secret,
  s.key_id,
  s.nonce,
  s.created_at,
  s.updated_at
FROM vault.secrets s;

CREATE FUNCTION vault.create_secret(
  new_secret text,
  new_name text DEFAULT NULL,
  new_description text DEFAULT '',
  new_key_id uuid DEFAULT NULL
)
RETURNS uuid
SECURITY DEFINER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  rec record;
BEGIN
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (new_secret, new_name, new_description)
  RETURNING * INTO rec;
  UPDATE vault.secrets s
  SET secret = encode(vault._crypto_aead_det_encrypt(
    message := convert_to(rec.secret, 'utf8'),
    additional := convert_to(s.id::text, 'utf8'),
    key_id := 0,
    context := 'pgsodium'::bytea,
    nonce := rec.nonce
  ), 'base64')
  WHERE id = rec.id;
  RETURN rec.id;
END
$$;

CREATE FUNCTION vault.update_secret(
  secret_id uuid,
  new_secret text DEFAULT NULL,
  new_name text DEFAULT NULL,
  new_description text DEFAULT NULL,
  new_key_id uuid DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  decrypted_secret text := (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id
  );
BEGIN
  UPDATE vault.secrets s
  SET
    secret = CASE WHEN new_secret IS NULL THEN s.secret
                  ELSE encode(vault._crypto_aead_det_encrypt(
                    message := convert_to(new_secret, 'utf8'),
                    additional := convert_to(s.id::text, 'utf8'),
                    key_id := 0,
                    context := 'pgsodium'::bytea,
                    nonce := s.nonce
                  ), 'base64') END,
    name = coalesce(new_name, s.name),
    description = coalesce(new_description, s.description),
    updated_at = now()
  WHERE s.id = secret_id;
END
$$;

REVOKE ALL ON FUNCTION
  vault._crypto_aead_det_encrypt,
  vault._crypto_aead_det_decrypt,
  vault._crypto_aead_det_noncegen,
  vault.create_secret,
  vault.update_secret
FROM PUBLIC;

SELECT pg_catalog.pg_extension_config_dump('vault.secrets', '');
