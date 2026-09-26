/** @jest-environment node */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import type { Prisma } from "@prisma/client";

jest.mock("server-only", () => ({}), { virtual: true });

import { createNeutralGenerationStore } from "@/lib/fulfillment-runtime/neutral-generation-store";

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

suite(
  "neutral generation migration and fencing on disposable PostgreSQL",
  () => {
    let root = "",
      data = "",
      socket = "",
      port = 0;
    let started = false;
    let owner: Client, contender: Client;

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
      root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-neutral-generation-"));
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
      owner = new Client({
        host: socket,
        port,
        user: "postgres",
        database: "postgres",
      });
      contender = new Client({
        host: socket,
        port,
        user: "postgres",
        database: "postgres",
      });
      await owner.connect();
      await contender.connect();
      await owner.query(`
      CREATE ROLE ot_neutral_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
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
      await owner.query(`
      INSERT INTO ot_order VALUES ('ord_1','T2','PAID','14000000000000','cs_1','price_69','prod_neutral',6900,'usd',6900,'usd',69,'{"policyVersion":"ot-neutral-records-report/2026-09-15"}');
      INSERT INTO ot_neutral_report_reservation VALUES ('res_1','ord_1','neutral-order-binding/07f4ae8201e32fee4e3d966ee5ea7d64c2bfc8fbaf2b36ffcd4ce715f87ea193','0b8b54155714f2d705447a9e094bd34eb127455d0dc8718bb209af227b8e837c','price_69','prod_neutral','ot-neutral-records-report/2026-09-15','RESERVED');
      INSERT INTO ot_payment_binding VALUES ('ord_1','cs_1','pi_1');
      INSERT INTO ot_order VALUES ('ord_2','T2','PAID','14000000000001','cs_2','price_69','prod_neutral',6900,'usd',6900,'usd',69,'{"policyVersion":"ot-neutral-records-report/2026-09-15"}');
      INSERT INTO ot_neutral_report_reservation
        SELECT 'res_2','ord_2',
          'neutral-order-binding/' || encode(sha256(convert_to('orderId:5:ord_2|policy:ot-neutral-records-report/2026-09-15','UTF8')),'hex'),
          encode(sha256(convert_to('ot-neutral-property/v1','UTF8') || decode('00','hex') || convert_to('14000000000001','UTF8')),'hex'),
          'price_69','prod_neutral','ot-neutral-records-report/2026-09-15','RESERVED';
      INSERT INTO ot_payment_binding VALUES ('ord_2','cs_2','pi_2');
    `);
    }, 60_000);

    afterAll(async () => {
      await contender?.end().catch(() => undefined);
      await owner?.end().catch(() => undefined);
      if (data && started)
        execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
          stdio: "ignore",
          env: postgresEnv,
        });
      if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    test("claims, atomic begin, ambiguous recovery, authority, and exact final fences hold", async () => {
      const firstStore = createNeutralGenerationStore(adapter(owner));
      const secondStore = createNeutralGenerationStore(adapter(contender));
      const [a, b] = await Promise.all([
        firstStore.ensure("ord_1"),
        secondStore.ensure("ord_1"),
      ]);
      expect(a).toEqual(b);
      expect(
        (
          await owner.query(
            "select count(*)::int n from ot_neutral_generation_work",
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await owner.query(
            "select has_table_privilege('anon','ot_neutral_generation_work','SELECT') allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60_000);
      const [claimA, claimB] = await Promise.all([
        firstStore.claim({
          workId: a!.workId,
          owner: "owner-a",
          token: "11111111-1111-4111-8111-111111111111",
          now: now.toISOString(),
          expiresAt,
        }),
        secondStore.claim({
          workId: a!.workId,
          owner: "owner-b",
          token: "22222222-2222-4222-8222-222222222222",
          now: now.toISOString(),
          expiresAt,
        }),
      ]);
      expect([claimA, claimB].filter(Boolean)).toHaveLength(1);
      const winner = claimA ?? claimB!;
      const winnerOwner = claimA ? "owner-a" : "owner-b";
      const winnerToken = claimA
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222";
      await owner.query(
        "update ot_neutral_generation_work set lease_expires_at=clock_timestamp()-interval '1 second'",
      );
      const successor = await secondStore.claim({
        workId: a!.workId,
        owner: "owner-c",
        token: "33333333-3333-4333-8333-333333333333",
        now: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(successor).not.toBeNull();
      await expect(
        firstStore.beginProduction({
          workId: a!.workId,
          owner: winnerOwner,
          token: winnerToken,
          revision: winner.revision,
        }),
      ).resolves.toBeNull();

      await owner.query("insert into ot_settlement_reversal values ('pi_1')");
      await expect(
        secondStore.beginProduction({
          workId: a!.workId,
          owner: "owner-c",
          token: "33333333-3333-4333-8333-333333333333",
          revision: successor!.revision,
        }),
      ).resolves.toBeNull();
      await owner.query("delete from ot_settlement_reversal where payment_intent='pi_1'");
      const producing = await secondStore.beginProduction({
        workId: a!.workId,
        owner: "owner-c",
        token: "33333333-3333-4333-8333-333333333333",
        revision: successor!.revision,
      });
      expect(producing).toMatchObject({
        workId: a!.workId,
        orderId: "ord_1",
        propertyPin: "14000000000000",
        revision: successor!.revision + 1,
      });
      await expect(secondStore.candidates({ limit: 10 })).resolves.toEqual([]);
      expect(
        (
          await owner.query(
            "select status from ot_neutral_generation_work where id=$1",
            [a!.workId],
          )
        ).rows[0].status,
      ).toBe("PRODUCING");

      await owner.query(
        "update ot_neutral_generation_work set lease_expires_at=clock_timestamp()-interval '1 second'",
      );
      await expect(secondStore.candidates({ limit: 10 })).resolves.toEqual([]);
      expect(
        (
          await owner.query(
            "select status, reason_code from ot_neutral_generation_work where id=$1",
            [a!.workId],
          )
        ).rows[0],
      ).toEqual({
        status: "RECONCILIATION_REQUIRED",
        reason_code: "PRODUCTION_OUTCOME_UNKNOWN",
      });
      await expect(
        firstStore.transition({
          workId: a!.workId,
          owner: winnerOwner,
          token: winnerToken,
          revision: winner.revision,
          status: "COMPLETE",
          reasonCode: null,
        }),
      ).resolves.toBe(false);

      const second = await firstStore.ensure("ord_2");
      const secondClaim = await firstStore.claim({
        workId: second!.workId,
        owner: "owner-d",
        token: "44444444-4444-4444-8444-444444444444",
        now: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      const secondProduction = await firstStore.beginProduction({
        workId: second!.workId,
        owner: "owner-d",
        token: "44444444-4444-4444-8444-444444444444",
        revision: secondClaim!.revision,
      });
      await expect(
        firstStore.transition({
          workId: second!.workId,
          owner: "owner-d",
          token: "44444444-4444-4444-8444-444444444444",
          revision: secondClaim!.revision,
          status: "COMPLETE",
          reasonCode: null,
        }),
      ).resolves.toBe(false);
      await expect(
        firstStore.transition({
          workId: second!.workId,
          owner: "owner-d",
          token: "44444444-4444-4444-8444-444444444444",
          revision: secondProduction!.revision,
          status: "COMPLETE",
          reasonCode: null,
        }),
      ).resolves.toBe(true);
      await expect(
        firstStore.transition({
          workId: second!.workId,
          owner: "owner-d",
          token: "44444444-4444-4444-8444-444444444444",
          revision: secondProduction!.revision,
          status: "FAILED",
          reasonCode: "AUTHORITY_OR_INPUT_REFUSED",
        }),
      ).resolves.toBe(false);
    });
  },
);
