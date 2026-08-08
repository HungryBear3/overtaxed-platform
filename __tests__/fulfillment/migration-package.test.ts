/**
 * @jest-environment node
 *
 * Phase 2 Slice 1 migration contract: Prisma discovers one timestamped,
 * additive migration whose DDL matches the controller-reviewed Phase 1 body.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOOSE_REVIEW_SQL = join(
  ROOT,
  "prisma/migrations/add_ot_t2_fulfillment_evidence.sql",
);
const MIGRATION_SQL = join(
  ROOT,
  "prisma/migrations/20260807001500_add_ot_t2_fulfillment_evidence/migration.sql",
);
const REVIEWED_DDL_SHA256 =
  "e929435e0be357f6997e43e646c067d4fc64177ad2cc35161fa3974260403a0f";

function ddlBody(sql: string): string {
  const marker = "-- CreateEnum";
  const offset = sql.indexOf(marker);
  if (offset < 0) throw new Error(`missing ${marker}`);
  return sql.slice(offset).trim();
}

describe("OT T2 fulfillment evidence migration package", () => {
  it("adopts the review SQL as one timestamped source of truth", () => {
    expect(existsSync(LOOSE_REVIEW_SQL)).toBe(false);
    expect(existsSync(MIGRATION_SQL)).toBe(true);
    const migration = readFileSync(MIGRATION_SQL, "utf8");
    expect(migration).toContain("Phase 2 Slice 1");
    expect(migration).not.toContain("REVIEW ONLY");
  });

  it("preserves the exact controller-reviewed DDL body", () => {
    const migration = readFileSync(MIGRATION_SQL, "utf8");
    const digest = createHash("sha256")
      .update(ddlBody(migration))
      .digest("hex");
    expect(digest).toBe(REVIEWED_DDL_SHA256);
  });

  it("remains additive and creates only the four fulfillment-evidence tables", () => {
    const migration = readFileSync(MIGRATION_SQL, "utf8");
    expect([...migration.matchAll(/CREATE TABLE /g)]).toHaveLength(4);
    expect(migration).toContain('CREATE TABLE "ot_fulfillment"');
    expect(migration).toContain('CREATE TABLE "ot_fulfillment_artifact"');
    expect(migration).toContain('CREATE TABLE "ot_delivery_attempt"');
    expect(migration).toContain('CREATE TABLE "ot_delivery_event"');
    expect(migration).not.toMatch(
      /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im,
    );
  });
});
