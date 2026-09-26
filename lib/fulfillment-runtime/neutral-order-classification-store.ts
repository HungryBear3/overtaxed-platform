import "server-only"

import { Prisma } from "@prisma/client"
import { neutralPrisma } from "@/lib/fulfillment-runtime/neutral-db"
import { inNeutralTransaction, type NeutralDbExecutor } from "@/lib/fulfillment-runtime/neutral-db-executor"
import { decideNeutralOrderClassification } from "@/lib/fulfillment/neutral-order-classification"
import { parseNeutralProductionDatabaseMarker } from "@/lib/fulfillment/neutral-production-database-marker"

type Db = NeutralDbExecutor
const db = () => neutralPrisma() as unknown as Db
const enabled = () => process.env.OT_NEUTRAL_OPERATOR_QUEUE_ENABLED === "true"

/**
 * Is THIS database positively identified as the OT Production database?
 *
 * Positively: the durable marker must be present and parse as the approved
 * Production project. An absent, malformed, or Preview marker is NOT a
 * Production identification — this predicate never guesses in either direction,
 * and the SAMPLE refusal (I-12) is built on the positive answer only.
 */
async function productionDatabase(tx: Db): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ marker: string | null }>>(
    Prisma.sql`SELECT shobj_description(oid,'pg_database') AS "marker" FROM pg_database WHERE datname=current_database()`,
  )
  try {
    parseNeutralProductionDatabaseMarker(rows[0]?.marker ?? null)
    return true
  } catch {
    return false
  }
}

export type NeutralClassificationResult =
  | { ok: true; class: string; noteCode: string | null; created: boolean; reservationId: string }
  | { ok: false; blocker: string }

/**
 * Record the durable, insert-only class of one order.
 *
 * Insert-only is enforced three ways and all of them matter: the runtime role
 * holds no UPDATE or DELETE grant, the primary key is the order, and a
 * conflicting re-assertion fails closed here rather than overwriting. The row is
 * the evidence that an owner test was declared BEFORE it completed, so a path
 * that could rewrite it after the fact would destroy the only thing it proves.
 *
 * This never touches payment, artifact, QA, or delivery authority. Class is for
 * reporting and for the Slice 2 PREPARE gate; every authority predicate applies
 * identically to every class.
 */
export async function classifyNeutralOrder(
  input: { orderId: string; actorKey: string; class: string; noteCode?: string | null },
  options: { db?: Db } = {},
): Promise<NeutralClassificationResult> {
  if (!enabled()) return { ok: false, blocker: "FLAG_DISABLED" }
  if (!input.orderId || input.orderId.length > 128) return { ok: false, blocker: "INVALID_INPUT" }

  return inNeutralTransaction(options.db ?? db(), options.db, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-classification:${input.orderId}`}))::text AS "locked"`,
    )

    const reservation = (
      await tx.$queryRaw<Array<{ reservationId: string }>>(
        Prisma.sql`SELECT "id" AS "reservationId" FROM "ot_neutral_report_reservation" WHERE "order_id"=${input.orderId}`,
      )
    )[0]
    if (!reservation) return { ok: false as const, blocker: "ORDER_NOT_IN_NEUTRAL_SCOPE" }

    const existing = (
      await tx.$queryRaw<Array<{ class: string }>>(
        Prisma.sql`SELECT "class" FROM "ot_neutral_order_classification" WHERE "order_id"=${input.orderId}`,
      )
    )[0]

    const decision = decideNeutralOrderClassification({
      class: input.class,
      actorKey: input.actorKey,
      noteCode: input.noteCode ?? null,
      existingClass: existing?.class ?? null,
      productionDatabase: await productionDatabase(tx),
    })
    if (!decision.ok) return { ok: false as const, blocker: decision.blocker }

    if (decision.created) {
      // `classified_at` is deliberately absent: the runtime role holds no INSERT
      // grant on it, so the instant is always the database clock.
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO "ot_neutral_order_classification" ("order_id","class","actor_key","note_code") VALUES (${input.orderId},${decision.class},${input.actorKey},${decision.noteCode}) ON CONFLICT ("order_id") DO NOTHING`,
      )
    }

    // Read back under the same lock. A racing insert of a DIFFERENT class must
    // surface as a conflict, never as a silent success against another actor's row.
    const actual = (
      await tx.$queryRaw<Array<{ class: string; noteCode: string | null }>>(
        Prisma.sql`SELECT "class","note_code" AS "noteCode" FROM "ot_neutral_order_classification" WHERE "order_id"=${input.orderId}`,
      )
    )[0]
    if (!actual) return { ok: false as const, blocker: "CLASSIFICATION_CONFLICT" }
    if (actual.class !== decision.class) return { ok: false as const, blocker: "CLASS_CONFLICT" }

    return {
      ok: true as const,
      class: actual.class,
      noteCode: actual.noteCode,
      created: decision.created,
      reservationId: reservation.reservationId,
    }
  })
}
