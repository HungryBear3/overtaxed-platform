import fs from "node:fs"
import path from "node:path"

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20260916220000_harden_ot_supabase_public_acl/migration.sql",
  ),
  "utf8",
)

describe("OT hosted-Supabase PUBLIC ACL hardening", () => {
  it("fails closed unless every qualified target exists", () => {
    expect(sql).toContain("to_regclass('extensions.pg_stat_statements')")
    expect(sql).toContain("to_regclass('extensions.pg_stat_statements_info')")
    expect(sql).toContain("to_regprocedure('public.rls_auto_enable()')")
    expect(sql).toContain("to_regclass('public.ot_packet_download_capability')")
    expect(sql).toContain("target topology is invalid")
  })

  it("removes only the approved PUBLIC privileges", () => {
    expect(sql).toContain("REVOKE SELECT ON TABLE extensions.pg_stat_statements")
    expect(sql).toContain("extensions.pg_stat_statements")
    expect(sql).toContain("extensions.pg_stat_statements_info")
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC")
    expect(sql).not.toMatch(/REVOKE ALL/)
  })

  it("proves and adopts each managed owner before revoking", () => {
    expect(sql).toContain("pg_get_userbyid(c.relowner)")
    expect(sql).toContain("pg_get_userbyid(p.proowner)")
    expect(sql).toContain("pg_has_role(current_user, stats_owner, 'SET')")
    expect(sql).toContain("pg_has_role(current_user, rls_owner, 'SET')")
    expect(sql).toContain("pg_has_role(current_user, capability_owner, 'SET')")
    expect(sql).toContain("SET LOCAL ROLE %I")
    expect(sql.match(/RESET ROLE/g)).toHaveLength(3)
  })

  it("forces capability RLS and verifies the final catalog state", () => {
    expect(sql).toContain(
      "ALTER TABLE public.ot_packet_download_capability FORCE ROW LEVEL SECURITY",
    )
    expect(sql).toContain("aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))")
    expect(sql).toContain("aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))")
    expect(sql).toContain("c.relrowsecurity AND c.relforcerowsecurity")
    expect(sql).toContain("hardening verification failed")
  })

  it("contains no application-data mutation", () => {
    expect(sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im)
  })
})
