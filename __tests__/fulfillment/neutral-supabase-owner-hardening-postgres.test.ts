import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";

Object.assign(globalThis, { TextDecoder, TextEncoder });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg") as typeof import("pg");

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20260916121000_harden_ot_supabase_owner_roles/migration.sql",
  ),
  "utf8",
);
const reconciliation = fs.readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20260916120000_reconcile_ot_neutral_qa_delivery_forward/migration.sql",
  ),
  "utf8",
);
const migration33 = fs.readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20260915190000_add_ot_neutral_qa_delivery/migration.sql",
  ),
  "utf8",
);

describe("hosted owner-role hardening on disposable PostgreSQL", () => {
  let root = "";
  let data = "";
  let socket = "";
  let port = 0;
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-owner-hardening-"));
    data = path.join(root, "data");
    socket = path.join(root, "socket");
    fs.mkdirSync(socket);
    port = 42000 + Math.floor(Math.random() * 10000);
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "postgres"], {
      stdio: "ignore",
    });
    execFileSync(
      "pg_ctl",
      ["-D", data, "-o", `-F -k ${socket} -p ${port} -c allow_system_table_mods=on`, "-w", "start"],
      { stdio: "ignore" },
    );
    client = new Client({
      host: socket,
      port,
      user: "postgres",
      database: "postgres",
    });
    await client.connect();
    await client.query(`
      create role supabase_admin superuser noinherit;
      grant supabase_admin to postgres with set true;
    `);
  });

  afterAll(async () => {
    await client?.end();
    if (data) {
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "ignore",
      });
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function resetFixture() {
    await client.query(`
      drop schema if exists public cascade;
      create schema public authorization postgres;
      grant all on schema public to public;
      revoke create on schema public from public;
      do $cleanup_memberships$ begin
        if exists(select 1 from pg_roles where rolname='hosted_api_parent')
          and exists(select 1 from pg_roles where rolname='anon') then
          revoke hosted_api_parent from anon;
        end if;
        if exists(select 1 from pg_roles where rolname='ot_neutral_app_reader')
          and exists(select 1 from pg_roles where rolname='unexpected_app_member') then
          revoke ot_neutral_app_reader from unexpected_app_member;
        end if;
        if exists(select 1 from pg_roles where rolname='ot_preview_app')
          and exists(select 1 from pg_roles where rolname='unexpected_app_member') then
          revoke ot_preview_app from unexpected_app_member;
        end if;
        if exists(select 1 from pg_roles where rolname='ot_neutral_app_reader')
          and exists(select 1 from pg_roles where rolname='ot_preview_app') then
          revoke ot_neutral_app_reader from ot_preview_app;
        end if;
        if exists(select 1 from pg_roles where rolname='unexpected_privileged_role')
          and exists(select 1 from pg_roles where rolname='ot_preview_app') then
          revoke unexpected_privileged_role from ot_preview_app;
        end if;
      end $cleanup_memberships$;
      drop role if exists anon;
      drop role if exists authenticated;
      drop role if exists service_role;
      drop role if exists hosted_api_parent;
      drop role if exists unexpected_app_member;
      drop role if exists unexpected_privileged_role;
      drop role if exists ot_preview_app;
      do $cleanup$ begin
        if exists(select 1 from pg_roles where rolname='ot_commerce_capture_owner') then
          revoke all on schema public from ot_commerce_capture_owner;
        end if;
        if exists(select 1 from pg_roles where rolname='ot_neutral_reversal_guard_owner') then
          revoke all on schema public from ot_neutral_reversal_guard_owner;
        end if;
      end $cleanup$;
      drop role if exists ot_commerce_capture_owner;
      drop role if exists ot_neutral_reversal_guard_owner;
      drop role if exists unexpected_reader;
      create role ot_commerce_capture_owner noinherit nologin;
      create role ot_neutral_reversal_guard_owner noinherit nologin;
      create table public.ot_commerce_deadline_capture(id text);
      create function public.ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)
        returns void language sql as 'select';
      create function public.ot_commerce_deadline_capture_append_only()
        returns trigger language plpgsql as 'begin return new; end';
      create function public.ot_neutral_hold_on_settlement_reversal()
        returns trigger language plpgsql as 'begin return new; end';
      alter table public.ot_commerce_deadline_capture owner to ot_commerce_capture_owner;
      alter function public.ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)
        owner to ot_commerce_capture_owner;
      alter function public.ot_commerce_deadline_capture_append_only()
        owner to ot_commerce_capture_owner;
      alter function public.ot_neutral_hold_on_settlement_reversal()
        owner to ot_neutral_reversal_guard_owner;
      grant create on schema public to ot_commerce_capture_owner, ot_neutral_reversal_guard_owner;
    `);
  }

  async function setupMigration33Fixture() {
    await client.query(`
      drop schema public cascade;
      create schema public authorization postgres;
      grant all on schema public to public;
      revoke create on schema public from public;
      drop role if exists ot_neutral_reversal_guard_owner;
      drop role if exists ot_neutral_app_reader;
      drop role if exists ot_neutral_delivery_runtime;
      drop role if exists ot_neutral_runtime;
      create role ot_neutral_runtime nologin;
      create role ot_neutral_delivery_runtime nologin noinherit;
      create role ot_preview_app login inherit nosuperuser nocreaterole nocreatedb noreplication nobypassrls;
      grant usage on schema public to ot_preview_app;
      create type "OTFulfillmentKind" as enum ('T2_REPORT');
      create table ot_order(id text primary key);
      create table ot_neutral_report_reservation(
        id text primary key, order_id text unique, status text, bundle_sha256 text,
        policy_version text, property_fingerprint text, superseded_by_sha256 text
      );
      create table ot_fulfillment(
        id text primary key, order_id text, kind "OTFulfillmentKind", status text,
        attempt_count integer, updated_at timestamptz
      );
      create table ot_fulfillment_artifact(
        id text, fulfillment_id text, version integer, artifact_sha256 text,
        byte_size integer, storage_locator text, generator_version text,
        template_version text, generated_at timestamptz, source_order_id text,
        property_binding_fingerprint text
      );
      create table ot_payment_binding(order_id text, payment_intent text);
      create table ot_settlement_reversal(payment_intent text);
      create table ot_packet_download_capability(
        fulfillment_id text, revoked_at timestamptz, revoked_reason_code text
      );
    `);
    await client.query(migration33);
    await client.query(`
      grant ot_neutral_app_reader to ot_preview_app
        with admin false, inherit true, set true granted by postgres;
    `);
    await client.query(`
      grant select (reservation_id,order_id,status,policy_version,artifact_sha256,customer_artifact_sha256,property_binding_fingerprint,fulfillment_id)
        on ot_neutral_qa_review to ot_neutral_delivery_runtime;
      create policy ot_neutral_delivery_reservation_read on ot_neutral_report_reservation
        for select to ot_neutral_delivery_runtime using (true);
      create policy ot_neutral_delivery_qa_read on ot_neutral_qa_review
        for select to ot_neutral_delivery_runtime using (true);
    `);
    // The forward reconciliation runs after 20260915230000, whose only
    // refund-work schema delta is this three-column provider lookup audit
    // shape. Reproduce that later-applied state without pulling unrelated
    // commerce-view dependencies into this bounded fixture.
    await client.query(`
      alter table ot_neutral_refund_work
        add column provider_lookup_attempts integer not null default 0,
        add column last_provider_lookup_at timestamptz(3),
        add column last_provider_lookup_result text,
        add constraint ot_neutral_refund_lookup_audit_shape check (
          provider_lookup_attempts >= 0
          and ((provider_lookup_attempts = 0 and last_provider_lookup_at is null and last_provider_lookup_result is null)
            or (provider_lookup_attempts > 0 and last_provider_lookup_at is not null and last_provider_lookup_result in ('RETRYABLE_PROVIDER_FAILURE','PROVIDER_RESPONSE_RECEIVED')))
        );
      grant update (provider_lookup_attempts,last_provider_lookup_at,last_provider_lookup_result,updated_at)
        on ot_neutral_refund_work to ot_neutral_runtime;
    `);
  }

  beforeEach(resetFixture);

  test("pins only the native and hosted-Supabase catalog renderings", () => {
    const pinned = [
      ...reconciliation.matchAll(/'([0-9a-f]{32})'\s*(?:--[^\n]*)?/g),
    ]
      .map((match) => match[1])
      .filter((value) =>
        [
          "8782889552b478d71c5ab63e2bace721",
          "27b99eb0aada08c4a93990a35f2d0e1c",
        ].includes(value),
      );
    expect(pinned).toEqual([
      "8782889552b478d71c5ab63e2bace721",
      "27b99eb0aada08c4a93990a35f2d0e1c",
    ]);
    expect(reconciliation).toContain("catalog_hash NOT IN");
    expect(reconciliation).not.toContain("00000000000000000000000000000000");
  });

  test("unsafe attributes abort before any hardening mutation", async () => {
    await client.query(`alter role ot_neutral_reversal_guard_owner login`);
    await expect(client.query(migration)).rejects.toThrow(/unsafe attributes/);
    const state = await client.query(`
      select has_schema_privilege('ot_commerce_capture_owner','public','CREATE') commerce_create,
             has_schema_privilege('ot_neutral_reversal_guard_owner','public','CREATE') reversal_create
    `);
    expect(state.rows[0]).toEqual({ commerce_create: true, reversal_create: true });
  });

  test("unexpected memberships are rejected without mutation", async () => {
    await client.query(`create role unexpected_member`);
    await client.query(`grant ot_commerce_capture_owner to unexpected_member`);
    await expect(client.query(migration)).rejects.toThrow(/unexpected membership graph/);
    expect(
      (await client.query(`select has_schema_privilege('ot_commerce_capture_owner','public','CREATE') allowed`)).rows[0].allowed,
    ).toBe(true);
    await client.query(`drop role unexpected_member`);
  });

  test("accepts only the exact hosted edge and removes schema CREATE", async () => {
    await client.query(`
      insert into pg_auth_members(oid,roleid,member,grantor,admin_option,inherit_option,set_option)
      select 900001,r.oid,m.oid,g.oid,true,false,false
      from pg_roles r, pg_roles m, pg_roles g
      where r.rolname='ot_commerce_capture_owner' and m.rolname='postgres' and g.rolname='supabase_admin';
      insert into pg_auth_members(oid,roleid,member,grantor,admin_option,inherit_option,set_option)
      select 900002,r.oid,m.oid,g.oid,true,false,false
      from pg_roles r, pg_roles m, pg_roles g
      where r.rolname='ot_neutral_reversal_guard_owner' and m.rolname='postgres' and g.rolname='supabase_admin';
    `);
    const before = await client.query(`select rr.rolname role, mr.rolname member, gr.rolname grantor, m.admin_option, m.inherit_option, m.set_option from pg_auth_members m join pg_roles rr on rr.oid=m.roleid join pg_roles mr on mr.oid=m.member join pg_roles gr on gr.oid=m.grantor where rr.rolname in ('ot_commerce_capture_owner','ot_neutral_reversal_guard_owner')`);
    expect(before.rows).toEqual([
      { role: "ot_commerce_capture_owner", member: "postgres", grantor: "supabase_admin", admin_option: true, inherit_option: false, set_option: false },
      { role: "ot_neutral_reversal_guard_owner", member: "postgres", grantor: "supabase_admin", admin_option: true, inherit_option: false, set_option: false },
    ]);
    await client.query(migration);
    const state = await client.query(`
      select r.rolname,
        has_schema_privilege(r.rolname,'public','CREATE') can_create,
        count(m.*)::int edges,
        bool_and(m.admin_option and not m.inherit_option and not m.set_option) options_exact
      from pg_roles r
      left join pg_auth_members m on m.roleid=r.oid or m.member=r.oid
      where r.rolname in ('ot_commerce_capture_owner','ot_neutral_reversal_guard_owner')
      group by r.rolname order by r.rolname
    `);
    expect(state.rows).toEqual([
      { rolname: "ot_commerce_capture_owner", can_create: false, edges: 1, options_exact: true },
      { rolname: "ot_neutral_reversal_guard_owner", can_create: false, edges: 1, options_exact: true },
    ]);
  });

  test("cleans an interrupted temporary SET edge and is idempotent", async () => {
    await client.query(`
      grant ot_commerce_capture_owner to postgres
        with admin false, inherit false, set true granted by postgres;
      grant ot_neutral_reversal_guard_owner to postgres
        with admin false, inherit false, set true granted by postgres;
    `);
    await client.query(migration);
    await client.query(migration);
    const edges = await client.query(`
      select count(*)::int count from pg_auth_members m
      join pg_roles r on r.oid=m.roleid
      where r.rolname in ('ot_commerce_capture_owner','ot_neutral_reversal_guard_owner')
    `);
    expect(edges.rows[0].count).toBe(0);
  });

  test("rejects a wrong append-only function owner before privilege mutation", async () => {
    await client.query(`alter function public.ot_commerce_deadline_capture_append_only() owner to postgres`);
    await expect(client.query(migration)).rejects.toThrow(/pre-mutation object topology/);
    expect((await client.query(`select has_schema_privilege('ot_commerce_capture_owner','public','CREATE') allowed`)).rows[0].allowed).toBe(true);
  });

  test("partial migration-33 reconciliation refuses an incomplete fingerprint without mutation", async () => {
    await client.query(`
      alter function public.ot_neutral_hold_on_settlement_reversal() owner to postgres;
      revoke all on schema public from ot_neutral_reversal_guard_owner;
      drop role ot_neutral_reversal_guard_owner;
    `);
    await expect(client.query(reconciliation)).rejects.toThrow(/missing relation/);
    expect(
      (await client.query(`select count(*)::int count from pg_roles where rolname='ot_neutral_reversal_guard_owner'`)).rows[0].count,
    ).toBe(0);
  });

  test("partial migration-33 reconciliation holds without creating a missing owner", async () => {
    await client.query(`
      alter function public.ot_neutral_hold_on_settlement_reversal() owner to postgres;
      revoke all on schema public from ot_neutral_reversal_guard_owner;
      drop role ot_neutral_reversal_guard_owner;
      create table public.ot_neutral_customer_zip_attempt(id text);
      create table public.ot_neutral_qa_review(id text);
      create table public.ot_neutral_refund_work(id text);
      create table public.ot_settlement_reversal(id text);
      create trigger ot_neutral_hold_on_reversal before insert on public.ot_settlement_reversal
        for each row execute function public.ot_neutral_hold_on_settlement_reversal();
    `);
    await expect(client.query(reconciliation)).rejects.toThrow(/reconciliation refused/);
    expect((await client.query(`select count(*)::int count from pg_roles where rolname='ot_neutral_reversal_guard_owner'`)).rows[0].count).toBe(0);
  });

  test("accepts the exact migration-33 security fingerprint", async () => {
    await setupMigration33Fixture();
    await expect(client.query(reconciliation)).resolves.toBeDefined();
  });

  test("accepts only the exact hosted app-reader membership edge", async () => {
    await setupMigration33Fixture();
    await client.query(`
      insert into pg_auth_members(oid,roleid,member,grantor,admin_option,inherit_option,set_option)
      select 900003,r.oid,m.oid,g.oid,true,false,false
      from pg_roles r, pg_roles m, pg_roles g
      where r.rolname='ot_neutral_app_reader' and m.rolname='postgres' and g.rolname='supabase_admin';
    `);
    await expect(client.query(reconciliation)).resolves.toBeDefined();
  });

  test("accepts one exact Supabase platform edge for each custom app role", async () => {
    await setupMigration33Fixture();
    await client.query(`
      insert into pg_auth_members(oid,roleid,member,grantor,admin_option,inherit_option,set_option)
      select 900004,r.oid,m.oid,g.oid,true,false,false
      from pg_roles r, pg_roles m, pg_roles g
      where r.rolname='ot_neutral_app_reader' and m.rolname='postgres' and g.rolname='supabase_admin';
      insert into pg_auth_members(oid,roleid,member,grantor,admin_option,inherit_option,set_option)
      select 900005,r.oid,m.oid,g.oid,true,false,false
      from pg_roles r, pg_roles m, pg_roles g
      where r.rolname='ot_preview_app' and m.rolname='postgres' and g.rolname='supabase_admin';
    `);
    await expect(client.query(reconciliation)).resolves.toBeDefined();
  });

  test.each([
    ["wrong options", `select 900006,r.oid,m.oid,g.oid,false,false,false from pg_roles r,pg_roles m,pg_roles g where r.rolname='ot_preview_app' and m.rolname='postgres' and g.rolname='supabase_admin'`],
    ["wrong grantor", `select 900007,r.oid,m.oid,g.oid,true,false,false from pg_roles r,pg_roles m,pg_roles g where r.rolname='ot_preview_app' and m.rolname='postgres' and g.rolname='postgres'`],
  ])("rejects an app-login platform edge with %s", async (_name, selectSql) => {
    await setupMigration33Fixture();
    await client.query(`insert into pg_auth_members(oid,roleid,member,grantor,admin_option,inherit_option,set_option) ${selectSql}`);
    await expect(client.query(reconciliation)).rejects.toThrow(/app reader role fingerprint/);
  });

  test("revokes hosted API defaults before accepting the normalized final state", async () => {
    await setupMigration33Fixture();
    await client.query(`
      create role anon;
      create role authenticated;
      create role service_role;
      grant select,insert,update,delete,truncate,references,trigger
        on ot_neutral_customer_zip_attempt,ot_neutral_qa_review,ot_neutral_refund_work
        to anon,authenticated,service_role;
    `);
    await expect(client.query(reconciliation)).resolves.toBeDefined();
    const unsafe = await client.query(`
      select count(*)::int count
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      join pg_roles r on r.oid=acl.grantee
      where c.relnamespace='public'::regnamespace
        and c.relname in ('ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work')
        and r.rolname in ('anon','authenticated','service_role')
    `);
    expect(unsafe.rows[0].count).toBe(0);
  });

  test("rejects inherited hosted API privileges even after direct ACL cleanup", async () => {
    await setupMigration33Fixture();
    await client.query(`
      create role anon;
      create role hosted_api_parent;
      grant select(status) on ot_neutral_refund_work to hosted_api_parent;
      grant hosted_api_parent to anon;
    `);
    await expect(client.query(reconciliation)).rejects.toThrow(/effective QA\/refund privileges/);
  });

  test("rolls back hosted ACL revocation when the post-revoke fingerprint fails", async () => {
    await setupMigration33Fixture();
    await client.query(`
      create role anon;
      create role authenticated;
      create role service_role;
      grant select,insert,update,delete,truncate,references,trigger
        on ot_neutral_customer_zip_attempt,ot_neutral_qa_review,ot_neutral_refund_work
        to anon,authenticated,service_role;
      create sequence ot_neutral_force_post_revoke_digest_mismatch;
    `);
    const before = await client.query(`
      select r.rolname,c.relname,acl.privilege_type
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      join pg_roles r on r.oid=acl.grantee
      where c.relnamespace='public'::regnamespace
        and c.relname in ('ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work')
        and r.rolname in ('anon','authenticated','service_role')
      order by 1,2,3
    `);
    await expect(client.query(reconciliation)).rejects.toThrow(/exact catalog hash/);
    const after = await client.query(`
      select r.rolname,c.relname,acl.privilege_type
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      join pg_roles r on r.oid=acl.grantee
      where c.relnamespace='public'::regnamespace
        and c.relname in ('ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work')
        and r.rolname in ('anon','authenticated','service_role')
      order by 1,2,3
    `);
    expect(after.rows).toEqual(before.rows);
  });

  test.each([
    ["column", `alter table ot_neutral_refund_work alter column status drop default`, /column fingerprint/],
    ["provider lookup attempts column", `alter table ot_neutral_refund_work alter column provider_lookup_attempts drop default`, /column fingerprint/],
    ["provider lookup timestamp column", `alter table ot_neutral_refund_work alter column last_provider_lookup_at type timestamp`, /column fingerprint/],
    ["provider lookup result column", `alter table ot_neutral_refund_work alter column last_provider_lookup_result set not null`, /column fingerprint/],
    ["provider lookup audit constraint", `alter table ot_neutral_refund_work drop constraint ot_neutral_refund_lookup_audit_shape`, /constraint fingerprint/],
    ["RLS", `alter table ot_neutral_qa_review no force row level security`, /relation kind or RLS/],
    ["constraint", `alter table ot_neutral_qa_review drop constraint ot_neutral_qa_review_minutes`, /constraint fingerprint/],
    ["index", `drop index ot_neutral_refund_work_status_created_idx`, /index fingerprint/],
    ["policy", `drop policy ot_neutral_refund_work_runtime on ot_neutral_refund_work`, /policy fingerprint/],
    ["function", `alter function ot_neutral_hold_on_settlement_reversal() security invoker`, /function fingerprint/],
    ["trigger", `alter table ot_settlement_reversal disable trigger ot_neutral_hold_on_reversal`, /missing reversal guard trigger/],
    ["owner", `alter role ot_neutral_reversal_guard_owner login`, /owner role fingerprint/],
    ["grant", `revoke select on ot_payment_binding from ot_neutral_reversal_guard_owner`, /grant fingerprint/],
    ["same-name wrong-table constraint", `alter table ot_neutral_qa_review drop constraint ot_neutral_qa_review_minutes; alter table ot_order add constraint ot_neutral_qa_review_minutes check (id is not null)`, /exact catalog hash/],
    ["same-name wrong-table index", `drop index ot_neutral_refund_work_status_created_idx; create index ot_neutral_refund_work_status_created_idx on ot_order(id)`, /exact catalog hash/],
    ["wrong index predicate", `drop index ot_neutral_qa_review_status_updated_idx; create index ot_neutral_qa_review_status_updated_idx on ot_neutral_qa_review(status,updated_at) where status='PENDING'`, /exact catalog hash/],
    ["excess table grant", `grant delete on ot_neutral_refund_work to ot_neutral_runtime`, /exact catalog hash/],
    ["PUBLIC table grant", `grant select on ot_neutral_refund_work to public`, /exact catalog hash/],
    ["bad enum", `alter type "OTNeutralQaStatus" add value 'UNEXPECTED'`, /exact catalog hash/],
    ["bad reservation column", `alter table ot_neutral_report_reservation alter column customer_zip_filename type varchar(255)`, /exact catalog hash/],
    ["app-reader attributes", `alter role ot_neutral_app_reader login`, /app reader role fingerprint/],
    ["app-reader membership", `create role unexpected_app_member; grant ot_neutral_app_reader to unexpected_app_member`, /app reader role fingerprint/],
    ["privilege granted to canonical app login", `create role unexpected_privileged_role; grant unexpected_privileged_role to ot_preview_app`, /app reader role fingerprint/],
    ["canonical app login granted outward", `create role unexpected_app_member; grant ot_preview_app to unexpected_app_member`, /app reader role fingerprint/],
    ["canonical app-login inheritance", `alter role ot_preview_app noinherit`, /app reader role fingerprint/],
    ["app-reader schema privilege", `grant create on schema public to ot_neutral_app_reader`, /app reader role fingerprint/],
    ["unexpected reader policy and grants", `create role unexpected_reader nologin; grant select on ot_neutral_qa_review to unexpected_reader; grant select(status) on ot_neutral_refund_work to unexpected_reader; create policy evil_permissive on ot_neutral_qa_review for select to unexpected_reader using (true)`, /exact catalog hash/],
    ["wrong relation owner", `alter table ot_neutral_qa_review owner to ot_neutral_app_reader`, /exact catalog hash/],
    ["wrong type owner", `alter type "OTNeutralRefundStatus" owner to ot_neutral_app_reader`, /exact catalog hash/],
    ["unexpected scoped sequence", `create sequence ot_neutral_unexpected_seq`, /exact catalog hash/],
  ])("rejects a %s mismatch without changing the fingerprint", async (_name, mutation, error) => {
    await setupMigration33Fixture();
    await client.query(mutation as string);
    const before = await client.query(`select count(*)::int objects from pg_class where relnamespace='public'::regnamespace`);
    await expect(client.query(reconciliation)).rejects.toThrow(error as RegExp);
    const after = await client.query(`select count(*)::int objects from pg_class where relnamespace='public'::regnamespace`);
    expect(after.rows).toEqual(before.rows);
  });
});
