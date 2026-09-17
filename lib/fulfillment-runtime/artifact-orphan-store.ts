/**
 * Durable, idempotent quarantine recording for unbound T2 artifact content.
 *
 * This replaces the HOLD placeholder that used to throw. The placeholder was
 * honest about one thing — inline deletion is unsafe — but it left the most
 * important fact unwritten: that bytes may be sitting in private storage with
 * nothing pointing at them.
 *
 * What this module does: write that fact down, exactly once per
 * (fulfillment, locator, expected digest), and nothing else.
 *
 * What it deliberately does NOT do, in any branch:
 *   - delete, overwrite, or rewrite a storage object. The content address may
 *     already be bound by a different fulfillment, so deletion here could
 *     destroy immutable evidence belonging to someone else. Ambiguity preserves
 *     the artifact. A future garbage collector must coordinate atomically with
 *     the binding registry, re-check every reference at deletion time, and
 *     preserve on ambiguity; this table is its input, not its authority;
 *   - re-check the activation flag. That is not an oversight. One of the exact
 *     situations that produces an orphan is activation being withdrawn mid-flight
 *     — refusing to record then would guarantee the orphan goes unrecorded
 *     precisely when it is most likely to exist. Recording is a safety note, not
 *     a feature, and it writes to a table nothing else reads.
 *
 * Idempotency is done in PostgreSQL, not by read-then-write: a single
 * `ON CONFLICT DO UPDATE` cannot lose a race with a concurrent recorder.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  decideArtifactOrphanRecord,
  type ArtifactOrphanBlocker,
  type ArtifactOrphanReasonCode,
  type ArtifactOrphanUploadOutcome,
} from "@/lib/fulfillment/artifact-orphan";

export type RecordArtifactOrphanCommand = {
  fulfillmentId: string;
  sourceOrderId: string;
  storageLocator: string;
  artifactSha256: string;
  uploadOutcome: ArtifactOrphanUploadOutcome;
  reasonCode: ArtifactOrphanReasonCode;
};

export type RecordArtifactOrphanOutcome =
  | {
      ok: true;
      created: boolean;
      observationCount: number;
      uploadOutcome: string;
    }
  | { ok: false; blocker: ArtifactOrphanBlocker };

/**
 * Transaction-start time as a strict RFC3339 UTC instant, rendered by the
 * database. Identical in form and reasoning to the binder's clock: a driver date
 * mapping would silently apply the server's local UTC offset, and the pure layer
 * refuses anything it cannot parse rather than falling back to a process clock.
 */
const TRUSTED_CLOCK_SQL = Prisma.sql`
  SELECT to_char(
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "now"
`;

type QuarantineRow = {
  id: string;
  observationCount: number;
  uploadOutcome: string;
};

/**
 * The narrow slice of the Prisma client this store uses. Exported so a test can
 * build a correctly typed fake instead of casting a whole client.
 */
export type ArtifactOrphanStoreClient = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
};

export interface ArtifactOrphanStore {
  record(
    command: RecordArtifactOrphanCommand,
  ): Promise<RecordArtifactOrphanOutcome>;
}

export function createPrismaArtifactOrphanStore(
  client: ArtifactOrphanStoreClient,
): ArtifactOrphanStore {
  return {
    async record(command) {
      const clock = await client.$queryRaw<Array<{ now: unknown }>>(
        TRUSTED_CLOCK_SQL,
      );
      const rawNow = clock[0]?.now;
      const observedAt = typeof rawNow === "string" ? rawNow : "";

      const decision = decideArtifactOrphanRecord({
        fulfillmentId: command.fulfillmentId,
        sourceOrderId: command.sourceOrderId,
        storageLocator: command.storageLocator,
        artifactSha256: command.artifactSha256,
        uploadOutcome: command.uploadOutcome,
        reasonCode: command.reasonCode,
        observedAt,
      });
      if (!decision.ok) return { ok: false, blocker: decision.blocker };
      const record = decision.record;
      const observed = new Date(record.observedAt);

      // One statement, so a concurrent recorder cannot interleave between a read
      // and a write. The row id is generated here because `@default(cuid())` is
      // resolved by the Prisma client, not by a column default, and this is a
      // raw insert.
      //
      // The conflict branch is append-only in spirit: it never clears a field.
      //   - `first_reason_code` / `first_observed_at` are left untouched, so the
      //     original observation survives every later one;
      //   - `last_observed_at` takes the GREATEST of the two, so an out-of-order
      //     or clock-skewed observation cannot move the record backwards;
      //   - `upload_outcome` folds monotonically towards certainty: once storage
      //     has CONFIRMED an object exists, a later ambiguous observation must
      //     never downgrade that to UNKNOWN.
      const rows = await client.$queryRaw<QuarantineRow[]>(
        Prisma.sql`
          INSERT INTO "ot_artifact_orphan_quarantine" (
            "id", "storage_locator", "artifact_sha256", "fulfillment_id",
            "source_order_id", "upload_outcome", "first_reason_code",
            "last_reason_code", "observation_count", "first_observed_at",
            "last_observed_at"
          ) VALUES (
            ${randomUUID()}, ${record.storageLocator}, ${record.artifactSha256},
            ${record.fulfillmentId}, ${record.sourceOrderId},
            ${record.uploadOutcome}, ${record.reasonCode}, ${record.reasonCode},
            1, ${observed}, ${observed}
          )
          ON CONFLICT ("fulfillment_id", "storage_locator", "artifact_sha256")
          DO UPDATE SET
            "observation_count" = "ot_artifact_orphan_quarantine"."observation_count" + 1,
            "last_reason_code" = EXCLUDED."last_reason_code",
            "last_observed_at" = GREATEST(
              "ot_artifact_orphan_quarantine"."last_observed_at",
              EXCLUDED."last_observed_at"
            ),
            "upload_outcome" = CASE
              WHEN "ot_artifact_orphan_quarantine"."upload_outcome" = 'CONFIRMED'
              THEN 'CONFIRMED'
              ELSE EXCLUDED."upload_outcome"
            END
          RETURNING "id",
                    "observation_count" AS "observationCount",
                    "upload_outcome" AS "uploadOutcome"
        `,
      );

      const row = rows[0];
      // A write that returns nothing did not durably record anything, so the
      // caller must keep treating this as unreconciled.
      if (!row) throw new Error("OT_ARTIFACT_ORPHAN_NOT_RECORDED");
      return {
        ok: true,
        created: row.observationCount === 1,
        observationCount: row.observationCount,
        uploadOutcome: row.uploadOutcome,
      };
    },
  };
}

export const prismaArtifactOrphanStore = createPrismaArtifactOrphanStore(
  prisma as unknown as ArtifactOrphanStoreClient,
);
