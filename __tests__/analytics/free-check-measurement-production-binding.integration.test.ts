/** @jest-environment node */
/**
 * Runs the real measurement migration on a disposable socket-only cluster whose
 * owner carries Supabase-style default grants. `service_role` is BYPASSRLS, so
 * RLS cannot stand in for the explicit REVOKE this suite pins.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";

const migrationPath = path.join(
  process.cwd(),
  "prisma/migrations/20261103210000_add_ot_free_check_measurement/migration.sql",
);
const TABLE = "ot_free_check_completion";
const API_ROLES = ["anon", "authenticated", "service_role"] as const;
const PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

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

suite("production-only measurement runtime binding", () => {
  let root = "",
    data = "",
    socket = "",
    port = 0;
  let started = false;
  let admin: Client;
  let owner: Client;
  const postgresEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-fc-privs-"));
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
      [
        "-D",
        data,
        "-o",
        `-F -c listen_addresses='' -k ${socket} -p ${port}`,
        "-w",
        "start",
      ],
      { stdio: "ignore", env: postgresEnv },
    );
    started = true;
    admin = new Client({
      host: socket,
      port,
      user: "postgres",
      database: "postgres",
    });
    await admin.connect();
    await admin.query(`
      CREATE ROLE app_owner LOGIN NOSUPERUSER;
      CREATE ROLE anon LOGIN;
      CREATE ROLE authenticated LOGIN;
      CREATE ROLE service_role LOGIN BYPASSRLS;
      CREATE ROLE ot_neutral_app_reader NOLOGIN NOINHERIT;
      CREATE ROLE ot_prod_app LOGIN INHERIT;
      GRANT ot_neutral_app_reader TO ot_prod_app WITH INHERIT TRUE, SET FALSE;
      GRANT USAGE ON SCHEMA public TO ot_prod_app;
      GRANT CREATE, USAGE ON SCHEMA public TO app_owner;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated, service_role;
    `);
    owner = new Client({
      host: socket,
      port,
      user: "app_owner",
      database: "postgres",
    });
    await owner.connect();
    await owner.query(fs.readFileSync(migrationPath, "utf8"));
  }, 120_000);

  afterAll(async () => {
    await owner?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (data && started)
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "ignore",
        env: postgresEnv,
      });
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  const bindingDir = path.join(
    process.cwd(),
    "prisma/measurement-production-binding",
  );
  const sql = (file: string) =>
    fs.readFileSync(path.join(bindingDir, file), "utf8");
  const row = `(gen_random_uuid(), 'unknown', 'synthetic_v1', 'insufficient_evidence',
    'no_assessed_value', false, 'unknown')`;
  const insert = `INSERT INTO ${TABLE} (completion_id, attribution_state, registry_version,
    outcome_code, outcome_reason, allow_checkout, window_status) VALUES ${row}`;

  test("binds exact nonowner runtime and supports dedicated restricted writer plus export", async () => {
    await admin.query("ALTER ROLE ot_prod_app RENAME TO absent_prod_app");
    await expect(owner.query(sql("01_bind.sql"))).rejects.toThrow(
      /unsafe\/missing/,
    );
    await owner.query("ROLLBACK");
    await admin.query("ALTER ROLE absent_prod_app RENAME TO ot_prod_app");
    await admin.query("ALTER ROLE ot_prod_app BYPASSRLS");
    await expect(owner.query(sql("01_bind.sql"))).rejects.toThrow(
      /unsafe\/missing/,
    );
    await owner.query("ROLLBACK");
    await admin.query("ALTER ROLE ot_prod_app NOBYPASSRLS");
    await owner.query(sql("01_bind.sql"));
    const before = await admin.query(
      "SELECT roleid,member,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member",
    );
    const app = new Client({
      host: socket,
      port,
      user: "ot_prod_app",
      database: "postgres",
    });
    await app.connect();
    expect(
      (await app.query("select current_user,session_user")).rows[0],
    ).toEqual({
      current_user: "ot_prod_app",
      session_user: "ot_prod_app",
    });
    const prior = { ...process.env };
    process.env.OT_FREE_CHECK_MEASUREMENT_DATABASE_URL = `postgresql://ot_prod_app@localhost:${port}/postgres?host=${encodeURIComponent(socket)}`;
    process.env.VERCEL_ENV = "production";
    process.env.OT_FREE_CHECK_MEASUREMENT_ENABLED = "1";
    const { withMeasurementClient } =
      await import("@/lib/analytics/free-check-measurement-runtime");
    try {
      expect(
        await withMeasurementClient(
          (db) => db.$queryRaw`SELECT current_user, session_user`,
        ),
      ).toEqual([
        {
          current_user: "ot_prod_app",
          session_user: "ot_prod_app",
        },
      ]);
      const { recordFreeCheckCompletion } =
        await import("@/lib/analytics/free-check-measurement");
      const { exportFreeCheckMeasurement } =
        await import("@/lib/analytics/free-check-measurement-report");
      expect(
        await recordFreeCheckCompletion({
          body: { freeCheckAttributionObservation: "untagged" },
          outcome: (
            await import("@/lib/free-check-outcome-contract")
          ).canonicalFreeCheckOutcome(
            "insufficient_evidence",
            "no_assessed_value",
          ),
          windowStatus: "unknown",
          preview: false,
        }),
      ).toBe("recorded");
      await admin.query("ALTER ROLE ot_prod_app BYPASSRLS");
      await expect(withMeasurementClient(async () => true)).rejects.toThrow(
        "measurement_identity_unsafe",
      );
      await admin.query("ALTER ROLE ot_prod_app NOBYPASSRLS");
      await admin.query(
        "CREATE ROLE extra_measurement NOLOGIN; GRANT extra_measurement TO ot_prod_app",
      );
      await expect(withMeasurementClient(async () => true)).rejects.toThrow(
        "measurement_identity_unsafe",
      );
      await admin.query(
        "REVOKE extra_measurement FROM ot_prod_app; DROP ROLE extra_measurement",
      );
      const report = await withMeasurementClient((db) =>
        exportFreeCheckMeasurement(
          db,
          new Date("2000-01-01"),
          new Date("2100-01-01"),
        ),
      );
      expect(report.status).toBe("available");
      expect(report.groups).toEqual([
        expect.objectContaining({
          attributionState: "untagged_request",
          completed: 1,
        }),
      ]);
      for (const statement of [
        `UPDATE ${TABLE} SET allow_checkout=false`,
        `DELETE FROM ${TABLE}`,
        `TRUNCATE ${TABLE}`,
        `ALTER TABLE ${TABLE} ADD COLUMN forbidden int`,
        `CREATE TABLE public.forbidden (id int)`,
        `ALTER ROLE ot_prod_app BYPASSRLS`,
      ])
        await expect(app.query(statement)).rejects.toMatchObject({
          code: "42501",
        });
      for (const role of API_ROLES) {
        const api = new Client({
          host: socket,
          port,
          user: role,
          database: "postgres",
        });
        await api.connect();
        try {
          for (const statement of [
            `SELECT * FROM ${TABLE}`,
            insert,
            `UPDATE ${TABLE} SET allow_checkout=false`,
            `DELETE FROM ${TABLE}`,
            `TRUNCATE ${TABLE}`,
            `ALTER TABLE ${TABLE} ADD COLUMN forbidden int`,
            `CREATE TABLE public.forbidden (id int)`,
            `ALTER ROLE ot_prod_app BYPASSRLS`,
          ])
            await expect(api.query(statement)).rejects.toMatchObject({
              code: "42501",
            });
        } finally {
          await api.end();
        }
      }
      await expect(
        app.query(
          insert.replace(
            "'unknown', 'synthetic_v1'",
            "'bad_state', 'synthetic_v1'",
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await admin.query(sql("02_postconditions.sql"));
      await admin.query(`GRANT UPDATE ON ${TABLE} TO ot_prod_app`);
      await expect(admin.query(sql("02_postconditions.sql"))).rejects.toThrow(
        /app table grant/,
      );
      await admin.query(`REVOKE UPDATE ON ${TABLE} FROM ot_prod_app`);
      await admin.query(
        `CREATE ROLE sneaky NOLOGIN; GRANT SELECT ON ${TABLE} TO sneaky; GRANT sneaky TO service_role`,
      );
      await expect(admin.query(sql("02_postconditions.sql"))).rejects.toThrow(
        /unexpected effective/,
      );
      await admin.query(
        `REVOKE sneaky FROM service_role; REVOKE SELECT ON ${TABLE} FROM sneaky; DROP ROLE sneaky`,
      );
      await admin.query(sql("02_postconditions.sql"));
      expect(
        (
          await admin.query(
            "SELECT roleid,member,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member",
          )
        ).rows,
      ).toEqual(before.rows);
      await owner.query("DROP POLICY ot_measurement_prod_insert ON " + TABLE);
      await expect(app.query(insert)).rejects.toMatchObject({ code: "42501" });
      await owner.query(
        "CREATE POLICY ot_measurement_prod_insert ON " +
          TABLE +
          " FOR INSERT TO ot_prod_app WITH CHECK (true)",
      );
      await owner.query("DROP POLICY ot_measurement_prod_select ON " + TABLE);
      expect(
        (await app.query(`SELECT count(*)::int n FROM ${TABLE}`)).rows[0].n,
      ).toBe(0);
      await owner.query(
        "CREATE POLICY ot_measurement_prod_select ON " +
          TABLE +
          " FOR SELECT TO ot_prod_app USING (true)",
      );
      const n = (await owner.query(`SELECT count(*)::int n FROM ${TABLE}`))
        .rows[0].n;
      await owner.query(sql("03_rollback.sql"));
      expect(
        (await owner.query(`SELECT count(*)::int n FROM ${TABLE}`)).rows[0].n,
      ).toBe(n);
      await expect(app.query(insert)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
      process.env = prior;
    }
  }, 120_000);
});
