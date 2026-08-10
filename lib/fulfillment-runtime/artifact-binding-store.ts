/**
 * OT T2 delivery-evidence Phase 2 Slice 2 — transactional artifact binding.
 *
 * This is the ONLY module in the slice that writes. It binds an already-decided
 * artifact identity to an existing eligible T2 fulfillment summary.
 *
 * It never sends email, never calls a provider, never mutates Stripe or order
 * settlement state, never deletes or overwrites prior evidence, and never
 * backfills history. On any ambiguity it fails closed with a bounded code.
 *
 * Concurrency contract:
 *   - lock the authoritative parent `ot_order` row FOR UPDATE. Every binder for
 *     a given order serializes on that lock, so the read-then-create below is
 *     race-free without relying on catching a constraint violation;
 *   - re-verify eligibility INSIDE the lock against freshly read state, so a
 *     concurrent refund/dispute that wins the lock is visible before evidence
 *     can be made;
 *   - read any existing artifact first: identical in every durable dimension is
 *     an idempotent no-op, anything different is a stable conflict;
 *   - only then create.
 *
 * Deliberately NOT "create, catch P2002, re-read": in PostgreSQL a failed
 * statement poisons the surrounding transaction, so the recovery read would
 * itself fail. The unique indexes remain as a backstop, and a constraint
 * violation is allowed to propagate so the transaction rolls back.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { t2ArtifactBindingEnabled } from "@/lib/fulfillment/flag";
import {
  decideArtifactBinding,
  isIdenticalBinding,
  SLICE2_ARTIFACT_VERSION,
  type ArtifactBindingBlocker,
  type ArtifactBindingInput,
  type BoundArtifactIdentity,
} from "@/lib/fulfillment/artifact-binding";

export type ArtifactBindingOutcome =
  | { ok: true; created: boolean; artifactId: string; artifactSha256: string }
  | { ok: false; blocker: ArtifactBindingBlocker };

/**
 * Note what is NOT here: there is no `flagEnabled`. Activation is not something a
 * caller — least of all request-shaped data — gets to assert. The gate is owned by
 * the orchestration seam and re-checked by this store's own injected evaluator.
 */
export type BindArtifactCommand = {
  orderId: string;
  fulfillmentId: string;
  bytes: Buffer;
  provenance: ArtifactBindingInput["provenance"];
  storageLocator: string;
  assertedSha256?: string;
};

// `ot_order` is one of the tables that kept camelCase physical column names, so
// these identifiers must stay quoted exactly as they appear in the database.
type OrderRow = {
  id: string;
  tier: string;
  status: string;
  propertyPin: string | null;
  propertyAddress: string | null;
};

type FulfillmentRow = {
  id: string;
  orderId: string;
  kind: string;
  status: string;
  statusRevision: number;
};

type ArtifactRow = {
  id: string;
  artifactSha256: string;
  byteSize: number;
  storageLocator: string;
  generatorVersion: string;
  templateVersion: string | null;
  sourceOrderId: string | null;
  propertyBindingFingerprint: string | null;
  generatedAt: Date | null;
};

const ARTIFACT_SELECT = {
  id: true,
  artifactSha256: true,
  byteSize: true,
  storageLocator: true,
  generatorVersion: true,
  templateVersion: true,
  sourceOrderId: true,
  propertyBindingFingerprint: true,
  generatedAt: true,
} as const;

/**
 * The clock is formatted to canonical UTC text by PostgreSQL itself (see
 * TRUSTED_CLOCK_SQL) precisely so no driver date mapping sits between the
 * database and the comparison.
 *
 * This matters: reading `CURRENT_TIMESTAMP` as a mapped `Date` returns a value
 * built from the server's LOCAL wall-clock reading, which `toISOString()` then
 * labels as UTC — a silent skew equal to the server's UTC offset. That clock
 * would wrongly refuse legitimate bindings generated within the offset window.
 *
 * So: accept a string and nothing else. Anything unusable becomes "", which the
 * pure layer refuses as `UNTRUSTED_CLOCK` — never a fallback to a local clock.
 */
function toInstant(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Transaction-start time as a strict RFC3339 UTC instant, rendered by the
 * database. `AT TIME ZONE 'UTC'` normalizes away the session TimeZone setting,
 * and `.MS` gives the exact 3-digit millisecond form the strict parser expects.
 */
const TRUSTED_CLOCK_SQL = Prisma.sql`
  SELECT to_char(
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "now"
`;

/** Internal signal: unwind (and roll back) the transaction with a bounded code. */
class BindingRefusal extends Error {
  constructor(readonly blocker: ArtifactBindingBlocker) {
    super(blocker);
    this.name = "BindingRefusal";
  }
}

type TransactionLike = {
  $queryRaw<T>(query: unknown): Promise<T>;
  oTFulfillment: {
    findUnique(input: unknown): Promise<FulfillmentRow | null>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  oTFulfillmentArtifact: {
    create(input: unknown): Promise<ArtifactRow>;
    findUnique(input: unknown): Promise<ArtifactRow | null>;
  };
};

type ClientLike = {
  $transaction<T>(work: (tx: TransactionLike) => Promise<T>): Promise<T>;
};

export function createPrismaArtifactBindingStore(
  client: ClientLike,
  deps: {
    /**
     * Injected so tests can enable the store without setting a real environment
     * variable, and so activation is a construction-time dependency rather than
     * anything a command can carry. Defaults to the strict default-off gate.
     */
    isBindingEnabled?: () => boolean;
  } = {},
) {
  const isBindingEnabled =
    deps.isBindingEnabled ?? (() => t2ArtifactBindingEnabled(process.env));

  return {
    async bind(command: BindArtifactCommand): Promise<ArtifactBindingOutcome> {
      // Defence in depth: the orchestration seam already refused if disabled.
      // A disabled deployment does zero work and opens zero transactions.
      const flagEnabled = isBindingEnabled() === true;
      if (!flagEnabled) return { ok: false, blocker: "FLAG_DISABLED" };

      try {
        return await client.$transaction(async (tx) => {
          // Authoritative parent lock. Settlement is READ here, never written.
          const orders = await tx.$queryRaw<OrderRow[]>(
            Prisma.sql`SELECT "id", "tier", "status", "propertyPin", "propertyAddress"
                       FROM "ot_order" WHERE "id" = ${command.orderId} FOR UPDATE`,
          );
          const orderRow = orders[0];

          const fulfillment = orderRow
            ? await tx.oTFulfillment.findUnique({
                where: { id: command.fulfillmentId },
                select: {
                  id: true,
                  orderId: true,
                  kind: true,
                  status: true,
                  statusRevision: true,
                },
              })
            : null;

          // Read-before-write, safe because we hold the parent order lock.
          // This happens BEFORE the decision because whether a row already
          // exists changes which gates apply: a replay must not be judged
          // against the bindable-status gate that its own first pass consumed.
          const existing = fulfillment
            ? await tx.oTFulfillmentArtifact.findUnique({
                where: {
                  fulfillmentId_version: {
                    fulfillmentId: fulfillment.id,
                    version: SLICE2_ARTIFACT_VERSION,
                  },
                },
                select: ARTIFACT_SELECT,
              })
            : null;

          // Authoritative clock, read on the transaction handle AFTER the
          // order/fulfillment/existing reads and BEFORE any write. PostgreSQL
          // `CURRENT_TIMESTAMP` is transaction-start time, so every gate below
          // and the insert that may follow share one consistent instant that no
          // caller can influence.
          const clock =
            await tx.$queryRaw<Array<{ now: unknown }>>(TRUSTED_CLOCK_SQL);
          const trustedNow = toInstant(clock[0]?.now);

          // Re-run the full pure decision inside the lock against freshly read
          // state. The caller's view of the world is never trusted.
          const decision = decideArtifactBinding({
            flagEnabled,
            trustedNow,
            bytes: command.bytes,
            existingBinding: existing !== null,
            order: orderRow
              ? {
                  id: orderRow.id,
                  tier: orderRow.tier,
                  status: orderRow.status,
                  propertyPin: orderRow.propertyPin,
                  propertyAddress: orderRow.propertyAddress,
                }
              : null,
            fulfillment,
            provenance: command.provenance,
            storageLocator: command.storageLocator,
            assertedSha256: command.assertedSha256,
          });

          if (!decision.ok) throw new BindingRefusal(decision.blocker);
          const identity = decision.artifact;

          if (existing) {
            // A REPLAY decision authorizes no write whatsoever. The lifecycle
            // allowlist already refused every status but ARTIFACT_READY.
            if (decision.mode !== "REPLAY")
              throw new BindingRefusal("ARTIFACT_BINDING_CONFLICT");
            // Immutable evidence: identical => idempotent success; any
            // difference in bytes, provenance, or locator => stable conflict.
            if (!isIdenticalBinding(existing, identity))
              throw new BindingRefusal("ARTIFACT_BINDING_CONFLICT");
            return {
              ok: true as const,
              created: false,
              artifactId: existing.id,
              artifactSha256: existing.artifactSha256,
            };
          }

          // Symmetrically, only a CREATE decision may insert.
          if (decision.mode !== "CREATE")
            throw new BindingRefusal("ARTIFACT_BINDING_CONFLICT");

          const created = await tx.oTFulfillmentArtifact.create({
            data: {
              fulfillmentId: identity.fulfillmentId,
              version: identity.version,
              artifactSha256: identity.artifactSha256,
              byteSize: identity.byteSize,
              storageLocator: identity.storageLocator,
              generatorVersion: identity.generatorVersion,
              templateVersion: identity.templateVersion,
              sourceOrderId: identity.sourceOrderId,
              propertyBindingFingerprint: identity.propertyBindingFingerprint,
              generatedAt: new Date(identity.generatedAt),
              // Explicit, and NOT the column's `DEFAULT CURRENT_TIMESTAMP`:
              // Prisma resolves `@default(now())` client-side, so omitting this
              // field silently sources it from the Node process clock — a
              // SECOND clock, independent of the one `trustedNow` came from and
              // the one every gate above was judged against.
              //
              // That split is not theoretical. `generatedAt <= trustedNow` is
              // checked against PostgreSQL transaction time, while the read
              // model's `generatedAt <= createdAt` would then be evaluated
              // against the application clock. Whenever the application clock
              // lags, a legitimately past `generatedAt` passes the write gate
              // and is persisted already tainted.
              //
              // `trustedNow` is canonical UTC text rendered by the database
              // (TRUSTED_CLOCK_SQL) and was proven parseable by the pure layer
              // before we got here, so one instant governs the whole decision
              // and the row it produces.
              createdAt: new Date(trustedNow),
            },
            select: ARTIFACT_SELECT,
          });

          // Advance the summary only from the exact revision we decided
          // against. A concurrent transition invalidates this binding rather
          // than clobbering it.
          const advanced = await tx.oTFulfillment.updateMany({
            where: {
              id: identity.fulfillmentId,
              status: "ARTIFACT_PENDING",
              statusRevision: decision.expectedStatusRevision,
            },
            data: {
              status: "ARTIFACT_READY",
              statusRevision: decision.expectedStatusRevision + 1,
            },
          });
          if (advanced.count !== 1)
            throw new BindingRefusal("ARTIFACT_BINDING_CONFLICT");

          return {
            ok: true as const,
            created: true,
            artifactId: created.id,
            artifactSha256: created.artifactSha256,
          };
        });
      } catch (error) {
        // Refusals unwound the transaction, so nothing was written.
        if (error instanceof BindingRefusal)
          return { ok: false, blocker: error.blocker };
        throw error;
      }
    },
  };
}

export type ArtifactBindingStore = ReturnType<
  typeof createPrismaArtifactBindingStore
>;

export const prismaArtifactBindingStore = createPrismaArtifactBindingStore(
  prisma as unknown as ClientLike,
);

export type { BoundArtifactIdentity };
