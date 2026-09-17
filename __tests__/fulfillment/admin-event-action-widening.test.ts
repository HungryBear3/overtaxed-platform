/**
 * @jest-environment node
 *
 * The admin audit table has to be able to STORE what operator recovery writes.
 *
 * `20260808173000_add_ot_fulfillment_admin_events` created
 * `ot_fulfillment_admin_event` for exactly one action and pinned four columns to
 * it: `action = 'ENTER_MANUAL_REVIEW'`, `to_status = 'MANUAL_REVIEW'`,
 * `reason_code = 'MANUAL_REVIEW'`, and a five-value `from_status` list.
 *
 * `runT2DeliveryRecovery`'s RESOLVE_UNRESOLVED_SEND writes
 * `('RESOLVE_UNRESOLVED_SEND', 'DELIVERY_PENDING', 'FAILED', <resolve code>)`,
 * which violates ALL FOUR. Against a real database that INSERT raises 23514 and
 * unwinds the whole recovery transaction — the status advance, the capability
 * revocation and the audit row together — so the operator control silently does
 * not work. Every unit test passes, because every unit test uses a fake that has
 * no CHECK constraints.
 *
 * These assertions are a source contract over the DDL and the writer. They
 * cannot execute SQL — no database is reachable here — so what they pin is that
 * the migration exists, that it states both shapes, that it drops the old
 * constraints by DISCOVERY rather than by a guessed PostgreSQL auto-name, and
 * that the values the writer actually inserts are inside the new rule.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  RESOLVE_REASON_CODES,
} from "@/lib/fulfillment-runtime/t2-delivery-recovery"

const ROOT = process.cwd()
const ORIGINAL = readFileSync(
  join(ROOT, "prisma/migrations/20260808173000_add_ot_fulfillment_admin_events/migration.sql"),
  "utf8",
)
const SQL = readFileSync(
  join(ROOT, "prisma/migrations/20260912180000_widen_ot_admin_event_actions/migration.sql"),
  "utf8",
)
const RECOVERY = readFileSync(
  join(ROOT, "lib/fulfillment-runtime/t2-delivery-recovery.ts"),
  "utf8",
)

describe("the constraint this migration exists to repair is really there", () => {
  it.each([
    [`CHECK ("action" = 'ENTER_MANUAL_REVIEW')`],
    [`CHECK ("to_status" = 'MANUAL_REVIEW')`],
    [`CHECK ("reason_code" = 'MANUAL_REVIEW')`],
  ])("the original migration still pins %s", (constraint) => {
    expect(ORIGINAL).toContain(constraint)
  })

  it("the original from_status list excludes DELIVERY_PENDING", () => {
    const list = ORIGINAL.match(/CHECK \("from_status" IN \(([^)]*)\)\)/)
    expect(list).not.toBeNull()
    expect(list![1]).not.toContain("DELIVERY_PENDING")
  })

  it("and the recovery writer inserts exactly the values those refuse", () => {
    const insert = RECOVERY.slice(
      RECOVERY.indexOf('INSERT INTO "ot_fulfillment_admin_event"'),
    ).slice(0, 900)
    expect(insert).toContain("RESOLVE_UNRESOLVED_SEND")
    expect(insert).toContain("DELIVERY_PENDING")
    expect(insert).toContain("FAILED")
  })
})

describe("the repair drops the old constraints without guessing their names", () => {
  it("never names a PostgreSQL auto-generated constraint", () => {
    // "<table>_<column>_check" is an implementation detail of how an unnamed
    // CHECK gets named, and differs if one was ever renamed or rebuilt by hand.
    expect(SQL).not.toContain("ot_fulfillment_admin_event_action_check")
    expect(SQL).not.toContain("ot_fulfillment_admin_event_to_status_check")
    expect(SQL).not.toContain("ot_fulfillment_admin_event_reason_code_check")
    expect(SQL).not.toContain("ot_fulfillment_admin_event_from_status_check")
  })

  it("discovers them from the catalogue by the columns they constrain", () => {
    expect(SQL).toContain("pg_constraint")
    expect(SQL).toContain("c.contype = 'c'")
    expect(SQL).toContain("c.conkey <@ target_columns")
    expect(SQL).toContain("DROP CONSTRAINT %I")
  })

  it("scopes the discovery to exactly the four columns being replaced", () => {
    expect(SQL).toContain(
      "a.attname IN ('action', 'from_status', 'to_status', 'reason_code')",
    )
    // The revision and actor constraints reference columns outside that set, so
    // a subset test cannot reach them.
    for (const survivor of ["from_revision", "to_revision", "actor_user_id"]) {
      expect(SQL).not.toMatch(
        new RegExp(`attname IN \\([^)]*${survivor}`),
      )
    }
  })
})

describe("the replacement couples each action to the transition it may describe", () => {
  it("keeps the manual-review shape byte-for-byte equivalent to the old rule", () => {
    const shape = SQL.slice(SQL.indexOf("_enter_manual_review_shape"))
    expect(shape).toContain(`"to_status" = 'MANUAL_REVIEW'`)
    expect(shape).toContain(`"reason_code" = 'MANUAL_REVIEW'`)
    for (const from of [
      "NOT_STARTED",
      "NEEDS_RECONCILIATION",
      "INCOMPLETE_INPUT",
      "ARTIFACT_PENDING",
      "ARTIFACT_READY",
    ]) {
      expect(shape.slice(0, 800)).toContain(from)
    }
  })

  it("admits the resolve shape, and only from the one unresolved status", () => {
    const shape = SQL.slice(SQL.indexOf("_resolve_unresolved_send_shape"))
    expect(shape).toContain(`"from_status" = 'DELIVERY_PENDING'`)
    expect(shape).toContain(`"to_status" = 'FAILED'`)
    // PROVIDER_ACCEPTED means the provider took custody and is expected to
    // report; it is not a send an operator may end.
    expect(shape.slice(0, 600)).not.toContain("PROVIDER_ACCEPTED")
  })

  it("admits exactly the reason codes the store will let an operator assert", () => {
    const shape = SQL.slice(SQL.indexOf("_resolve_unresolved_send_shape")).slice(0, 800)
    for (const code of RESOLVE_REASON_CODES) expect(shape).toContain(`'${code}'`)
    // Provider-originated verdicts are evidence, never an operator assertion.
    expect(shape).not.toContain("BOUNCED")
    expect(shape).not.toContain("COMPLAINED")
  })

  it("refuses the cross-products independent column widening would have allowed", () => {
    // Each shape is written as `action <> X OR (…)`, which constrains the
    // transition only for its own action. Widening `action`, `to_status` and
    // `reason_code` separately would have let an ENTER_MANUAL_REVIEW row claim
    // DELIVERY_PENDING → FAILED, and this table is audit evidence.
    expect(SQL).toContain(`"action" <> 'ENTER_MANUAL_REVIEW'`)
    expect(SQL).toContain(`"action" <> 'RESOLVE_UNRESOLVED_SEND'`)
  })

  it("keeps the action vocabulary closed, so a third action is not free text", () => {
    // Both shape constraints are vacuously true for an unknown action, so
    // dropping the old equality check without this would have left the column
    // unconstrained.
    expect(SQL).toContain("ot_fulfillment_admin_event_action_closed")
    expect(SQL).toContain(
      `"action" IN ('ENTER_MANUAL_REVIEW', 'RESOLVE_UNRESOLVED_SEND')`,
    )
  })
})

describe("the migration stays additive", () => {
  it("drops, retypes and backfills nothing", () => {
    expect(SQL).not.toMatch(/DROP\s+COLUMN/i)
    expect(SQL).not.toMatch(/DROP\s+TABLE/i)
    expect(SQL).not.toMatch(/DROP\s+INDEX/i)
    expect(SQL).not.toMatch(/ALTER\s+COLUMN/i)
    expect(SQL).not.toMatch(/^\s*(?:TRUNCATE|DELETE|UPDATE|INSERT)\b/im)
  })

  it("touches only the admin event table", () => {
    const tables = new Set(
      [...SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]),
    )
    expect([...tables]).toEqual(["ot_fulfillment_admin_event"])
  })
})
