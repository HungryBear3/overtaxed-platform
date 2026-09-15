/**
 * Durable first-touch attribution binding for `ot_order`.
 *
 * Access is parameterized raw SQL against the dedicated `ot_order_attribution`
 * table (see prisma/migrations/20260912000000_add_ot_order_attribution). There
 * is deliberately no Prisma model: the Prisma schema is owned elsewhere and is
 * not edited by this slice.
 *
 * The binding is insert-if-absent then read back. The application NEVER issues
 * an UPDATE here, and the migration installs a BEFORE UPDATE trigger that
 * raises, so "first touch wins" is enforced by the database rather than by
 * convention. A retry that arrives with different codes gets the original row
 * back from the readback — including an original organic row.
 *
 * See ATTRIBUTION-SCOPE.md for why organic is an explicit row rather than the
 * absence of one.
 */

import { isWellFormedAttributionCode } from "./registry"

export type OrderAttributionRow = {
  orderId: string
  /** `null` means organic: the first touch carried no approved campaign. */
  campaignCode: string | null
  creativeCode: string | null
  registryVersion: string
  boundAt: Date
}

/**
 * The slice of the Prisma client this module uses. Narrow on purpose: raw SQL
 * only, so nothing here can reach a model or a column outside this table.
 */
export type AttributionSqlClient = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

export class AttributionBindingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "AttributionBindingError"
  }
}

/**
 * Persistence gate, default OFF.
 *
 * Off: no row is read or written and no attribution metadata is stamped, so the
 * checkout path is behaviourally identical to a deployment without this table.
 * This is what keeps the existing no-campaign flow working before the migration
 * is applied. It gates PERSISTENCE ONLY — code validation and rejection of
 * unknown codes happen regardless.
 *
 * On: binding is mandatory for every order, organic included, and a failure
 * fails the checkout closed before any provider side effect.
 */
export function attributionBindingEnabled(): boolean {
  return process.env.OT_ATTRIBUTION_ENABLED?.trim() === "1"
}

function assertBindable(params: { orderId: string; campaignCode: string | null; creativeCode: string | null }) {
  if (!params.orderId) throw new AttributionBindingError("attribution binding requires a canonical order id")
  if (params.campaignCode !== null && !isWellFormedAttributionCode(params.campaignCode)) {
    throw new AttributionBindingError("attribution campaign code is not well formed")
  }
  if (params.creativeCode !== null && !isWellFormedAttributionCode(params.creativeCode)) {
    throw new AttributionBindingError("attribution creative code is not well formed")
  }
  // Mirrors the SQL CHECK: a creative may not be stored without its campaign.
  if (params.campaignCode === null && params.creativeCode !== null) {
    throw new AttributionBindingError("attribution creative code requires a campaign code")
  }
}

/**
 * Bind first-touch attribution to a canonical order id and return the row that
 * is actually durable — which may be an earlier binding, not the one offered.
 *
 * Callers must treat the return value, not their own input, as the truth. That
 * is what makes a retry unable to overwrite or upgrade the original.
 */
export async function bindFirstTouchAttribution(
  client: AttributionSqlClient,
  params: {
    orderId: string
    campaignCode: string | null
    creativeCode: string | null
    registryVersion: string
  },
): Promise<OrderAttributionRow> {
  assertBindable(params)

  try {
    await client.$executeRaw`
      INSERT INTO "ot_order_attribution" ("order_id", "campaign_code", "creative_code", "registry_version")
      VALUES (${params.orderId}, ${params.campaignCode}, ${params.creativeCode}, ${params.registryVersion})
      ON CONFLICT ("order_id") DO NOTHING
    `
  } catch (cause) {
    throw new AttributionBindingError("attribution first-touch insert failed", { cause })
  }

  const row = await readOrderAttribution(client, params.orderId)
  if (!row) {
    throw new AttributionBindingError("attribution readback returned no row after insert")
  }
  return row
}

/** Readback of the immutable row. The only source for provider metadata. */
export async function readOrderAttribution(
  client: AttributionSqlClient,
  orderId: string,
): Promise<OrderAttributionRow | null> {
  let rows: unknown
  try {
    rows = await client.$queryRaw<OrderAttributionRow[]>`
      SELECT
        "order_id" AS "orderId",
        "campaign_code" AS "campaignCode",
        "creative_code" AS "creativeCode",
        "registry_version" AS "registryVersion",
        "bound_at" AS "boundAt"
      FROM "ot_order_attribution"
      WHERE "order_id" = ${orderId}
    `
  } catch (cause) {
    throw new AttributionBindingError("attribution readback failed", { cause })
  }

  if (!Array.isArray(rows)) throw new AttributionBindingError("attribution readback returned a non-list result")
  if (rows.length === 0) return null
  // `order_id` is the primary key, so more than one row means the readback is
  // not describing the state this code reasons about. Fail rather than pick.
  if (rows.length > 1) throw new AttributionBindingError("attribution readback returned multiple rows for one order")

  const row = rows[0] as Partial<OrderAttributionRow>
  if (typeof row?.orderId !== "string") {
    throw new AttributionBindingError("attribution readback row is missing its order id")
  }
  return {
    orderId: row.orderId,
    campaignCode: row.campaignCode ?? null,
    creativeCode: row.creativeCode ?? null,
    registryVersion: String(row.registryVersion ?? ""),
    boundAt: row.boundAt instanceof Date ? row.boundAt : new Date(String(row.boundAt ?? 0)),
  }
}

/**
 * Provider metadata derived from the immutable row.
 *
 * `null` (binding disabled) contributes no keys at all, so a deployment with
 * the gate off produces exactly the metadata it produced before this change.
 */
export function attributionMetadata(row: OrderAttributionRow | null): Record<string, string> {
  if (!row) return {}
  if (row.campaignCode === null) return { attributionStatus: "organic" }
  return {
    attributionStatus: "campaign",
    attributionCampaign: row.campaignCode,
    ...(row.creativeCode ? { attributionCreative: row.creativeCode } : {}),
  }
}
