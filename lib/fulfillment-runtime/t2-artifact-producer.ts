import "server-only"

import type { ArtifactProvenanceInput } from "@/lib/fulfillment/artifact-binding"
import {
  T2_PRODUCER_VERSION,
  T2_TEMPLATE_VERSION,
  buildT2ArtifactContent,
  encodeT2Artifact,
  type DeadlineAuthoritySnapshot,
  type SignedPolicySnapshot,
  type SourceRecord,
  type SubjectRecord,
  type T2ArtifactRefusal,
} from "@/lib/fulfillment/t2-artifact-content"
import type { ComparableMatchAttributes } from "@/lib/fulfillment/t2-comparables"
import { evaluateCheckoutBusinessDayCutoff } from "@/lib/checkout/business-days"
import { resolveEligibilityPolicy } from "@/lib/checkout/ot-contract"

/**
 * The OT T2 artifact producer.
 *
 * This file used to be a HOLD stub that returned
 * `T2_ARTIFACT_PRODUCER_UNAVAILABLE` unconditionally, so no paid T2 order could
 * ever be fulfilled. It now produces a real, deterministic evidence packet —
 * and still refuses, loudly and by name, every case it must not serve.
 *
 * Two properties matter more than the happy path.
 *
 * **It cannot open itself.** Production data comes from [[defaultGateway]],
 * whose policy resolver is the live `resolveEligibilityPolicy`. OD-2 and OD-3
 * are unsigned, that registry is empty, and so the very first check in
 * [[buildT2ArtifactContent]] refuses with `ELIGIBILITY_POLICY_UNSIGNED`. Nothing
 * in this module can sign a policy, and no environment variable reaches past
 * the registry. Successful generation is reachable only by injecting a
 * `policyResolver` — which is exactly what the tests do, and what production
 * has no way to do.
 *
 * **It is pure at the edges.** All composition happens in
 * `lib/fulfillment/t2-artifact-content.ts`, which has no clock, no database and
 * no network. This module's only job is to fetch, to apply the Chicago
 * business-day cutoff, and to hand a fully-resolved input across. That is why
 * the same order produces byte-identical bytes on every run.
 */

export type T2ArtifactProducerBlocker =
  | T2ArtifactRefusal
  | "T2_ARTIFACT_PRODUCER_UNAVAILABLE"
  | "ORDER_NOT_FOUND"
  | "SUBJECT_RECORD_UNAVAILABLE"
  | "COMPARABLE_SOURCE_UNAVAILABLE"

export type GeneratedT2Artifact =
  | { ok: true; bytes: Buffer; provenance: ArtifactProvenanceInput }
  | { ok: false; blocker: T2ArtifactProducerBlocker }

export type T2ProducerOrder = {
  id: string
  propertyPin: string
  propertyAddress: string
  township: string
}

export type T2ProducerCountyData = {
  subject: SubjectRecord
  comparableCandidates: ComparableMatchAttributes[]
  comparableAssessedValues: Map<string, number>
  comparableAddresses: Map<string, string>
  sources: SourceRecord[]
}

/**
 * Everything the producer needs from the outside world.
 *
 * Injected wholesale in tests. There is deliberately no partial-override
 * convenience: a test that supplies a signed policy must also supply its own
 * data, so a fixture can never half-escape into a real lookup.
 */
export interface T2ArtifactGateway {
  loadOrder(orderId: string): Promise<T2ProducerOrder | null>
  loadCountyData(order: T2ProducerOrder): Promise<T2ProducerCountyData | null>
  resolvePolicy(): SignedPolicySnapshot | null
  resolveDeadline(order: T2ProducerOrder): Promise<Omit<
    DeadlineAuthoritySnapshot,
    "businessDaysRemaining" | "businessDayCutoffAllowed"
  > | null>
  now(): Date
}

type OrderRow = {
  id: string
  propertyPin: string | null
  propertyAddress: string | null
  township: string | null
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

    async loadCountyData() {
      // Deliberately unimplemented in this slice.
      //
      // A production county gateway must read building area, residence type and
      // assessed value for the subject AND for every parcel in its Assessor
      // neighbourhood, with a retrieval timestamp per dataset. The existing
      // `getComparableEquity` helper cannot be reused: it ranks candidates by
      // lowest assessed dollars per square foot, which is the cherry-pick this
      // producer exists to avoid, and it caps its cohort read at 150 unordered
      // parcels. Wiring a correct non-directional county reader is a separate,
      // separately reviewable slice; until it exists this returns null and the
      // producer refuses rather than guessing.
      return null
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

    async resolveDeadline(order) {
      const { projectTownshipDeadline } = await import("@/lib/appeals/township-deadlines")
      const { RESOLUTION_SOURCE, townshipKeyFromName } = await import(
        "@/lib/deadlines/township-resolution"
      )
      const at = new Date().toISOString()
      const pin = order.propertyPin.replace(/\D/g, "")
      const projection = projectTownshipDeadline({
        township: {
          inputKind: "pin",
          normalizedPin: pin,
          normalizedAddress: null,
          townshipKey: townshipKeyFromName(order.township),
          townshipName: order.township,
          resolutionSource: RESOLUTION_SOURCE,
          resolvedAt: at,
        },
        stage: "assessor",
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

/** RFC3339 UTC to millisecond-free second precision, so bytes are stable. */
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

  const deadlineBase = await gateway.resolveDeadline(order)
  if (!deadlineBase) return { ok: false, blocker: "UNTRUSTED_DEADLINE_AUTHORITY" }

  // The approved three-business-day product cutoff, in America/Chicago. A
  // packet is not produced for a window the buyer cannot realistically file
  // into, even though payment already settled.
  const cutoff = evaluateCheckoutBusinessDayCutoff({
    closeDate: deadlineBase.closeDate,
    now: gateway.now(),
  })
  const deadline: DeadlineAuthoritySnapshot = {
    ...deadlineBase,
    businessDaysRemaining: cutoff.businessDaysRemaining,
    businessDayCutoffAllowed: cutoff.allowed,
  }

  const county = await gateway.loadCountyData(order)
  if (!county) return { ok: false, blocker: "COMPARABLE_SOURCE_UNAVAILABLE" }
  if (!county.subject) return { ok: false, blocker: "SUBJECT_RECORD_UNAVAILABLE" }

  const generatedAt = toRfc3339Utc(gateway.now())
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
    bytes: encodeT2Artifact(content.text),
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
