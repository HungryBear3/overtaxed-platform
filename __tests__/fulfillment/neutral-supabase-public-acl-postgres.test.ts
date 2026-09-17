import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { TextDecoder, TextEncoder } from "node:util"

Object.assign(globalThis, { TextDecoder, TextEncoder })
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg") as typeof import("pg")
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PREVIEW_EFFECTIVE_ACL_SQL } = require("@/lib/fulfillment/neutral-preview-acceptance") as typeof import("@/lib/fulfillment/neutral-preview-acceptance")

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20260916220000_harden_ot_supabase_public_acl/migration.sql",
  ),
  "utf8",
)

describe("OT Supabase PUBLIC ACL hardening on disposable PostgreSQL", () => {
  let root = ""
  let data = ""
  let socket = ""
  let port = 0
  let client: InstanceType<typeof Client>

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-public-acl-"))
    data = path.join(root, "data")
    socket = path.join(root, "socket")
    fs.mkdirSync(socket)
    port = 42000 + Math.floor(Math.random() * 10000)
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "postgres"], {
      stdio: "ignore",
    })
    execFileSync(
      "pg_ctl",
      ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-w", "start"],
      { stdio: "ignore" },
    )
    client = new Client({ host: socket, port, user: "postgres", database: "postgres" })
    await client.connect()
  })

  afterAll(async () => {
    await client?.end()
    if (data) {
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "ignore",
      })
    }
    fs.rmSync(root, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await client.query(`
      drop schema if exists extensions cascade;
      drop schema if exists public cascade;
      drop role if exists restricted_probe;
      drop role if exists supabase_admin;
      create role supabase_admin superuser noinherit;
      grant supabase_admin to postgres with set true;
      create role restricted_probe noinherit;
      create schema public authorization postgres;
      create table public.ot_packet_download_capability(id text primary key);
      alter table public.ot_packet_download_capability enable row level security;
      set role supabase_admin;
      create schema extensions authorization supabase_admin;
      create view extensions.pg_stat_statements as select 'query'::text query;
      create view extensions.pg_stat_statements_info as select 1::integer dealloc;
      create function public.rls_auto_enable() returns void language sql as 'select';
      grant select on extensions.pg_stat_statements, extensions.pg_stat_statements_info to public;
      grant execute on function public.rls_auto_enable() to public;
      reset role;
    `)
  })

  test("revokes managed PUBLIC grants, forces RLS, and is idempotent", async () => {
    await client.query(migration)
    await client.query(migration)

    const state = await client.query(`
      select
        has_table_privilege('restricted_probe','extensions.pg_stat_statements','SELECT') stats_select,
        has_table_privilege('restricted_probe','extensions.pg_stat_statements_info','SELECT') info_select,
        has_function_privilege('restricted_probe','public.rls_auto_enable()','EXECUTE') routine_execute,
        (select relrowsecurity and relforcerowsecurity
         from pg_class where oid='public.ot_packet_download_capability'::regclass) forced_rls
    `)
    expect(state.rows[0]).toEqual({
      stats_select: false,
      info_select: false,
      routine_execute: false,
      forced_rls: true,
    })
  })

  test("fails closed before mutation when the hosted topology is incomplete", async () => {
    await client.query("drop function public.rls_auto_enable()")
    await expect(client.query(migration)).rejects.toThrow(/target topology is invalid/)
    expect(
      (
        await client.query(
          "select has_table_privilege('restricted_probe','extensions.pg_stat_statements','SELECT') allowed",
        )
      ).rows[0].allowed,
    ).toBe(true)
  })

  test("aclexplode treats a NULL column ACL as zero rows", async () => {
    const result = await client.query(`
      select count(*)::int entries
      from pg_attribute a
      cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
      where a.attrelid='public.ot_packet_download_capability'::regclass
        and a.attname='id'
    `)
    expect(result.rows[0].entries).toBe(0)
  })

  test("the production ACL query returns JSON columns as a string array", async () => {
    await client.query(
      "grant select (id) on public.ot_packet_download_capability to restricted_probe",
    )
    const result = await client.query(PREVIEW_EFFECTIVE_ACL_SQL, [["restricted_probe"]])
    const row = result.rows.find(
      (candidate: { object?: string; privilege?: string }) =>
        candidate.object === "ot_packet_download_capability" &&
        candidate.privilege === "SELECT",
    )
    expect(row).toMatchObject({
      role: "restricted_probe",
      schema: "public",
      kind: "relation",
      object: "ot_packet_download_capability",
      privilege: "SELECT",
      table_wide: false,
      columns: ["id"],
      public_derived: false,
    })
  })
})
