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

suite("free-check measurement migration privileges", () => {
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
    admin = new Client({ host: socket, port, user: "postgres", database: "postgres" });
    await admin.connect();
    await admin.query(`
      CREATE ROLE app_owner LOGIN NOSUPERUSER;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role LOGIN BYPASSRLS;
      GRANT CREATE, USAGE ON SCHEMA public TO app_owner;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated, service_role;
    `);
    owner = new Client({ host: socket, port, user: "app_owner", database: "postgres" });
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

  const row = `(gen_random_uuid(), 'unknown', 'synthetic_v1', 'insufficient_evidence',
    'no_assessed_value', false, 'unknown')`;
  const insert = `INSERT INTO ${TABLE} (completion_id, attribution_state, registry_version,
    outcome_code, outcome_reason, allow_checkout, window_status) VALUES ${row}`;

  test("the default-grant fixture really hands API roles the table before the REVOKE matters", async () => {
    await owner.query(`CREATE TABLE ot_default_grant_probe (id int)`);
    const held = await admin.query(
      `SELECT has_table_privilege('service_role','ot_default_grant_probe','SELECT') AS held`,
    );
    expect(held.rows[0].held).toBe(true);
  });

  test.each(
    API_ROLES.flatMap((role) => PRIVILEGES.map((p) => [role, p] as const)),
  )("%s holds no %s after the migration", async (role, privilege) => {
    const { rows } = await admin.query(
      `SELECT has_table_privilege($1, $2, $3) AS held`,
      [role, TABLE, privilege],
    );
    expect(rows[0].held).toBe(false);
  });

  test("a BYPASSRLS service_role login cannot actually read or write the ledger", async () => {
    await owner.query(insert);
    const service = new Client({
      host: socket,
      port,
      user: "service_role",
      database: "postgres",
    });
    await service.connect();
    try {
      await expect(service.query(`SELECT * FROM ${TABLE}`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(service.query(insert)).rejects.toThrow(/permission denied/);
      await expect(service.query(`DELETE FROM ${TABLE}`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await service.end();
    }
  });

  test("the owning application role keeps its write and aggregate read", async () => {
    await owner.query(insert);
    const { rows } = await owner.query(`SELECT COUNT(*)::int AS n FROM ${TABLE}`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  test("the migration still applies where the API roles do not exist", async () => {
    await admin.query(`CREATE DATABASE bare`);
    const bare = new Client({ host: socket, port, user: "postgres", database: "bare" });
    await bare.connect();
    try {
      await admin.query(`DROP OWNED BY service_role`);
      await admin.query(`DROP ROLE service_role`);
      await expect(
        bare.query(fs.readFileSync(migrationPath, "utf8")),
      ).resolves.toBeDefined();
    } finally {
      await bare.end();
    }
  });
});
