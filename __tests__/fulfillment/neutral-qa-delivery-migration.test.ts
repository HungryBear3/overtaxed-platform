import fs from "node:fs"
import path from "node:path"

const sql = fs.readFileSync(
  path.join(process.cwd(), "prisma/migrations/20260915190000_add_ot_neutral_qa_delivery/migration.sql"),
  "utf8",
)

describe("neutral QA/delivery migration authority", () => {
  it.each(["ot_neutral_customer_zip_attempt", "ot_neutral_qa_review", "ot_neutral_refund_work"])(
    "forces RLS and installs a runtime policy on %s",
    (table) => {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      expect(sql).toContain(`CREATE POLICY "${table}_runtime"`)
      expect(sql).toContain(`REVOKE ALL ON TABLE "${table}" FROM PUBLIC`)
    },
  )

  it("uses the existing non-bypass runtime role and column-bounded shared-table grants", () => {
    expect(sql).toContain("rolname='ot_neutral_runtime'")
    expect(sql).toContain('GRANT SELECT ("id","order_id","kind","status","attempt_count") ON TABLE "ot_fulfillment"')
    expect(sql).toContain('GRANT INSERT ("id","order_id","kind","status","updated_at") ON TABLE "ot_fulfillment"')
    expect(sql).toContain('GRANT SELECT ("fulfillment_id","version","artifact_sha256","byte_size","storage_locator","generator_version","template_version","source_order_id","property_binding_fingerprint") ON TABLE "ot_fulfillment_artifact"')
    expect(sql).not.toMatch(/GRANT ALL|GRANT SELECT, INSERT, UPDATE ON TABLE "ot_fulfillment"/)
    expect(sql).not.toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "ot_neutral_qa_review"')
    expect(sql).toContain('GRANT UPDATE ("status","minutes_spent","reason_code","decided_at","fulfillment_id","customer_artifact_sha256","updated_at")')
  })

  it("gives the global app only the neutral authority columns needed for read-side gates", () => {
    expect(sql).toContain("CREATE ROLE ot_neutral_app_reader NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")
    expect(sql).toContain('GRANT SELECT ("id","order_id","status","bundle_sha256","policy_version","property_fingerprint","superseded_by_sha256","customer_zip_sha256"')
    expect(sql).toContain('GRANT SELECT ("reservation_id","order_id","status","policy_version","artifact_sha256","customer_artifact_sha256","property_binding_fingerprint","fulfillment_id")')
    expect(sql).toContain('CREATE POLICY "ot_neutral_report_reservation_app_read"')
    expect(sql).toContain('CREATE POLICY "ot_neutral_qa_review_app_read"')
    expect(sql).not.toContain('GRANT INSERT ON TABLE "ot_neutral_qa_review" TO ot_neutral_app_reader')
  })

  it("enforces reason and minute semantics in the database", () => {
    expect(sql).toContain('CONSTRAINT "ot_neutral_qa_review_reason_semantics"')
    expect(sql).toContain('"status"=\'APPROVED\' AND "reason_code"=\'QA_PASSED\'')
    expect(sql).toContain('"status"=\'REFUND_REQUIRED\'')
    expect(sql).toContain('"minutes_spent" BETWEEN 1 AND 20')
  })

  it("binds QA to its order and keeps reviewed/customer artifact identities separate", () => {
    expect(sql).toContain('CONSTRAINT "ot_neutral_qa_review_order_fkey"')
    expect(sql).toContain('"customer_artifact_sha256" TEXT')
  })
  it("models read-confirmed reconciliation before promotion",()=>expect(sql).toContain("'READ_CONFIRMED'"))
  it("keeps refund confirmation operator-only and receipt-bound",()=>{
    expect(sql).toContain('CREATE TABLE "ot_neutral_refund_work"')
    expect(sql).toContain("'REFUND_REQUIRED','REFUND_CLAIMED','RECEIPT_RECORDED_PENDING_VERIFICATION','RECEIPT_VERIFICATION_HELD','REFUND_CONFIRMED'")
    expect(sql).toContain("provider_receipt_id\" ~ '^re_[A-Za-z0-9]{8,64}$'")
    expect(sql).not.toMatch(/stripe.*refund/i)
  })

  it("removes shared-commerce access in favor of neutral-only projections",()=>{
    const constrained=fs.readFileSync(path.join(process.cwd(),"prisma/migrations/20260915230000_constrain_ot_neutral_runtime_commerce_reads/migration.sql"),"utf8")
    const postMigrationPreflight=fs.readFileSync(path.join(process.cwd(),"scripts/preflight-neutral-report-migration.ts"),"utf8")
    expect(constrained).toContain('REVOKE ALL ON TABLE "ot_order", "ot_payment_binding", "ot_settlement_reversal"')
    expect(constrained).toContain('CREATE VIEW "ot_neutral_runtime_order"')
    expect(constrained).toContain("policyVersion' = 'ot-neutral-records-report/2026-09-15'")
    expect(constrained).toContain('JOIN "ot_neutral_report_reservation" r ON r."order_id" = b."order_id"')
    expect(constrained).not.toContain('GRANT SELECT ON TABLE "ot_order"')
    expect(postMigrationPreflight).toContain("has_table_privilege(current_user,'ot_neutral_runtime_order','SELECT')")
    expect(postMigrationPreflight).toContain("has_table_privilege(current_user,'ot_neutral_runtime_payment_binding','SELECT')")
    expect(postMigrationPreflight).toContain("has_table_privilege(current_user,'ot_neutral_runtime_settlement_reversal','SELECT')")
    expect(postMigrationPreflight).toContain("Runtime direct shared-commerce read unexpectedly succeeded")
    expect(postMigrationPreflight).toContain("shobj_description(oid, 'pg_database')")
    expect(postMigrationPreflight).not.toContain("has_column_privilege(current_user,'ot_order'")
  })
})
