/** @jest-environment node */
/**
 * Executes the REAL 20261024120000_ot_zero_total_settlement migration (after the
 * real historical settlement migration and the real historical neutral delivery
 * view) on a disposable LOCAL PostgreSQL cluster. No external database.
 * OT_ZT_PG_DATA_PARENT / OT_ZT_PG_SOCKET_PARENT select local scratch parents.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import type { Prisma } from "@prisma/client";
import { bindZeroTotalSettlement } from "@/lib/checkout/ot-reversal";
import * as authority from "@/lib/fulfillment-runtime/payment-authority";

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
const migration = (name: string) => fs.readFileSync(path.join(process.cwd(), "prisma/migrations", name, "migration.sql"), "utf8");
const compile = (query: Prisma.Sql) => {
  const sql = query as unknown as { strings: readonly string[]; values: readonly unknown[] };
  return { text: sql.strings.reduce((o, p, i) => o + p + (i < sql.values.length ? `$${i + 1}` : ""), ""), values: [...sql.values] };
};

suite("zero-total settlement migration on disposable local PostgreSQL", () => {
  let dataRoot = "", socket = "", port = 0, started = false;
  let db: Client;
  const env = { ...process.env, LC_ALL: "C", LANG: "C" };
  // The binder uses tagged-template $queryRaw`...`; accept both call shapes.
  const asSql = (q: Prisma.Sql | TemplateStringsArray, values: unknown[]) =>
    Array.isArray(q) ? ({ strings: q, values } as unknown as Prisma.Sql) : (q as Prisma.Sql);
  const tx = (c: Client) => ({
    $queryRaw: async (q: Prisma.Sql | TemplateStringsArray, ...v: unknown[]) => (await c.query(compile(asSql(q, v)))).rows,
    $executeRaw: async (q: Prisma.Sql | TemplateStringsArray, ...v: unknown[]) => (await c.query(compile(asSql(q, v)))).rowCount ?? 0,
  }) as unknown as Prisma.TransactionClient;

  beforeAll(async () => {
    dataRoot = fs.mkdtempSync(path.join(process.env.OT_ZT_PG_DATA_PARENT ?? os.tmpdir(), "zt-pg-data-"));
    socket = fs.mkdtempSync(path.join(process.env.OT_ZT_PG_SOCKET_PARENT ?? os.tmpdir(), "zt-"));
    port = 52000 + Math.floor(Math.random() * 8000);
    const data = path.join(dataRoot, "data");
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "postgres"], { stdio: "ignore", env });
    execFileSync("pg_ctl", ["-D", data, "-o", `-F -k ${socket} -p ${port} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore", env });
    started = true;
    db = new Client({ host: socket, port, user: "postgres", database: "postgres" });
    await db.connect();
    await db.query(`
      CREATE ROLE ot_neutral_runtime NOLOGIN; CREATE ROLE ot_neutral_delivery_runtime NOLOGIN;
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE TABLE ot_order (id text primary key, tier text, status text not null, email text, "propertyPin" text, "propertyAddress" text,
        "stripeSessionId" text, "checkoutAmountCents" integer, "checkoutCurrency" text, "settledAmountCents" integer);
      CREATE TABLE ot_fulfillment (id text primary key, order_id text references ot_order(id), kind text);
      CREATE TABLE ot_neutral_report_reservation (id text primary key, order_id text unique references ot_order(id));
    `);
    await db.query(migration("20260912190000_ot_settlement_revocation"));
    await db.query(`
      CREATE VIEW ot_neutral_runtime_order AS SELECT o.* FROM ot_order o WHERE EXISTS (SELECT 1 FROM ot_neutral_report_reservation r WHERE r.order_id=o.id);
      CREATE VIEW ot_neutral_runtime_payment_binding AS SELECT b.* FROM ot_payment_binding b JOIN ot_neutral_report_reservation r ON r.order_id=b.order_id;
      CREATE VIEW ot_neutral_runtime_settlement_reversal AS SELECT x.payment_intent FROM ot_settlement_reversal x;
      GRANT SELECT ON ot_neutral_runtime_order, ot_neutral_runtime_payment_binding, ot_neutral_runtime_settlement_reversal TO ot_neutral_runtime;
    `);
    // The real historical delivery view bytes, as deployed before this change.
    const delivery = migration("20260915220000_add_ot_neutral_delivery_runtime");
    const view = delivery.slice(delivery.indexOf('CREATE VIEW "ot_neutral_delivery_order"'), delivery.indexOf('GRANT SELECT ON "ot_neutral_delivery_order" TO ot_neutral_delivery_runtime;') + 'GRANT SELECT ON "ot_neutral_delivery_order" TO ot_neutral_delivery_runtime;'.length);
    expect(view).toContain("paymentAuthoritative");
    await db.query(view);
    await db.query(migration("20261024120000_ot_zero_total_settlement"));
    await db.query(`
      INSERT INTO ot_order VALUES
        ('z1','T2','PAID','a@x','1','A','cs_z1',6900,'usd',0),
        ('z2','T2','PAID','a@x','2','A','cs_z2',6900,'usd',6900),
        ('p1','T2','PAID','a@x','3','A','cs_p1',6900,'usd',6900),
        ('p2','T2','PAID','a@x','4','A','cs_p2',6900,'usd',6900),
        ('h1','T2','PAID','a@x','5','A','cs_h1',6900,'usd',6900),
        ('zx','T2','CHECKOUT_CREATED','a@x','6','A','cs_zx',6900,'usd',null);
      UPDATE ot_order SET "checkoutDiscountPromotionCodeId"='promo_full' WHERE id IN ('z1','z2','zx');
      INSERT INTO ot_neutral_report_reservation SELECT 'r_'||id, id FROM ot_order;
      INSERT INTO ot_fulfillment SELECT 'f_'||id, id, 'NEUTRAL_RECORDS_REPORT' FROM ot_order;
      INSERT INTO ot_payment_binding VALUES ('p1','cs_p1','pi_p1'),('p2','cs_p2','pi_p2');
      INSERT INTO ot_settlement_reversal (event_id,event_type,payment_intent) VALUES ('evt_r','charge.refunded','pi_p2');
    `);
  }, 60000);

  afterAll(async () => {
    await db?.end().catch(() => undefined);
    if (started) execFileSync("pg_ctl", ["-D", path.join(dataRoot, "data"), "-m", "fast", "-w", "stop"], { stdio: "ignore", env });
    if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true });
    if (socket) fs.rmSync(socket, { recursive: true, force: true });
  });

  const base = { sessionId: "", eventId: "evt_z", promotionCodeId: "promo_full", couponId: "coupon_full", subtotalCents: 6900, discountCents: 6900, currency: "usd" };
  const authorized = async (sql: Prisma.Sql, from = "ot_order", c: Client = db) => {
    const q = compile(sql);
    return (await c.query({ text: `SELECT o."id" FROM "${from}" o WHERE ${q.text} ORDER BY 1`, values: q.values })).rows.map((r) => r.id);
  };

  it("applies the column, ledger, and neutral view", async () => {
    const col = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name='ot_order' AND column_name='checkoutDiscountPromotionCodeId'`);
    expect(col.rowCount).toBe(1);
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ot_zero_total_settlement'`);
    expect(cols.rows.map((r) => r.column_name)).not.toContain("payment_intent");
  });

  it("binds only the exact durable order and is idempotent; a mismatched order is refused", async () => {
    await bindZeroTotalSettlement(tx(db), { ...base, orderId: "z1", sessionId: "cs_z1" });
    await bindZeroTotalSettlement(tx(db), { ...base, orderId: "z1", sessionId: "cs_z1", eventId: "evt_replay" });
    await expect(bindZeroTotalSettlement(tx(db), { ...base, orderId: "zx", sessionId: "cs_zx", promotionCodeId: "promo_other" })).rejects.toThrow("mismatch");
    await expect(bindZeroTotalSettlement(tx(db), { ...base, orderId: "p1", sessionId: "cs_p1" })).rejects.toThrow("mismatch");
    const rows = await db.query(`SELECT order_id, event_id FROM ot_zero_total_settlement ORDER BY 1`);
    expect(rows.rows).toEqual([{ order_id: "z1", event_id: "evt_z" }]);
  });

  it("enforces CHECK constraints and append-only evidence", async () => {
    await expect(db.query(`INSERT INTO ot_zero_total_settlement (order_id,session_id,event_id,promotion_code,coupon,subtotal_cents,discount_cents,currency) VALUES ('zx','cs_zx','e','promo_full','c',6900,100,'usd')`)).rejects.toThrow(/check/i);
    await expect(db.query(`INSERT INTO ot_zero_total_settlement (order_id,session_id,event_id,promotion_code,coupon,subtotal_cents,discount_cents,currency) VALUES ('zx','pi_zx','e','promo_full','c',6900,6900,'usd')`)).rejects.toThrow(/check/i);
    await expect(db.query(`UPDATE ot_zero_total_settlement SET discount_cents=discount_cents`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM ot_zero_total_settlement`)).rejects.toThrow(/append-only/);
  });

  it("payment authority admits exact zero-total and unreversed PI only", async () => {
    // z2 has a zero-total row forced past the binder but is not settled at zero.
    await db.query(`INSERT INTO ot_zero_total_settlement (order_id,session_id,event_id,promotion_code,coupon,subtotal_cents,discount_cents,currency) VALUES ('z2','cs_z2','e','promo_full','c',6900,6900,'usd')`);
    expect(await authorized(authority.trustedPaymentAuthority("o"))).toEqual(["p1", "z1"]);
  });

  it("neutral runtime reads authority only through views, never the ledger", async () => {
    await db.query("SET ROLE ot_neutral_runtime");
    try {
      expect(await authorized(authority.trustedPaymentAuthority("o", true), "ot_neutral_runtime_order")).toEqual(["p1", "z1"]);
      const join = (authority as unknown as { neutralZeroTotalSettlementJoin: (a: string) => Prisma.Sql }).neutralZeroTotalSettlementJoin("o");
      const q = compile(join);
      const rows = await db.query({ text: `SELECT o."id", zt."promotion_code" AS "zeroTotalPromotionCode" FROM "ot_neutral_runtime_order" o ${q.text} ORDER BY 1`, values: q.values });
      expect(rows.rows.filter((r) => r.zeroTotalPromotionCode)).toEqual([{ id: "z1", zeroTotalPromotionCode: "promo_full" }]);
      await expect(db.query(`SELECT 1 FROM ot_zero_total_settlement`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.query("RESET ROLE");
    }
  });

  it("neutral delivery (download) view grants exact zero-total and keeps reversal denial", async () => {
    await db.query("SET ROLE ot_neutral_delivery_runtime");
    try {
      const rows = await db.query(`SELECT id, "paymentAuthoritative" FROM ot_neutral_delivery_order ORDER BY 1`);
      expect(Object.fromEntries(rows.rows.map((r) => [r.id, r.paymentAuthoritative]))).toEqual({ h1: false, p1: true, p2: false, z1: true, z2: false, zx: false });
    } finally {
      await db.query("RESET ROLE");
    }
  });
});
