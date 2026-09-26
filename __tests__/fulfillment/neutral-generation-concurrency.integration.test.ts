/** @jest-environment node */
/**
 * Independent race harness for `neutralGenerationStore.ensure()`.
 *
 * The release preflight reproduced `ensure()` raising PostgreSQL `23505` on
 * `ot_neutral_generation_reservation_key` in 43 of 60 genuinely contended
 * pairs. `ON CONFLICT ("order_id")` names one arbiter index while the table
 * carries two unique constraints, and a conflict detected on a non-arbiter
 * unique index is raised rather than routed to the `DO UPDATE` path.
 *
 * This suite is deliberately separate from the fencing integration suite so it
 * can be run on its own as the acceptance harness for that finding. It asserts
 * the whole idempotency contract, not just the absence of a throw:
 *   - two concurrent calls for the same order and reservation,
 *   - sequential repeats,
 *   - distinct Stripe events reaching the same order,
 *   - an existing row whose reservation binding disagrees (must fail closed),
 *   - exactly one work row per order and per reservation.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import type { Prisma } from "@prisma/client";

jest.mock("server-only", () => ({}), { virtual: true });

import { createNeutralGenerationStore } from "@/lib/fulfillment-runtime/neutral-generation-store";

/** Contended pairs. The preflight used 60; the acceptance bar is 0 failures. */
const PAIRS = 60;
/**
 * Pairs released together in one batch. A `pg` Client serialises its own
 * queries, so contention comes from running each side of a pair on its own
 * connection and releasing many pairs in the same tick. Two connections and an
 * awaited loop reproduce the defect only ~3/60; batching widens the window to
 * the rate the preflight observed.
 */
const BATCH = PAIRS;
const CONNECTIONS = BATCH * 2;

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

suite("neutral generation ensure() idempotency under genuine concurrency", () => {
  let root = "",
    data = "",
    socket = "",
    port = 0;
  let started = false;
  let owner: Client;
  let pool: Client[] = [];

  const postgresEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

  const adapter = (client: Client) => {
    const compile = (query: Prisma.Sql) => {
      const sql = query as unknown as {
        strings: readonly string[];
        values: readonly unknown[];
      };
      const text = sql.strings.reduce(
        (out, part, index) =>
          out + part + (index < sql.values.length ? `$${index + 1}` : ""),
        "",
      );
      return { text, values: [...sql.values] };
    };
    return {
      $queryRaw: async <T>(query: Prisma.Sql) =>
        (await client.query(compile(query))).rows as T,
      $executeRaw: async (query: Prisma.Sql) =>
        (await client.query(compile(query))).rowCount ?? 0,
    };
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-neutral-race-"));
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
      ["-D", data, "-o", `-F -k ${socket} -p ${port} -c max_connections=400`, "-w", "start"],
      { stdio: "ignore", env: postgresEnv },
    );
    started = true;
    owner = new Client({ host: socket, port, user: "postgres", database: "postgres" });
    await owner.connect();
    pool = Array.from(
      { length: CONNECTIONS },
      () => new Client({ host: socket, port, user: "postgres", database: "postgres" }),
    );
    await Promise.all(pool.map((client) => client.connect()));
    await owner.query(`
      CREATE ROLE ot_neutral_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE TABLE ot_order (id text primary key, tier text not null, status text not null, "propertyPin" text, "stripeSessionId" text, "checkoutPriceId" text, "checkoutProductId" text, "checkoutAmountCents" integer, "checkoutCurrency" text, "settledAmountCents" integer, "settledCurrency" text, "amountPaid" double precision, "eligibilitySnapshot" jsonb);
      CREATE TABLE ot_neutral_report_reservation (id text primary key, order_id text unique not null references ot_order(id), reservation_key text not null, property_fingerprint text not null, checkout_price_id text not null, checkout_product_id text not null, policy_version text not null, status text not null);
      CREATE TABLE ot_payment_binding (order_id text, session_id text, payment_intent text);
      CREATE TABLE ot_settlement_reversal (payment_intent text);
      CREATE VIEW ot_neutral_runtime_order AS SELECT * FROM ot_order;
      CREATE VIEW ot_neutral_runtime_payment_binding AS SELECT * FROM ot_payment_binding;
      CREATE VIEW ot_neutral_runtime_settlement_reversal AS SELECT * FROM ot_settlement_reversal;
    `);
    await owner.query(
      fs.readFileSync(
        path.join(
          process.cwd(),
          "prisma/migrations/20260921120000_add_ot_neutral_generation_work/migration.sql",
        ),
        "utf8",
      ),
    );
    // One admitted order + reservation + binding per contended pair. Keys are
    // derived in SQL with the same construction the authority predicate re-asserts.
    await owner.query(
      `INSERT INTO ot_order
       SELECT 'ord_r' || g, 'T2', 'PAID', (14000000001000 + g)::text, 'cs_r' || g,
              'price_69', 'prod_neutral', 6900, 'usd', 6900, 'usd', 69,
              '{"policyVersion":"ot-neutral-records-report/2026-09-15"}'
       FROM generate_series(1, $1::int) g`,
      [PAIRS],
    );
    await owner.query(
      `INSERT INTO ot_neutral_report_reservation
       SELECT 'res_r' || g, 'ord_r' || g,
              'neutral-order-binding/' || encode(sha256(convert_to(
                'orderId:' || length('ord_r' || g)::text || ':' || 'ord_r' || g
                || '|policy:ot-neutral-records-report/2026-09-15', 'UTF8')), 'hex'),
              encode(sha256(convert_to('ot-neutral-property/v1', 'UTF8') || decode('00', 'hex')
                || convert_to((14000000001000 + g)::text, 'UTF8')), 'hex'),
              'price_69', 'prod_neutral', 'ot-neutral-records-report/2026-09-15', 'RESERVED'
       FROM generate_series(1, $1::int) g`,
      [PAIRS],
    );
    await owner.query(
      `INSERT INTO ot_payment_binding
       SELECT 'ord_r' || g, 'cs_r' || g, 'pi_r' || g FROM generate_series(1, $1::int) g`,
      [PAIRS],
    );

    // Two further admitted orders used only by the binding tests. `ord_spare`
    // exists so a work row can be fabricated holding a reservation that belongs
    // to a different order — the only way to construct a disagreeing binding,
    // since `ot_neutral_report_reservation.order_id` is unique and the work
    // row's reservation FK is ON DELETE NO ACTION.
    await owner.query(
      `INSERT INTO ot_order VALUES
         ('ord_bind','T2','PAID','14000000002001','cs_bind','price_69','prod_neutral',6900,'usd',6900,'usd',69,'{"policyVersion":"ot-neutral-records-report/2026-09-15"}'),
         ('ord_spare','T2','PAID','14000000002002','cs_spare','price_69','prod_neutral',6900,'usd',6900,'usd',69,'{"policyVersion":"ot-neutral-records-report/2026-09-15"}')`,
    );
    await owner.query(
      `INSERT INTO ot_neutral_report_reservation
       SELECT 'res_' || replace(o.id, 'ord_', ''), o."id",
              'neutral-order-binding/' || encode(sha256(convert_to(
                'orderId:' || length(o."id")::text || ':' || o."id"
                || '|policy:ot-neutral-records-report/2026-09-15', 'UTF8')), 'hex'),
              encode(sha256(convert_to('ot-neutral-property/v1', 'UTF8') || decode('00', 'hex')
                || convert_to(o."propertyPin", 'UTF8')), 'hex'),
              'price_69', 'prod_neutral', 'ot-neutral-records-report/2026-09-15', 'RESERVED'
       FROM ot_order o WHERE o."id" IN ('ord_bind','ord_spare')`,
    );
    await owner.query(
      `INSERT INTO ot_payment_binding
       SELECT o."id", o."stripeSessionId", 'pi_' || replace(o."id", 'ord_', '')
       FROM ot_order o WHERE o."id" IN ('ord_bind','ord_spare')`,
    );
  }, 120_000);

  afterAll(async () => {
    await Promise.all(pool.map((client) => client.end().catch(() => undefined)));
    await owner?.end().catch(() => undefined);
    if (data && started)
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "ignore",
        env: postgresEnv,
      });
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  test(`${PAIRS} genuinely contended ensure() pairs are idempotent with zero failures`, async () => {
    const stores = pool.map((client) => createNeutralGenerationStore(adapter(client)));

    const failures: Array<{ orderId: string; message: string }> = [];
    const disagreements: string[] = [];

    for (let offset = 0; offset < PAIRS; offset += BATCH) {
      const size = Math.min(BATCH, PAIRS - offset);
      const orderIds = Array.from(
        { length: size },
        (_unused, slot) => `ord_r${offset + slot + 1}`,
      );
      // Every promise in the batch is created in one synchronous pass, so both
      // sides of each pair are in flight on their own connection before any of
      // them can commit. This is the contention the production path has when a
      // duplicate delivery races the original across two Vercel instances.
      const settled = await Promise.allSettled(
        orderIds.flatMap((orderId, slot) => [
          stores[slot * 2]!.ensure(orderId),
          stores[slot * 2 + 1]!.ensure(orderId),
        ]),
      );
      settled.forEach((outcome, index) => {
        const orderId = orderIds[Math.floor(index / 2)]!;
        if (outcome.status === "rejected")
          failures.push({
            orderId,
            message: String(
              (outcome.reason as { message?: string })?.message ?? outcome.reason,
            ),
          });
      });
      for (let slot = 0; slot < size; slot += 1) {
        const a = settled[slot * 2]!;
        const b = settled[slot * 2 + 1]!;
        if (a.status !== "fulfilled" || b.status !== "fulfilled") continue;
        if (!a.value || !b.value)
          disagreements.push(`${orderIds[slot]}: null work row`);
        else if (a.value.workId !== b.value.workId)
          disagreements.push(
            `${orderIds[slot]}: ${a.value.workId} !== ${b.value.workId}`,
          );
      }
    }

    expect({ failures: failures.length, sample: failures.slice(0, 3) }).toEqual({
      failures: 0,
      sample: [],
    });
    expect(disagreements).toEqual([]);

    // The invariant the fix must not trade away: exactly one row per order and
    // per reservation, for every contended pair.
    const counts = await owner.query(
      `SELECT count(*)::int AS rows,
              count(DISTINCT order_id)::int AS orders,
              count(DISTINCT reservation_id)::int AS reservations
       FROM ot_neutral_generation_work`,
    );
    expect(counts.rows[0]).toEqual({
      rows: PAIRS,
      orders: PAIRS,
      reservations: PAIRS,
    });
  }, 300_000);

  test("sequential repeats and distinct Stripe events return the same work row", async () => {
    const first = createNeutralGenerationStore(adapter(pool[0]!));
    const second = createNeutralGenerationStore(adapter(pool[1]!));
    // A sequential repeat on the same connection.
    const initial = await first.ensure("ord_r1");
    expect(initial).not.toBeNull();
    const repeat = await first.ensure("ord_r1");
    expect(repeat).toEqual(initial);
    // A second, distinct Stripe event for the same order arriving on another
    // connection — `checkout.session.completed` alongside
    // `checkout.session.async_payment_succeeded`.
    const distinctEvent = await second.ensure("ord_r1");
    expect(distinctEvent).toEqual(initial);
    expect(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM ot_neutral_generation_work WHERE order_id='ord_r1'",
        )
      ).rows[0].n,
    ).toBe(1);
  }, 60_000);

  test("an existing row whose reservation binding disagrees fails closed and never rebinds", async () => {
    const store = createNeutralGenerationStore(adapter(owner));
    const fabricated = randomUUID();
    // A work row for `ord_bind` that is bound to another order's reservation.
    // The authority predicate derives `res_bind` for this order, so the row on
    // disk disagrees with the proposal.
    await owner.query(
      `INSERT INTO ot_neutral_generation_work ("id","order_id","reservation_id")
       VALUES ($1,'ord_bind','res_spare')`,
      [fabricated],
    );
    const before = (
      await owner.query(
        `SELECT "id","reservation_id","status","status_revision"
         FROM ot_neutral_generation_work WHERE order_id='ord_bind'`,
      )
    ).rows[0];

    await expect(store.ensure("ord_bind")).resolves.toBeNull();

    const after = (
      await owner.query(
        `SELECT "id","reservation_id","status","status_revision"
         FROM ot_neutral_generation_work WHERE order_id='ord_bind'`,
      )
    ).rows[0];
    expect(after).toEqual(before);
    expect(after.reservation_id).toBe("res_spare");

    // Positive control: with the disagreeing row gone, the same call binds the
    // reservation the authority predicate actually derives. This proves the
    // refusal above came from the binding guard and not from the authority
    // predicate refusing the order outright.
    await owner.query(
      `DELETE FROM ot_neutral_generation_work WHERE order_id='ord_bind'`,
    );
    const rebound = await store.ensure("ord_bind");
    expect(rebound).not.toBeNull();
    expect(
      (
        await owner.query(
          `SELECT "reservation_id" FROM ot_neutral_generation_work WHERE order_id='ord_bind'`,
        )
      ).rows[0].reservation_id,
    ).toBe("res_bind");
  }, 60_000);
});
