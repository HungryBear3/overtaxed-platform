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
 * therefore visible before any use is claimed.
 *
 * The capability VALUE never reaches this module. Callers hash it first, and
 * only the digest is passed, queried, compared or held — so there is nothing
 * here that a log line, an error message or a stack trace could leak.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { t2PacketDownloadEnabled } from "@/lib/fulfillment/flag";
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

export interface PacketDownloadStore {
  issue(input: {
    capabilityHash: string;
    fulfillmentId: string;
    ttlSeconds: number;
    maxUses: number;
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
 * Transaction-start time as a strict RFC3339 UTC instant, rendered by the
 * database — never by a driver date mapping, which would silently apply the
 * server's local UTC offset and expire capabilities at the wrong moment.
 */
const TRUSTED_CLOCK_SQL = Prisma.sql`
  SELECT to_char(
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
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
): Promise<ContextRows> {
  const probe = await tx.$queryRaw<Array<{ sourceOrderId: string }>>(
    Prisma.sql`SELECT "source_order_id" AS "sourceOrderId"
               FROM "ot_packet_download_capability"
               WHERE "capability_hash" = ${capabilityHash}`,
  );
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

  const orders = await tx.$queryRaw<PacketDownloadOrderRow[]>(
    Prisma.sql`SELECT ${ORDER_COLUMNS} FROM "ot_order" WHERE "id" = ${orderId} FOR UPDATE`,
  );

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
                     AND "version" = ${capability.artifactVersion}`,
      )
    : [];

  // Read AFTER every row and BEFORE any write, so one consistent instant governs
  // the whole decision and the update that may follow.
  const clock = await tx.$queryRaw<Array<{ now: unknown }>>(TRUSTED_CLOCK_SQL);

  return {
    capability,
    order: orders[0] ?? null,
    fulfillment: fulfillments[0] ?? null,
    artifact: artifacts[0] ?? null,
    trustedNow: toInstant(clock[0]?.now),
  };
}

export function createPrismaPacketDownloadStore(
  client: PacketDownloadClient,
): PacketDownloadStore {
  return {
    async issue(input) {
      // Defence in depth: a disabled deployment opens no database boundary.
      if (!t2PacketDownloadEnabled(process.env))
        return { ok: false, blocker: "FLAG_DISABLED" };

      return client.$transaction(async (tx): Promise<IssueCapabilityOutcome> => {
        const fulfillments = await tx.$queryRaw<PacketDownloadFulfillmentRow[]>(
          Prisma.sql`SELECT ${FULFILLMENT_COLUMNS} FROM "ot_fulfillment"
                     WHERE "id" = ${input.fulfillmentId}`,
        );
        const fulfillment = fulfillments[0] ?? null;
        if (!fulfillment) return { ok: false, blocker: "FULFILLMENT_NOT_FOUND" };

        const orders = await tx.$queryRaw<PacketDownloadOrderRow[]>(
          Prisma.sql`SELECT ${ORDER_COLUMNS} FROM "ot_order"
                     WHERE "id" = ${fulfillment.orderId} FOR UPDATE`,
        );

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
        return {
          ok: true,
          capabilityId: id,
          artifactId: capability.artifactId,
          artifactSha256: capability.artifactSha256,
          expiresAt: capability.expiresAt,
          maxUses: capability.maxUses,
        };
      });
    },

    async authorize(input) {
      if (!t2PacketDownloadEnabled(process.env))
        return { ok: false, blocker: "FLAG_DISABLED" };

      try {
        return await client.$transaction(
          async (tx): Promise<AuthorizeDownloadOutcome> => {
            const context = await loadContext(tx, input.capabilityHash);
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
        const context = await loadContext(tx, input.capabilityHash);
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
