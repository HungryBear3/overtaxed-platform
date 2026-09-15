import { Client } from "pg"

async function main() {
  const migrationUrl = process.env.DIRECT_URL?.trim()
  const appUrl=process.env.DATABASE_URL?.trim()
  const runtimeUrl = process.env.OT_NEUTRAL_DATABASE_URL?.trim()
  if (!migrationUrl || !runtimeUrl || !appUrl) throw new Error("DIRECT_URL, DATABASE_URL, and OT_NEUTRAL_DATABASE_URL are required")
  if (migrationUrl === runtimeUrl || migrationUrl===appUrl || runtimeUrl===appUrl) throw new Error("Migration, app, and neutral runtime URLs must be distinct")
  const migration = new Client({ connectionString: migrationUrl })
  const app = new Client({connectionString:appUrl})
  const runtime = new Client({ connectionString: runtimeUrl })
  await migration.connect();await app.connect(); await runtime.connect()
  try {
    const [{ rows: migrationIdentity }, { rows: runtimeIdentity }] = await Promise.all([
      migration.query(`select current_user as role, has_schema_privilege(current_user,'public','CREATE') as can_migrate, r.rolsuper, r.rolcreaterole from pg_roles r where r.rolname=current_user`),
      runtime.query(`select current_user as role, has_schema_privilege(current_user,'public','CREATE') as can_migrate, r.rolsuper, r.rolbypassrls, pg_has_role(current_user,'ot_neutral_runtime','member') as runtime_member from pg_roles r where r.rolname=current_user`),
    ])
    const appIdentity=await app.query(`select current_user as role,current_database() as db,inet_server_addr()::text as host,r.rolsuper,r.rolbypassrls from pg_roles r where r.rolname=current_user`)
    const migrationServer=await migration.query(`select current_database() as db,inet_server_addr()::text as host`),runtimeServer=await runtime.query(`select current_database() as db,inet_server_addr()::text as host`)
    if(appIdentity.rows[0]?.role===runtimeIdentity[0]?.role||appIdentity.rows[0]?.role===migrationIdentity[0]?.role||appIdentity.rows[0]?.rolsuper||appIdentity.rows[0]?.rolbypassrls||appIdentity.rows[0]?.db!==runtimeServer.rows[0]?.db||migrationServer.rows[0]?.db!==runtimeServer.rows[0]?.db)throw new Error("Three database identities are not isolated on the same database")
    if (!migrationIdentity[0]?.can_migrate || (!migrationIdentity[0]?.rolsuper && !migrationIdentity[0]?.rolcreaterole)) throw new Error("DIRECT_URL identity lacks schema/role migration authority")
    if (runtimeIdentity[0]?.can_migrate || runtimeIdentity[0]?.rolsuper || runtimeIdentity[0]?.rolbypassrls || !runtimeIdentity[0]?.runtime_member || runtimeIdentity[0]?.role===migrationIdentity[0]?.role) throw new Error("DATABASE_URL runtime identity is over-privileged or not isolated")
    const group=await migration.query(`select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='ot_neutral_runtime'`)
    if (group.rows.length!==1 || group.rows[0].rolcanlogin || group.rows[0].rolsuper || group.rows[0].rolbypassrls) throw new Error("Neutral runtime role invariants are invalid")
    const table = await runtime.query(`select to_regclass('public.ot_neutral_report_reservation') as table_name`)
    if (!table.rows[0]?.table_name) throw new Error("Neutral report repository migration is not installed")
    const grants = await runtime.query(`select has_table_privilege(current_user,'ot_neutral_report_reservation','SELECT,INSERT,UPDATE') as allowed, has_table_privilege(current_user,'ot_neutral_report_reservation','DELETE,TRUNCATE,REFERENCES,TRIGGER') as excessive`)
    if (!grants.rows[0]?.allowed || grants.rows[0]?.excessive) throw new Error("Runtime neutral-report grants are not restricted as required")
    const authorityGrants=await runtime.query(`select has_column_privilege(current_user,'ot_order','id','SELECT') and has_column_privilege(current_user,'ot_order','propertyPin','SELECT') and has_column_privilege(current_user,'ot_order','status','SELECT') and has_column_privilege(current_user,'ot_order','settledAmountCents','SELECT') and has_column_privilege(current_user,'ot_payment_binding','payment_intent','SELECT') and has_column_privilege(current_user,'ot_settlement_reversal','payment_intent','SELECT') as allowed, has_table_privilege(current_user,'ot_order','INSERT,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_payment_binding','INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_settlement_reversal','INSERT,UPDATE,DELETE,TRUNCATE') as excessive`)
    if (!authorityGrants.rows[0]?.allowed || authorityGrants.rows[0]?.excessive) throw new Error("Runtime authority-source grants are incomplete or excessive")
    const security = await runtime.query(`select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid='ot_neutral_report_reservation'::regclass`)
    if (!security.rows[0]?.relrowsecurity || !security.rows[0]?.relforcerowsecurity || security.rows[0]?.owner===runtimeIdentity[0]?.role) throw new Error("RLS/ownership boundary is not enforced")
    await runtime.query("begin")
    try {
      await runtime.query(`select count(*) from ot_neutral_report_reservation`)
      await runtime.query(`select o."id" from ot_order o left join ot_payment_binding b on b.order_id=o."id" left join ot_settlement_reversal r on r.payment_intent=b.payment_intent where false`)
      await runtime.query(`update ot_neutral_report_reservation set updated_at=updated_at where false`)
      await runtime.query(`insert into ot_neutral_report_reservation (id,order_id,policy_version,property_fingerprint,reservation_key,checkout_price_id,checkout_product_id,admission_sha256,data_evidence_sha256,deadline_evidence_sha256,source_content_sha256,deadline_identity_sha256,official_retrieved_at,deadline_retrieved_at,cohort_position,reviewer_key,reviewer_week_start) select '', '', '', repeat('a',64), '', '', '', repeat('a',64),repeat('a',64),repeat('a',64),repeat('a',64),repeat('a',64),current_timestamp,current_timestamp,1,'x',current_date where false`)
      let deleteDenied=false
      await runtime.query("savepoint deny_delete")
      try { await runtime.query(`delete from ot_neutral_report_reservation where false`) } catch { deleteDenied=true; await runtime.query("rollback to savepoint deny_delete") }
      if (!deleteDenied) throw new Error("Runtime DELETE unexpectedly succeeded")
    } finally { await runtime.query("rollback") }
    process.stdout.write("neutral-report migration preflight: PASS\n")
  } finally { await Promise.allSettled([migration.end(),app.end(), runtime.end()]) }
}
main().catch(() => { process.stderr.write("neutral-report migration preflight: FAIL\n"); process.exitCode = 1 })
