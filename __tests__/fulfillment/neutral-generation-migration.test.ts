/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

const migration = path.join(
  process.cwd(),
  "prisma/migrations/20260921120000_add_ot_neutral_generation_work/migration.sql",
);

test("neutral generation migration is additive, private, constrained, and deployable after the baseline", () => {
  const sql = fs.readFileSync(migration, "utf8");
  expect(sql).toContain('CREATE TYPE "OTNeutralGenerationStatus"');
  expect(sql).toContain('CREATE TABLE "ot_neutral_generation_work"');
  expect(sql).toContain("'PENDING'");
  expect(sql).toContain("'CLAIMED'");
  expect(sql).toContain("'PRODUCING'");
  expect(sql).toContain("'COMPLETE'");
  expect(sql).toContain("'RETRY_REQUIRED'");
  expect(sql).toContain("'RECONCILIATION_REQUIRED'");
  expect(sql).toContain("'FAILED'");
  expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  expect(sql).toContain("FORCE ROW LEVEL SECURITY");
  expect(sql).toContain("ot_neutral_runtime_generation_work");
  expect(sql).toContain("ot_neutral_generation_state_shape");
  expect(sql).toContain('"production_started_at" TIMESTAMPTZ(3)');
  expect(sql).toContain("'PRODUCTION_OUTCOME_UNKNOWN'");
  expect(sql).toContain("neutral generation runtime security verification failed");
  expect(sql).toContain("service_role");
  expect(sql).toContain('UNIQUE ("order_id")');
  expect(sql).toContain('UNIQUE ("reservation_id")');
  expect(sql).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE)\b/im);

  const manifest = fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/fulfillment/neutral-production-baseline-manifest.ts",
    ),
    "utf8",
  );
  expect(manifest).toContain('"20260921120000_add_ot_neutral_generation_work"');
});

test("schema models generation work without PII or delivery relations", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma/schema.prisma"),
    "utf8",
  );
  const block =
    schema.match(/model OTNeutralGenerationWork \{[\s\S]*?\n\}/)?.[0] ?? "";
  expect(block).toContain("statusRevision");
  expect(block).toContain("attemptCount");
  expect(block).toContain("leaseOwner");
  expect(block).toContain("leaseToken");
  expect(block).toContain("leaseExpiresAt");
  expect(block).toContain("productionStartedAt");
  expect(block).toContain("reasonCode");
  expect(block).not.toMatch(
    /email|name|address|provider|payload|delivery|capability/i,
  );
});
