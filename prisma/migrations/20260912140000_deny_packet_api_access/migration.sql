-- Corrective additive hardening; original creation may already be installed.
ALTER TABLE "ot_packet_download_capability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_artifact_orphan_quarantine" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ot_packet_download_capability", "ot_artifact_orphan_quarantine" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "ot_packet_download_capability", "ot_artifact_orphan_quarantine" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
