/** @jest-environment node */
/**
 * Native store behaviour for Slice 1, on a disposable PostgreSQL cluster built
 * by applying the repository's real migrations.
 *
 * This drives the REAL stores through the real SQL. It proves the three things
 * that only a database can prove: that a refused read writes no audit row and
 * mutates nothing, that a successful read appends exactly one row carrying the
 * digest actually served, and that a QA approval is admissible only after a
 * same-reviewer, post-open read of the current bundle.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Client } from "pg"

jest.mock("server-only", () => ({}), { virtual: true })

/** Synthetic object store. No network, no Blob, no provider. */
const bundles = new Map<string, { pdf: Buffer; csv: Buffer }>()
const zips = new Map<string, Buffer>()

jest.mock("@/lib/fulfillment-runtime/neutral-report-storage", () => {
  const actual = jest.requireActual("@/lib/fulfillment-runtime/neutral-report-storage")
  return {
    ...actual,
    readNeutralBundle: jest.fn(async (locator: string, expectedSha256: string) => {
      const bundle = bundles.get(expectedSha256)
      if (!bundle || locator !== actual.neutralBundleLocator(expectedSha256))
        throw new Error("NEUTRAL_STORAGE_MISMATCH")
      return { ...bundle }
    }),
  }
})
jest.mock("@/lib/fulfillment-runtime/neutral-customer-zip-storage", () => ({
  __esModule: true,
  readNeutralCustomerZip: jest.fn(async (locator: string) => {
    const bytes = zips.get(locator)
    if (!bytes) throw new Error("NEUTRAL_ZIP_STORAGE_UNAVAILABLE")
    return Buffer.from(bytes)
  }),
  writeNeutralCustomerZip: jest.fn(),
}))

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")

function available() {
  try {
    execFileSync("initdb", ["--version"], { stdio: "ignore" })
    execFileSync("pg_ctl", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const suite = available() ? describe : describe.skip

/**
 * Three migrations fingerprint real Supabase roles/topology and refuse on any
 * synthetic cluster by design — the baseline manifest records them as
 * "replaced" for the same reason. Their absence is asserted, not ignored.
 */
const EXPECTED_MIGRATION_REFUSALS = [
  "20260916120000_reconcile_ot_neutral_qa_delivery_forward",
  "20260916121000_harden_ot_supabase_owner_roles",
  "20260916220000_harden_ot_supabase_public_acl",
]

suite("Slice 1 operator stores on native PostgreSQL", () => {
  let root = "", data = "", socket = "", port = 0, started = false
  let owner: Client
  let executor: import("@/lib/fulfillment-runtime/neutral-db-executor").NeutralDbExecutor
  const postgresEnv = { ...process.env, LC_ALL: "C", LANG: "C" }
  const savedFlags: Record<string, string | undefined> = {}
  const FLAGS = [
    "OT_NEUTRAL_OPERATOR_QUEUE_ENABLED",
    "OT_NEUTRAL_OPERATOR_READ_ENABLED",
    "OT_NEUTRAL_QA_ENABLED",
  ] as const

  const BUNDLE = sha("bundle-v1")
  const PDF_BYTES = Buffer.from("%PDF-1.7 synthetic neutral report\n%%EOF\n")
  const CSV_BYTES = Buffer.from("field,value\nsubject,synthetic\n")
  const PDF = sha(PDF_BYTES)
  const CSV = sha(CSV_BYTES)
  const ZIP_BYTES = Buffer.from("PK synthetic customer zip")
  const ZIP = sha(ZIP_BYTES)

  const REVIEWER = "admin:u1"
  const OTHER_REVIEWER = "admin:u2"

  const audits = async () =>
    (await owner.query(`SELECT * FROM "ot_neutral_operator_artifact_read" ORDER BY "served_at"`)).rows

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ot-neutral-stores-"))
    data = path.join(root, "data")
    socket = path.join(root, "socket")
    fs.mkdirSync(socket)
    port = 44000 + Math.floor(Math.random() * 8000)
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "postgres"], { stdio: "ignore", env: postgresEnv })
    execFileSync("pg_ctl", ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-w", "start"], {
      stdio: "ignore",
      env: postgresEnv,
    })
    started = true
    owner = new Client({ host: socket, port, user: "postgres", database: "postgres" })
    await owner.connect()
    await owner.query(`
      CREATE ROLE ot_neutral_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE ot_neutral_delivery_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE ot_neutral_app_reader NOLOGIN;
      CREATE ROLE ot_neutral_reversal_guard_owner NOLOGIN;
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE ROLE ot_preview_app NOLOGIN;
    `)

    const dir = path.join(process.cwd(), "prisma/migrations")
    const names = fs
      .readdirSync(dir)
      .filter((name) => fs.existsSync(path.join(dir, name, "migration.sql")))
      .sort()
    const refused: string[] = []
    for (const name of names) {
      try {
        await owner.query(fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8"))
      } catch {
        refused.push(name)
      }
    }
    expect(refused).toEqual(EXPECTED_MIGRATION_REFUSALS)
    // The slice's own migration applied cleanly among them.
    expect(refused).not.toContain("20260922120000_add_ot_neutral_operator_ledgers")

    const { createNeutralTransactionExecutor } = await import(
      "@/lib/fulfillment-runtime/neutral-db-executor"
    )
    executor = createNeutralTransactionExecutor({
      query: (text: string, values?: unknown[]) => owner.query(text, values),
    })

    for (const flag of FLAGS) {
      savedFlags[flag] = process.env[flag]
      process.env[flag] = "true"
    }

    bundles.set(BUNDLE, { pdf: PDF_BYTES, csv: CSV_BYTES })
    zips.set(`ot-neutral-customer/sha256/${ZIP}.zip`, ZIP_BYTES)
  }, 240_000)

  afterAll(async () => {
    for (const flag of FLAGS)
      if (savedFlags[flag] === undefined) delete process.env[flag]
      else process.env[flag] = savedFlags[flag]
    await owner?.end().catch(() => undefined)
    if (data && started)
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "ignore",
        env: postgresEnv,
      })
    if (root) fs.rmSync(root, { recursive: true, force: true })
  })

  /**
   * Rebuild one complete synthetic chain before each test.
   *
   * `ot_payment_binding` and `ot_settlement_reversal` are BOTH immutable in this
   * schema — triggers refuse UPDATE and DELETE on each. That is precisely the
   * containment property the reversal design rests on, so the fixture works with
   * it rather than around it: every test gets a FRESH order, session, and payment
   * intent, and the settlement evidence of earlier tests names dead identifiers
   * that cannot reach the order under test. Only the neutral-owned rows, which
   * carry no such guarantee, are deleted.
   */
  let orderId = ""
  let reservationId = ""
  let paymentIntent = ""
  let counter = 0
  beforeEach(async () => {
    await owner.query(`
      DELETE FROM "ot_neutral_operator_artifact_read";
      DELETE FROM "ot_neutral_order_classification";
      DELETE FROM "ot_neutral_manual_delivery";
      DELETE FROM "ot_neutral_refund_work";
      DELETE FROM "ot_neutral_qa_review";
      DELETE FROM "ot_fulfillment_artifact";
      DELETE FROM "ot_fulfillment";
      DELETE FROM "ot_neutral_report_reservation";
    `)
    counter += 1
    orderId = `ord_${counter}`
    reservationId = `res_${counter}`
    paymentIntent = `pi_test_${counter}`
    const sessionId = `cs_test_${counter}`
    await owner.query(
      `INSERT INTO "ot_order" ("id","tier","email","status","stripeSessionId","amountPaid","checkoutAmountCents","settledAmountCents","updatedAt")
       VALUES ($1,'T2','person@example.com','PAID',$2,69,6900,6900,CURRENT_TIMESTAMP)`,
      [orderId, sessionId],
    )
    await owner.query(
      `INSERT INTO "ot_neutral_report_reservation"
        ("id","order_id","policy_version","property_fingerprint","reservation_key","checkout_price_id","checkout_product_id",
         "admission_sha256","data_evidence_sha256","deadline_evidence_sha256","source_content_sha256","deadline_identity_sha256",
         "official_retrieved_at","official_oldest_retrieved_at","official_max_age_seconds","deadline_retrieved_at",
         "cohort_position","precheckout_lease_expires_at","reviewer_key","reviewer_week_start",
         "status","bundle_sha256","manifest_sha256","pdf_sha256","csv_sha256","private_references","promoted_at","created_at")
       VALUES ($6,$7,'ot-neutral-records-report/2026-09-15',$1,$8,'price_1','prod_1',
         $1,$1,$1,$1,$1,
         CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,3600,CURRENT_TIMESTAMP,
         1,CURRENT_TIMESTAMP + interval '1 hour','pilot-primary',CURRENT_DATE,
         'PROMOTED',$2,$3,$4,$5,'{"locator":"x"}'::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [sha("fingerprint"), BUNDLE, sha("manifest"), PDF, CSV, reservationId, orderId, `rk_${counter}`],
    )
    await owner.query(
      `INSERT INTO "ot_payment_binding" ("order_id","session_id","payment_intent") VALUES ($1,$2,$3)`,
      [orderId, sessionId, paymentIntent],
    )
  })

  const openQa = async (reviewerKey = REVIEWER) => {
    const { openNeutralQaReview } = await import("@/lib/fulfillment-runtime/neutral-qa-store")
    return openNeutralQaReview({ orderId, reviewerKey }, { db: executor })
  }
  const readArtifact = async (
    input: Partial<{ artifactKind: string; expectedSha256: string; actorKey: string }> = {},
  ) => {
    const { readNeutralOperatorArtifact } = await import(
      "@/lib/fulfillment-runtime/neutral-operator-read-store"
    )
    return readNeutralOperatorArtifact(
      {
        orderId,
        actorKey: input.actorKey ?? REVIEWER,
        artifactKind: input.artifactKind ?? "INTERNAL_PDF",
        expectedSha256: input.expectedSha256 ?? PDF,
      },
      { db: executor },
    )
  }
  const approve = async (reviewerKey = REVIEWER) => {
    const { decideNeutralQaReview } = await import("@/lib/fulfillment-runtime/neutral-qa-store")
    return decideNeutralQaReview(
      { orderId, reviewerKey, decision: "approve", reasonCode: "QA_PASSED", minutesSpent: 0 },
      { db: executor },
    )
  }

  // ------------------------------------------------------------ classification

  test("classification is durable, idempotent, and fails closed on a different class", async () => {
    const { classifyNeutralOrder } = await import(
      "@/lib/fulfillment-runtime/neutral-order-classification-store"
    )
    const first = await classifyNeutralOrder(
      { orderId, actorKey: REVIEWER, class: "OWNER_TEST", noteCode: "OWNER_FULL_PRICE_TEST" },
      { db: executor },
    )
    expect(first).toMatchObject({ ok: true, class: "OWNER_TEST", created: true })

    const again = await classifyNeutralOrder(
      { orderId, actorKey: REVIEWER, class: "OWNER_TEST" },
      { db: executor },
    )
    expect(again).toMatchObject({ ok: true, class: "OWNER_TEST", created: false })

    const conflicting = await classifyNeutralOrder(
      { orderId, actorKey: REVIEWER, class: "CUSTOMER" },
      { db: executor },
    )
    expect(conflicting).toEqual({ ok: false, blocker: "CLASS_CONFLICT" })

    const rows = await owner.query(
      `SELECT "class","note_code","classified_at" FROM "ot_neutral_order_classification"`,
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].class).toBe("OWNER_TEST")
    expect(rows.rows[0].classified_at).toBeInstanceOf(Date)
  })

  test("SAMPLE is refused once the database is positively marked Production (I-12)", async () => {
    const { classifyNeutralOrder } = await import(
      "@/lib/fulfillment-runtime/neutral-order-classification-store"
    )
    // Unmarked: not positively Production, so SAMPLE is permitted.
    expect(
      await classifyNeutralOrder({ orderId, actorKey: REVIEWER, class: "SAMPLE" }, { db: executor }),
    ).toMatchObject({ ok: true, class: "SAMPLE" })
    await owner.query(`DELETE FROM "ot_neutral_order_classification"`)

    const marker = JSON.stringify({
      schema: "ot.database-environment.v1",
      purpose: "ot-neutral-report",
      environment: "production",
      production: true,
      projectRef: "kdvjiijzgflumgkndxsl",
      instanceId: "11111111-1111-4111-8111-111111111111",
    })
    await owner.query(`COMMENT ON DATABASE postgres IS ${owner.escapeLiteral(marker)}`)
    try {
      expect(
        await classifyNeutralOrder({ orderId, actorKey: REVIEWER, class: "SAMPLE" }, { db: executor }),
      ).toEqual({ ok: false, blocker: "SAMPLE_PROHIBITED_IN_PRODUCTION" })
      // Every other class still works in Production.
      expect(
        await classifyNeutralOrder(
          { orderId, actorKey: REVIEWER, class: "CUSTOMER" },
          { db: executor },
        ),
      ).toMatchObject({ ok: true, class: "CUSTOMER" })
      expect((await owner.query(`SELECT * FROM "ot_neutral_order_classification"`)).rows).toHaveLength(1)
    } finally {
      await owner.query(`COMMENT ON DATABASE postgres IS NULL`)
    }
  })

  // --------------------------------------------------------- operator reads

  test("a successful read serves the exact verified bytes and appends exactly one audit row", async () => {
    expect(await openQa()).toMatchObject({ ok: true })
    const result = await readArtifact()
    expect(result).toMatchObject({ ok: true, sha256: PDF, byteSize: PDF_BYTES.length })
    if (!result.ok) throw new Error("unreachable")
    expect(result.bytes.equals(PDF_BYTES)).toBe(true)

    const rows = await audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      reservation_id: reservationId,
      order_id: orderId,
      actor_key: REVIEWER,
      purpose: "QA_REVIEW",
      artifact_kind: "INTERNAL_PDF",
      sha256: PDF,
      reservation_bundle_sha256: BUNDLE,
      byte_size: PDF_BYTES.length,
    })
    expect(rows[0].served_at).toBeInstanceOf(Date)

    // The CSV is a separate audited serve of a separate digest.
    expect(await readArtifact({ artifactKind: "INTERNAL_CSV", expectedSha256: CSV })).toMatchObject({
      ok: true,
      sha256: CSV,
    })
    expect(await audits()).toHaveLength(2)
  })

  test.each([
    ["wrong actor", { actorKey: OTHER_REVIEWER }, "QA_NOT_OPEN_FOR_ACTOR"],
    ["stale digest", { expectedSha256: sha("stale") }, "ARTIFACT_DIGEST_MISMATCH"],
    ["wrong purpose for kind", { artifactKind: "CUSTOMER_ZIP", expectedSha256: ZIP }, "DELIVERY_NOT_READY"],
  ])("a refused read (%s) writes zero audit rows and mutates nothing", async (_label, input, blocker) => {
    expect(await openQa()).toMatchObject({ ok: true })
    const before = await owner.query(`SELECT "status","bundle_sha256" FROM "ot_neutral_report_reservation"`)
    expect(await readArtifact(input)).toEqual({ ok: false, blocker })
    expect(await audits()).toHaveLength(0)
    const after = await owner.query(`SELECT "status","bundle_sha256" FROM "ot_neutral_report_reservation"`)
    expect(after.rows).toEqual(before.rows)
    expect((await owner.query(`SELECT * FROM "ot_neutral_manual_delivery"`)).rows).toHaveLength(0)
  })

  test("a read with no QA open at all is refused and audits nothing", async () => {
    expect(await readArtifact()).toEqual({ ok: false, blocker: "QA_NOT_OPEN_FOR_ACTOR" })
    expect(await audits()).toHaveLength(0)
  })

  test("a storage digest mismatch serves nothing and audits nothing", async () => {
    expect(await openQa()).toMatchObject({ ok: true })
    // The object store no longer holds the bundle the reservation names.
    bundles.delete(BUNDLE)
    try {
      expect(await readArtifact()).toEqual({ ok: false, blocker: "STORAGE_READ_FAILED" })
      expect(await audits()).toHaveLength(0)
    } finally {
      bundles.set(BUNDLE, { pdf: PDF_BYTES, csv: CSV_BYTES })
    }
  })

  test("a reversal after the QA opened refuses the read with no audit row", async () => {
    expect(await openQa()).toMatchObject({ ok: true })
    await owner.query(
      `INSERT INTO "ot_settlement_reversal" ("payment_intent","event_id","event_type")
       VALUES ($1,$2,'charge.refunded') ON CONFLICT DO NOTHING`,
      [paymentIntent, `evt_refund_${counter}`],
    )
    expect(await readArtifact()).toEqual({ ok: false, blocker: "PAYMENT_NOT_AUTHORITATIVE" })
    expect(await audits()).toHaveLength(0)
  })

  // ------------------------------------------------- QA approval binding (T-08)

  test("approval is refused with no read at all, and succeeds after one exact read", async () => {
    expect(await openQa()).toMatchObject({ ok: true })
    expect(await approve()).toEqual({ ok: false, blocker: "QA_READ_AUDIT_REQUIRED" })
    expect((await owner.query(`SELECT "status" FROM "ot_neutral_qa_review"`)).rows[0].status).toBe("IN_REVIEW")

    expect(await readArtifact()).toMatchObject({ ok: true })
    expect(await approve()).toMatchObject({ ok: true, status: "APPROVED" })
    expect((await owner.query(`SELECT "status" FROM "ot_neutral_qa_review"`)).rows[0].status).toBe("APPROVED")
  })

  test("another reviewer's read does not authorize this reviewer's approval", async () => {
    expect(await openQa(OTHER_REVIEWER)).toMatchObject({ ok: true })
    expect(await readArtifact({ actorKey: OTHER_REVIEWER })).toMatchObject({ ok: true })
    // A row exists for the OTHER reviewer only; this reviewer cannot approve.
    expect(await approve(REVIEWER)).toEqual({ ok: false, blocker: "QA_BINDING_DRIFT" })
    expect((await owner.query(`SELECT "status" FROM "ot_neutral_qa_review"`)).rows[0].status).toBe("IN_REVIEW")
  })

  test("a pre-open read does not authorize approval", async () => {
    expect(await openQa()).toMatchObject({ ok: true })
    expect(await readArtifact()).toMatchObject({ ok: true })
    // Move the single audit row to before the review opened.
    await owner.query(
      `UPDATE "ot_neutral_operator_artifact_read" SET "served_at"=(SELECT "started_at" FROM "ot_neutral_qa_review") - interval '1 second'`,
    )
    expect(await approve()).toEqual({ ok: false, blocker: "QA_READ_AUDIT_REQUIRED" })
  })

  test("a read of superseded bytes does not authorize approval", async () => {
    expect(await openQa()).toMatchObject({ ok: true })
    expect(await readArtifact()).toMatchObject({ ok: true })
    // The recorded read names a bundle identity that is no longer current.
    await owner.query(`UPDATE "ot_neutral_operator_artifact_read" SET "reservation_bundle_sha256"=$1`, [
      sha("superseded-bundle"),
    ])
    expect(await approve()).toEqual({ ok: false, blocker: "QA_READ_AUDIT_REQUIRED" })
  })

  test("a read taken for delivery does not authorize approval", async () => {
    expect(await openQa()).toMatchObject({ ok: true })
    expect(await readArtifact()).toMatchObject({ ok: true })
    // Re-purpose the row. The SQL CHECK forces the kind to move with it, which
    // is itself part of why a delivery read can never masquerade as QA evidence.
    await owner.query(
      `UPDATE "ot_neutral_operator_artifact_read" SET "purpose"='DELIVERY_PREPARE',"artifact_kind"='CUSTOMER_ZIP'`,
    )
    expect(await approve()).toEqual({ ok: false, blocker: "QA_READ_AUDIT_REQUIRED" })
  })

  // ------------------------------------------------------------------- queue

  test("the queue derives AWAITING_QA and exposes no PII", async () => {
    const { listNeutralOperatorQueue } = await import("@/lib/fulfillment-runtime/neutral-operator-queue")
    const result = await listNeutralOperatorQueue({ db: executor })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("unreachable")
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      orderId,
      reservationId,
      state: "AWAITING_QA",
      bundleSha256: BUNDLE,
      classification: null,
    })
    const serialized = JSON.stringify(result.items)
    expect(serialized).not.toMatch(/person@example\.com|@|cs_test_|pi_test_|pilot-primary/)
  })

  test("the queue reports a settlement hold over every other state", async () => {
    const { listNeutralOperatorQueue } = await import("@/lib/fulfillment-runtime/neutral-operator-queue")
    await owner.query(
      `INSERT INTO "ot_settlement_reversal" ("payment_intent","event_id","event_type")
       VALUES ($1,$2,'charge.dispute.created') ON CONFLICT DO NOTHING`,
      [paymentIntent, `evt_dispute_${counter}`],
    )
    const result = await listNeutralOperatorQueue({ db: executor })
    if (!result.ok) throw new Error("unreachable")
    expect(result.items[0].state).toBe("SETTLEMENT_HOLD")
  })
})
