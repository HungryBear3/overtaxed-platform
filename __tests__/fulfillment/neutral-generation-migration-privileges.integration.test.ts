/** @jest-environment node */
/**
 * Native coverage for the neutral generation migration's own privilege
 * self-check.
 *
 * `has_table_privilege(role, table, 'SELECT,INSERT,UPDATE')` has ANY
 * semantics: PostgreSQL returns true when the role holds *any* listed
 * privilege. The release preflight confirmed on a disposable cluster that a
 * role granted only `SELECT` satisfies that expression, so the migration would
 * pass its own gate on a silently degraded `GRANT`.
 *
 * These tests run the real `migration.sql`, degrade one privilege at a time,
 * and re-execute the verification block on its own. Each required privilege
 * must be proved individually, and each forbidden privilege must be refused
 * individually, for the runtime role and for every API role.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";

const migrationPath = path.join(
  process.cwd(),
  "prisma/migrations/20260921120000_add_ot_neutral_generation_work/migration.sql",
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

suite("neutral generation migration privilege verification", () => {
  let root = "",
    data = "",
    socket = "",
    port = 0;
  let started = false;
  let client: Client;
  let verification = "";

  const postgresEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
  const REQUIRED = ["SELECT", "INSERT", "UPDATE"] as const;
  const FORBIDDEN = ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;
  const API_ROLES = ["anon", "authenticated", "service_role"] as const;

  /** Re-run only the migration's verification block. */
  const verify = () => client.query(verification);

  beforeAll(async () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    // The verification block is the migration's final statement.
    verification = sql.slice(sql.lastIndexOf("DO $$"));
    expect(verification).toContain(
      "neutral generation runtime security verification failed",
    );

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-neutral-privs-"));
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
      CREATE TABLE ot_order (id text primary key);
      CREATE TABLE ot_neutral_report_reservation (id text primary key, order_id text unique not null references ot_order(id));
    `);
    await client.query(fs.readFileSync(migrationPath, "utf8"));
  }, 120_000);

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
    await client.query(
      `REVOKE ALL ON TABLE "ot_neutral_generation_work" FROM ot_neutral_runtime`,
    );
    await client.query(
      `GRANT SELECT,INSERT,UPDATE ON TABLE "ot_neutral_generation_work" TO ot_neutral_runtime`,
    );
    for (const role of API_ROLES)
      await client.query(
        `REVOKE ALL ON TABLE "ot_neutral_generation_work" FROM ${role}`,
      );
  };

  afterEach(restore);

  test("the migration's verification passes on the posture the migration itself leaves", async () => {
    await expect(verify()).resolves.toBeDefined();
  });

  test("ANY-semantics is not enough: the cluster confirms the degraded-grant hazard is real", async () => {
    await client.query(
      `REVOKE INSERT,UPDATE ON TABLE "ot_neutral_generation_work" FROM ot_neutral_runtime`,
    );
    const any = await client.query(
      `SELECT has_table_privilege('ot_neutral_runtime','ot_neutral_generation_work','SELECT,INSERT,UPDATE') AS any_held,
              has_table_privilege('ot_neutral_runtime','ot_neutral_generation_work','INSERT') AS insert_held`,
    );
    // This is the defect in one row: the list form reports true while INSERT is gone.
    expect(any.rows[0]).toEqual({ any_held: true, insert_held: false });
    // The verification must refuse anyway.
    await expect(verify()).rejects.toThrow(
      /neutral generation runtime security verification failed/,
    );
  });

  test.each(REQUIRED)(
    "verification refuses when the runtime role loses %s",
    async (privilege) => {
      await client.query(
        `REVOKE ${privilege} ON TABLE "ot_neutral_generation_work" FROM ot_neutral_runtime`,
      );
      await expect(verify()).rejects.toThrow(
        /neutral generation runtime security verification failed/,
      );
    },
  );

  test.each(FORBIDDEN)(
    "verification refuses when the runtime role gains %s",
    async (privilege) => {
      await client.query(
        `GRANT ${privilege} ON TABLE "ot_neutral_generation_work" TO ot_neutral_runtime`,
      );
      await expect(verify()).rejects.toThrow(
        /neutral generation runtime security verification failed/,
      );
    },
  );

  test.each(
    API_ROLES.flatMap((role) =>
      [...REQUIRED, ...FORBIDDEN].map(
        (privilege) => [role, privilege] as const,
      ),
    ),
  )("verification refuses when API role %s retains %s", async (role, privilege) => {
    await client.query(
      `GRANT ${privilege} ON TABLE "ot_neutral_generation_work" TO ${role}`,
    );
    await expect(verify()).rejects.toThrow(
      /neutral generation API role .* retains table privilege/,
    );
  });

  test("the runtime role can execute the lock primitives ensure() depends on", async () => {
    // `ensure()` serialises same-order callers on
    // pg_advisory_xact_lock(hashtextextended(...)). Both are EXECUTE-to-PUBLIC
    // by default, but the store runs as ot_neutral_runtime — a NOLOGIN,
    // NOINHERIT, NOSUPERUSER, NOBYPASSRLS role — so the dependency is pinned
    // here. Revoking PUBLIC EXECUTE on either would break the paid webhook path.
    await client.query("SET ROLE ot_neutral_runtime");
    try {
      // The proof is that the call completes as this role rather than raising
      // insufficient_privilege; pg_advisory_xact_lock returns void.
      const result = await client.query(
        `SELECT current_user AS running_as,
                hashtextextended('ot-neutral-generation-work/ord_1', 0) AS lock_key,
                pg_advisory_xact_lock(hashtextextended('ot-neutral-generation-work/ord_1', 0))::text AS lock_result`,
      );
      expect(result.rows[0].running_as).toBe("ot_neutral_runtime");
      expect(result.rows[0].lock_key).toMatch(/^-?\d+$/);
      expect(result.rows[0].lock_result).toBe("");
    } finally {
      await client.query("RESET ROLE");
    }
  });

  test("forced row level security is still required", async () => {
    await client.query(
      `ALTER TABLE "ot_neutral_generation_work" NO FORCE ROW LEVEL SECURITY`,
    );
    await expect(verify()).rejects.toThrow(
      /neutral generation runtime security verification failed/,
    );
    await client.query(
      `ALTER TABLE "ot_neutral_generation_work" FORCE ROW LEVEL SECURITY`,
    );
  });
});
