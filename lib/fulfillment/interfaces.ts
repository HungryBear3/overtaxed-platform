/**
 * OT T2 delivery-evidence foundation — stable Phase-2 interfaces (TYPES ONLY).
 *
 * These narrow the seams a later phase will implement (generation, private
 * storage, transactional delivery, provider-event normalization, leased worker
 * claim, admin retry/regenerate, private download token). Phase 1 deliberately
 * ships NO implementation behind any of them — importing this module executes no
 * code and touches nothing. Results are content-addressed and payload-free; no
 * shape here carries a public bearer URL, raw bytes, raw provider payload, or PII.
 */
import type {
  OTDeliveryEventType,
  OTFulfillmentKind,
  OTFulfillmentStatus,
} from "@/lib/fulfillment/types";
import type { FulfillmentIdempotencyPurpose } from "@/lib/fulfillment/idempotency";
import type { PrivateStorageLocator } from "@/lib/fulfillment/validation";

/** Result of generating an artifact — identity only, never the raw bytes. */
export interface ArtifactGeneratorResult {
  ok: boolean;
  artifactSha256?: string;
  byteSize?: number;
  generatorVersion?: string;
  templateVersion?: string;
  reasonCode?: string;
}

/**
 * Result of persisting an artifact to private storage — a validated private,
 * opaque, relative locator only (branded via isValidPrivateStorageLocator). The
 * brand makes a public/signed/bearer URL unassignable here at the type level, and
 * the runtime validator enforces the same contract behaviorally.
 */
export interface PrivateArtifactStorageResult {
  ok: boolean;
  storageLocator?: PrivateStorageLocator;
  reasonCode?: string;
}

/** Result of a transactional delivery send — opaque provider identity only. */
export interface TransactionalDeliveryAdapterResult {
  ok: boolean;
  provider?: string;
  providerMessageId?: string;
  reasonCode?: string;
}

/** A provider webhook normalized to the payload-free event vocabulary. */
export interface ProviderEventNormalization {
  provider: string;
  providerEventId: string;
  eventType: OTDeliveryEventType;
  sequence: number;
  occurredAt: string;
  reasonCode?: string;
}

/** A bounded worker claim over a fulfillment lease. */
export interface LeasedWorkerClaim {
  fulfillmentId: string;
  kind: OTFulfillmentKind;
  leaseOwner: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

/** A modeled admin retry/regenerate command (not executed in Phase 1). */
export interface AdminRetryCommand {
  fulfillmentId: string;
  action: "RETRY_DELIVERY" | "REGENERATE_ARTIFACT";
  purpose: FulfillmentIdempotencyPurpose;
  requestedBy: string;
  expectedStatus: OTFulfillmentStatus;
}

/** A private, time-bounded download token service (interface only). */
export interface PrivateDownloadTokenService {
  issue(input: {
    fulfillmentId: string;
    artifactSha256: string;
    ttlSeconds: number;
  }): Promise<{ token: string; expiresAt: string }>;
  verify(
    token: string,
  ): Promise<{ ok: boolean; fulfillmentId?: string; artifactSha256?: string }>;
}
