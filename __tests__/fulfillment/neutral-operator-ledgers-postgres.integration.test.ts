/** @jest-environment node */
/**
 * Native coverage for the Slice 1 operator-ledger migration.
 *
 * A Prisma `db push` proves nothing about CHECK constraints, partial unique
 * indexes, composite foreign keys, forced RLS, or column-level grants, because
 * Prisma does not emit them. These tests start a disposable PostgreSQL cluster,
 * apply the EXACT `migration.sql`, and then probe each guarantee — including
 * negative probes that degrade one privilege at a time and re-run the
 * migration's own verification block.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";

const migrationPath = path.join(
  process.cwd(),
  "prisma/migrations/20260922120000_add_ot_neutral_operator_ledgers/migration.sql",
);

function available() {
  try {
    execFileSync("initdb", ["--version"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const suite = available() ? describe : describe.skip;

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);

suite("neutral operator ledgers migration on native PostgreSQL", () => {
  let root = "",
    data = "",
    socket = "",
    port = 0;
  let started = false;
  let client: Client;
  let verification = "";

  const postgresEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
  const API_ROLES = ["anon", "authenticated", "service_role"] as const;
  const LEDGERS = [
    "ot_neutral_order_classification",
    "ot_neutral_operator_artifact_read",
    "ot_neutral_manual_delivery",
  ] as const;

  const verify = () => client.query(verification);

  /** Seed one complete authoritative chain the ledgers can reference. */
  const seed = async () => {
    await client.query(`
      INSERT INTO ot_order ("id") VALUES ('ord_1') ON CONFLICT DO NOTHING;
      INSERT INTO ot_neutral_report_reservation ("id","order_id") VALUES ('res_1','ord_1') ON CONFLICT DO NOTHING;
      INSERT INTO ot_fulfillment ("id","order_id") VALUES ('ful_1','ord_1') ON CONFLICT DO NOTHING;
      INSERT INTO ot_fulfillment_artifact ("id","fulfillment_id","version","artifact_sha256")
        VALUES ('art_1','ful_1',1,'${HEX_A}') ON CONFLICT DO NOTHING;
      INSERT INTO ot_neutral_qa_review ("id","reservation_id","order_id") VALUES ('qa_1','res_1','ord_1') ON CONFLICT DO NOTHING;
    `);
  };

  const prepared = (id: string, sha = HEX_A) =>
    client.query(
      `INSERT INTO "ot_neutral_manual_delivery"
         ("id","reservation_id","order_id","qa_review_id","fulfillment_id","customer_artifact_sha256",
          "policy_version","property_binding_fingerprint","payment_binding_sha256","status","status_revision",
          "prepared_by","prepare_expires_at")
       VALUES ($1,'res_1','ord_1','qa_1','ful_1',$2,'p/v1','fp_1',$3,'PREPARED',0,'admin:u1',CURRENT_TIMESTAMP + interval '24 hours')`,
      [id, sha, HEX_B],
    );

  beforeAll(async () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    verification = sql.slice(sql.lastIndexOf("DO $$"));
    expect(verification).toContain(
      "neutral operator ledger runtime security verification failed",
    );

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-neutral-ledgers-"));
    data = path.join(root, "data");
    socket = path.join(root, "socket");
    fs.mkdirSync(socket);
    port = 44000 + Math.floor(Math.random() * 8000);
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "postgres"], {
      stdio: "ignore",
      env: postgresEnv,
    });
    execFileSync(
      "pg_ctl",
      ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-w", "start"],
      { stdio: "ignore", env: postgresEnv },
    );
    started = true;
    client = new Client({ host: socket, port, user: "postgres", database: "postgres" });
    await client.connect();
    await client.query(`
      CREATE ROLE ot_neutral_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      GRANT USAGE ON SCHEMA public TO ot_neutral_runtime;
      CREATE TABLE ot_order (id text primary key);
      CREATE TABLE ot_neutral_report_reservation (
        id text primary key,
        order_id text unique not null references ot_order(id)
      );
      CREATE TABLE ot_fulfillment (id text primary key, order_id text not null references ot_order(id));
      CREATE TABLE ot_fulfillment_artifact (
        id text primary key,
        fulfillment_id text not null references ot_fulfillment(id),
        version integer not null,
        artifact_sha256 text not null,
        UNIQUE (fulfillment_id, version),
        UNIQUE (fulfillment_id, artifact_sha256)
      );
      CREATE TABLE ot_neutral_qa_review (
        id text primary key,
        reservation_id text unique not null references ot_neutral_report_reservation(id),
        order_id text unique not null references ot_order(id)
      );
    `);
    // The exact migration bytes, unmodified.
    await client.query(fs.readFileSync(migrationPath, "utf8"));
    await seed();
  }, 180_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    if (data && started)
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "ignore",
        env: postgresEnv,
      });
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  /** Put the grant posture back exactly as the migration leaves it. */
  const restore = async () => {
    for (const table of LEDGERS) {
      await client.query(`REVOKE ALL ON TABLE "${table}" FROM ot_neutral_runtime`);
      for (const role of API_ROLES)
        await client.query(`REVOKE ALL ON TABLE "${table}" FROM ${role}`);
    }
    await client.query(
      `GRANT SELECT ON TABLE "ot_neutral_order_classification" TO ot_neutral_runtime;
       GRANT INSERT ("order_id","class","actor_key","note_code") ON TABLE "ot_neutral_order_classification" TO ot_neutral_runtime;
       GRANT SELECT ON TABLE "ot_neutral_operator_artifact_read" TO ot_neutral_runtime;
       GRANT INSERT ("id","reservation_id","order_id","actor_key","purpose","artifact_kind","sha256","reservation_bundle_sha256","byte_size") ON TABLE "ot_neutral_operator_artifact_read" TO ot_neutral_runtime;
       GRANT SELECT ON TABLE "ot_neutral_manual_delivery" TO ot_neutral_runtime;`,
    );
    await client.query(
      `DELETE FROM "ot_neutral_manual_delivery"; DELETE FROM "ot_neutral_operator_artifact_read"; DELETE FROM "ot_neutral_order_classification";`,
    );
  };

  afterEach(restore);

  // ---------------------------------------------------------------- posture

  test("the migration's own verification passes on the posture it leaves", async () => {
    await expect(verify()).resolves.toBeDefined();
  });

  test.each(LEDGERS)("%s has ENABLE and FORCE row level security", async (table) => {
    const result = await client.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid=$1::regclass`,
      [table],
    );
    expect(result.rows[0]).toEqual({ enabled: true, forced: true });
  });

  test.each(LEDGERS)("PUBLIC holds no privilege on %s", async (table) => {
    const result = await client.query(
      `SELECT has_table_privilege('public',$1,'SELECT') AS held`,
      [table],
    );
    expect(result.rows[0].held).toBe(false);
  });

  test.each(
    LEDGERS.flatMap((table) =>
      API_ROLES.flatMap((role) =>
        (["SELECT", "INSERT", "UPDATE", "DELETE"] as const).map(
          (privilege) => [table, role, privilege] as const,
        ),
      ),
    ),
  )("%s: API role %s holds no %s", async (table, role, privilege) => {
    const result = await client.query(
      `SELECT has_table_privilege($1,$2,$3) AS held`,
      [role, table, privilege],
    );
    expect(result.rows[0].held).toBe(false);
  });

  test("the runtime role is insert-only on classification and the read audit, and read-only on manual delivery (I-11)", async () => {
    const result = await client.query(
      `SELECT
         has_table_privilege('ot_neutral_runtime','ot_neutral_order_classification','SELECT') s_cls,
         has_table_privilege('ot_neutral_runtime','ot_neutral_order_classification','INSERT') i_cls,
         has_table_privilege('ot_neutral_runtime','ot_neutral_order_classification','UPDATE') u_cls,
         has_table_privilege('ot_neutral_runtime','ot_neutral_order_classification','DELETE') d_cls,
         has_table_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','SELECT') s_rd,
         has_table_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','INSERT') i_rd,
         has_table_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','UPDATE') u_rd,
         has_table_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','DELETE') d_rd,
         has_table_privilege('ot_neutral_runtime','ot_neutral_manual_delivery','SELECT') s_md,
         has_table_privilege('ot_neutral_runtime','ot_neutral_manual_delivery','INSERT') i_md,
         has_table_privilege('ot_neutral_runtime','ot_neutral_manual_delivery','UPDATE') u_md,
         has_table_privilege('ot_neutral_runtime','ot_neutral_manual_delivery','DELETE') d_md`,
    );
    // `has_table_privilege(role, table, 'INSERT')` is FALSE when the role holds
    // only COLUMN-level INSERT. That is the posture this migration leaves for
    // both append-only ledgers, and it is the point: a TABLE-level INSERT grant
    // would also hand the runtime role the database-clock columns. So table
    // INSERT must be absent here, and the column grants are asserted separately
    // in the next test.
    expect(result.rows[0]).toEqual({
      s_cls: true, i_cls: false, u_cls: false, d_cls: false,
      s_rd: true, i_rd: false, u_rd: false, d_rd: false,
      s_md: true, i_md: false, u_md: false, d_md: false,
    });
  });

  test("column-level INSERT is what actually permits the two append-only writes", async () => {
    // Proved end-to-end by the SET ROLE insert tests below; asserted here as the
    // privilege fact, so a regression to a table-level grant is visible as such.
    const result = await client.query(
      `SELECT
         has_column_privilege('ot_neutral_runtime','ot_neutral_order_classification','order_id','INSERT') a,
         has_column_privilege('ot_neutral_runtime','ot_neutral_order_classification','note_code','INSERT') b,
         has_column_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','id','INSERT') c,
         has_column_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','byte_size','INSERT') d,
         has_column_privilege('ot_neutral_runtime','ot_neutral_manual_delivery','id','INSERT') e`,
    );
    expect(result.rows[0]).toEqual({ a: true, b: true, c: true, d: true, e: false });
  });

  test("the runtime role cannot supply either database-clock column", async () => {
    const result = await client.query(
      `SELECT
         has_column_privilege('ot_neutral_runtime','ot_neutral_order_classification','classified_at','INSERT') cls,
         has_column_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','served_at','INSERT') rd,
         has_column_privilege('ot_neutral_runtime','ot_neutral_order_classification','class','INSERT') ok_cls,
         has_column_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','sha256','INSERT') ok_rd`,
    );
    expect(result.rows[0]).toEqual({ cls: false, rd: false, ok_cls: true, ok_rd: true });
  });

  // ------------------------------------------------- negative grant probes

  test("verification refuses when the runtime role loses SELECT on a ledger", async () => {
    await client.query(
      `REVOKE SELECT ON TABLE "ot_neutral_order_classification" FROM ot_neutral_runtime`,
    );
    await expect(verify()).rejects.toThrow(
      /runtime role lacks SELECT on ot_neutral_order_classification/,
    );
  });

  test.each(LEDGERS)(
    "verification refuses when the runtime role gains UPDATE on %s",
    async (table) => {
      await client.query(`GRANT UPDATE ON TABLE "${table}" TO ot_neutral_runtime`);
      await expect(verify()).rejects.toThrow(/retains UPDATE on/);
    },
  );

  test.each(LEDGERS)(
    "verification refuses when the runtime role gains DELETE on %s",
    async (table) => {
      await client.query(`GRANT DELETE ON TABLE "${table}" TO ot_neutral_runtime`);
      await expect(verify()).rejects.toThrow(/retains DELETE on/);
    },
  );

  test("verification refuses a manual-delivery INSERT grant (no Slice 1 write path)", async () => {
    await client.query(
      `GRANT INSERT ON TABLE "ot_neutral_manual_delivery" TO ot_neutral_runtime`,
    );
    await expect(verify()).rejects.toThrow(
      /retains INSERT on ot_neutral_manual_delivery/,
    );
  });

  test("verification refuses when the runtime role may set classified_at", async () => {
    await client.query(
      `GRANT INSERT ("classified_at") ON TABLE "ot_neutral_order_classification" TO ot_neutral_runtime`,
    );
    await expect(verify()).rejects.toThrow(/may set .*classified_at/);
  });

  test("verification refuses when the runtime role may set served_at", async () => {
    await client.query(
      `GRANT INSERT ("served_at") ON TABLE "ot_neutral_operator_artifact_read" TO ot_neutral_runtime`,
    );
    await expect(verify()).rejects.toThrow(/may set .*served_at/);
  });

  test.each(
    API_ROLES.flatMap((role) =>
      LEDGERS.map((table) => [role, table] as const),
    ),
  )("verification refuses when API role %s regains SELECT on %s", async (role, table) => {
    await client.query(`GRANT SELECT ON TABLE "${table}" TO ${role}`);
    await expect(verify()).rejects.toThrow(
      /API role .* retains table privilege/,
    );
  });

  test.each(LEDGERS)("verification refuses when %s loses FORCE RLS", async (table) => {
    await client.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
    await expect(verify()).rejects.toThrow(
      /is not ENABLE\+FORCE row level security/,
    );
    await client.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
  });

  // ------------------------------------------------------- classification

  test("classification accepts each closed class and refuses anything else", async () => {
    for (const value of ["CUSTOMER", "OWNER_TEST", "NEGATIVE_TEST", "SAMPLE"]) {
      await client.query(
        `INSERT INTO "ot_neutral_order_classification" ("order_id","class","actor_key") VALUES ('ord_1',$1,'admin:u1')`,
        [value],
      );
      await client.query(`DELETE FROM "ot_neutral_order_classification"`);
    }
    await expect(
      client.query(
        `INSERT INTO "ot_neutral_order_classification" ("order_id","class","actor_key") VALUES ('ord_1','PARTNER','admin:u1')`,
      ),
    ).rejects.toThrow(/ot_neutral_classification_class_shape/);
  });

  test("classification refuses a malformed actor key and an unknown note code", async () => {
    await expect(
      client.query(
        `INSERT INTO "ot_neutral_order_classification" ("order_id","class","actor_key") VALUES ('ord_1','CUSTOMER','user:u1')`,
      ),
    ).rejects.toThrow(/ot_neutral_classification_actor_shape/);
    await expect(
      client.query(
        `INSERT INTO "ot_neutral_order_classification" ("order_id","class","actor_key","note_code") VALUES ('ord_1','CUSTOMER','admin:u1','FREE TEXT')`,
      ),
    ).rejects.toThrow(/ot_neutral_classification_note_shape/);
  });

  test("classification is one row per order and refuses a second class", async () => {
    await client.query(
      `INSERT INTO "ot_neutral_order_classification" ("order_id","class","actor_key") VALUES ('ord_1','CUSTOMER','admin:u1')`,
    );
    await expect(
      client.query(
        `INSERT INTO "ot_neutral_order_classification" ("order_id","class","actor_key") VALUES ('ord_1','OWNER_TEST','admin:u1')`,
      ),
    ).rejects.toThrow(/duplicate key|ot_neutral_order_classification_pkey/);
  });

  test("the runtime role can insert a classification but cannot update or delete one", async () => {
    await client.query("SET ROLE ot_neutral_runtime");
    try {
      await client.query(
        `INSERT INTO "ot_neutral_order_classification" ("order_id","class","actor_key") VALUES ('ord_1','CUSTOMER','admin:u1')`,
      );
      await expect(
        client.query(
          `UPDATE "ot_neutral_order_classification" SET "class"='OWNER_TEST' WHERE "order_id"='ord_1'`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        client.query(`DELETE FROM "ot_neutral_order_classification"`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("RESET ROLE");
    }
  });

  // ------------------------------------------------------ read audit shape

  const insertRead = (overrides: Record<string, string | number> = {}) => {
    const row = {
      id: "rd_1",
      reservation_id: "res_1",
      order_id: "ord_1",
      actor_key: "admin:u1",
      purpose: "QA_REVIEW",
      artifact_kind: "INTERNAL_PDF",
      sha256: HEX_C,
      reservation_bundle_sha256: HEX_A,
      byte_size: 1024,
      ...overrides,
    };
    const keys = Object.keys(row);
    return client.query(
      `INSERT INTO "ot_neutral_operator_artifact_read" (${keys
        .map((k) => `"${k}"`)
        .join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
      keys.map((k) => (row as Record<string, string | number>)[k]),
    );
  };

  test("the read audit binds purpose to artifact kind (T-07 shape)", async () => {
    await insertRead();
    await client.query(`DELETE FROM "ot_neutral_operator_artifact_read"`);
    await insertRead({ purpose: "DELIVERY_PREPARE", artifact_kind: "CUSTOMER_ZIP" });
    await client.query(`DELETE FROM "ot_neutral_operator_artifact_read"`);
    await expect(
      insertRead({ purpose: "QA_REVIEW", artifact_kind: "CUSTOMER_ZIP" }),
    ).rejects.toThrow(/ot_neutral_operator_read_state_shape/);
    await expect(
      insertRead({ purpose: "DELIVERY_PREPARE", artifact_kind: "INTERNAL_PDF" }),
    ).rejects.toThrow(/ot_neutral_operator_read_state_shape/);
    await expect(insertRead({ purpose: "BROWSE" })).rejects.toThrow(
      /ot_neutral_operator_read_state_shape/,
    );
  });

  test("the read audit refuses a non-hex digest, an empty read, and a bad actor", async () => {
    await expect(insertRead({ sha256: "NOTHEX" })).rejects.toThrow(
      /ot_neutral_operator_read_digest_shape/,
    );
    await expect(
      insertRead({ reservation_bundle_sha256: HEX_A.toUpperCase() }),
    ).rejects.toThrow(/ot_neutral_operator_read_digest_shape/);
    await expect(insertRead({ byte_size: 0 })).rejects.toThrow(
      /ot_neutral_operator_read_size_shape/,
    );
    await expect(insertRead({ actor_key: "admin:" })).rejects.toThrow(
      /ot_neutral_operator_read_actor_shape/,
    );
  });

  test("the runtime role can append a read row but cannot update or delete one", async () => {
    await client.query("SET ROLE ot_neutral_runtime");
    try {
      await client.query(
        `INSERT INTO "ot_neutral_operator_artifact_read"
           ("id","reservation_id","order_id","actor_key","purpose","artifact_kind","sha256","reservation_bundle_sha256","byte_size")
         VALUES ('rd_r','res_1','ord_1','admin:u1','QA_REVIEW','INTERNAL_PDF',$1,$2,10)`,
        [HEX_C, HEX_A],
      );
      await expect(
        client.query(
          `UPDATE "ot_neutral_operator_artifact_read" SET "byte_size"=1 WHERE "id"='rd_r'`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        client.query(`DELETE FROM "ot_neutral_operator_artifact_read"`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("RESET ROLE");
    }
  });

  test("served_at comes from the database clock, not the caller", async () => {
    await insertRead();
    const result = await client.query(
      `SELECT "served_at" IS NOT NULL AS set FROM "ot_neutral_operator_artifact_read" WHERE "id"='rd_1'`,
    );
    expect(result.rows[0].set).toBe(true);
  });

  // --------------------------------------------------- manual delivery SQL

  test("the composite FK rejects a digest that has no artifact row (I-1)", async () => {
    await expect(prepared("md_x", HEX_B)).rejects.toThrow(
      /ot_neutral_manual_delivery_artifact_fkey/,
    );
    await expect(prepared("md_ok", HEX_A)).resolves.toBeDefined();
  });

  test("only one active delivery may exist per reservation (I-2)", async () => {
    await prepared("md_1");
    await expect(prepared("md_2")).rejects.toThrow(
      /ot_neutral_manual_delivery_active_key/,
    );
    // Voiding the first frees the slot; the partial index excludes VOIDED.
    await client.query(
      `UPDATE "ot_neutral_manual_delivery" SET "status"='VOIDED',"status_revision"=1,"voided_by"='admin:u1',"voided_at"=CURRENT_TIMESTAMP,"void_reason_code"='OPERATOR_VOID' WHERE "id"='md_1'`,
    );
    await expect(prepared("md_2")).resolves.toBeDefined();
  });

  test("at most one CONFIRMED delivery may ever exist per reservation (I-2)", async () => {
    await prepared("md_1");
    await client.query(
      `UPDATE "ot_neutral_manual_delivery" SET "status"='CONFIRMED',"status_revision"=3,
         "recorded_by"='admin:u1',"recorded_at"=CURRENT_TIMESTAMP,"channel_code"='SUPPORT_MAILBOX_EMAIL',
         "external_reference_sha256"=$1,"recipient_binding_sha256"=$2,
         "confirmed_by"='admin:u1',"confirmed_at"=CURRENT_TIMESTAMP,"confirmation_code"='CUSTOMER_REPLY'
       WHERE "id"='md_1'`,
      [HEX_B, HEX_C],
    );
    await expect(prepared("md_2")).rejects.toThrow(
      /ot_neutral_manual_delivery_(active|confirmed)_key/,
    );
  });

  test("the state shape refuses a half-recorded row and a voided-confirmed row", async () => {
    await prepared("md_1");
    await expect(
      client.query(
        `UPDATE "ot_neutral_manual_delivery" SET "status"='RECORDED',"status_revision"=1,"recorded_by"='admin:u1' WHERE "id"='md_1'`,
      ),
    ).rejects.toThrow(/ot_neutral_manual_delivery_state_shape/);
    await expect(
      client.query(
        `UPDATE "ot_neutral_manual_delivery" SET "status"='VOIDED',"status_revision"=1,"voided_by"='admin:u1',"voided_at"=CURRENT_TIMESTAMP,"void_reason_code"='OPERATOR_VOID',"confirmed_by"='admin:u1',"confirmed_at"=CURRENT_TIMESTAMP,"confirmation_code"='CUSTOMER_REPLY' WHERE "id"='md_1'`,
      ),
    ).rejects.toThrow(/ot_neutral_manual_delivery_state_shape/);
  });

  test("the manual-delivery code sets are closed", async () => {
    await prepared("md_1");
    await expect(
      client.query(
        `UPDATE "ot_neutral_manual_delivery" SET "status"='RECORDED',"status_revision"=1,"recorded_by"='admin:u1',"recorded_at"=CURRENT_TIMESTAMP,"channel_code"='CARRIER_PIGEON',"external_reference_sha256"=$1,"recipient_binding_sha256"=$2 WHERE "id"='md_1'`,
        [HEX_B, HEX_C],
      ),
    ).rejects.toThrow(/ot_neutral_manual_delivery_code_shape/);
    await expect(
      client.query(
        `UPDATE "ot_neutral_manual_delivery" SET "status"='VOIDED',"status_revision"=1,"voided_by"='admin:u1',"voided_at"=CURRENT_TIMESTAMP,"void_reason_code"='CHANGED_MIND' WHERE "id"='md_1'`,
      ),
    ).rejects.toThrow(/ot_neutral_manual_delivery_code_shape/);
  });

  test("the runtime role can read but never insert manual delivery evidence", async () => {
    await prepared("md_1");
    await client.query("SET ROLE ot_neutral_runtime");
    try {
      const rows = await client.query(
        `SELECT "id" FROM "ot_neutral_manual_delivery"`,
      );
      expect(rows.rows).toEqual([{ id: "md_1" }]);
      await expect(
        client.query(
          `INSERT INTO "ot_neutral_manual_delivery" ("id","reservation_id","order_id","qa_review_id","fulfillment_id","customer_artifact_sha256","policy_version","property_binding_fingerprint","payment_binding_sha256","prepared_by","prepare_expires_at") VALUES ('md_z','res_1','ord_1','qa_1','ful_1',$1,'p/v1','fp_1',$2,'admin:u1',CURRENT_TIMESTAMP)`,
          [HEX_A, HEX_B],
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("RESET ROLE");
    }
  });
});
