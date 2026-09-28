/** @jest-environment node */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { parseInformationalAssessorHtml } from "@/lib/deadlines/assessor-calendar-parser";
import { collectOfficialDeadlineCapture } from "@/lib/deadlines/collect-informational-snapshot";
import { INFORMATIONAL_SOURCE_URL } from "@/lib/deadlines/informational-snapshot";
import { informationalSnapshotStore } from "@/lib/deadlines/informational-snapshot-store";
import { POST } from "@/app/api/internal/official-calendar-preview/route";
import {
  createQualificationHarness,
  createRunId,
  FEATURE_ENV,
  fixtureFetch,
  OWNED_KEYS,
  PINNED,
  resolveQualificationTarget,
  SNAPSHOT_KEY,
  type HarnessPorts,
  type Journal,
  type ResolvedTarget,
} from "@/lib/social/official-calendar-qualification";
import { pgQualificationDb } from "@/lib/social/official-calendar-qualification-pg";

jest.mock("server-only", () => ({}));

/**
 * The whole harness against a real PostgreSQL through the real Prisma client.
 * Skipped unless a LOOPBACK `ot_calendar_rehearsal_*` database is supplied;
 * the target rules refuse anything else, so this can never reach a hosted DB.
 */
const url = process.env.OT_CALENDAR_QUALIFICATION_TEST_DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("official-calendar qualification against PostgreSQL", () => {
  jest.setTimeout(60_000);
  const markerInstanceId = randomUUID();
  let resolved: ResolvedTarget;
  let admin: Client;

  beforeAll(async () => {
    for (const name of [...FEATURE_ENV, "DATABASE_URL"])
      delete process.env[name];
    resolved = resolveQualificationTarget(
      {
        OT_CALENDAR_PREVIEW_DATABASE_URL: url,
        OT_CALENDAR_PREVIEW_MARKER_INSTANCE_ID: markerInstanceId,
      },
      "local-rehearsal",
    );
    const { host, port, database, user } = resolved.target;
    admin = new Client({
      host,
      port,
      database,
      user,
      password: resolved.password,
      ssl: false,
    });
    await admin.connect();
    await admin.query(
      readFileSync(
        join(
          process.cwd(),
          "prisma/migrations/20250306000001_add_system_config/migration.sql",
        ),
        "utf8",
      ),
    );
    const marker = JSON.stringify({
      schema: "ot.database-environment.v1",
      purpose: "ot-official-calendar-preview",
      environment: "preview",
      isolated: true,
      production: false,
      instanceId: markerInstanceId,
    });
    await admin.query(
      `comment on database "${database.replace(/"/g, '""')}" is '${marker}'`,
    );
    // lib/db reads DATABASE_URL at first import, which happens inside the store.
    process.env.DATABASE_URL = resolved.connectionString;
  });
  afterAll(async () => {
    await admin.query(
      `delete from "SystemConfig" where "key" = any($1::text[])`,
      [[...OWNED_KEYS]],
    );
    await admin.end();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  const memory = () => {
    let journal: Journal | null = null;
    return {
      current: () => journal,
      read: async () => journal && structuredClone(journal),
      write: async (j: Journal) => void (journal = structuredClone(j)),
      writeReceipt: async () => undefined,
      removeTemporary: async () => 0,
    };
  };
  const portsFor = (
    openDb: HarnessPorts["openDb"],
    journal: HarnessPorts["journal"],
  ): HarnessPorts => ({
    env: process.env,
    openDb,
    store: informationalSnapshotStore,
    capture: (bytes, now) =>
      collectOfficialDeadlineCapture({
        fetchSource: fixtureFetch(bytes, INFORMATIONAL_SOURCE_URL),
        parseHtml: parseInformationalAssessorHtml,
        now: () => now,
      }),
    route: POST,
    fixture: async () =>
      new Uint8Array(readFileSync(join(process.cwd(), PINNED.fixturePath))),
    journal,
    now: () => new Date(),
    log: () => undefined,
  });
  const harnessFor = (
    openDb: HarnessPorts["openDb"],
    journal: HarnessPorts["journal"],
    runId = createRunId(),
  ) =>
    createQualificationHarness(portsFor(openDb, journal), {
      runId,
      target: resolved.target,
      secrets: [resolved.connectionString, resolved.password],
      source: { commit: "local", tree: "local", clean: true },
      requireCleanSource: false,
    });
  const run = () => {
    const journal = memory();
    return {
      harness: harnessFor(pgQualificationDb(resolved), journal),
      journal: journal.current,
    };
  };
  const keyRows = async () =>
    (
      await admin.query(
        `select "key", "id" from "SystemConfig" where "key" = any($1::text[])`,
        [[...OWNED_KEYS]],
      )
    ).rows;

  it("seeds, proves, cleans only its own rows and returns to default-off", async () => {
    await admin.query(
      `insert into "SystemConfig" ("id","key","value","updatedAt") values ($1,$2,'unrelated',now())
       on conflict ("key") do nothing`,
      [`ocq-unrelated-${randomUUID()}`, "ot:qualification-test:unrelated"],
    );
    const { harness, journal } = run();
    const outcome = await harness.run();
    expect(outcome.complete).toBe(true);
    const j = journal()!;
    expect(j.phases.proof!.evidence.rendered).toMatchObject({
      status: 200,
      renderedText: PINNED.renderedText,
      postAllowed: false,
    });
    expect(j.phases.cleanup!.deleted).toBe(2);
    // The seed instant is true time whatever the server's session zone is.
    expect(
      Math.abs(Date.now() - Date.parse(j.phases.seeded!.retrievedAt)),
    ).toBeLessThan(60_000);
    expect(await keyRows()).toEqual([]);
    const unrelated = await admin.query(
      `select 1 from "SystemConfig" where "key" = 'ot:qualification-test:unrelated'`,
    );
    expect(unrelated.rowCount).toBe(1);
    expect(FEATURE_ENV.every((name) => process.env[name] === undefined)).toBe(
      true,
    );
  });

  it("refuses a pre-existing snapshot row and leaves it untouched", async () => {
    await admin.query(
      `insert into "SystemConfig" ("id","key","value","updatedAt") values ('preexisting',$1,'{}',now())`,
      [SNAPSHOT_KEY],
    );
    try {
      await expect(run().harness.run()).rejects.toMatchObject({
        code: "target_not_clean",
      });
      expect(await keyRows()).toEqual([
        { key: SNAPSHOT_KEY, id: "preexisting" },
      ]);
    } finally {
      await admin.query(
        `delete from "SystemConfig" where "id" = 'preexisting'`,
      );
    }
  });

  it("refuses an incompatible schema without writing", async () => {
    await admin.query(
      `alter table "SystemConfig" rename column "value" to "payload"`,
    );
    try {
      await expect(run().harness.run()).rejects.toMatchObject({
        code: "schema_invalid",
      });
    } finally {
      await admin.query(
        `alter table "SystemConfig" rename column "payload" to "value"`,
      );
    }
    expect(await keyRows()).toEqual([]);
  });

  it("finishes an interrupted cleanup on resume against the real rows", async () => {
    const journal = memory();
    const runId = createRunId();
    const make = (openDb: HarnessPorts["openDb"]) =>
      harnessFor(openDb, journal, runId);
    const real = pgQualificationDb(resolved);
    const interrupting: HarnessPorts["openDb"] = async () => {
      const db = await real();
      return {
        ...db,
        deleteOwned: async (rows, since) => {
          await db.deleteOwned(rows.slice(0, 1), since);
          throw new Error("connection reset");
        },
      };
    };
    await expect(make(interrupting).run()).rejects.toThrow("connection reset");
    expect(await keyRows()).toHaveLength(1);
    const outcome = await make(real).run();
    expect(outcome.complete).toBe(true);
    expect(await keyRows()).toEqual([]);
  });
});
