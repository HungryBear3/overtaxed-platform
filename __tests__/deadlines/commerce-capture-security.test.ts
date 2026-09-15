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
    expect(sql).toContain("(embedded #>> '{snapshot,sources,assessor,retrievedAt}') IS NULL")
    expect(sql).toContain("(embedded #>> '{snapshot,sources,assessor,contentSha256}') IS NULL")
    expect(sql).toContain("(embedded #>> '{sourceBodyBase64}') IS NULL")
    expect(sql).toContain("capture_source_body IS DISTINCT FROM decode")
    expect(sql).toContain("capture_content_sha256 IS DISTINCT FROM encode(sha256(capture_source_body), 'hex')")
    expect(sql).toContain("WHERE roleid = owner_role_oid OR member = owner_role_oid")
    expect(sql).toContain("pre-existing ot_commerce_capture_owner role is not isolated")
    expect(sql).toContain("requires an isolated privileged migration connection")
    expect(sql).not.toContain("GRANT ot_commerce_capture_owner TO")
  })
})
