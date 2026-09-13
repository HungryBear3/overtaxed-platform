import "server-only"

import type { ArtifactProvenanceInput } from "@/lib/fulfillment/artifact-binding"
import {
  T2_PRODUCER_VERSION,
  T2_TEMPLATE_VERSION,
  buildT2ArtifactContent,
  type DeadlineAuthoritySnapshot,
  type SignedPolicySnapshot,
  type SourceRecord,
  type SubjectRecord,
  type T2ArtifactRefusal,
} from "@/lib/fulfillment/t2-artifact-content"
import type { ComparableMatchAttributes } from "@/lib/fulfillment/t2-comparables"
import type { CountyDataRefusal, CountyGatewayBlocker } from "./t2-county-gateway"
import { evaluateCheckoutBusinessDayCutoff } from "@/lib/checkout/business-days"
import { resolveEligibilityPolicy } from "@/lib/checkout/ot-contract"
import { renderT2ArtifactPdf } from "@/lib/fulfillment/t2-artifact-pdf"

/**
 * The OT T2 artifact producer.
 *
 * This file used to be a HOLD stub that returned
 * `T2_ARTIFACT_PRODUCER_UNAVAILABLE` unconditionally, so no paid T2 order could
 * ever be fulfilled. It now produces a real evidence packet — and still
 * refuses, loudly and by name, every case it must not serve.
 *
 * Three properties matter more than the happy path.
 *
 * **It cannot open itself.** Production data comes from [[defaultGateway]],
 * whose policy resolver is the live `resolveEligibilityPolicy`. OD-2 and OD-3
 * are unsigned, that registry is empty, and so the very first check refuses
 * with `ELIGIBILITY_POLICY_UNSIGNED`. Nothing in this module can sign a policy,
 * and no environment variable reaches past the registry. Successful generation
 * is reachable only by injecting a `policyResolver` — which is exactly what the
 * tests do, and what production has no way to do.
 *
 * **Runtime orchestration is independently gated.** Paid settlement can reach
 * the binding workflow through the default-off scheduling and lease modules.
 * That code connection does not supply county data, sign eligibility, activate
 * private storage or deliver to a customer.
 *
 * **Its bytes are deterministic given the stable generation instant.** The
 * packet embeds no wall-clock reading. `generatedAt` is the immutable
 * `createdAt` of the fulfillment row — the instant kickoff created it in
 * `ARTIFACT_PENDING` — and the business-day figure written into the manifest is
 * measured from that same instant. The runtime clock is sampled exactly once
 * per attempt and used only for attempt-time GATE decisions (deadline freshness
 * and the three-business-day cutoff), which refuse but never render. So two
 * attempts on different days, against the same order, fulfillment, sources and
 * policy, produce byte-identical packets and identical hashes; a retry after an
 * ambiguous bind therefore replays as an idempotent no-op rather than a
 * conflict. All composition happens in `lib/fulfillment/t2-artifact-content.ts`,
 * which has no clock, no database and no network.
 */

export type T2ArtifactProducerBlocker =
  | T2ArtifactRefusal
  | "T2_ARTIFACT_PRODUCER_UNAVAILABLE"
  | "ORDER_NOT_FOUND"
  | "FULFILLMENT_NOT_FOUND"
  | "FULFILLMENT_ORDER_MISMATCH"
  | "GENERATION_INSTANT_UNAVAILABLE"
  | "SUBJECT_RECORD_UNAVAILABLE"
  | "COMPARABLE_SOURCE_UNAVAILABLE"
  // Named refusals from the official county reader. They say WHICH official
  // record was missing or ambiguous, which `COMPARABLE_SOURCE_UNAVAILABLE`
  // cannot: operations should not have to guess whether the county published
  // nothing, published something contradictory, or was simply unreachable.
  | CountyGatewayBlocker

export type GeneratedT2Artifact =
  | { ok: true; bytes: Buffer; provenance: ArtifactProvenanceInput }
  | { ok: false; blocker: T2ArtifactProducerBlocker }

export type T2ProducerOrder = {
  id: string
  propertyPin: string
  propertyAddress: string
  township: string
}

/**
 * The fulfillment summary the packet is being produced for. `createdAt` is the
 * stable generation instant: kickoff creates the row with create-only upsert
 * semantics directly in its initial status, and the column is never rewritten.
 */
export type T2ProducerFulfillment = {
  id: string
  orderId: string
  kind: string
  status: string
  createdAt: Date
}

export type T2ProducerCountyData = {
  subject: SubjectRecord
  comparableCandidates: ComparableMatchAttributes[]
  comparableAssessedValues: Map<string, number>
  comparableAddresses: Map<string, string>
  sources: SourceRecord[]
}

export type T2ProducerDeadlineBase = Omit<
  DeadlineAuthoritySnapshot,
  "businessDaysRemainingAtGeneration" | "businessDayCutoffAllowed"
>

/**
 * Everything the producer needs from the outside world.
 *
 * Injected wholesale in tests. There is deliberately no partial-override
 * convenience: a test that supplies a signed policy must also supply its own
 * data, so a fixture can never half-escape into a real lookup.
 */
export interface T2ArtifactGateway {
  loadOrder(orderId: string): Promise<T2ProducerOrder | null>
  loadFulfillment(fulfillmentId: string): Promise<T2ProducerFulfillment | null>
  /**
   * County evidence, a NAMED refusal, or `null`.
   *
   * The refusal arm is what lets the official reader in
   * `lib/fulfillment-runtime/t2-county-gateway.ts` report which official record
   * was unavailable rather than collapsing every cause into one code. The union
   * is widening only: an implementation that returns data or `null` — including
   * every gateway the existing tests inject — still satisfies it.
   */
  loadCountyData(order: T2ProducerOrder): Promise<T2ProducerCountyData | CountyDataRefusal | null>
  resolvePolicy(): SignedPolicySnapshot | null
  /**
   * Resolve the deadline authority as of `at` — the single clock sample for
   * this attempt. Implementations must not read an ambient clock of their own.
   */
  resolveDeadline(order: T2ProducerOrder, at: Date): Promise<T2ProducerDeadlineBase | null>
  /** Sampled exactly once per attempt by the producer. */
  now(): Date
}

type OrderRow = {
  id: string
  propertyPin: string | null
  propertyAddress: string | null
  township: string | null
}

type FulfillmentRow = {
  id: string
  order_id: string
  kind: string
  status: string
  created_at: Date | string | null
}

type OrderReaderClient = { $queryRaw<T>(query: unknown): Promise<T> }

/**
 * Production wiring.
 *
 * Imports are dynamic so a test that injects a gateway never loads Prisma or a
 * county client at all. The policy resolver is the live one; see the note above
 * about why that makes production refusal structural rather than configured.
 */
function defaultGateway(): T2ArtifactGateway {
  return {
    async loadOrder(orderId) {
      // Read through a narrow structural client and raw SQL, matching the idiom
      // already used by `lib/fulfillment-runtime/artifact-binding-store.ts`. The
      // generated Prisma client's model accessors are not reliably present in
      // this repository's type space, and a bounded row type is the established
      // fix here rather than a cast that would hide a real mismatch.
      const [{ prisma }, { Prisma }] = await Promise.all([
        import("@/lib/db"),
        import("@prisma/client"),
      ])
      const client = prisma as unknown as OrderReaderClient
      const rows = await client.$queryRaw<OrderRow[]>(
        Prisma.sql`SELECT "id", "propertyPin", "propertyAddress", "township"
                   FROM "ot_order" WHERE "id" = ${orderId} LIMIT 1`,
      )
      const order = rows[0]
      if (!order?.propertyPin || !order.propertyAddress || !order.township) return null
      return {
        id: order.id,
        propertyPin: order.propertyPin,
        propertyAddress: order.propertyAddress,
        township: order.township,
      }
    },

    async loadFulfillment(fulfillmentId) {
      // `ot_fulfillment` uses snake_case physical columns (see the Prisma
      // `@map` attributes); read them exactly as the database names them.
      const [{ prisma }, { Prisma }] = await Promise.all([
        import("@/lib/db"),
        import("@prisma/client"),
      ])
      const client = prisma as unknown as OrderReaderClient
      const rows = await client.$queryRaw<FulfillmentRow[]>(
        Prisma.sql`SELECT "id", "order_id", "kind"::text AS "kind", "status"::text AS "status", "created_at"
                   FROM "ot_fulfillment" WHERE "id" = ${fulfillmentId} LIMIT 1`,
      )
      const row = rows[0]
      if (!row?.id || !row.order_id) return null
      const createdAt =
        row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at ?? ""))
      return {
        id: row.id,
        orderId: row.order_id,
        kind: String(row.kind ?? ""),
        status: String(row.status ?? ""),
        createdAt,
      }
    },

    async loadCountyData(order) {
      // The strict official reader. It hands the WHOLE assessor neighbourhood to
      // selection, never filters or orders by an assessed value, and refuses by
      // name on any missing or ambiguous official record rather than pruning it.
      //
      // Addresses come from the current-year Assessor Parcel Addresses dataset
      // joined on exact PIN and tax year; the order's own address is never
      // substituted, because the packet renders that block as what the county
      // publishes.
      //
      // The import is dynamic for the same reason as the others here: a test
      // that injects a gateway never loads this module.
      const { loadOfficialCountyData } = await import("./t2-county-gateway")
      return loadOfficialCountyData({
        propertyPin: order.propertyPin,
        township: order.township,
      })
    },

    resolvePolicy() {
      // The live registry. Empty while OD-2 and OD-3 are unsigned, and there is
      // no value of OT_ELIGIBILITY_POLICY_VERSION that creates an entry in it.
      const policy = resolveEligibilityPolicy()
      if (!policy.signed) return null
      return {
        version: policy.version,
        ownerDecisions: policy.ownerDecisions,
        signedAt: policy.signedAt,
        evidenceThreshold: policy.evidenceThreshold,
      }
    },

    async resolveDeadline(order, at) {
      const { projectCommerceDeadline } = await import("@/lib/deadlines/commerce-deadline-authority")
      const { RESOLUTION_SOURCE, townshipKeyFromName } = await import(
        "@/lib/deadlines/township-resolution"
      )
      // The single attempt clock, handed in — never a second ambient reading.
      const atIso = at.toISOString()
      const pin = order.propertyPin.replace(/\D/g, "")
      const projection = await projectCommerceDeadline({
        township: {
          inputKind: "pin",
          normalizedPin: pin,
          normalizedAddress: null,
          townshipKey: townshipKeyFromName(order.township),
          townshipName: order.township,
          resolutionSource: RESOLUTION_SOURCE,
          resolvedAt: atIso,
        },
        at,
      })
      if (!projection.available) {
        // A synthetic or unverified snapshot lands here. Never trusted.
        return {
          trusted: false,
          status: "unknown",
          closeDate: null,
          sourceName: "Cook County Assessor",
          sourceUrl: projection.officialSourceUrl,
          retrievedAt: null,
        }
      }
      return {
        trusted: true,
        status: projection.status,
        closeDate: projection.showDates ? projection.lastFileDate : null,
        sourceName: "Cook County Assessor",
        sourceUrl: projection.officialSourceUrl,
        retrievedAt: projection.retrievedAt,
      }
    },

    now() {
      return new Date()
    },
  }
}

/** RFC3339 UTC at second precision, so the embedded instant is compact and stable. */
function toRfc3339Utc(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

export async function generateT2Artifact(
  input: { orderId: string; fulfillmentId: string },
  gateway: T2ArtifactGateway = defaultGateway(),
): Promise<GeneratedT2Artifact> {
  // Policy first, deliberately. With OD-2 and OD-3 unsigned this is the real
  // reason production produces nothing, and a refusal should say so rather than
  // report whichever downstream lookup happened to be unwired.
  const policy = gateway.resolvePolicy()
  if (!policy) return { ok: false, blocker: "ELIGIBILITY_POLICY_UNSIGNED" }

  const order = await gateway.loadOrder(input.orderId)
  if (!order) return { ok: false, blocker: "ORDER_NOT_FOUND" }

  // The fulfillment supplies the stable generation instant and must be the
  // T2 evidence summary of this exact order. The binder re-verifies the same
  // pairing inside its transaction; this is the producer's own copy of it.
  const fulfillment = await gateway.loadFulfillment(input.fulfillmentId)
  if (!fulfillment) return { ok: false, blocker: "FULFILLMENT_NOT_FOUND" }
  if (fulfillment.orderId !== order.id || fulfillment.kind !== "T2_APPEAL_EVIDENCE") {
    return { ok: false, blocker: "FULFILLMENT_ORDER_MISMATCH" }
  }
  const generationInstant = fulfillment.createdAt
  if (!(generationInstant instanceof Date) || !Number.isFinite(generationInstant.getTime())) {
    return { ok: false, blocker: "GENERATION_INSTANT_UNAVAILABLE" }
  }
  const generatedAt = toRfc3339Utc(generationInstant)

  // One clock sample per attempt. It feeds the attempt-time gates below and
  // nothing that is rendered.
  const attemptAt = gateway.now()

  const deadlineBase = await gateway.resolveDeadline(order, attemptAt)
  if (!deadlineBase) return { ok: false, blocker: "UNTRUSTED_DEADLINE_AUTHORITY" }

  // The approved three-business-day product cutoff, in America/Chicago, judged
  // at attempt time: a packet is not produced for a window the buyer cannot
  // realistically file into, even though payment already settled.
  const attemptCutoff = evaluateCheckoutBusinessDayCutoff({
    closeDate: deadlineBase.closeDate,
    now: attemptAt,
  })
  // The figure that is embedded in the bytes is measured from the stable
  // generation instant, so it cannot drift between attempts.
  const generationCutoff = evaluateCheckoutBusinessDayCutoff({
    closeDate: deadlineBase.closeDate,
    now: generationInstant,
  })
  const deadline: DeadlineAuthoritySnapshot = {
    ...deadlineBase,
    businessDaysRemainingAtGeneration: generationCutoff.businessDaysRemaining,
    businessDayCutoffAllowed: attemptCutoff.allowed,
  }

  const county = await gateway.loadCountyData(order)
  if (!county) return { ok: false, blocker: "COMPARABLE_SOURCE_UNAVAILABLE" }
  // A named county refusal is reported as itself. Reducing it to the generic
  // code here would discard the only signal that distinguishes an unreachable
  // source from a contradictory official record.
  if ("blocker" in county) return { ok: false, blocker: county.blocker }
  if (!county.subject) return { ok: false, blocker: "SUBJECT_RECORD_UNAVAILABLE" }

  const content = buildT2ArtifactContent({
    orderId: order.id,
    orderPropertyPin: order.propertyPin,
    orderPropertyAddress: order.propertyAddress,
    subject: county.subject,
    comparableCandidates: county.comparableCandidates,
    comparableAssessedValues: county.comparableAssessedValues,
    comparableAddresses: county.comparableAddresses,
    policy,
    deadline,
    sources: county.sources,
    generatedAt,
  })
  if (!content.ok) return { ok: false, blocker: content.blocker }

  return {
    ok: true,
    bytes: await renderT2ArtifactPdf(content.text, generatedAt),
    provenance: {
      sourceOrderId: order.id,
      propertyPin: order.propertyPin,
      propertyAddress: order.propertyAddress,
      generatorVersion: T2_PRODUCER_VERSION,
      templateVersion: T2_TEMPLATE_VERSION,
      generatedAt,
    },
  }
}
