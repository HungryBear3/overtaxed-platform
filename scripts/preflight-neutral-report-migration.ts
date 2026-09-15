import { Client } from "pg"

async function main() {
  const migrationUrl = process.env.DIRECT_URL?.trim()
  const appUrl=process.env.DATABASE_URL?.trim()
  const runtimeUrl = process.env.OT_NEUTRAL_DATABASE_URL?.trim()
  const deliveryUrl=process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL?.trim()
  if (!migrationUrl || !runtimeUrl || !appUrl||!deliveryUrl) throw new Error("DIRECT_URL, DATABASE_URL, OT_NEUTRAL_DATABASE_URL, and OT_NEUTRAL_DELIVERY_DATABASE_URL are required")
  if(new Set([migrationUrl,runtimeUrl,appUrl,deliveryUrl]).size!==4)throw new Error("All four database URLs must be distinct")
  const migration = new Client({ connectionString: migrationUrl })
  const app = new Client({connectionString:appUrl})
  const runtime = new Client({ connectionString: runtimeUrl })
  const delivery=new Client({connectionString:deliveryUrl})
  await migration.connect();await app.connect(); await runtime.connect();await delivery.connect()
  try {
    const [{ rows: migrationIdentity }, { rows: runtimeIdentity }] = await Promise.all([
      migration.query(`select current_user as role, has_schema_privilege(current_user,'public','CREATE') as can_migrate, r.rolsuper, r.rolcreaterole from pg_roles r where r.rolname=current_user`),
      runtime.query(`select current_user as role, has_schema_privilege(current_user,'public','CREATE') as can_migrate, r.rolsuper, r.rolbypassrls, pg_has_role(current_user,'ot_neutral_runtime','member') as runtime_member from pg_roles r where r.rolname=current_user`),
    ])
    const appIdentity=await app.query(`select current_user as role,current_database() as db,inet_server_addr()::text as host,r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'ot_neutral_app_reader','member') as neutral_reader from pg_roles r where r.rolname=current_user`)
    const deliveryIdentity=await delivery.query(`select current_user as role,current_database() as db,r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'ot_neutral_delivery_runtime','member') delivery_member,has_schema_privilege(current_user,'public','CREATE') can_migrate from pg_roles r where r.rolname=current_user`)
    const migrationServer=await migration.query(`select current_database() as db,inet_server_addr()::text as host`),runtimeServer=await runtime.query(`select current_database() as db,inet_server_addr()::text as host`)
    if(appIdentity.rows[0]?.role===runtimeIdentity[0]?.role||appIdentity.rows[0]?.role===migrationIdentity[0]?.role||appIdentity.rows[0]?.rolsuper||appIdentity.rows[0]?.rolbypassrls||!appIdentity.rows[0]?.neutral_reader||appIdentity.rows[0]?.db!==runtimeServer.rows[0]?.db||migrationServer.rows[0]?.db!==runtimeServer.rows[0]?.db)throw new Error("Three database identities are not isolated on the same database or app neutral reader is absent")
    const di=deliveryIdentity.rows[0];if(!di?.delivery_member||di.rolsuper||di.rolbypassrls||di.can_migrate||[migrationIdentity[0]?.role,runtimeIdentity[0]?.role,appIdentity.rows[0]?.role].includes(di.role)||di.db!==runtimeServer.rows[0]?.db)throw new Error("Neutral delivery identity is not isolated and restricted")
    if (!migrationIdentity[0]?.can_migrate || (!migrationIdentity[0]?.rolsuper && !migrationIdentity[0]?.rolcreaterole)) throw new Error("DIRECT_URL identity lacks schema/role migration authority")
    if (runtimeIdentity[0]?.can_migrate || runtimeIdentity[0]?.rolsuper || runtimeIdentity[0]?.rolbypassrls || !runtimeIdentity[0]?.runtime_member || runtimeIdentity[0]?.role===migrationIdentity[0]?.role) throw new Error("DATABASE_URL runtime identity is over-privileged or not isolated")
    const group=await migration.query(`select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='ot_neutral_runtime'`)
    if (group.rows.length!==1 || group.rows[0].rolcanlogin || group.rows[0].rolsuper || group.rows[0].rolbypassrls) throw new Error("Neutral runtime role invariants are invalid")
    const deliveryGroup=await migration.query(`select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='ot_neutral_delivery_runtime'`)
    if(deliveryGroup.rows.length!==1||deliveryGroup.rows[0].rolcanlogin||deliveryGroup.rows[0].rolsuper||deliveryGroup.rows[0].rolbypassrls)throw new Error("Neutral delivery role invariants are invalid")
    const deliveryGrants=await delivery.query(`select has_column_privilege(current_user,'ot_packet_download_capability','capability_hash','SELECT') and has_column_privilege(current_user,'ot_packet_download_capability','capability_hash','INSERT') and has_column_privilege(current_user,'ot_packet_download_capability','use_count','UPDATE') allowed,has_table_privilege(current_user,'ot_packet_download_capability','DELETE,TRUNCATE,REFERENCES,TRIGGER') excessive,has_column_privilege(current_user,'ot_delivery_attempt','download_capability_id','UPDATE') attempt_update`)
    if(!deliveryGrants.rows[0]?.allowed||deliveryGrants.rows[0]?.excessive||!deliveryGrants.rows[0]?.attempt_update)throw new Error("Neutral delivery grants are incomplete or excessive")
    const tables = await runtime.query(`select to_regclass('public.ot_neutral_report_reservation') as reservation, to_regclass('public.ot_neutral_qa_review') as qa_review, to_regclass('public.ot_neutral_customer_zip_attempt') as zip_attempt,to_regclass('public.ot_neutral_refund_work') as refund_work`)
    if (!tables.rows[0]?.reservation || !tables.rows[0]?.qa_review || !tables.rows[0]?.zip_attempt || !tables.rows[0]?.refund_work) throw new Error("Neutral report Phase 3 migrations are not installed")
    const grants = await runtime.query(`select has_table_privilege(current_user,'ot_neutral_report_reservation','SELECT,INSERT,UPDATE') as allowed, has_table_privilege(current_user,'ot_neutral_report_reservation','DELETE,TRUNCATE,REFERENCES,TRIGGER') as excessive`)
    if (!grants.rows[0]?.allowed || grants.rows[0]?.excessive) throw new Error("Runtime neutral-report grants are not restricted as required")
    for (const tableName of ['ot_neutral_qa_review','ot_neutral_customer_zip_attempt','ot_neutral_refund_work']) {
      const phase3Grants = await runtime.query(`select has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE') as allowed, has_table_privilege(current_user,$1,'DELETE,TRUNCATE,REFERENCES,TRIGGER') as excessive`, [tableName])
      if (!phase3Grants.rows[0]?.allowed || phase3Grants.rows[0]?.excessive) throw new Error(`Runtime ${tableName} grants are incomplete or excessive`)
      const phase3Security = await runtime.query(`select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid=$1::regclass`, [tableName])
      if (!phase3Security.rows[0]?.relrowsecurity || !phase3Security.rows[0]?.relforcerowsecurity || phase3Security.rows[0]?.owner===runtimeIdentity[0]?.role) throw new Error(`RLS/ownership boundary is not enforced for ${tableName}`)
    }
    const authorityGrants=await runtime.query(`select has_column_privilege(current_user,'ot_order','id','SELECT') and has_column_privilege(current_user,'ot_order','propertyPin','SELECT') and has_column_privilege(current_user,'ot_order','status','SELECT') and has_column_privilege(current_user,'ot_order','settledAmountCents','SELECT') and has_column_privilege(current_user,'ot_payment_binding','payment_intent','SELECT') and has_column_privilege(current_user,'ot_settlement_reversal','payment_intent','SELECT') as allowed, has_table_privilege(current_user,'ot_order','INSERT,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_payment_binding','INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_settlement_reversal','INSERT,UPDATE,DELETE,TRUNCATE') as excessive`)
    if (!authorityGrants.rows[0]?.allowed || authorityGrants.rows[0]?.excessive) throw new Error("Runtime authority-source grants are incomplete or excessive")
    const appNeutral=await app.query(`select has_column_privilege(current_user,'ot_neutral_report_reservation','bundle_sha256','SELECT') and has_column_privilege(current_user,'ot_neutral_report_reservation','superseded_by_sha256','SELECT') and has_column_privilege(current_user,'ot_neutral_qa_review','customer_artifact_sha256','SELECT') and has_column_privilege(current_user,'ot_neutral_qa_review','fulfillment_id','SELECT') as allowed, has_table_privilege(current_user,'ot_neutral_report_reservation','INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_neutral_qa_review','INSERT,UPDATE,DELETE,TRUNCATE') as excessive`)
    if (!appNeutral.rows[0]?.allowed || appNeutral.rows[0]?.excessive) throw new Error("App neutral authority-read grants are incomplete or excessive")
    const fulfillmentGrants=await runtime.query(`select has_column_privilege(current_user,'ot_fulfillment','attempt_count','SELECT') and has_column_privilege(current_user,'ot_fulfillment_artifact','generator_version','SELECT') and has_column_privilege(current_user,'ot_fulfillment_artifact','source_order_id','SELECT') as allowed, has_table_privilege(current_user,'ot_fulfillment','UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_fulfillment_artifact','UPDATE,DELETE,TRUNCATE') as excessive`)
    if(!fulfillmentGrants.rows[0]?.allowed||fulfillmentGrants.rows[0]?.excessive)throw new Error("Neutral fulfillment grants are incomplete or excessive")
    const sharedOwners=await runtime.query(`select relname,pg_get_userbyid(relowner) owner from pg_class where oid in ('ot_fulfillment'::regclass,'ot_fulfillment_artifact'::regclass)`)
    if(sharedOwners.rows.length!==2||sharedOwners.rows.some(row=>row.owner===runtimeIdentity[0]?.role))throw new Error("Neutral runtime must not own shared fulfillment tables")
    const security = await runtime.query(`select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid='ot_neutral_report_reservation'::regclass`)
    if (!security.rows[0]?.relrowsecurity || !security.rows[0]?.relforcerowsecurity || security.rows[0]?.owner===runtimeIdentity[0]?.role) throw new Error("RLS/ownership boundary is not enforced")
    await runtime.query("begin")
    try {
      await runtime.query(`select count(*) from ot_neutral_report_reservation`)
      await runtime.query(`select o."id" from ot_order o left join ot_payment_binding b on b.order_id=o."id" left join ot_settlement_reversal r on r.payment_intent=b.payment_intent where false`)
      await runtime.query(`update ot_neutral_report_reservation set updated_at=updated_at where false`)
      await runtime.query(`select count(*) from ot_neutral_qa_review`)
      await runtime.query(`select count(*) from ot_neutral_customer_zip_attempt`)
      await runtime.query(`select count(*) from ot_neutral_refund_work`)
      await runtime.query(`select a.generator_version,a.source_order_id from ot_fulfillment_artifact a where false`)
      await runtime.query(`insert into ot_fulfillment(id,order_id,kind,status,updated_at) select '','','NEUTRAL_RECORDS_REPORT','ARTIFACT_READY',clock_timestamp() where false`)
      await runtime.query(`insert into ot_fulfillment_artifact(id,fulfillment_id,version,artifact_sha256,byte_size,storage_locator,generator_version,template_version,generated_at,source_order_id,property_binding_fingerprint) select '','',1,repeat('a',64),1,'','neutral-customer-zip/v1','',clock_timestamp(),'',repeat('a',64) where false`)
      await app.query(`select r.bundle_sha256,r.superseded_by_sha256,q.customer_artifact_sha256,q.fulfillment_id from ot_neutral_report_reservation r join ot_neutral_qa_review q on q.reservation_id=r.id where false`)
      await runtime.query(`insert into ot_neutral_report_reservation (id,order_id,policy_version,property_fingerprint,reservation_key,checkout_price_id,checkout_product_id,admission_sha256,data_evidence_sha256,deadline_evidence_sha256,source_content_sha256,deadline_identity_sha256,official_retrieved_at,deadline_retrieved_at,cohort_position,reviewer_key,reviewer_week_start) select '', '', '', repeat('a',64), '', '', '', repeat('a',64),repeat('a',64),repeat('a',64),repeat('a',64),repeat('a',64),current_timestamp,current_timestamp,1,'x',current_date where false`)
      let deleteDenied=false
      await runtime.query("savepoint deny_delete")
      try { await runtime.query(`delete from ot_neutral_report_reservation where false`) } catch { deleteDenied=true; await runtime.query("rollback to savepoint deny_delete") }
      if (!deleteDenied) throw new Error("Runtime DELETE unexpectedly succeeded")
      for (const tableName of ['ot_neutral_qa_review','ot_neutral_customer_zip_attempt','ot_neutral_refund_work']) {
        let phase3DeleteDenied=false
        await runtime.query(`savepoint deny_delete_${tableName}`)
        try { await runtime.query(`delete from ${tableName} where false`) } catch { phase3DeleteDenied=true; await runtime.query(`rollback to savepoint deny_delete_${tableName}`) }
        if (!phase3DeleteDenied) throw new Error(`Runtime DELETE unexpectedly succeeded for ${tableName}`)
      }
      for(const tableName of ['ot_fulfillment','ot_fulfillment_artifact']){
        for(const verb of ['update','delete','truncate']){
          let denied=false;const savepoint=`deny_${verb}_${tableName}`;await runtime.query(`savepoint ${savepoint}`)
          try{if(verb==='update')await runtime.query(`update ${tableName} set id=id where false`);else if(verb==='delete')await runtime.query(`delete from ${tableName} where false`);else await runtime.query(`truncate ${tableName}`)}catch{denied=true;await runtime.query(`rollback to savepoint ${savepoint}`)}
          if(!denied)throw new Error(`Runtime ${verb} unexpectedly succeeded for ${tableName}`)
        }
      }
    } finally { await runtime.query("rollback") }
    process.stdout.write("neutral-report migration preflight: PASS\n")
  } finally { await Promise.allSettled([migration.end(),app.end(), runtime.end(),delivery.end()]) }
}
main().catch(() => { process.stderr.write("neutral-report migration preflight: FAIL\n"); process.exitCode = 1 })
