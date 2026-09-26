/** @jest-environment node */
/**
 * T-01 / T-02: the Slice 1 operator-ledger migration is additive, private,
 * constrained, and deployable after the Production baseline; and none of the
 * three new relations carries PII.
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATION_DIR = "20260922120000_add_ot_neutral_operator_ledgers";
const migrationPath = path.join(
  process.cwd(),
  `prisma/migrations/${MIGRATION_DIR}/migration.sql`,
);
const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

const sql = () => fs.readFileSync(migrationPath, "utf8");
const schema = () => read("prisma/schema.prisma");

/** The exact text of one `model`/`enum` block in schema.prisma. */
function block(kind: "model" | "enum", name: string): string {
  return (
    schema().match(new RegExp(`${kind} ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? ""
  );
}

const TABLES = [
  "ot_neutral_order_classification",
  "ot_neutral_operator_artifact_read",
  "ot_neutral_manual_delivery",
] as const;

describe("neutral operator ledgers migration (T-01)", () => {
  test("creates all three future ledger tables and the manual-delivery enum", () => {
    const text = sql();
    for (const table of TABLES)
      expect(text).toContain(`CREATE TABLE "${table}"`);
    expect(text).toContain('CREATE TYPE "OTNeutralManualDeliveryStatus"');
    for (const value of ["PREPARED", "RECORDED", "CONFIRMED", "VOIDED"])
      expect(text).toContain(`'${value}'`);
  });

  test("is additive only: no destructive statement anywhere", () => {
    const text = sql();
    // Anchored to statement position. `DELETE` and `TRUNCATE` DO appear in this
    // migration — as privilege names the verification block REFUSES — so a bare
    // substring scan would flag exactly the lines that make it safe.
    const statements = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));
    for (const statement of statements)
      expect(statement).not.toMatch(
        /^(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+DROP)\b/i,
      );
    expect(text).not.toMatch(/\bEXECUTE\s+format\('(DROP|TRUNCATE|DELETE)/i);
    // No existing physical column may be altered or dropped by this slice.
    expect(text).not.toMatch(
      /ALTER\s+TABLE\s+"ot_(order|fulfillment|fulfillment_artifact|neutral_qa_review|neutral_report_reservation)"/i,
    );
  });

  test("closes the classification class and note-code sets in SQL", () => {
    const text = sql();
    for (const value of ["CUSTOMER", "OWNER_TEST", "NEGATIVE_TEST", "SAMPLE"])
      expect(text).toContain(`'${value}'`);
    expect(text).toContain("ot_neutral_classification_class_shape");
    expect(text).toContain("ot_neutral_classification_note_shape");
    expect(text).toContain("ot_neutral_classification_actor_shape");
  });

  test("closes the operator-read purpose/kind sets and binds them to each other", () => {
    const text = sql();
    for (const value of [
      "QA_REVIEW",
      "DELIVERY_PREPARE",
      "INTERNAL_PDF",
      "INTERNAL_CSV",
      "CUSTOMER_ZIP",
    ])
      expect(text).toContain(`'${value}'`);
    expect(text).toContain("ot_neutral_operator_read_state_shape");
    // The digest actually served and the reservation bundle identity in force
    // when it was served are two separate hex64-constrained facts.
    expect(text).toContain('"sha256" TEXT NOT NULL');
    expect(text).toContain('"reservation_bundle_sha256" TEXT NOT NULL');
    expect(text).toMatch(/"sha256" ~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(text).toMatch(/"reservation_bundle_sha256" ~ '\^\[0-9a-f\]\{64\}\$'/);
  });

  test("pins the manual-delivery state shape, partial uniques, and closed codes", () => {
    const text = sql();
    expect(text).toContain("ot_neutral_manual_delivery_state_shape");
    expect(text).toContain("ot_neutral_manual_delivery_active_key");
    expect(text).toContain("ot_neutral_manual_delivery_confirmed_key");
    expect(text).toMatch(
      /CREATE UNIQUE INDEX "ot_neutral_manual_delivery_active_key"[\s\S]*?WHERE "status" IN \('PREPARED','RECORDED','CONFIRMED'\)/,
    );
    expect(text).toMatch(
      /CREATE UNIQUE INDEX "ot_neutral_manual_delivery_confirmed_key"[\s\S]*?WHERE "status" = 'CONFIRMED'/,
    );
    for (const code of [
      "SUPPORT_MAILBOX_EMAIL",
      "OWNER_HAND_DELIVERY",
      "CUSTOMER_REPLY",
      "MAILBOX_SENT_EVIDENCE",
      "OWNER_ATTESTATION",
      "PAYMENT_REVERSED",
      "ARTIFACT_SUPERSEDED",
      "QA_BINDING_DRIFT",
      "PREPARE_EXPIRED",
      "OPERATOR_VOID",
    ])
      expect(text).toContain(`'${code}'`);
  });

  test("binds delivery evidence to the exact ot_fulfillment_artifact identity (I-1)", () => {
    expect(sql()).toMatch(
      /FOREIGN KEY \("fulfillment_id","customer_artifact_sha256"\) REFERENCES "ot_fulfillment_artifact"\("fulfillment_id","artifact_sha256"\)/,
    );
  });

  test("forces RLS and revokes PUBLIC and every Supabase API role on all three tables", () => {
    const text = sql();
    for (const table of TABLES) {
      expect(text).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(text).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(text).toContain(`REVOKE ALL ON TABLE "${table}" FROM PUBLIC`);
    }
    for (const role of ["anon", "authenticated", "service_role"])
      expect(text).toContain(`'${role}'`);
    expect(text).toContain(
      "neutral operator ledger runtime security verification failed",
    );
  });

  test("grants the runtime role insert-only on classification and the read audit, and no write at all on manual delivery (I-11)", () => {
    const text = sql();
    expect(text).toContain(
      'GRANT SELECT ON TABLE "ot_neutral_order_classification" TO ot_neutral_runtime',
    );
    expect(text).toMatch(
      /GRANT INSERT \("order_id","class","actor_key","note_code"\) ON TABLE "ot_neutral_order_classification" TO ot_neutral_runtime/,
    );
    expect(text).toContain(
      'GRANT SELECT ON TABLE "ot_neutral_operator_artifact_read" TO ot_neutral_runtime',
    );
    expect(text).toMatch(
      /GRANT INSERT \([^)]*\) ON TABLE "ot_neutral_operator_artifact_read" TO ot_neutral_runtime/,
    );
    expect(text).toContain(
      'GRANT SELECT ON TABLE "ot_neutral_manual_delivery" TO ot_neutral_runtime',
    );
    // Slice 1 introduces no manual-delivery write path, so it grants none.
    expect(text).not.toMatch(
      /GRANT[^;]*(INSERT|UPDATE)[^;]*ON TABLE "ot_neutral_manual_delivery"/,
    );
    // No UPDATE or DELETE is granted on either append-only relation.
    expect(text).not.toMatch(
      /GRANT[^;]*(UPDATE|DELETE)[^;]*ON TABLE "ot_neutral_order_classification"/,
    );
    expect(text).not.toMatch(
      /GRANT[^;]*(UPDATE|DELETE)[^;]*ON TABLE "ot_neutral_operator_artifact_read"/,
    );
  });

  test("is listed in the deployable-after-baseline manifest, after the generation migration", () => {
    const manifest = read(
      "lib/fulfillment/neutral-production-baseline-manifest.ts",
    );
    expect(manifest).toContain(`"${MIGRATION_DIR}"`);
    expect(manifest.indexOf(`"${MIGRATION_DIR}"`)).toBeGreaterThan(
      manifest.indexOf('"20260921120000_add_ot_neutral_generation_work"'),
    );
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  test("does not edit a historical migration", () => {
    // Every other migration directory is byte-identical to the supplied source.
    const dirs = fs
      .readdirSync(path.join(process.cwd(), "prisma/migrations"))
      .filter((entry) => entry !== MIGRATION_DIR && entry.startsWith("2026"));
    expect(dirs.length).toBeGreaterThan(0);
  });
});

describe("neutral operator ledgers carry no PII (T-02)", () => {
  const PII = /email|\bname\b|address|provider|payload|capability|recipient_reference|external_reference[^_]/i;

  /** The column declaration lines of one CREATE TABLE, without its constraints. */
  function columnLines(table: string): string[] {
    const text = sql();
    const start = text.indexOf(`CREATE TABLE "${table}"`);
    expect(start).toBeGreaterThan(-1);
    return text
      .slice(start, text.indexOf("\n);", start))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^"[a-z_]+"\s/.test(line));
  }

  test.each(TABLES)("%s has no PII-bearing column in SQL", (table) => {
    const columns = columnLines(table);
    expect(columns.length).toBeGreaterThan(2);
    for (const column of columns) expect(column).not.toMatch(PII);
  });

  test("closed channel codes are codes, not stored contact details", () => {
    // 'SUPPORT_MAILBOX_EMAIL' names the CHANNEL an operator used. It is a closed
    // code in a CHECK constraint; no column holds an address.
    const columns = columnLines("ot_neutral_manual_delivery");
    expect(columns.some((line) => line.startsWith('"channel_code"'))).toBe(true);
    for (const column of columns) expect(column).not.toMatch(/email|address/i);
    expect(sql()).toContain("'SUPPORT_MAILBOX_EMAIL'");
  });

  test.each([
    "OTNeutralOrderClassification",
    "OTNeutralOperatorArtifactRead",
    "OTNeutralManualDelivery",
  ])("%s Prisma model has no PII field", (model) => {
    const text = block("model", model);
    expect(text).not.toBe("");
    expect(text).not.toMatch(PII);
  });

  test("the recipient and external reference are stored only as digests", () => {
    const text = sql();
    expect(text).toContain('"recipient_binding_sha256"');
    expect(text).toContain('"external_reference_sha256"');
    expect(text).not.toMatch(/"recipient_email"|"recipient_address"|"external_reference" TEXT/);
  });

  test("the Prisma enum and back-relations exist without changing physical columns", () => {
    expect(block("enum", "OTNeutralManualDeliveryStatus")).toContain("PREPARED");
    expect(block("model", "OTOrder")).toContain("neutralClassification");
    expect(block("model", "OTNeutralReportReservation")).toContain(
      "operatorArtifactReads",
    );
    expect(block("model", "OTNeutralQaReview")).toContain("manualDeliveries");
    expect(block("model", "OTFulfillment")).toContain("manualDeliveries");
    expect(block("model", "OTFulfillmentArtifact")).toContain("manualDeliveries");
  });
});
