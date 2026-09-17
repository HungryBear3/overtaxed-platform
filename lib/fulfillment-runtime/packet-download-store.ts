import { trustedPaymentAuthority } from "./payment-authority";
/**
 * Transactional store for T2 packet download capabilities.
 *
 * Three operations, each with one job:
 *   - `issue`   mint a capability for an already-bound artifact;
 *   - `authorize` verify a submitted capability and claim exactly one use;
 *   - `reassert` re-verify authority after the asynchronous storage read, before
 *      a single byte is handed to the caller;
 *   - `revoke`  end every live capability for a fulfillment, idempotently.
 *
 * Concurrency contract, identical to the binder's so the two cannot deadlock:
 * lock the authoritative `ot_order` row FOR UPDATE first, then the capability
 * row, and re-verify everything inside that lock against freshly read state. A
 * concurrent refund, dispute, cancellation or revocation that wins the lock is
 * therefore visible before any use is claimed. Expiry is judged against the
 * database's WALL clock read after those locks, never transaction-start time,
 * so a capability that expired while this transaction queued for the lock is
 * refused rather than served.
 *
 * The capability VALUE never reaches this module. Callers hash it first, and
 * only the digest is passed, queried, compared or held — so there is nothing
 * here that a log line, an error message or a stack trace could leak.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { neutralDeliveryPrisma } from "@/lib/fulfillment-runtime/neutral-delivery-db";
import { neutralDeliveryEnabled, t2PacketDownloadEnabled } from "@/lib/fulfillment/flag";
import {
  CAPABILITY_REVOCATION_REASONS,
  decideCapabilityIssuance,
  decidePacketDownload,
  type CapabilityRevocationReason,
  type PacketDownloadArtifactRow,
  type PacketDownloadBlocker,
  type PacketDownloadCapabilityRow,
  type PacketDownloadFulfillmentRow,
  type PacketDownloadGrant,
  type PacketDownloadOrderRow,
} from "@/lib/fulfillment/packet-download";

export type AuthorizeDownloadOutcome =
  | { ok: true; grant: PacketDownloadGrant }
  | { ok: false; blocker: PacketDownloadBlocker };

export type IssueCapabilityOutcome =
  | {
      ok: true;
      capabilityId: string;
      artifactId: string;
      artifactSha256: string;
      expiresAt: string;
      maxUses: number;
    }
  | { ok: false; blocker: PacketDownloadBlocker };

/**
 * Optional association between a freshly minted capability and the delivery
 * attempt that is about to hand it out.
 *
 * When present, three extra things happen inside the SAME transaction as the
 * insert, so there is no window in which any of them is half-done:
 *   - the attempt is locked and required to have NO capability yet, which is
 *     what makes "an ambiguous send is never re-minted under the same key" an
 *     invariant of the database rather than a habit of the caller;
 *   - every other live capability for the fulfillment is revoked as SUPERSEDED,
 *     so a newly issued credential invalidates the ones it replaces;
 *   - the attempt records the capability id, so a later revocation or operator
 *     recovery can name the exact credential that attempt issued.
 */
export type CapabilityAttemptBinding = {
  attemptNumber: number;
  provider: string;
};

export interface PacketDownloadStore {
  issue(input: {
    capabilityHash: string;
    fulfillmentId: string;
    ttlSeconds: number;
    maxUses: number;
    attempt?: CapabilityAttemptBinding;
  }): Promise<IssueCapabilityOutcome>;
  authorize(input: { capabilityHash: string }): Promise<AuthorizeDownloadOutcome>;
  reassert(input: {
    capabilityHash: string;
    grant: PacketDownloadGrant;
  }): Promise<AuthorizeDownloadOutcome>;
  revoke(input: {
    fulfillmentId: string;
    reasonCode: CapabilityRevocationReason;
  }): Promise<{ ok: true; revoked: number } | { ok: false; blocker: string }>;
}

/**
 * WALL-CLOCK time as a strict RFC3339 UTC instant, rendered by the database —
 * never by a driver date mapping, which would silently apply the server's local
 * UTC offset and expire capabilities at the wrong moment.
 *
 * `clock_timestamp()`, deliberately NOT `CURRENT_TIMESTAMP`/`now()`. Every read
 * of this happens AFTER a `FOR UPDATE` lock that may have blocked for an
 * unbounded time behind another writer, and `CURRENT_TIMESTAMP` is frozen at
 * TRANSACTION START — it does not advance across that wait. A transaction that
 * began while a capability was still live and then waited past its expiry would
 * read the pre-wait instant, judge the capability unexpired and serve the
 * packet. `clock_timestamp()` advances during the transaction, so expiry is
 * measured at the moment the decision is actually made.
 */
const TRUSTED_CLOCK_SQL = Prisma.sql`
  SELECT to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "now"
`;

const CAPABILITY_COLUMNS = Prisma.sql`
  "id", "capability_hash" AS "capabilityHash", "fulfillment_id" AS "fulfillmentId",
  "artifact_id" AS "artifactId", "artifact_version" AS "artifactVersion",
  "artifact_sha256" AS "artifactSha256", "source_order_id" AS "sourceOrderId",
  "property_binding_fingerprint" AS "propertyBindingFingerprint",
  "expires_at" AS "expiresAt", "max_uses" AS "maxUses",
  "use_count" AS "useCount", "revoked_at" AS "revokedAt"
`;

const ARTIFACT_COLUMNS = Prisma.sql`
  "id", "fulfillment_id" AS "fulfillmentId", "version",
  "artifact_sha256" AS "artifactSha256", "byte_size" AS "byteSize",
  "storage_locator" AS "storageLocator", "source_order_id" AS "sourceOrderId",
  "property_binding_fingerprint" AS "propertyBindingFingerprint"
`;

/** `ot_order` kept camelCase physical column names; they must stay quoted. */
const ORDER_COLUMNS = Prisma.sql`
  "id", "tier", "status", "propertyPin", "propertyAddress"
`;

const FULFILLMENT_COLUMNS = Prisma.sql`
  "id", "order_id" AS "orderId", "kind"::text AS "kind", "status"::text AS "status"
`;

/**
 * The narrow slice of the Prisma client this store uses. Exported so a test can
 * build a correctly typed fake instead of casting a whole client.
 */
export type PacketDownloadTransaction = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};
export type PacketDownloadClient = {
  $transaction<T>(work: (tx: PacketDownloadTransaction) => Promise<T>): Promise<T>;
};

/** The narrow attempt shape the optional binding needs. */
type AttemptBindingRow = {
  attemptNumber: number;
  provider: string;
  downloadCapabilityId: string | null;
};

type ContextRows = {
  capability: PacketDownloadCapabilityRow | null;
  order: PacketDownloadOrderRow | null;
  fulfillment: PacketDownloadFulfillmentRow | null;
  artifact: PacketDownloadArtifactRow | null;
  trustedNow: string;
};

function toInstant(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function withNeutralQa(
  tx: PacketDownloadTransaction,
  fulfillment: PacketDownloadFulfillmentRow | null,
): Promise<PacketDownloadFulfillmentRow | null> {
  if (!fulfillment || fulfillment.kind !== "NEUTRAL_RECORDS_REPORT") return fulfillment;
  if (!neutralDeliveryEnabled()) return {...fulfillment, neutralQaApproved:false};
  const rows = await tx.$queryRaw<Array<{ approved: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM "ot_neutral_qa_review" q
      JOIN "ot_neutral_report_reservation" r ON r."id"=q."reservation_id"
      JOIN "ot_fulfillment_artifact" a ON a."fulfillment_id"=q."fulfillment_id"
      WHERE q."fulfillment_id"=${fulfillment.id} AND q."order_id"=${fulfillment.orderId}
        AND q."status"='APPROVED' AND r."status"='PROMOTED'
        AND r."superseded_by_sha256" IS NULL
        AND q."customer_artifact_sha256"=a."artifact_sha256"
        AND q."artifact_sha256"=r."bundle_sha256"
        AND q."property_binding_fingerprint"=a."property_binding_fingerprint"
        AND q."policy_version"=a."template_version"
        AND a."version"=(SELECT max(x."version") FROM "ot_fulfillment_artifact" x WHERE x."fulfillment_id"=q."fulfillment_id")
    ) AS "approved"
  `);
  return {...fulfillment, neutralQaApproved: rows[0]?.approved === true};
}

/**
 * Read every row the decision needs, under the authoritative order lock.
 *
 * The capability is read twice on purpose. The first read is only to learn which
 * order to lock; the second, taken after the lock, is the one the decision uses.
 * Reading it before the lock and trusting that snapshot would let a refund or a
 * revocation that commits in between go unseen.
 */
async function loadContext(
  tx: PacketDownloadTransaction,
  capabilityHash: string,
  neutralRestricted=false,
): Promise<ContextRows> {
  const probe = await tx.$queryRaw<Array<{ sourceOrderId: string }>>(neutralRestricted
    ? Prisma.sql`SELECT c."source_order_id" AS "sourceOrderId" FROM "ot_packet_download_capability" c JOIN "ot_fulfillment" f ON f."id"=c."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT' WHERE c."capability_hash"=${capabilityHash}`
    : Prisma.sql`SELECT c."source_order_id" AS "sourceOrderId" FROM "ot_packet_download_capability" c JOIN "ot_fulfillment" f ON f."id"=c."fulfillment_id" AND f."kind"::text<>'NEUTRAL_RECORDS_REPORT' WHERE c."capability_hash"=${capabilityHash}`);
  const orderId = probe[0]?.sourceOrderId;
  if (orderId === undefined) {
    return {
      capability: null,
      order: null,
      fulfillment: null,
      artifact: null,
      trustedNow: "",
    };
  }

  if(neutralRestricted)await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-delivery:${orderId}`}))::text AS "locked"`)
  const orders = await tx.$queryRaw<PacketDownloadOrderRow[]>(neutralRestricted
    ? Prisma.sql`SELECT "id","tier","status","propertyPin","propertyAddress" FROM "ot_neutral_delivery_order" WHERE "id"=${orderId} AND "paymentAuthoritative"=true`
    : Prisma.sql`SELECT ${ORDER_COLUMNS} FROM "ot_order" WHERE "id" = ${orderId} AND ${trustedPaymentAuthority()} FOR UPDATE`);

  const capabilities = await tx.$queryRaw<PacketDownloadCapabilityRow[]>(
    Prisma.sql`SELECT ${CAPABILITY_COLUMNS}
               FROM "ot_packet_download_capability"
               WHERE "capability_hash" = ${capabilityHash}
               FOR UPDATE`,
  );
  const capability = capabilities[0] ?? null;

  const fulfillments = capability
    ? await tx.$queryRaw<PacketDownloadFulfillmentRow[]>(
        Prisma.sql`SELECT ${FULFILLMENT_COLUMNS} FROM "ot_fulfillment"
                   WHERE "id" = ${capability.fulfillmentId}`,
      )
    : [];

  const artifacts = capability
    ? await tx.$queryRaw<PacketDownloadArtifactRow[]>(
        Prisma.sql`SELECT ${ARTIFACT_COLUMNS} FROM "ot_fulfillment_artifact"
                   WHERE "fulfillment_id" = ${capability.fulfillmentId}
                     ORDER BY "version" DESC LIMIT 1`,
      )
    : [];

  // Read AFTER every row — including the FOR UPDATE locks above, which may have
  // blocked — and BEFORE any write, so one consistent WALL-CLOCK instant governs
  // the whole decision and the update that may follow.
  const clock = await tx.$queryRaw<Array<{ now: unknown }>>(TRUSTED_CLOCK_SQL);

  return {
    capability,
    order: orders[0] ?? null,
    fulfillment: await withNeutralQa(tx, fulfillments[0] ?? null),
    artifact: artifacts[0] ?? null,
    trustedNow: toInstant(clock[0]?.now),
  };
}

export function createPrismaPacketDownloadStore(
  client: PacketDownloadClient,
  options:{neutralRestricted?:boolean}={},
): PacketDownloadStore {
  return {
    async issue(input) {
      // Defence in depth: a disabled deployment opens no database boundary.
      if (!t2PacketDownloadEnabled(process.env))
        return { ok: false, blocker: "FLAG_DISABLED" };

      return client.$transaction(async (tx): Promise<IssueCapabilityOutcome> => {
        const fulfillments = await tx.$queryRaw<PacketDownloadFulfillmentRow[]>(options.neutralRestricted
          ? Prisma.sql`SELECT ${FULFILLMENT_COLUMNS} FROM "ot_fulfillment" WHERE "id"=${input.fulfillmentId} AND "kind"::text='NEUTRAL_RECORDS_REPORT'`
          : Prisma.sql`SELECT ${FULFILLMENT_COLUMNS} FROM "ot_fulfillment" WHERE "id"=${input.fulfillmentId} AND "kind"::text<>'NEUTRAL_RECORDS_REPORT'`);
        let fulfillment = fulfillments[0] ?? null;
        if (!fulfillment) return { ok: false, blocker: "FULFILLMENT_NOT_FOUND" };

        if(options.neutralRestricted)await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`neutral-delivery:${fulfillment.orderId}`}))::text AS "locked"`)
        const orders = await tx.$queryRaw<PacketDownloadOrderRow[]>(options.neutralRestricted
          ? Prisma.sql`SELECT "id","tier","status","propertyPin","propertyAddress" FROM "ot_neutral_delivery_order" WHERE "id"=${fulfillment.orderId} AND "paymentAuthoritative"=true`
          : Prisma.sql`SELECT ${ORDER_COLUMNS} FROM "ot_order" WHERE "id" = ${fulfillment.orderId} AND ${trustedPaymentAuthority()} FOR UPDATE`);

        const refreshed = await tx.$queryRaw<PacketDownloadFulfillmentRow[]>(options.neutralRestricted
          ? Prisma.sql`SELECT ${FULFILLMENT_COLUMNS} FROM "ot_fulfillment" WHERE "id" = ${input.fulfillmentId}`
          : Prisma.sql`SELECT ${FULFILLMENT_COLUMNS} FROM "ot_fulfillment" WHERE "id" = ${input.fulfillmentId} FOR UPDATE`);
        const authorizedFulfillment = await withNeutralQa(tx, refreshed[0] ?? null);
        if (!authorizedFulfillment) return { ok: false, blocker: "FULFILLMENT_NOT_FOUND" };
        fulfillment = authorizedFulfillment;

        // Order → fulfillment → attempt, the same lock ordering the delivery
        // store and the binder use, so the three can never deadlock.
        const binding = input.attempt;
        if (binding) {
          const attempts = await tx.$queryRaw<AttemptBindingRow[]>(
            Prisma.sql`SELECT "attempt_number" AS "attemptNumber", "provider",
                              "download_capability_id" AS "downloadCapabilityId"
                       FROM "ot_delivery_attempt"
                       WHERE "fulfillment_id" = ${input.fulfillmentId}
                         AND "attempt_number" = ${binding.attemptNumber}
                       FOR UPDATE`,
          );
          const attempt = attempts[0] ?? null;
          // No attempt, a different sender, or an attempt that ALREADY issued a
          // credential. The last case is the important one: a retry of an
          // ambiguous send must never mint a second value under the same logical
          // key, because the first value is deliberately not recoverable and the
          // two messages could never be identical.
          if (
            !attempt ||
            attempt.provider !== binding.provider ||
            attempt.downloadCapabilityId !== null
          ) {
            return { ok: false, blocker: "CAPABILITY_BINDING_MISMATCH" };
          }
        }

        // The CURRENT artifact is the highest bound version. Nothing here may
        // mint a capability for a version that has been superseded.
        const artifacts = await tx.$queryRaw<PacketDownloadArtifactRow[]>(
          Prisma.sql`SELECT ${ARTIFACT_COLUMNS} FROM "ot_fulfillment_artifact"
                     WHERE "fulfillment_id" = ${input.fulfillmentId}
                     ORDER BY "version" DESC LIMIT 1`,
        );
        const clock = await tx.$queryRaw<Array<{ now: unknown }>>(
          TRUSTED_CLOCK_SQL,
        );

        const decision = decideCapabilityIssuance({
          flagEnabled: t2PacketDownloadEnabled(process.env),
          trustedNow: toInstant(clock[0]?.now),
          capabilityHash: input.capabilityHash,
          ttlSeconds: input.ttlSeconds,
          maxUses: input.maxUses,
          artifact: artifacts[0] ?? null,
          fulfillment,
          order: orders[0] ?? null,
        });
        if (!decision.ok) return { ok: false, blocker: decision.blocker };
        const capability = decision.capability;

        // If activation is withdrawn while the reads awaited PostgreSQL, abort
        // before a usable capability exists.
        if (!t2PacketDownloadEnabled(process.env))
          return { ok: false, blocker: "FLAG_DISABLED" };

        const id = randomUUID();
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "ot_packet_download_capability" (
                       "id", "capability_hash", "fulfillment_id", "artifact_id",
                       "artifact_version", "artifact_sha256", "source_order_id",
                       "property_binding_fingerprint", "issued_at", "expires_at",
                       "max_uses", "use_count"
                     ) VALUES (
                       ${id}, ${capability.capabilityHash}, ${capability.fulfillmentId},
                       ${capability.artifactId}, ${capability.artifactVersion},
                       ${capability.artifactSha256}, ${capability.sourceOrderId},
                       ${capability.propertyBindingFingerprint},
                       ${new Date(capability.issuedAt)}, ${new Date(capability.expiresAt)},
                       ${capability.maxUses}, 0
                     )`,
        );

        if (binding) {
          // A newly issued credential supersedes the ones it replaces. Scoped to
          // live rows other than the one just written, so this is idempotent and
          // can never revoke the capability it is issuing.
          await tx.$executeRaw(
            Prisma.sql`UPDATE "ot_packet_download_capability"
                       SET "revoked_at" = ${new Date(capability.issuedAt)},
                           "revoked_reason_code" = ${"SUPERSEDED"}
                       WHERE "fulfillment_id" = ${input.fulfillmentId}
                         AND "id" <> ${id}
                         AND "revoked_at" IS NULL`,
          );
          // Conditional on the attempt STILL having no capability, so a
          // concurrent issuer that won the race invalidates this one rather than
          // both handing out a live value.
          const bound = await tx.$executeRaw(
            Prisma.sql`UPDATE "ot_delivery_attempt"
                       SET "download_capability_id" = ${id}
                       WHERE "fulfillment_id" = ${input.fulfillmentId}
                         AND "attempt_number" = ${binding.attemptNumber}
                         AND "download_capability_id" IS NULL`,
          );
          if (bound !== 1) throw new PacketDownloadRollback();
        }

        return {
          ok: true,
          capabilityId: id,
          artifactId: capability.artifactId,
          artifactSha256: capability.artifactSha256,
          expiresAt: capability.expiresAt,
          maxUses: capability.maxUses,
        };
      }).catch((error: unknown): IssueCapabilityOutcome => {
        // The rollback signal unwound the transaction, so nothing — not the
        // capability row, not the supersession, not the attempt binding —
        // committed. Everything else propagates.
        if (error instanceof PacketDownloadRollback)
          return { ok: false, blocker: "CAPABILITY_BINDING_MISMATCH" };
        throw error;
      });
    },

    async authorize(input) {
      if (!t2PacketDownloadEnabled(process.env))
        return { ok: false, blocker: "FLAG_DISABLED" };

      try {
        return await client.$transaction(
          async (tx): Promise<AuthorizeDownloadOutcome> => {
            const context = await loadContext(tx, input.capabilityHash,options.neutralRestricted);
            const decision = decidePacketDownload({
              flagEnabled: t2PacketDownloadEnabled(process.env),
              trustedNow: context.trustedNow,
              capabilityHash: input.capabilityHash,
              capability: context.capability,
              artifact: context.artifact,
              fulfillment: context.fulfillment,
              order: context.order,
            });
            if (!decision.ok) return { ok: false, blocker: decision.blocker };
            const grant = decision.grant;

            // Claim exactly one use, conditional on the exact count the decision was
            // made against and on the capability still being live. A concurrent
            // claimant or revoker therefore invalidates this authorization instead
            // of both callers spending the same use.
            const claimed = await tx.$executeRaw(
              Prisma.sql`UPDATE "ot_packet_download_capability"
                         SET "use_count" = ${grant.nextUseCount},
                             "last_used_at" = ${new Date(context.trustedNow)}
                         WHERE "id" = ${grant.capabilityId}
                           AND "use_count" = ${grant.expectedUseCount}
                           AND "revoked_at" IS NULL
                           AND "expires_at" > ${new Date(context.trustedNow)}`,
            );
            if (claimed !== 1)
              return { ok: false, blocker: "CAPABILITY_USE_NOT_CLAIMED" };

            // A withdrawal observed while the claim awaited PostgreSQL rolls the
            // claim back rather than serving bytes under a disabled flag.
            if (!t2PacketDownloadEnabled(process.env))
              throw new PacketDownloadRollback();
            return { ok: true, grant };
          },
        );
      } catch (error) {
        // The rollback signal unwound the transaction, so the claim never
        // committed and no use was spent.
        if (error instanceof PacketDownloadRollback)
          return { ok: false, blocker: "FLAG_DISABLED" };
        throw error;
      }
    },

    async reassert(input) {
      if (!t2PacketDownloadEnabled(process.env))
        return { ok: false, blocker: "FLAG_DISABLED" };

      return client.$transaction(async (tx): Promise<AuthorizeDownloadOutcome> => {
        const context = await loadContext(tx, input.capabilityHash,options.neutralRestricted);
        const capability = context.capability;
        if (!capability) return { ok: false, blocker: "CAPABILITY_NOT_FOUND" };

        // The use budget is re-checked against the count this grant was CLAIMED
        // FROM, not the post-claim count. Re-checking the post-claim count would
        // refuse the last legitimate use of every capability — the claim would
        // have consumed the budget it is now being judged against. Everything
        // else (revocation, expiry, settlement, lifecycle, artifact identity,
        // property binding) is re-evaluated against freshly read state.
        const decision = decidePacketDownload({
          flagEnabled: t2PacketDownloadEnabled(process.env),
          trustedNow: context.trustedNow,
          capabilityHash: input.capabilityHash,
          capability: { ...capability, useCount: input.grant.expectedUseCount },
          artifact: context.artifact,
          fulfillment: context.fulfillment,
          order: context.order,
        });
        if (!decision.ok) return { ok: false, blocker: decision.blocker };

        // Our claim must still be on record. If the counter moved anywhere other
        // than forward past our use, this is not the capability we authorized.
        if (capability.useCount < input.grant.nextUseCount)
          return { ok: false, blocker: "CAPABILITY_USE_NOT_CLAIMED" };

        // The re-read identity must be the exact identity that was granted.
        const grant = decision.grant;
        if (
          grant.capabilityId !== input.grant.capabilityId ||
          grant.artifactId !== input.grant.artifactId ||
          grant.artifactVersion !== input.grant.artifactVersion ||
          grant.artifactSha256 !== input.grant.artifactSha256 ||
          grant.storageLocator !== input.grant.storageLocator ||
          grant.byteSize !== input.grant.byteSize ||
          grant.fulfillmentId !== input.grant.fulfillmentId ||
          grant.orderId !== input.grant.orderId
        ) {
          return { ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" };
        }
        return { ok: true, grant: input.grant };
      });
    },

    async revoke(input) {
      if (!CAPABILITY_REVOCATION_REASONS.has(input.reasonCode))
        return { ok: false, blocker: "INVALID_REASON_CODE" };

      // Revocation is deliberately NOT gated on the download flag: turning the
      // download surface off must never be able to block ending access.
      return client.$transaction(
        async (
          tx,
        ): Promise<
          { ok: true; revoked: number } | { ok: false; blocker: string }
        > => {
          const clock = await tx.$queryRaw<Array<{ now: unknown }>>(
            TRUSTED_CLOCK_SQL,
          );
          const now = toInstant(clock[0]?.now);
          if (now === "") return { ok: false, blocker: "UNTRUSTED_CLOCK" };
          // Idempotent: only live rows are touched, so a repeat call revokes 0 and
          // never rewrites an existing revocation reason or timestamp.
          const revoked = await tx.$executeRaw(
            Prisma.sql`UPDATE "ot_packet_download_capability"
                       SET "revoked_at" = ${new Date(now)},
                           "revoked_reason_code" = ${input.reasonCode}
                       WHERE "fulfillment_id" = ${input.fulfillmentId}
                         AND "revoked_at" IS NULL`,
          );
          return { ok: true, revoked };
        },
      );
    },
  };
}

/** Internal signal: unwind (and roll back) a claim taken under a withdrawn flag. */
class PacketDownloadRollback extends Error {
  constructor() {
    super("PACKET_DOWNLOAD_ROLLBACK");
    this.name = "PacketDownloadRollback";
  }
}

export const prismaPacketDownloadStore = createPrismaPacketDownloadStore(
  prisma as unknown as PacketDownloadClient,
);

export function neutralPacketDownloadStore(executor?:PacketDownloadClient):PacketDownloadStore{
  return createPrismaPacketDownloadStore(executor??neutralDeliveryPrisma() as unknown as PacketDownloadClient,{neutralRestricted:true})
}
export async function authoritativeFulfillmentKind(id:string):Promise<string|null>{
  const rows=await prisma.$queryRaw<Array<{kind:string}>>(Prisma.sql`SELECT "kind" FROM "ot_fulfillment_kind_authority" WHERE "id"=${id}`);return rows[0]?.kind??null
}
export async function authoritativeCapabilityKind(hash:string):Promise<string|null>{
  const rows=await prisma.$queryRaw<Array<{kind:string}>>(Prisma.sql`SELECT "kind" FROM "ot_packet_capability_kind_authority" WHERE "capability_hash"=${hash}`);return rows[0]?.kind??null
}
