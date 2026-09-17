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
 * Every row carries an EXPLICIT state, because the three cases are genuinely
 * different and collapsing any two of them produces a false claim:
 *
 *   - `campaign`            an approved code pair was the first touch;
 *   - `organic`             the order was CREATED by a request that carried no
 *                           approved campaign. A real, positive statement about
 *                           a first touch we actually observed;
 *   - `legacy_unattributed` the order already existed when binding first ran
 *                           against it, so its real first touch was never
 *                           observed and is unknowable. NOT organic — calling
 *                           it organic would assert an untagged first touch
 *                           that nothing ever measured — and never the current
 *                           request's campaign, which is a LATER touch.
 *
 * See ATTRIBUTION-SCOPE.md for why organic is an explicit row rather than the
 * absence of one.
 */

import { isWellFormedAttributionCode, isWellFormedRegistryVersion } from "./registry"

/** How the stored first touch came to be. Stored explicitly, never inferred. */
export type AttributionState = "campaign" | "organic" | "legacy_unattributed"

const ATTRIBUTION_STATES: readonly AttributionState[] = ["campaign", "organic", "legacy_unattributed"]

export type OrderAttributionRow = {
  orderId: string
  state: AttributionState
  /** Non-null only when `state === "campaign"`. */
  campaignCode: string | null
  creativeCode: string | null
  registryVersion: string
  boundAt: Date
}

/**
 * The slice of the Prisma client this module uses. Narrow on purpose: raw SQL
 * only, so nothing here can reach a model or a column outside this table. A
 * transaction client satisfies it too, which is what lets the route commit an
 * order and its first touch atomically.
 */
export type AttributionSqlClient = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

/**
 * Fixed, enumerated failure classifications.
 *
 * These exist so a failure can be logged without logging anything derived from
 * the failure itself. A driver error's message and `cause` can carry statement
 * text, bound parameter values and vendor detail strings; none of that may
 * reach a log line from this path.
 */
export type AttributionBindingFailureReason =
  | "invalid_binding_input"
  | "insert_failed"
  | "readback_failed"
  | "readback_not_a_list"
  | "readback_multiple_rows"
  | "readback_shape_invalid"
  | "readback_missing_after_insert"

/**
 * A binding failure, carrying ONLY a fixed classification.
 *
 * The originating driver error is deliberately NOT retained as `cause`. Keeping
 * it would mean one careless `console.error(err)` upstream serializes SQL text
 * and bound parameters into logs, and the parameters on this path include the
 * order id and the submitted codes. The classification is enough to tell the
 * operator what broke; the database's own logs hold the detail.
 */
export class AttributionBindingError extends Error {
  readonly reason: AttributionBindingFailureReason

  constructor(reason: AttributionBindingFailureReason) {
    super(`attribution binding failed: ${reason}`)
    this.name = "AttributionBindingError"
    this.reason = reason
  }
}

/** The fixed classification for any thrown value, with no detail extracted. */
export function attributionFailureReason(error: unknown): AttributionBindingFailureReason {
  return error instanceof AttributionBindingError ? error.reason : "insert_failed"
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
 * On: binding is mandatory for every order, organic and legacy included, and a
 * failure fails the checkout closed before any provider side effect.
 */
export function attributionBindingEnabled(): boolean {
  return process.env.OT_ORDER_ATTRIBUTION_ENABLED?.trim() === "1"
}

/** The coherence rules, identical to the SQL CHECK constraints on the table. */
function stateIsCoherent(params: {
  state: AttributionState
  campaignCode: string | null
  creativeCode: string | null
}): boolean {
  if (params.campaignCode !== null && !isWellFormedAttributionCode(params.campaignCode)) return false
  if (params.creativeCode !== null && !isWellFormedAttributionCode(params.creativeCode)) return false
  if (params.state === "campaign") return params.campaignCode !== null
  // `organic` and `legacy_unattributed` are both "no approved code", and a
  // creative can never stand without its campaign.
  return params.campaignCode === null && params.creativeCode === null
}

function assertBindable(params: {
  orderId: string
  state: AttributionState
  campaignCode: string | null
  creativeCode: string | null
  registryVersion: string
}) {
  if (!params.orderId) throw new AttributionBindingError("invalid_binding_input")
  if (!ATTRIBUTION_STATES.includes(params.state)) throw new AttributionBindingError("invalid_binding_input")
  if (!isWellFormedRegistryVersion(params.registryVersion)) throw new AttributionBindingError("invalid_binding_input")
  if (!stateIsCoherent(params)) throw new AttributionBindingError("invalid_binding_input")
}

/**
 * Bind first-touch attribution to a canonical order id and return the row that
 * is actually durable — which may be an earlier binding, not the one offered.
 *
 * Callers must treat the return value, not their own input, as the truth. That
 * is what makes a retry unable to overwrite or upgrade the original, and what
 * makes a `legacy_unattributed` bind against an order that turns out to already
 * carry a campaign row a harmless no-op.
 */
export async function bindFirstTouchAttribution(
  client: AttributionSqlClient,
  params: {
    orderId: string
    state: AttributionState
    campaignCode: string | null
    creativeCode: string | null
    registryVersion: string
  },
): Promise<OrderAttributionRow> {
  assertBindable(params)

  try {
    await client.$executeRaw`
      INSERT INTO "ot_order_attribution" ("order_id", "state", "campaign_code", "creative_code", "registry_version")
      VALUES (${params.orderId}, ${params.state}, ${params.campaignCode}, ${params.creativeCode}, ${params.registryVersion})
      ON CONFLICT ("order_id") DO NOTHING
    `
  } catch {
    // The driver error is dropped here, not rethrown as `cause`: see
    // AttributionBindingError.
    throw new AttributionBindingError("insert_failed")
  }

  const row = await readOrderAttribution(client, params.orderId)
  if (!row) throw new AttributionBindingError("readback_missing_after_insert")
  return row
}

/**
 * Readback of the immutable row. The only source for provider metadata.
 *
 * Stored data is treated as UNTRUSTED. The table has CHECK constraints, but
 * this code must not depend on them having been applied — the migration is not
 * executed by this branch, a restore or a manual edit can bypass them, and the
 * campaign code is copied verbatim into Stripe metadata. So the row is
 * revalidated against exactly the shape the constraints describe, and anything
 * else is a hard failure rather than a value that gets forwarded.
 */
export async function readOrderAttribution(
  client: AttributionSqlClient,
  orderId: string,
): Promise<OrderAttributionRow | null> {
  let rows: unknown
  try {
    rows = await client.$queryRaw<OrderAttributionRow[]>`
      SELECT
        "order_id" AS "orderId",
        "state" AS "state",
        "campaign_code" AS "campaignCode",
        "creative_code" AS "creativeCode",
        "registry_version" AS "registryVersion",
        "bound_at" AS "boundAt"
      FROM "ot_order_attribution"
      WHERE "order_id" = ${orderId}
    `
  } catch {
    throw new AttributionBindingError("readback_failed")
  }

  if (!Array.isArray(rows)) throw new AttributionBindingError("readback_not_a_list")
  if (rows.length === 0) return null
  // `order_id` is the primary key, so more than one row means the readback is
  // not describing the state this code reasons about. Fail rather than pick.
  if (rows.length > 1) throw new AttributionBindingError("readback_multiple_rows")

  const row = rows[0] as Record<string, unknown>
  if (typeof row?.orderId !== "string" || row.orderId.length === 0) {
    throw new AttributionBindingError("readback_shape_invalid")
  }
  const state = row.state
  if (typeof state !== "string" || !ATTRIBUTION_STATES.includes(state as AttributionState)) {
    throw new AttributionBindingError("readback_shape_invalid")
  }
  const campaignCode = row.campaignCode ?? null
  const creativeCode = row.creativeCode ?? null
  if (campaignCode !== null && typeof campaignCode !== "string") {
    throw new AttributionBindingError("readback_shape_invalid")
  }
  if (creativeCode !== null && typeof creativeCode !== "string") {
    throw new AttributionBindingError("readback_shape_invalid")
  }
  if (!stateIsCoherent({ state: state as AttributionState, campaignCode, creativeCode })) {
    throw new AttributionBindingError("readback_shape_invalid")
  }
  // Not forwarded to any provider, but a stored version that is not a version
  // means the row was not written by this code, and nothing on it is trusted.
  if (!isWellFormedRegistryVersion(row.registryVersion)) {
    throw new AttributionBindingError("readback_shape_invalid")
  }
  const boundAt = row.boundAt instanceof Date ? row.boundAt : new Date(String(row.boundAt ?? ""))
  if (Number.isNaN(boundAt.getTime())) throw new AttributionBindingError("readback_shape_invalid")

  return {
    orderId: row.orderId,
    state: state as AttributionState,
    campaignCode,
    creativeCode,
    registryVersion: row.registryVersion,
    boundAt,
  }
}

/**
 * Provider metadata derived from the immutable row.
 *
 * `null` (binding disabled) contributes no keys at all, so a deployment with
 * the gate off produces exactly the metadata it produced before this change.
 *
 * `legacy_unattributed` is stamped as itself. It is deliberately NOT dressed up
 * as organic or as a channel: the honest statement is "this order's first touch
 * predates attribution and is unknown", and downstream reporting must be able
 * to exclude these rather than count them as untagged traffic.
 *
 * The registry version is NOT stamped. It identifies an internal approval set,
 * it has no meaning to the provider, and keeping it out means no stored string
 * other than an already-revalidated code can reach Stripe.
 */
export function attributionMetadata(row: OrderAttributionRow | null): Record<string, string> {
  if (!row) return {}
  if (row.state !== "campaign" || row.campaignCode === null) {
    return { attributionStatus: row.state }
  }
  return {
    attributionStatus: "campaign",
    attributionCampaign: row.campaignCode,
    ...(row.creativeCode ? { attributionCreative: row.creativeCode } : {}),
  }
}
