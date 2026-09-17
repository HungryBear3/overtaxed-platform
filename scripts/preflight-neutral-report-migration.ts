import { Client } from "pg";
import { assertSameNeutralPreviewDatabase } from "../lib/fulfillment/neutral-preview-database-marker";

async function main() {
  // Reconciliation's catalog proof pins separate native-PG18 and hosted-
  // Supabase renderings. This preflight intentionally re-proves the portable
  // security invariants below rather than recomputing a host-rendered digest.
  const migrationUrl = process.env.DIRECT_URL?.trim();
  const appUrl = process.env.DATABASE_URL?.trim();
  const runtimeUrl = process.env.OT_NEUTRAL_DATABASE_URL?.trim();
  const deliveryUrl = process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL?.trim();
  if (!migrationUrl || !runtimeUrl || !appUrl || !deliveryUrl)
    throw new Error(
      "DIRECT_URL, DATABASE_URL, OT_NEUTRAL_DATABASE_URL, and OT_NEUTRAL_DELIVERY_DATABASE_URL are required",
    );
  if (new Set([migrationUrl, runtimeUrl, appUrl, deliveryUrl]).size !== 4)
    throw new Error("All four database URLs must be distinct");
  const migration = new Client({ connectionString: migrationUrl });
  const app = new Client({ connectionString: appUrl });
  const runtime = new Client({ connectionString: runtimeUrl });
  const delivery = new Client({ connectionString: deliveryUrl });
  await migration.connect();
  await app.connect();
  await runtime.connect();
  await delivery.connect();
  try {
    const [{ rows: migrationIdentity }, { rows: runtimeIdentity }] =
      await Promise.all([
        migration.query(
          `select current_user as role, has_schema_privilege(current_user,'public','CREATE') as can_migrate, r.rolsuper, r.rolcreaterole from pg_roles r where r.rolname=current_user`,
        ),
        runtime.query(
          `select current_user as role, has_schema_privilege(current_user,'public','CREATE') as can_migrate, r.rolsuper, r.rolbypassrls, pg_has_role(current_user,'ot_neutral_runtime','member') as runtime_member from pg_roles r where r.rolname=current_user`,
        ),
      ]);
    const appIdentity = await app.query(
      `select current_user as role,current_database() as db,inet_server_addr()::text as host,r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'ot_neutral_app_reader','member') as neutral_reader from pg_roles r where r.rolname=current_user`,
    );
    const deliveryIdentity = await delivery.query(
      `select current_user as role,current_database() as db,r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'ot_neutral_delivery_runtime','member') delivery_member,has_schema_privilege(current_user,'public','CREATE') can_migrate from pg_roles r where r.rolname=current_user`,
    );
    const databaseIdentitySql = `select current_database() as "databaseName", shobj_description(oid, 'pg_database') as marker from pg_database where datname=current_database()`;
    const [migrationDatabase, appDatabase, runtimeDatabase, deliveryDatabase] =
      await Promise.all([
        migration.query(databaseIdentitySql),
        app.query(databaseIdentitySql),
        runtime.query(databaseIdentitySql),
        delivery.query(databaseIdentitySql),
      ]);
    assertSameNeutralPreviewDatabase([
      migrationDatabase.rows[0],
      appDatabase.rows[0],
      runtimeDatabase.rows[0],
      deliveryDatabase.rows[0],
    ]);
    const runtimeServer = runtimeDatabase;
    if (
      appIdentity.rows[0]?.role === runtimeIdentity[0]?.role ||
      appIdentity.rows[0]?.role === migrationIdentity[0]?.role ||
      appIdentity.rows[0]?.rolsuper ||
      appIdentity.rows[0]?.rolbypassrls ||
      !appIdentity.rows[0]?.neutral_reader ||
      appIdentity.rows[0]?.db !== runtimeServer.rows[0]?.databaseName
    )
      throw new Error(
        "Three database identities are not isolated on the same database or app neutral reader is absent",
      );
    const di = deliveryIdentity.rows[0];
    if (
      !di?.delivery_member ||
      di.rolsuper ||
      di.rolbypassrls ||
      di.can_migrate ||
      [
        migrationIdentity[0]?.role,
        runtimeIdentity[0]?.role,
        appIdentity.rows[0]?.role,
      ].includes(di.role) ||
      di.db !== runtimeServer.rows[0]?.databaseName
    )
      throw new Error(
        "Neutral delivery identity is not isolated and restricted",
      );
    if (
      !migrationIdentity[0]?.can_migrate ||
      (!migrationIdentity[0]?.rolsuper && !migrationIdentity[0]?.rolcreaterole)
    )
      throw new Error(
        "DIRECT_URL identity lacks schema/role migration authority",
      );
    if (
      runtimeIdentity[0]?.can_migrate ||
      runtimeIdentity[0]?.rolsuper ||
      runtimeIdentity[0]?.rolbypassrls ||
      !runtimeIdentity[0]?.runtime_member ||
      runtimeIdentity[0]?.role === migrationIdentity[0]?.role
    )
      throw new Error(
        "DATABASE_URL runtime identity is over-privileged or not isolated",
      );
    const group = await migration.query(
      `select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='ot_neutral_runtime'`,
    );
    if (
      group.rows.length !== 1 ||
      group.rows[0].rolcanlogin ||
      group.rows[0].rolsuper ||
      group.rows[0].rolbypassrls
    )
      throw new Error("Neutral runtime role invariants are invalid");
    const appReaderGroup = await migration.query(
      `select r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
         has_schema_privilege(r.rolname,'public','CREATE') can_create,
         (select count(*)::int from pg_auth_members m join pg_roles member_role on member_role.oid=m.member join pg_roles grantor_role on grantor_role.oid=m.grantor
           where m.roleid=r.oid and member_role.rolname='ot_preview_app' and grantor_role.rolname='postgres'
             and m.admin_option=false and m.inherit_option=true and m.set_option=true) canonical_login_edges,
         (select count(*)::int from pg_auth_members m join pg_roles member_role on member_role.oid=m.member join pg_roles grantor_role on grantor_role.oid=m.grantor
           where m.roleid=r.oid and member_role.rolname='postgres' and grantor_role.rolname='supabase_admin'
             and m.admin_option=true and m.inherit_option=false and m.set_option=false) reader_platform_edges,
         (select count(*)::int from pg_auth_members m join pg_roles granted_role on granted_role.oid=m.roleid
           join pg_roles member_role on member_role.oid=m.member join pg_roles grantor_role on grantor_role.oid=m.grantor
           where granted_role.rolname='ot_preview_app' and member_role.rolname='postgres' and grantor_role.rolname='supabase_admin'
             and m.admin_option=true and m.inherit_option=false and m.set_option=false) app_login_platform_edges,
         (select count(*)::int from pg_auth_members m join pg_roles granted_role on granted_role.oid=m.roleid
           join pg_roles member_role on member_role.oid=m.member join pg_roles grantor_role on grantor_role.oid=m.grantor
           where (granted_role.rolname in ('ot_neutral_app_reader','ot_preview_app') or member_role.rolname in ('ot_neutral_app_reader','ot_preview_app'))
             and not (granted_role.rolname='ot_neutral_app_reader' and (
               (member_role.rolname='ot_preview_app' and grantor_role.rolname='postgres' and m.admin_option=false and m.inherit_option=true and m.set_option=true)
               or (member_role.rolname='postgres' and grantor_role.rolname='supabase_admin' and m.admin_option=true and m.inherit_option=false and m.set_option=false)))
             and not (granted_role.rolname='ot_preview_app' and member_role.rolname='postgres' and grantor_role.rolname='supabase_admin'
               and m.admin_option=true and m.inherit_option=false and m.set_option=false)) unexpected_edges,
         coalesce((select bool_and(m.roleid=r.oid and (
             (member_role.rolname='ot_preview_app' and grantor_role.rolname='postgres' and m.admin_option=false and m.inherit_option=true and m.set_option=true)
             or (member_role.rolname='postgres' and grantor_role.rolname='supabase_admin' and m.admin_option=true and m.inherit_option=false and m.set_option=false)))
           from pg_auth_members m join pg_roles member_role on member_role.oid=m.member join pg_roles grantor_role on grantor_role.oid=m.grantor
           where m.roleid=r.oid or m.member=r.oid),true) memberships_safe
       from pg_roles r where r.rolname='ot_neutral_app_reader'`,
    );
    const appLogin = await migration.query(
      `select rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
         has_schema_privilege(rolname,'public','USAGE') schema_usage,
         has_schema_privilege(rolname,'public','CREATE') schema_create
       from pg_roles where rolname='ot_preview_app'`,
    );
    if (
      appReaderGroup.rows.length !== 1 ||
      appReaderGroup.rows[0].rolcanlogin ||
      appReaderGroup.rows[0].rolinherit ||
      appReaderGroup.rows[0].rolsuper ||
      appReaderGroup.rows[0].rolcreaterole ||
      appReaderGroup.rows[0].rolcreatedb ||
      appReaderGroup.rows[0].rolreplication ||
      appReaderGroup.rows[0].rolbypassrls ||
      appReaderGroup.rows[0].can_create ||
      appReaderGroup.rows[0].canonical_login_edges !== 1 ||
      ![0, 1].includes(appReaderGroup.rows[0].reader_platform_edges) ||
      ![0, 1].includes(appReaderGroup.rows[0].app_login_platform_edges) ||
      appReaderGroup.rows[0].unexpected_edges !== 0 ||
      !appReaderGroup.rows[0].memberships_safe
    )
      throw new Error("Neutral app-reader role invariants are invalid");
    if (
      appLogin.rows.length !== 1 ||
      !appLogin.rows[0].rolcanlogin ||
      !appLogin.rows[0].rolinherit ||
      appLogin.rows[0].rolsuper ||
      appLogin.rows[0].rolcreaterole ||
      appLogin.rows[0].rolcreatedb ||
      appLogin.rows[0].rolreplication ||
      appLogin.rows[0].rolbypassrls ||
      !appLogin.rows[0].schema_usage ||
      appLogin.rows[0].schema_create
    )
      throw new Error("Canonical Preview app login invariants are invalid");
    const deliveryGroup = await migration.query(
      `select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='ot_neutral_delivery_runtime'`,
    );
    if (
      deliveryGroup.rows.length !== 1 ||
      deliveryGroup.rows[0].rolcanlogin ||
      deliveryGroup.rows[0].rolsuper ||
      deliveryGroup.rows[0].rolbypassrls
    )
      throw new Error("Neutral delivery role invariants are invalid");
    const ownerSecurity = await migration.query(
      `with owners(role_name) as (
         values ('ot_commerce_capture_owner'::text), ('ot_neutral_reversal_guard_owner'::text)
       )
       select o.role_name,
         r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreaterole,
         r.rolcreatedb, r.rolreplication, r.rolbypassrls,
         has_schema_privilege(o.role_name, 'public', 'CREATE') as can_create_schema,
         (select count(*)::int from pg_auth_members m where m.roleid = r.oid or m.member = r.oid) as membership_count,
         (select count(*)::int
          from pg_auth_members m
          join pg_roles member_role on member_role.oid = m.member
          join pg_roles grantor_role on grantor_role.oid = m.grantor
          where (m.roleid = r.oid or m.member = r.oid)
            and m.roleid = r.oid
            and member_role.rolname = 'postgres'
            and grantor_role.rolname = 'supabase_admin'
            and m.admin_option = true
            and m.inherit_option = false
            and m.set_option = false) as platform_edge_count,
         coalesce((
           select bool_and(
             m.roleid = r.oid
             and member_role.rolname = 'postgres'
             and grantor_role.rolname = 'supabase_admin'
             and m.admin_option = true
             and m.inherit_option = false
             and m.set_option = false
           )
           from pg_auth_members m
           join pg_roles member_role on member_role.oid = m.member
           join pg_roles grantor_role on grantor_role.oid = m.grantor
           where m.roleid = r.oid or m.member = r.oid
         ), true) as memberships_safe
       from owners o
       left join pg_roles r on r.rolname = o.role_name`,
    );
    if (
      ownerSecurity.rows.length !== 2 ||
      ownerSecurity.rows.some(
        (row) =>
          !row.role_name ||
          row.rolcanlogin !== false ||
          row.rolinherit !== false ||
          row.rolsuper !== false ||
          row.rolcreaterole !== false ||
          row.rolcreatedb !== false ||
          row.rolreplication !== false ||
          row.rolbypassrls !== false ||
          row.can_create_schema !== false ||
          ![0, 1].includes(row.membership_count) ||
          row.platform_edge_count !== row.membership_count ||
          row.memberships_safe !== true,
      )
    )
      throw new Error("Owner-role final-state security invariants are invalid");
    const ownerObjects = await migration.query(
      `select
         pg_get_userbyid((select relowner from pg_class where oid='public.ot_commerce_deadline_capture'::regclass)) capture_table_owner,
         pg_get_userbyid((select proowner from pg_proc where oid='public.ot_commerce_deadline_capture_append_only()'::regprocedure)) append_function_owner,
         pg_get_userbyid((select proowner from pg_proc where oid='public.ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)'::regprocedure)) publish_function_owner,
         pg_get_userbyid((select proowner from pg_proc where oid='public.ot_neutral_hold_on_settlement_reversal()'::regprocedure)) reversal_function_owner`,
    );
    if (
      ownerObjects.rows[0]?.capture_table_owner !== "ot_commerce_capture_owner" ||
      ownerObjects.rows[0]?.append_function_owner !== "ot_commerce_capture_owner" ||
      ownerObjects.rows[0]?.publish_function_owner !== "ot_commerce_capture_owner" ||
      ownerObjects.rows[0]?.reversal_function_owner !== "ot_neutral_reversal_guard_owner"
    )
      throw new Error("Owner-object final-state topology is invalid");
    const deliveryGrants = await delivery.query(
      `select has_column_privilege(current_user,'ot_packet_download_capability','capability_hash','SELECT') and has_column_privilege(current_user,'ot_packet_download_capability','capability_hash','INSERT') and has_column_privilege(current_user,'ot_packet_download_capability','use_count','UPDATE') allowed,has_table_privilege(current_user,'ot_packet_download_capability','DELETE,TRUNCATE,REFERENCES,TRIGGER') excessive,has_column_privilege(current_user,'ot_delivery_attempt','download_capability_id','UPDATE') attempt_update`,
    );
    if (
      !deliveryGrants.rows[0]?.allowed ||
      deliveryGrants.rows[0]?.excessive ||
      !deliveryGrants.rows[0]?.attempt_update
    )
      throw new Error("Neutral delivery grants are incomplete or excessive");
    const tables = await runtime.query(
      `select to_regclass('public.ot_neutral_report_reservation') as reservation, to_regclass('public.ot_neutral_qa_review') as qa_review, to_regclass('public.ot_neutral_customer_zip_attempt') as zip_attempt,to_regclass('public.ot_neutral_refund_work') as refund_work`,
    );
    if (
      !tables.rows[0]?.reservation ||
      !tables.rows[0]?.qa_review ||
      !tables.rows[0]?.zip_attempt ||
      !tables.rows[0]?.refund_work
    )
      throw new Error("Neutral report Phase 3 migrations are not installed");
    const hostedApiAcl = await migration.query(
      `select api.role_name,scoped.table_name
       from (values ('anon'),('authenticated'),('service_role')) api(role_name)
       cross join (values ('ot_neutral_customer_zip_attempt'),('ot_neutral_qa_review'),('ot_neutral_refund_work')) scoped(table_name)
       where exists(select 1 from pg_roles where rolname=api.role_name)
         and (has_table_privilege(api.role_name,format('public.%I',scoped.table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           or has_any_column_privilege(api.role_name,format('public.%I',scoped.table_name),'SELECT,INSERT,UPDATE,REFERENCES'))`,
    );
    if (hostedApiAcl.rows.length !== 0)
      throw new Error(
        "Supabase API roles retain unsafe effective neutral QA/refund privileges",
      );
    const grants = await runtime.query(
      `select has_table_privilege(current_user,'ot_neutral_report_reservation','SELECT,INSERT,UPDATE') as allowed, has_table_privilege(current_user,'ot_neutral_report_reservation','DELETE,TRUNCATE,REFERENCES,TRIGGER') as excessive`,
    );
    if (!grants.rows[0]?.allowed || grants.rows[0]?.excessive)
      throw new Error(
        "Runtime neutral-report grants are not restricted as required",
      );
    for (const tableName of [
      "ot_neutral_qa_review",
      "ot_neutral_customer_zip_attempt",
      "ot_neutral_refund_work",
    ]) {
      const phase3Grants = await runtime.query(
        `select has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE') as allowed, has_table_privilege(current_user,$1,'DELETE,TRUNCATE,REFERENCES,TRIGGER') as excessive`,
        [tableName],
      );
      if (!phase3Grants.rows[0]?.allowed || phase3Grants.rows[0]?.excessive)
        throw new Error(
          `Runtime ${tableName} grants are incomplete or excessive`,
        );
      const phase3Security = await runtime.query(
        `select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid=$1::regclass`,
        [tableName],
      );
      if (
        !phase3Security.rows[0]?.relrowsecurity ||
        !phase3Security.rows[0]?.relforcerowsecurity ||
        phase3Security.rows[0]?.owner === runtimeIdentity[0]?.role
      )
        throw new Error(
          `RLS/ownership boundary is not enforced for ${tableName}`,
        );
    }
    const authorityGrants = await runtime.query(
      `select has_table_privilege(current_user,'ot_neutral_runtime_order','SELECT') and has_table_privilege(current_user,'ot_neutral_runtime_payment_binding','SELECT') and has_table_privilege(current_user,'ot_neutral_runtime_settlement_reversal','SELECT') as allowed, has_table_privilege(current_user,'ot_order','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_payment_binding','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_settlement_reversal','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as excessive`,
    );
    if (!authorityGrants.rows[0]?.allowed || authorityGrants.rows[0]?.excessive)
      throw new Error(
        "Runtime neutral authority views are incomplete or shared commerce access is excessive",
      );
    const appNeutral = await app.query(
      `select has_column_privilege(current_user,'ot_neutral_report_reservation','bundle_sha256','SELECT') and has_column_privilege(current_user,'ot_neutral_report_reservation','superseded_by_sha256','SELECT') and has_column_privilege(current_user,'ot_neutral_qa_review','customer_artifact_sha256','SELECT') and has_column_privilege(current_user,'ot_neutral_qa_review','fulfillment_id','SELECT') as allowed, has_table_privilege(current_user,'ot_neutral_report_reservation','INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_neutral_qa_review','INSERT,UPDATE,DELETE,TRUNCATE') as excessive`,
    );
    if (!appNeutral.rows[0]?.allowed || appNeutral.rows[0]?.excessive)
      throw new Error(
        "App neutral authority-read grants are incomplete or excessive",
      );
    const fulfillmentGrants = await runtime.query(
      `select has_column_privilege(current_user,'ot_fulfillment','attempt_count','SELECT') and has_column_privilege(current_user,'ot_fulfillment_artifact','generator_version','SELECT') and has_column_privilege(current_user,'ot_fulfillment_artifact','source_order_id','SELECT') as allowed, has_table_privilege(current_user,'ot_fulfillment','UPDATE,DELETE,TRUNCATE') or has_table_privilege(current_user,'ot_fulfillment_artifact','UPDATE,DELETE,TRUNCATE') as excessive`,
    );
    if (
      !fulfillmentGrants.rows[0]?.allowed ||
      fulfillmentGrants.rows[0]?.excessive
    )
      throw new Error("Neutral fulfillment grants are incomplete or excessive");
    const sharedOwners = await runtime.query(
      `select relname,pg_get_userbyid(relowner) owner from pg_class where oid in ('ot_fulfillment'::regclass,'ot_fulfillment_artifact'::regclass)`,
    );
    if (
      sharedOwners.rows.length !== 2 ||
      sharedOwners.rows.some((row) => row.owner === runtimeIdentity[0]?.role)
    )
      throw new Error("Neutral runtime must not own shared fulfillment tables");
    const security = await runtime.query(
      `select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid='ot_neutral_report_reservation'::regclass`,
    );
    if (
      !security.rows[0]?.relrowsecurity ||
      !security.rows[0]?.relforcerowsecurity ||
      security.rows[0]?.owner === runtimeIdentity[0]?.role
    )
      throw new Error("RLS/ownership boundary is not enforced");
    await runtime.query("begin");
    try {
      await runtime.query(`select count(*) from ot_neutral_report_reservation`);
      await runtime.query(
        `select o."id" from ot_neutral_runtime_order o left join ot_neutral_runtime_payment_binding b on b."order_id"=o."id" left join ot_neutral_runtime_settlement_reversal r on r."payment_intent"=b."payment_intent" where false`,
      );
      await runtime.query(
        `update ot_neutral_report_reservation set updated_at=updated_at where false`,
      );
      await runtime.query(`select count(*) from ot_neutral_qa_review`);
      await runtime.query(
        `select count(*) from ot_neutral_customer_zip_attempt`,
      );
      await runtime.query(`select count(*) from ot_neutral_refund_work`);
      await runtime.query(
        `select a.generator_version,a.source_order_id from ot_fulfillment_artifact a where false`,
      );
      await runtime.query(
        `insert into ot_fulfillment(id,order_id,kind,status,updated_at) select '','','NEUTRAL_RECORDS_REPORT','ARTIFACT_READY',clock_timestamp() where false`,
      );
      await runtime.query(
        `insert into ot_fulfillment_artifact(id,fulfillment_id,version,artifact_sha256,byte_size,storage_locator,generator_version,template_version,generated_at,source_order_id,property_binding_fingerprint) select '','',1,repeat('a',64),1,'','neutral-customer-zip/v1','',clock_timestamp(),'',repeat('a',64) where false`,
      );
      await app.query(
        `select r.bundle_sha256,r.superseded_by_sha256,q.customer_artifact_sha256,q.fulfillment_id from ot_neutral_report_reservation r join ot_neutral_qa_review q on q.reservation_id=r.id where false`,
      );
      await runtime.query(
        `insert into ot_neutral_report_reservation (id,order_id,policy_version,property_fingerprint,reservation_key,checkout_price_id,checkout_product_id,admission_sha256,data_evidence_sha256,deadline_evidence_sha256,source_content_sha256,deadline_identity_sha256,official_retrieved_at,deadline_retrieved_at,cohort_position,reviewer_key,reviewer_week_start) select '', '', '', repeat('a',64), '', '', '', repeat('a',64),repeat('a',64),repeat('a',64),repeat('a',64),repeat('a',64),current_timestamp,current_timestamp,1,'x',current_date where false`,
      );
      for (const tableName of [
        "ot_order",
        "ot_payment_binding",
        "ot_settlement_reversal",
      ]) {
        let directReadDenied = false;
        const savepoint = `deny_direct_read_${tableName}`;
        await runtime.query(`savepoint ${savepoint}`);
        try {
          await runtime.query(`select * from ${tableName} where false`);
        } catch {
          directReadDenied = true;
          await runtime.query(`rollback to savepoint ${savepoint}`);
        }
        if (!directReadDenied)
          throw new Error(
            `Runtime direct shared-commerce read unexpectedly succeeded for ${tableName}`,
          );
      }
      let deleteDenied = false;
      await runtime.query("savepoint deny_delete");
      try {
        await runtime.query(
          `delete from ot_neutral_report_reservation where false`,
        );
      } catch {
        deleteDenied = true;
        await runtime.query("rollback to savepoint deny_delete");
      }
      if (!deleteDenied)
        throw new Error("Runtime DELETE unexpectedly succeeded");
      for (const tableName of [
        "ot_neutral_qa_review",
        "ot_neutral_customer_zip_attempt",
        "ot_neutral_refund_work",
      ]) {
        let phase3DeleteDenied = false;
        await runtime.query(`savepoint deny_delete_${tableName}`);
        try {
          await runtime.query(`delete from ${tableName} where false`);
        } catch {
          phase3DeleteDenied = true;
          await runtime.query(`rollback to savepoint deny_delete_${tableName}`);
        }
        if (!phase3DeleteDenied)
          throw new Error(
            `Runtime DELETE unexpectedly succeeded for ${tableName}`,
          );
      }
      for (const tableName of ["ot_fulfillment", "ot_fulfillment_artifact"]) {
        for (const verb of ["update", "delete", "truncate"]) {
          let denied = false;
          const savepoint = `deny_${verb}_${tableName}`;
          await runtime.query(`savepoint ${savepoint}`);
          try {
            if (verb === "update")
              await runtime.query(`update ${tableName} set id=id where false`);
            else if (verb === "delete")
              await runtime.query(`delete from ${tableName} where false`);
            else await runtime.query(`truncate ${tableName}`);
          } catch {
            denied = true;
            await runtime.query(`rollback to savepoint ${savepoint}`);
          }
          if (!denied)
            throw new Error(
              `Runtime ${verb} unexpectedly succeeded for ${tableName}`,
            );
        }
      }
    } finally {
      await runtime.query("rollback");
    }
    process.stdout.write("neutral-report migration preflight: PASS\n");
  } finally {
    await Promise.allSettled([
      migration.end(),
      app.end(),
      runtime.end(),
      delivery.end(),
    ]);
  }
}
main().catch((error) => {
  if (process.env.OT_NEUTRAL_PREFLIGHT_DEBUG === "1")
    process.stderr.write(`${error instanceof Error ? error.message : "unknown error"}\n`);
  process.stderr.write("neutral-report migration preflight: FAIL\n");
  process.exitCode = 1;
});
