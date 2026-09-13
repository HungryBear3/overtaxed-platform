import fs from "node:fs"
import path from "node:path"

describe("commerce capture authority", () => {
  it("reads immutable capture rows rather than a mutable SystemConfig pointer", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/deadlines/commerce-snapshot-store.ts"), "utf8")
    expect(source).toContain('FROM "ot_commerce_deadline_capture"')
    expect(source).not.toContain('FROM "SystemConfig"')
    expect(source).not.toContain("ON CONFLICT")
  })

  it("ships database append-only and application-role write restrictions", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260913170000_add_ot_commerce_deadline_capture/migration.sql"), "utf8")
    expect(sql).toContain("BEFORE UPDATE OR DELETE")
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY")
    expect(sql).toContain("REVOKE ALL ON TABLE")
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER")
    expect(sql).toContain("SECURITY DEFINER")
    expect(sql).toContain("ot_commerce_capture_owner NOLOGIN NOINHERIT")
    expect(sql).toContain('ALTER TABLE public."ot_commerce_deadline_capture" OWNER TO ot_commerce_capture_owner')
    expect(sql).toContain("capture_source_body <> decode")
    expect(sql).toContain("encode(sha256(capture_source_body), 'hex')")
  })
})
