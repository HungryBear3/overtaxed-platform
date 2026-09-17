/** @jest-environment node */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";

Object.assign(globalThis, { TextDecoder, TextEncoder });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg") as typeof import("pg");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  OT_PRODUCTION_LAST_APPLIED_MIGRATION,
} = require("@/lib/fulfillment/neutral-production-baseline-manifest") as typeof import("@/lib/fulfillment/neutral-production-baseline-manifest");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  PRODUCTION_BINDING_SQL,
  PRODUCTION_ROLE_SQL,
  assertProductionRoleBindings,
  assertProductionRoleInventory,
} = require("@/lib/fulfillment/neutral-production-verifier") as typeof import("@/lib/fulfillment/neutral-production-verifier");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  OT_NEUTRAL_FUNCTIONAL_ROLES,
} = require("@/lib/fulfillment/neutral-production-identity") as typeof import("@/lib/fulfillment/neutral-production-identity");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  classifyBaselinePreflight,
} = require("@/lib/fulfillment/neutral-production-baseline-runner") as typeof import("@/lib/fulfillment/neutral-production-baseline-runner");

/**
 * The Production baseline against a disposable PostgreSQL cluster.
 *
 * The fixture is Production-SHAPED rather than Production-like: the migration
 * connection is a NON-SUPERUSER role with CREATEROLE that owns schema public,
 * PUBLIC holds no CREATE on that schema, `public.rls_auto_enable()` does not
 * exist, and the Supabase API roles do. Those four facts together are what made
 * three of the pending migrations un-runnable, so a fixture that omitted any of
 * them would prove the baseline works somewhere it was never the problem.
 *
 * Compatible with PostgreSQL 17 and 18. `GRANT ... WITH INHERIT/SET` is 16+, and
 * nothing below depends on a version-specific catalog rendering.
 */

const root = process.cwd();
const artifact = (name: string) =>
  fs.readFileSync(path.join(root, "prisma/production-baseline", name), "utf8");

const PREFLIGHT = artifact("01_preflight.sql");
const BASELINE = artifact("02_baseline.sql");
const POSTCONDITIONS = artifact("03_postconditions.sql");

const OWNER = "ot_prod_owner";

/**
 * The three restricted logins, and the one functional role each is bound to.
 *
 * They are a PROVISIONING prerequisite: the Supabase Management API mints them,
 * nothing in the repository does, and the baseline's only claim on them is the
 * single membership edge it grants each one. The fixture therefore creates them
 * the way Production is required to hand them over — `LOGIN`, inheriting, and
 * holding nothing at all — so that "the baseline owns exactly these three edges"
 * is measured rather than assumed.
 */
const LOGIN_BINDINGS: ReadonlyArray<readonly [string, string]> = [
  ["ot_prod_app", "ot_neutral_app_reader"],
  ["ot_prod_neutral_runtime", "ot_neutral_runtime"],
  ["ot_prod_neutral_delivery", "ot_neutral_delivery_runtime"],
];
const LOGINS = LOGIN_BINDINGS.map(([login]) => login);

function appliedMigrations(): string[] {
  return fs
    .readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= OT_PRODUCTION_LAST_APPLIED_MIGRATION)
    .sort();
}

function postgresAvailable(): boolean {
  try {
    execFileSync("initdb", ["--version"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const suite = postgresAvailable() ? describe : describe.skip;

suite("OT neutral Production baseline on disposable PostgreSQL", () => {
  let root_dir = "";
  let data = "";
  let socket = "";
  let port = 0;
  let superuser: InstanceType<typeof Client>;
  let owner: InstanceType<typeof Client>;

  const connect = async (user: string) => {
    const client = new Client({ host: socket, port, user, database: "postgres" });
    await client.connect();
    return client;
  };

  beforeAll(async () => {
    root_dir = fs.mkdtempSync(path.join(os.tmpdir(), "ot-prod-baseline-"));
    data = path.join(root_dir, "data");
    socket = path.join(root_dir, "socket");
    fs.mkdirSync(socket);
    port = 43000 + Math.floor(Math.random() * 9000);
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "postgres"], {
      stdio: "ignore",
    });
    execFileSync(
      "pg_ctl",
      ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-w", "start"],
      { stdio: "ignore" },
    );
    superuser = await connect("postgres");
  }, 180_000);

  afterAll(async () => {
    await owner?.end().catch(() => undefined);
    await superuser?.end().catch(() => undefined);
    if (data)
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "ignore",
      });
    fs.rmSync(root_dir, { recursive: true, force: true });
  });

  /** A clean database that looks exactly like Production before the baseline. */
  async function buildProductionShapedState(): Promise<void> {
    await owner?.end().catch(() => undefined);
    await superuser.query(`
      drop schema if exists public cascade;
      drop schema if exists extensions cascade;
    `);
    // DROP ROLE alone is not enough between runs. A role that ever held a
    // grant, or that set default privileges, leaves catalog entries
    // (pg_default_acl, pg_shdepend) that make DROP ROLE fail with "cannot be
    // dropped because some objects depend on it" — and the failure surfaces on
    // the SECOND rebuild, not the first, which is exactly the kind of fixture
    // defect that reads as a flaky test.
    // The logins go FIRST. Once the baseline has run, the membership edges
    // binding them to their functional roles are recorded with the migration
    // role as grantor, and PostgreSQL 16+ refuses to drop a grantor while the
    // grant it made is still there. Removing the members removes the edges, so
    // by the time OWNER is dropped it is nobody's grantor — and this only ever
    // bites on the SECOND rebuild, which is precisely the shape of fixture
    // defect that reads as a flaky test.
    for (const role of [
      ...LOGINS,
      OWNER,
      "anon",
      "authenticated",
      "service_role",
      "ot_neutral_runtime",
      "ot_neutral_app_reader",
      "ot_neutral_delivery_runtime",
      "ot_neutral_reversal_guard_owner",
      "ot_commerce_capture_owner",
    ])
      await superuser.query(
        `do $$ begin
           if exists (select 1 from pg_roles where rolname = '${role}') then
             execute 'drop owned by ${role} cascade';
             execute 'drop role ${role}';
           end if;
         end $$`,
      );

    await superuser.query(`
      create role ${OWNER} login createrole nosuperuser nobypassrls;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema public authorization ${OWNER};
      revoke create on schema public from public;
      grant usage on schema public to anon, authenticated, service_role;
    `);

    // Provisioned by the platform, exactly as prerequisite 3 of the rollout
    // packet requires: LOGIN, INHERIT, and no authority, no schema CREATE and no
    // membership of any kind. Every edge they end up with is one the baseline
    // granted.
    for (const login of LOGINS)
      await superuser.query(
        `create role ${login} login inherit nosuperuser nobypassrls nocreaterole nocreatedb noreplication`,
      );

    // Production `postgres` owns its database; this fixture's owner does not,
    // so it needs the database-level CREATE that `CREATE SCHEMA extensions`
    // requires. Without it the fixture fails at schema creation and the whole
    // suite reports a Production-baseline defect that does not exist.
    await superuser.query(
      `grant create, temporary on database postgres to ${OWNER}`,
    );

    owner = await connect(OWNER);
    // Supabase hands every new relation in `public` to the API roles. Reproduce
    // it, or the API-role revocations in the baseline prove nothing.
    await owner.query(`
      alter default privileges in schema public
        grant all on tables to anon, authenticated, service_role;
    `);
    for (const migration of appliedMigrations())
      await owner.query(
        fs.readFileSync(
          path.join(root, "prisma/migrations", migration, "migration.sql"),
          "utf8",
        ),
      );

    // pg_stat_statements, owned by the migration role exactly as Production
    // reports it, and readable by PUBLIC exactly as Supabase leaves it.
    await owner.query(`
      create schema extensions authorization ${OWNER};
      create view extensions.pg_stat_statements as select 'query'::text as query;
      create view extensions.pg_stat_statements_info as select 1::integer as dealloc;
      grant select on extensions.pg_stat_statements, extensions.pg_stat_statements_info to public;
    `);

    // One real application row, so "modifies no application row" is a
    // measurement rather than a claim about empty tables.
    await owner.query(
      `insert into "ot_order" ("id","tier","email","propertyPin","status","createdAt","updatedAt")
       values ('prod-baseline-fixture','T2','fixture@example.invalid','12345678901234','CHECKOUT_PENDING',now(),now())`,
    );
  }

  const preflight = async () => (await owner.query(PREFLIGHT)).rows[0];

  const applyBaseline = async () => {
    await owner.query("begin");
    try {
      await owner.query(BASELINE);
      await owner.query(POSTCONDITIONS);
      await owner.query("commit");
    } catch (error) {
      await owner.query("rollback").catch(() => undefined);
      throw error;
    }
  };

  describe("clean Production-shaped state", () => {
    beforeAll(async () => {
      await buildProductionShapedState();
    }, 180_000);

    test("the fixture reproduces the four facts that broke the pending chain", async () => {
      const row = await preflight();
      expect(row.owner_is_superuser).toBe(false);
      expect(row.owner_can_create_role).toBe(true);
      expect(row.rls_auto_enable_present).toBe(false);
      expect(row.public_schema_public_create).toBe(false);
      const platformRoles = Array.isArray(row.platform_roles)
        ? row.platform_roles
        : String(row.platform_roles).replace(/^\{|\}$/g, "").split(",");
      expect(platformRoles).toEqual(
        expect.arrayContaining(["anon", "authenticated", "service_role"]),
      );
    });

    test("preflight classifies an untouched database as ABSENT with no prerequisites missing", async () => {
      const row = await preflight();
      expect(row.state).toBe("ABSENT");
      expect(row.present_objects).toBe(0);
      expect(row.missing_prerequisites).toEqual([]);
      expect(row.expected_objects).toBeGreaterThan(30);
    });

    test("preflight reports the provisioned logins as present, pristine and unbound", async () => {
      const row = await preflight();
      expect(row.missing_login_roles).toEqual([]);
      expect(row.unsafe_login_roles).toEqual([]);
      expect(row.unexpected_login_memberships).toEqual([]);
      // Both statistics views exist, which is what lets section 11 close the
      // PUBLIC grant instead of aborting the transaction.
      expect(row.pg_stat_statements_present).toBe(true);
      expect(row.pg_stat_statements_info_present).toBe(true);
    });

    test("the baseline applies and proves its own postconditions without superuser", async () => {
      await expect(applyBaseline()).resolves.toBeUndefined();
    }, 120_000);

    test("the ownership transfers landed and no borrowed membership survived", async () => {
      const owners = await owner.query(`
        select
          pg_get_userbyid((select relowner from pg_class where oid='public.ot_commerce_deadline_capture'::regclass)) as capture_table,
          pg_get_userbyid((select proowner from pg_proc where oid='public.ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)'::regprocedure)) as publish_fn,
          pg_get_userbyid((select proowner from pg_proc where oid='public.ot_neutral_hold_on_settlement_reversal()'::regprocedure)) as guard_fn,
          (select count(*)::int from pg_auth_members m
             join pg_roles granted on granted.oid=m.roleid
             join pg_roles member_role on member_role.oid=m.member
           where granted.rolname in ('ot_commerce_capture_owner','ot_neutral_reversal_guard_owner')
             and member_role.rolname='${OWNER}'
             and (m.inherit_option or m.set_option)) as borrowed
      `);
      expect(owners.rows[0]).toEqual({
        capture_table: "ot_commerce_capture_owner",
        publish_fn: "ot_commerce_capture_owner",
        guard_fn: "ot_neutral_reversal_guard_owner",
        borrowed: 0,
      });
    });

    test("the SECURITY DEFINER functions are closed to PUBLIC and to every API role", async () => {
      const result = await owner.query(`
        select
          has_function_privilege('public','public.ot_neutral_hold_on_settlement_reversal()','EXECUTE') as public_guard,
          has_function_privilege('anon','public.ot_publish_commerce_deadline_capture(text,timestamptz,text,text,bytea)','EXECUTE') as anon_publish,
          has_function_privilege('service_role','public.ot_neutral_hold_on_settlement_reversal()','EXECUTE') as service_guard
      `);
      expect(result.rows[0]).toEqual({
        public_guard: false,
        anon_publish: false,
        service_guard: false,
      });
    });

    test("Supabase default privileges are revoked from every relation the baseline created", async () => {
      const leaks = await owner.query(`
        select c.relname, r.rolname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join pg_roles r
        where n.nspname='public'
          and r.rolname in ('anon','authenticated','service_role')
          and c.relname in (
            'ot_payment_binding','ot_settlement_reversal','ot_order_attribution',
            'ot_packet_download_capability','ot_artifact_orphan_quarantine',
            'ot_delivery_provider_callback','ot_commerce_deadline_capture',
            'ot_neutral_report_reservation','ot_neutral_blob_attempt','ot_neutral_checkout_attempt',
            'ot_neutral_customer_zip_attempt','ot_neutral_qa_review','ot_neutral_refund_work',
            'ot_neutral_delivery_order','ot_neutral_runtime_order')
          and (has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            or has_any_column_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
      `);
      expect(leaks.rows).toEqual([]);
    });

    test("pg_stat_statements is closed to PUBLIC", async () => {
      const result = await owner.query(`
        select has_table_privilege('anon','extensions.pg_stat_statements','SELECT') as anon_select,
               has_table_privilege('anon','extensions.pg_stat_statements_info','SELECT') as info_select
      `);
      expect(result.rows[0]).toEqual({ anon_select: false, info_select: false });
    });

    test("the neutral runtime reaches commerce data only through the barrier views", async () => {
      const result = await owner.query(`
        select
          has_table_privilege('ot_neutral_runtime','public.ot_order','SELECT,INSERT,UPDATE,DELETE') as direct_order,
          has_any_column_privilege('ot_neutral_runtime','public.ot_order','SELECT') as any_order_column,
          has_table_privilege('ot_neutral_runtime','public.ot_neutral_runtime_order','SELECT') as view_order,
          has_table_privilege('ot_neutral_runtime','public.ot_neutral_report_reservation','DELETE') as runtime_delete
      `);
      expect(result.rows[0]).toEqual({
        direct_order: false,
        any_order_column: false,
        view_order: true,
        runtime_delete: false,
      });
    });

    /**
     * THE REVERSAL GUARD'S GRANT SURFACE, MEASURED.
     *
     * `GRANT SELECT, UPDATE (cols) ON ot_neutral_qa_review` binds the column
     * list to UPDATE ONLY — the SELECT in that statement is TABLE-WIDE. The
     * statement reads as though the list governed both, and nothing in this
     * suite or in the postconditions used to say otherwise: section 11 of
     * 03_postconditions.sql excuses this role from the commerce-table sweep on
     * the stated grounds that it holds "two narrow column reads", and
     * ot_neutral_qa_review is not a commerce table, so the wide read sat
     * outside every expectation there was.
     *
     * It is KEPT — it is byte-for-byte the grant 20260915190000 issues, Preview
     * holds it today, and an undocumented ACL difference between the two
     * environments is worse than a wide read held by a NOLOGIN role reachable
     * only through one SECURITY DEFINER trigger — and it is asserted here as
     * the true statement it is, in both directions.
     */
    test("the reversal guard holds exactly its designed grants, wide SELECT included", async () => {
      const result = await owner.query(`
        select
          -- The table-wide SELECT, deliberate and now stated.
          has_table_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','SELECT') as qa_table_select,
          -- Which is why every column of it reads, including the digests.
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','payment_binding_sha256','SELECT') as qa_digest_select,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','reviewer_key','SELECT') as qa_reviewer_select,
          -- The three the atomic hold actually reads.
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','order_id','SELECT') as qa_order_select,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','status','SELECT') as qa_status_select,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','minutes_spent','SELECT') as qa_minutes_select,
          -- The UPDATE half must stay narrow: five columns, and no table-wide.
          has_table_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','UPDATE') as qa_table_update,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','status','UPDATE') as qa_status_update,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','artifact_sha256','UPDATE') as qa_digest_update,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_neutral_qa_review','order_id','UPDATE') as qa_order_update,
          -- The two commerce column reads section 11 excuses, and their bounds.
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_payment_binding','payment_intent','SELECT') as binding_intent_select,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_payment_binding','session_id','SELECT') as binding_session_select,
          has_table_privilege('ot_neutral_reversal_guard_owner','public.ot_payment_binding','SELECT') as binding_table_select,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_settlement_reversal','payment_intent','SELECT') as reversal_intent_select,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_settlement_reversal','received_at','SELECT') as reversal_received_select,
          has_table_privilege('ot_neutral_reversal_guard_owner','public.ot_order','SELECT') as order_select,
          -- Capability revocation: two columns read, two written, nothing else.
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_packet_download_capability','revoked_at','UPDATE') as capability_revoke_update,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_packet_download_capability','use_count','UPDATE') as capability_use_update,
          has_column_privilege('ot_neutral_reversal_guard_owner','public.ot_packet_download_capability','capability_hash','SELECT') as capability_hash_select
      `);
      expect(result.rows[0]).toEqual({
        qa_table_select: true,
        qa_digest_select: true,
        qa_reviewer_select: true,
        qa_order_select: true,
        qa_status_select: true,
        qa_minutes_select: true,
        qa_table_update: false,
        qa_status_update: true,
        qa_digest_update: false,
        qa_order_update: false,
        binding_intent_select: true,
        binding_session_select: false,
        binding_table_select: false,
        reversal_intent_select: true,
        reversal_received_select: false,
        order_select: false,
        capability_revoke_update: true,
        capability_use_update: false,
        capability_hash_select: false,
      });
    });

    /**
     * The baseline owns the three login->functional-role edges and exactly
     * those. Asserted from the catalog rather than from the postconditions, so
     * that a postcondition that stopped looking would not also stop this
     * failing.
     */
    test("each restricted login is bound to exactly one functional role, INHERIT and not SET", async () => {
      const edges = await owner.query(`
        select member_role.rolname as login, granted.rolname as functional,
               m.inherit_option, m.set_option, m.admin_option
        from pg_auth_members m
        join pg_roles granted on granted.oid = m.roleid
        join pg_roles member_role on member_role.oid = m.member
        where member_role.rolname = any($1::text[])
        order by 1, 2
      `, [LOGINS]);
      expect(edges.rows).toEqual(
        [...LOGIN_BINDINGS]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([login, functional]) => ({
            login,
            functional,
            inherit_option: true,
            set_option: false,
            admin_option: false,
          })),
      );
    });

    test("a bound login reaches its functional role's grants and nothing more", async () => {
      const result = await owner.query(`
        select
          has_table_privilege('ot_prod_app','public.ot_fulfillment_kind_authority','SELECT') as app_authority_view,
          has_any_column_privilege('ot_prod_app','public.ot_neutral_report_reservation','SELECT') as app_reservation_columns,
          has_table_privilege('ot_prod_app','public.ot_order','SELECT') as app_order,
          has_table_privilege('ot_prod_neutral_runtime','public.ot_neutral_runtime_order','SELECT') as runtime_view,
          has_table_privilege('ot_prod_neutral_runtime','public.ot_order','SELECT') as runtime_order,
          has_table_privilege('ot_prod_neutral_delivery','public.ot_neutral_delivery_order','SELECT') as delivery_view,
          has_table_privilege('ot_prod_neutral_delivery','public.ot_neutral_refund_work','SELECT') as delivery_refunds
      `);
      expect(result.rows[0]).toEqual({
        app_authority_view: true,
        app_reservation_columns: true,
        app_order: false,
        runtime_view: true,
        runtime_order: false,
        delivery_view: true,
        delivery_refunds: false,
      });
    });

    /**
     * The SQL and the TypeScript proofs meet here.
     *
     * `assertProductionRoleBindings` is what Phase 3, 5 and 7 actually run, and
     * it reads the membership graph through `pg_has_role(..., 'MEMBER')`. The
     * baseline grants each edge `INHERIT TRUE, SET FALSE`, so if `MEMBER` were
     * the SET-shaped predicate rather than the membership-shaped one, every
     * apply would report three missing bindings against a database that had them
     * — a disagreement between the two halves that no amount of unit testing on
     * either half alone would surface. It is measured against a real catalog.
     */
    test("the verifier's own role and binding queries pass against the applied catalog", async () => {
      const roles = await owner.query(PRODUCTION_ROLE_SQL, [
        [...OT_NEUTRAL_FUNCTIONAL_ROLES, ...LOGINS],
      ]);
      expect(() =>
        assertProductionRoleInventory(
          roles.rows as Parameters<typeof assertProductionRoleInventory>[0],
        ),
      ).not.toThrow();

      const graph = await owner.query(PRODUCTION_BINDING_SQL, [LOGINS]);
      expect(graph.rows).toEqual(
        [...LOGIN_BINDINGS]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([login, functional]) => ({
            login,
            functional,
            can_set: false,
            edge_count: 1,
            exact_edge_count: 1,
            total_edge_count: 1,
          })),
      );
      expect(() =>
        assertProductionRoleBindings(
          graph.rows as Parameters<typeof assertProductionRoleBindings>[0],
        ),
      ).not.toThrow();
    }, 180_000);

    test("no application row was created, changed or removed", async () => {
      const result = await owner.query(
        `select count(*)::int as orders,
                (select count(*)::int from "ot_order" where id='prod-baseline-fixture') as fixture,
                (select count(*)::int from "ot_neutral_report_reservation") as reservations,
                (select count(*)::int from "ot_neutral_qa_review") as reviews,
                (select count(*)::int from "ot_payment_binding") as bindings
         from "ot_order"`,
      );
      expect(result.rows[0]).toEqual({
        orders: 1,
        fixture: 1,
        reservations: 0,
        reviews: 0,
        bindings: 0,
      });
    });

    test("the Prisma migration ledger was not written by the baseline", async () => {
      const result = await owner.query(
        `select to_regclass('public._prisma_migrations') is null as absent`,
      );
      expect(result.rows[0].absent).toBe(true);
    });

    test("replay is a verified no-op: preflight is COMPLETE and postconditions pass again", async () => {
      const row = await preflight();
      expect(row.state).toBe("COMPLETE");
      expect(row.present_objects).toBe(row.expected_objects);
      expect(row.missing_objects).toEqual([]);
      await expect(owner.query(POSTCONDITIONS)).resolves.toBeDefined();
    });
  });

  describe("fail-closed behaviour", () => {
    beforeEach(async () => {
      await buildProductionShapedState();
    }, 180_000);

    test("partial state is refused: the preflight reports PARTIAL and names what is missing", async () => {
      await applyBaseline();
      await owner.query(`drop table "ot_neutral_refund_work" cascade`);
      const row = await preflight();
      expect(row.state).toBe("PARTIAL");
      expect(row.missing_objects).toEqual(
        expect.arrayContaining(["relation:ot_neutral_refund_work"]),
      );
      expect(row.present_objects).toBeGreaterThan(0);
      expect(row.present_objects).toBeLessThan(row.expected_objects);
    }, 180_000);

    test("a missing prerequisite is reported before anything is applied", async () => {
      await owner.query(`drop table "ot_delivery_event" cascade`);
      const row = await preflight();
      expect(row.missing_prerequisites).toEqual(
        expect.arrayContaining(["relation:ot_delivery_event"]),
      );
      expect(row.state).toBe("ABSENT");
    }, 180_000);

    test("tampering with a policy after the fact fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(
        `drop policy "ot_neutral_qa_review_app_read" on "ot_neutral_qa_review"`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_neutral_qa_review_app_read/,
      );
    }, 180_000);

    test("tampering that ADDS an unexpected policy also fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(
        `create policy "ot_sneaky_read" on "ot_neutral_refund_work" for select to ot_neutral_app_reader using (true)`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /unexpected policy ot_sneaky_read/,
      );
    }, 180_000);

    test("weakening FORCE row level security fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(
        `alter table "ot_packet_download_capability" no force row level security`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_packet_download_capability is not ENABLE \+ FORCE/,
      );
    }, 180_000);

    /**
     * `security_barrier` is what stops PostgreSQL pushing a caller-supplied
     * qualifier BELOW the view's own WHERE clause, where a leakproof-looking
     * operator or a user-defined function in that qualifier can observe rows
     * the view exists to hide. Turning it off is ONE statement, leaves the view
     * present, readable by exactly the intended role, and correct in every
     * other respect — so nothing else in this file would have noticed.
     *
     * Each of the six is tampered with individually, because a check written
     * over a list can silently stop covering an entry of it.
     */
    test.each([
      "ot_neutral_delivery_order",
      "ot_fulfillment_kind_authority",
      "ot_packet_capability_kind_authority",
      "ot_neutral_runtime_order",
      "ot_neutral_runtime_payment_binding",
      "ot_neutral_runtime_settlement_reversal",
    ])("dropping security_barrier from %s fails the postconditions", async (view) => {
      await applyBaseline();
      // Proved present first, so the tamper below is a change and not a no-op.
      const before = await owner.query(
        `select (select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_barrier') as barrier
         from pg_class c where c.oid = to_regclass('public.' || quote_ident($1))`,
        [view],
      );
      expect(before.rows[0].barrier).toBe("true");

      await owner.query(
        `alter view "${view}" set (security_barrier = false)`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        new RegExp(`view ${view} is not security_barrier=true`),
      );
    }, 180_000);

    test("removing the security_barrier option entirely fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(
        `alter view "ot_neutral_runtime_order" reset (security_barrier)`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /view ot_neutral_runtime_order is not security_barrier=true/,
      );
    }, 180_000);

    /**
     * The reversal guard's grant surface is pinned in BOTH directions, so a
     * widening and a narrowing are each a failure with their own message. The
     * table-wide SELECT is deliberate; widening the UPDATE to match it is not,
     * and it is the change that would let the atomic hold rewrite a digest.
     */
    test("widening the reversal guard's UPDATE to the whole table fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(
        `grant update on "ot_neutral_qa_review" to ot_neutral_reversal_guard_owner`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_neutral_reversal_guard_owner unexpectedly holds table-wide UPDATE on ot_neutral_qa_review/,
      );
    }, 180_000);

    test("widening the reversal guard's commerce reads fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(
        `grant select on "ot_payment_binding" to ot_neutral_reversal_guard_owner`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_neutral_reversal_guard_owner unexpectedly holds table-wide SELECT on ot_payment_binding/,
      );
    }, 180_000);

    /**
     * And the narrowing direction. The three columns the hold reads are pinned
     * individually, so a future attempt to tighten the wide SELECT that missed
     * one would fail HERE rather than at a settlement reversal in Production.
     */
    test("narrowing the reversal guard's SELECT below what the hold reads fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(
        `revoke select on "ot_neutral_qa_review" from ot_neutral_reversal_guard_owner`,
      );
      const failure = owner.query(POSTCONDITIONS);
      await expect(failure).rejects.toThrow(
        /ot_neutral_reversal_guard_owner is missing SELECT on ot_neutral_qa_review\.status/,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_neutral_reversal_guard_owner is missing table-wide SELECT on ot_neutral_qa_review/,
      );
    }, 180_000);

    test("re-opening a SECURITY DEFINER function to PUBLIC fails the postconditions", async () => {
      await applyBaseline();
      await superuser.query(
        `grant execute on function public.ot_neutral_hold_on_settlement_reversal() to public`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /still executable by PUBLIC/,
      );
    }, 180_000);

    test("re-granting a Supabase API role fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(`grant select on "ot_neutral_qa_review" to anon`);
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /API role anon retains access to ot_neutral_qa_review/,
      );
    }, 180_000);

    /**
     * The postcondition that proves the widened admin-event vocabulary landed
     * used to anchor on `CHECK ((action = '…'))` — the NON-pretty rendering —
     * while asking `pg_get_constraintdef(oid, pretty := true)`, which emits ONE
     * pair of parentheses. It could not match any input it was ever given, so a
     * database that still carried the superseded constraint passed.
     *
     * Both halves are pinned against the live catalog: what PostgreSQL actually
     * renders, and that the postcondition now fires on it.
     */
    test("the superseded single-action CHECK renders with one paren pair, and the postcondition sees it", async () => {
      // Both predicates, evaluated by the server against the real constraint the
      // real migration created. String-equality on the rendering would be a
      // guess about PostgreSQL's formatter; this is the question that matters.
      const rendering = await owner.query(
        `select
           pg_get_constraintdef(oid, true) as pretty,
           pg_get_constraintdef(oid, true)
             ~ '^CHECK \\(\\(action = ''ENTER_MANUAL_REVIEW''::text\\)\\)$' as old_predicate,
           regexp_replace(pg_get_constraintdef(oid, true), '\\s', '', 'g')
             ~ '^CHECK\\(\\(*\\(?action\\)?(::text)?=''ENTER_MANUAL_REVIEW''::text\\)*\\)$' as new_predicate
         from pg_constraint
         where conname = 'ot_fulfillment_admin_event_action_check'`,
      );
      expect(rendering.rows).toHaveLength(1);
      expect(rendering.rows[0].pretty).toContain("ENTER_MANUAL_REVIEW");
      // The defect, reproduced: the shipped-until-now predicate never matched.
      expect(rendering.rows[0].old_predicate).toBe(false);
      expect(rendering.rows[0].new_predicate).toBe(true);

      await applyBaseline();
      await owner.query(
        `alter table "ot_fulfillment_admin_event"
           add constraint "ot_fulfillment_admin_event_action_check"
           check ("action" = 'ENTER_MANUAL_REVIEW')`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /superseded single-action admin-event CHECK is still present/,
      );
    }, 180_000);

    test("an absent restricted login aborts the baseline and is named", async () => {
      await superuser.query(`drop role ot_prod_neutral_delivery`);
      const row = await preflight();
      expect(row.missing_login_roles).toEqual(["ot_prod_neutral_delivery"]);

      await owner.query("begin");
      await expect(owner.query(BASELINE)).rejects.toThrow(
        /Production login ot_prod_neutral_delivery does not exist/,
      );
      await owner.query("rollback");
    }, 180_000);

    test("a restricted login carrying ambient authority aborts the baseline", async () => {
      await superuser.query(`alter role ot_prod_app bypassrls`);
      const row = await preflight();
      expect(row.unsafe_login_roles).toEqual(["ot_prod_app"]);

      await owner.query("begin");
      await expect(owner.query(BASELINE)).rejects.toThrow(
        /Production login ot_prod_app is not a pristine restricted login/,
      );
      await owner.query("rollback");
    }, 180_000);

    /**
     * "Exactly this edge and no other" is not provable by adding one. A login
     * that already reaches something else is a privilege path nobody designed,
     * and the baseline refuses rather than granting a fourth edge on top of it.
     */
    test("a restricted login that already reaches another role aborts the baseline", async () => {
      await superuser.query(`create role ot_unrelated_bystander nologin`);
      try {
        await superuser.query(
          `grant ot_unrelated_bystander to ot_prod_neutral_runtime`,
        );
        const row = await preflight();
        expect(row.unexpected_login_memberships).toEqual([
          "ot_prod_neutral_runtime->ot_unrelated_bystander",
        ]);

        await owner.query("begin");
        await expect(owner.query(BASELINE)).rejects.toThrow(
          /ot_prod_neutral_runtime already reaches role\(s\) this rollout did not design: ot_unrelated_bystander/,
        );
        await owner.query("rollback");
      } finally {
        await superuser.query(
          `do $$ begin
             if exists (select 1 from pg_roles where rolname = 'ot_unrelated_bystander') then
               execute 'drop owned by ot_unrelated_bystander cascade';
               execute 'drop role ot_unrelated_bystander';
             end if;
           end $$`,
        );
      }
    }, 180_000);

    test("revoking a login binding after the fact fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(`revoke ot_neutral_app_reader from ot_prod_app`);
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_prod_app is not bound to ot_neutral_app_reader/,
      );
    }, 180_000);

    test("adding a fourth binding after the fact fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(`grant ot_neutral_runtime to ot_prod_app`);
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_prod_app reaches ot_neutral_runtime \(granted by [^)]*\), which this rollout did not design/,
      );
    }, 180_000);

    /**
     * THE TWO-GRANTOR BYPASS, against a real catalog.
     *
     * `pg_auth_members` is keyed on (roleid, member, GRANTOR). A second grantor
     * can therefore record a SECOND edge for the SAME login -> functional pair,
     * and PostgreSQL unions the options on the two. Everything that used to be
     * asked about this pair was satisfied by the baseline's own correct edge:
     *
     *   * 02_baseline.sql looked for memberships `<> functional`, so the extra
     *     edge is on the one role it excluded from the query;
     *   * 03_postconditions.sql asked `EXISTS (… inherit AND NOT set …)`, which
     *     the baseline's row satisfies regardless of what sits beside it;
     *   * PRODUCTION_BINDING_SQL returned one row per reachable PAIR, and the
     *     pair set is unchanged.
     *
     * And the consequence is the one thing the whole binding design exists to
     * prevent: `ot_prod_app` can SET ROLE to `ot_neutral_app_reader` and shed
     * the login identity every audit trail is keyed on.
     *
     * The bypass is reproduced first — proved to BE a bypass by asserting the
     * SET path is live — and then every layer is required to reject it.
     */
    test("a second grantor's edge on the designed pair is the bypass, and every layer now rejects it", async () => {
      await applyBaseline();

      // The superuser is a grantor the migration role is not. This is exactly
      // the topology a platform operator produces with one GRANT.
      await superuser.query(
        `grant ot_neutral_app_reader to ot_prod_app with inherit true, set true`,
      );

      // 1. It really is two rows, and the SET path really is live.
      const catalog = await owner.query(`
        select count(*)::int as edges,
               pg_has_role('ot_prod_app','ot_neutral_app_reader','SET') as can_set
        from pg_auth_members m
        join pg_roles granted on granted.oid = m.roleid
        join pg_roles member_role on member_role.oid = m.member
        where member_role.rolname = 'ot_prod_app'
          and granted.rolname = 'ot_neutral_app_reader'
      `);
      expect(catalog.rows[0]).toEqual({ edges: 2, can_set: true });

      // 2. The SQL postconditions reject it — on the count, on the total, and
      //    on the SET path itself.
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_prod_app can SET ROLE to ot_neutral_app_reader/,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_prod_app holds 2 membership edges; exactly one is designed/,
      );

      // 3. The preflight reports it, and the runner's classifier refuses on it.
      const row = await preflight();
      expect(row.login_binding_set_paths).toEqual([
        "ot_prod_app->ot_neutral_app_reader",
      ]);
      expect(row.duplicate_login_bindings).toEqual([
        "ot_prod_app->ot_neutral_app_reader x2",
      ]);
      expect(row.unsafe_login_binding_edges).toEqual([
        expect.stringContaining("ot_prod_app->ot_neutral_app_reader:grantor=postgres"),
      ]);
      const classified = classifyBaselinePreflight(
        row as Parameters<typeof classifyBaselinePreflight>[0],
      );
      expect(classified.action).toBe("REFUSE");
      expect(classified.reasons.join(" ")).toMatch(
        /can SET ROLE to their functional role: ot_prod_app->ot_neutral_app_reader/,
      );

      // 4. The TypeScript verifier rejects it, from the same query Phase 3, 5
      //    and 7 actually issue — and the PAIR SET it returns is identical to a
      //    healthy one, which is why the counters had to exist.
      const graph = await owner.query(PRODUCTION_BINDING_SQL, [LOGINS]);
      expect(graph.rows.map((r: { login: string; functional: string }) => [r.login, r.functional]))
        .toEqual(
          [...LOGIN_BINDINGS]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([login, functional]) => [login, functional]),
        );
      expect(() =>
        assertProductionRoleBindings(
          graph.rows as Parameters<typeof assertProductionRoleBindings>[0],
        ),
      ).toThrow(/ot_prod_app can SET ROLE to ot_neutral_app_reader/);
    }, 180_000);

    /**
     * The pre-apply half of the same defect: a login that is ALREADY bound to
     * its designed functional role by somebody else. The body used to accept
     * this silently — its check excluded the designed role — and then grant a
     * second edge on top, which is how two grantors end up on one pair in the
     * first place.
     */
    test("a login already bound to its own functional role aborts the baseline", async () => {
      await superuser.query(`create role ot_neutral_app_reader nologin noinherit`);
      await superuser.query(
        `grant ot_neutral_app_reader to ot_prod_app with inherit true, set true`,
      );
      const row = await preflight();
      expect(row.login_binding_edges).toEqual([
        expect.stringContaining("ot_prod_app->ot_neutral_app_reader"),
      ]);
      expect(row.login_binding_set_paths).toEqual([
        "ot_prod_app->ot_neutral_app_reader",
      ]);
      // ABSENT + an existing edge on the designed pair is a refusal.
      const classified = classifyBaselinePreflight(
        row as Parameters<typeof classifyBaselinePreflight>[0],
      );
      expect(classified.action).toBe("REFUSE");
      expect(classified.reasons.join(" ")).toMatch(
        /already bound to their functional role, which this baseline has not yet granted/,
      );

      await owner.query("begin");
      await expect(owner.query(BASELINE)).rejects.toThrow(
        /ot_prod_app already reaches role\(s\) this rollout did not design: ot_neutral_app_reader \(granted by postgres/,
      );
      await owner.query("rollback");
    }, 180_000);

    /**
     * The functional role must never be SET-able, so the baseline grants
     * `SET FALSE` — and proves it did, inside its own transaction, rather than
     * leaving the claim to a later file.
     */
    test("weakening a binding to SET TRUE fails the postconditions", async () => {
      await applyBaseline();
      await owner.query(
        `grant ot_neutral_app_reader to ot_prod_app with inherit true, set true`,
      );
      await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
        /ot_prod_app can SET ROLE to ot_neutral_app_reader/,
      );
    }, 180_000);

    /**
     * The body closes the PUBLIC grant on both statistics views and aborts if
     * either is absent. The preflight reports the absence so the rehearsal
     * refuses on its receipt instead of mid-transaction.
     */
    test("a missing statistics view is reported by the preflight and aborts the body", async () => {
      await owner.query(`drop view extensions.pg_stat_statements_info`);
      const row = await preflight();
      expect(row.pg_stat_statements_present).toBe(true);
      expect(row.pg_stat_statements_info_present).toBe(false);

      await owner.query("begin");
      await expect(owner.query(BASELINE)).rejects.toThrow(
        /statistics-view topology is invalid/,
      );
      await owner.query("rollback");
    }, 180_000);

    /**
     * THE ZERO-ROW PROOF, PROVED TO BE A PROOF.
     *
     * It used to be `SELECT count(*)` over the thirteen relations the baseline
     * CREATES — all of which are empty by construction, so it could only ever
     * confirm something that could not have been otherwise. The claim operators
     * actually need is about the tables it does NOT create: `ot_order`,
     * `ot_fulfillment`, `ot_delivery_attempt` and the rest, which hold real
     * commerce rows and which the baseline alters the shape of.
     *
     * `pg_stat_xact_all_tables` answers that, and reads no customer data to do
     * it — three integers per relation, not one column value of one row. Here
     * the write is made deliberately, in the same transaction, against a
     * pre-existing table, and the baseline is required to see it.
     */
    test("the write proof measures only writes attributable to the baseline", async () => {
      await owner.query("begin");
      try {
        await owner.query(
          `insert into "ot_order" ("id","tier","email","propertyPin","status","createdAt","updatedAt")
           values ('zero-row-probe','T2','probe@example.invalid','99999999999999','CHECKOUT_PENDING',now(),now())`,
        );
        await expect(owner.query(BASELINE)).resolves.toBeDefined();
      } finally {
        await owner.query("rollback").catch(() => undefined);
      }
      // And it really did roll back: the probe row is not there.
      const survivors = await owner.query(
        `select count(*)::int as n from "ot_order" where id = 'zero-row-probe'`,
      );
      expect(survivors.rows[0].n).toBe(0);
    }, 180_000);

    test("the zero-row proof refuses to be vacuous: track_counts must be on", async () => {
      const setting = await owner.query(
        `select current_setting('track_counts', true) as track_counts`,
      );
      // If this ever came back anything but 'on', the proof above would pass by
      // measuring nothing — which is why the baseline raises rather than skips.
      expect(setting.rows[0].track_counts).toBe("on");
    }, 180_000);

    test("a second apply against an already-complete database fails on existing objects", async () => {
      await applyBaseline();
      await expect(owner.query(BASELINE)).rejects.toThrow(/already exists/);
    }, 180_000);

    /**
     * The constraint drop used to select by `conkey` — any CHECK whose columns
     * are a subset of the four admin-event columns — and drop whatever it found.
     * A hardening constraint added out-of-band matches that predicate exactly,
     * and would have been destroyed by a run whose receipt says "constraint
     * reshape only".
     */
    test("an unrecognised CHECK on the admin-event columns aborts the baseline", async () => {
      await owner.query(
        `alter table "ot_fulfillment_admin_event"
           add constraint "ot_admin_event_operator_guard"
           check ("reason_code" <> 'FORBIDDEN')`,
      );
      await owner.query("begin");
      await expect(owner.query(BASELINE)).rejects.toThrow(
        /unexpected CHECK constraint/,
      );
      await owner.query("rollback");

      const survived = await owner.query(
        `select count(*)::int as n from pg_constraint
         where conname = 'ot_admin_event_operator_guard'`,
      );
      expect(survived.rows[0].n).toBe(1);
    }, 180_000);

    test("the four pinned single-action CHECKs are the ones that get dropped", async () => {
      const before = await owner.query(
        `select conname from pg_constraint
         where conrelid = '"ot_fulfillment_admin_event"'::regclass and contype = 'c'
         order by conname`,
      );
      // If PostgreSQL ever named these differently, the pinned list would drop
      // nothing and the postconditions would catch it — but the failure would
      // read as a postcondition bug, so the names are asserted where they live.
      expect(before.rows.map((row: { conname: string }) => row.conname)).toEqual(
        expect.arrayContaining([
          "ot_fulfillment_admin_event_action_check",
          "ot_fulfillment_admin_event_to_status_check",
          "ot_fulfillment_admin_event_reason_code_check",
          "ot_fulfillment_admin_event_from_status_check",
        ]),
      );

      await applyBaseline();
      const after = await owner.query(
        `select count(*)::int as n from pg_constraint
         where conrelid = '"ot_fulfillment_admin_event"'::regclass
           and contype = 'c'
           and conname in ('ot_fulfillment_admin_event_action_check',
                           'ot_fulfillment_admin_event_to_status_check',
                           'ot_fulfillment_admin_event_reason_code_check',
                           'ot_fulfillment_admin_event_from_status_check')`,
      );
      expect(after.rows[0].n).toBe(0);
    }, 180_000);
  });

  /**
   * Cluster-global role facts. Roles outlive a dropped schema and a platform
   * operator can create them ahead of time, so the preflight has to classify
   * them as what they are rather than counting them into the ABSENT/PARTIAL
   * tally — which is what made a database with pre-created roles and no tables
   * refuse permanently while 02_baseline.sql was written to adopt them.
   */
  describe("pre-created roles and membership options", () => {
    beforeEach(async () => {
      await buildProductionShapedState();
    }, 180_000);

    test("pristine pre-created roles leave an untouched database ABSENT", async () => {
      for (const role of ["ot_neutral_runtime", "ot_neutral_app_reader"]) {
        await superuser.query(`create role ${role} nologin noinherit`);
        await superuser.query(
          `grant ${role} to ${OWNER} with admin option, inherit false, set false`,
        );
      }

      const row = await preflight();
      expect(row.state).toBe("ABSENT");
      expect(row.present_objects).toBe(0);
      expect(row.present_roles).toEqual([
        "ot_neutral_app_reader",
        "ot_neutral_runtime",
      ]);
      expect(row.unsafe_preexisting_roles).toEqual([]);
      // And the body genuinely adopts them.
      await expect(applyBaseline()).resolves.toBeUndefined();
    }, 180_000);

    /**
     * The two owner roles are the ones the transfers SET ROLE to. A role created
     * by somebody else, with no ADMIN edge back to the migration role, cannot be
     * adopted at all — and the refusal has to say that rather than surfacing as
     * a bare permission error partway through.
     */
    test("an un-adoptable pre-created owner role is refused by name", async () => {
      await superuser.query(
        `create role ot_commerce_capture_owner nologin noinherit`,
      );
      await owner.query("begin");
      await expect(owner.query(BASELINE)).rejects.toThrow(
        /ot_commerce_capture_owner cannot be adopted/,
      );
      await owner.query("rollback");
    }, 180_000);

    test("a pre-created role that can log in is reported as unsafe", async () => {
      await superuser.query(`create role ot_neutral_runtime login noinherit`);
      const row = await preflight();
      expect(row.unsafe_preexisting_roles).toEqual(["ot_neutral_runtime"]);
      expect(row.present_roles).toEqual(["ot_neutral_runtime"]);
    }, 180_000);

    /**
     * `createrole_self_grant = 'set, inherit'` makes CREATE ROLE hand the
     * creating role SET and INHERIT automatically. The transfer blocks then
     * found they already had what they were about to borrow, borrowed nothing,
     * restored nothing, and left a live SET path into a SECURITY DEFINER
     * function owner.
     */
    test("no SET/INHERIT edge survives even when createrole_self_grant grants them", async () => {
      await owner.query(`set createrole_self_grant = 'set, inherit'`);
      try {
        await expect(applyBaseline()).resolves.toBeUndefined();
      } finally {
        await owner.query(`reset createrole_self_grant`);
      }
      const result = await owner.query(`
        select count(*)::int as borrowed from pg_auth_members m
        join pg_roles granted on granted.oid = m.roleid
        join pg_roles member_role on member_role.oid = m.member
        where granted.rolname in ('ot_commerce_capture_owner','ot_neutral_reversal_guard_owner')
          and member_role.rolname = '${OWNER}'
          and (m.inherit_option or m.set_option)
      `);
      expect(result.rows[0].borrowed).toBe(0);
    }, 180_000);

    /**
     * Restore means restore. Writing `INHERIT FALSE, SET FALSE` unconditionally
     * removed a privilege the baseline never borrowed, invisibly, on any edge
     * that did not start that way.
     */
    test("a pre-existing membership edge is restored to exactly its original shape", async () => {
      await superuser.query(
        `create role ot_commerce_capture_owner nologin noinherit`,
      );
      await superuser.query(
        `grant ot_commerce_capture_owner to ${OWNER} with admin true, inherit true, set false`,
      );

      await owner.query("begin");
      try {
        await owner.query(BASELINE);
        const edge = await owner.query(`
          select m.inherit_option, m.set_option from pg_auth_members m
          join pg_roles granted on granted.oid = m.roleid
          join pg_roles member_role on member_role.oid = m.member
          where granted.rolname = 'ot_commerce_capture_owner'
            and member_role.rolname = '${OWNER}'
        `);
        expect(edge.rows[0]).toEqual({
          inherit_option: true,
          set_option: false,
        });
        // Restored faithfully, and then refused — an INHERIT path into a
        // SECURITY DEFINER function owner is not something the baseline gets to
        // accept just because it was not the one that created it.
        await expect(owner.query(POSTCONDITIONS)).rejects.toThrow(
          /holds SET or INHERIT on ot_commerce_capture_owner/,
        );
      } finally {
        await owner.query("rollback").catch(() => undefined);
      }
    }, 180_000);
  });
});
