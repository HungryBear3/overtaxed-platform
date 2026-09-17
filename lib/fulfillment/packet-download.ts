/**
 * OT T2 delivery-evidence — secure customer packet download (PURE decision layer).
 *
 * The problem this solves: an OT order is anonymous. `ot_order` has no `userId`,
 * and the email on it is an unverified checkout field. So there is no account to
 * authenticate and no ownership claim that can be trusted. (The legacy
 * `Invoice`-backed packet download is a different, account-owned product and is
 * unrelated to any of this.)
 *
 * The authorization is therefore a CAPABILITY: one opaque, high-entropy value
 * that is itself the proof. Rules that make that safe live here.
 *
 *   - The value is never stored. Only its SHA-256 is persisted, so a database
 *     read — by a backup, a log shipper, or an operator — yields nothing usable.
 *   - The value is never a URL. It is submitted in a POST body, so it cannot
 *     land in an access log, a `Referer` header, browser history, or a proxy
 *     cache. Nothing in this module or its callers builds a link containing it.
 *   - The capability is bound to an EXACT artifact (row id, version and content
 *     digest), to the authoritative order, and to the property binding in force
 *     when it was issued. A capability for one packet can never serve another.
 *   - Possession is necessary but never sufficient. Every gate below is re-run
 *     against freshly read authoritative state on every single use, so a refund,
 *     dispute, cancellation, terminal delivery outcome, or property drift
 *     revokes access immediately without anyone having to remember to revoke it.
 *
 * Pure: no database, no storage, no clock, no framework. Every refusal is a
 * bounded, stable, non-PII code and no input is echoed back.
 */
import { createHash } from "node:crypto";
import {
  classifyPropertyBinding,
  SLICE2_ARTIFACT_VERSION,
} from "@/lib/fulfillment/artifact-binding";
import { contentAddressedT2ArtifactLocator } from "@/lib/fulfillment/artifact-digest";
import { neutralCustomerZipLocator } from "@/lib/fulfillment/neutral-customer-zip";
import {
  isBoundedOpaqueString,
  isPgIntInRange,
  isValidArtifactSha256,
  isValidByteSize,
  isValidPrivateStorageLocator,
  parseStrictInstant,
  PG_INT_MAX,
} from "@/lib/fulfillment/validation";
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types";

/** 256 bits of entropy, base64url-encoded without padding. */
export const PACKET_DOWNLOAD_CAPABILITY_BYTES = 32;
export const PACKET_DOWNLOAD_CAPABILITY_LENGTH = 43;

// Exactly the unpadded base64url alphabet at exactly the length 32 random bytes
// produce. Anything else — padding, whitespace, a truncation, a hex digest
// someone read out of the database — is rejected before it is ever hashed.
const CAPABILITY_VALUE = /^[A-Za-z0-9_-]{43}$/;

/** Bounds on a capability's durable lifetime, enforced at issuance. */
export const MIN_CAPABILITY_TTL_SECONDS = 60;
export const MAX_CAPABILITY_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MIN_CAPABILITY_MAX_USES = 1;
export const MAX_CAPABILITY_MAX_USES = 1000;

/**
 * Fulfillment statuses from which a customer may download.
 *
 * Post-artifact and non-terminal, and nothing else. Every TERMINAL_LOCK status
 * (BOUNCED, COMPLAINED, CANCELLED, FAILED, INELIGIBLE) is absent by
 * construction, so a terminal outcome can never be resurrected into a live
 * download — including BOUNCED, where re-establishing customer access is
 * deliberately an operator decision (issue a fresh capability) rather than
 * something a held token silently keeps doing.
 */
export const DOWNLOADABLE_FULFILLMENT_STATUSES: ReadonlySet<string> =
  new Set<string>([
    "ARTIFACT_READY",
    "DELIVERY_PENDING",
    "PROVIDER_ACCEPTED",
    "DELAYED",
    "DELIVERED",
  ]);

/** Bounded, stable, non-PII refusal vocabulary. */
export type PacketDownloadBlocker =
  | "FLAG_DISABLED"
  | "INVALID_CAPABILITY"
  | "CAPABILITY_NOT_FOUND"
  | "CAPABILITY_REVOKED"
  | "CAPABILITY_EXPIRED"
  | "CAPABILITY_EXHAUSTED"
  /** The compare-and-set that claims one use lost to a concurrent writer. */
  | "CAPABILITY_USE_NOT_CLAIMED"
  | "CAPABILITY_BINDING_MISMATCH"
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_IDENTITY_MISMATCH"
  | "INVALID_STORAGE_LOCATOR"
  | "FULFILLMENT_NOT_FOUND"
  | "FULFILLMENT_NOT_DOWNLOADABLE"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_ELIGIBLE"
  | "PROPERTY_BINDING_UNVERIFIED"
  | "UNTRUSTED_CLOCK";

export const PACKET_DOWNLOAD_BLOCKERS: ReadonlySet<string> = new Set<string>([
  "FLAG_DISABLED",
  "INVALID_CAPABILITY",
  "CAPABILITY_NOT_FOUND",
  "CAPABILITY_REVOKED",
  "CAPABILITY_EXPIRED",
  "CAPABILITY_EXHAUSTED",
  "CAPABILITY_USE_NOT_CLAIMED",
  "CAPABILITY_BINDING_MISMATCH",
  "ARTIFACT_NOT_FOUND",
  "ARTIFACT_IDENTITY_MISMATCH",
  "INVALID_STORAGE_LOCATOR",
  "FULFILLMENT_NOT_FOUND",
  "FULFILLMENT_NOT_DOWNLOADABLE",
  "ORDER_NOT_FOUND",
  "ORDER_NOT_ELIGIBLE",
  "PROPERTY_BINDING_UNVERIFIED",
  "UNTRUSTED_CLOCK",
]);

/** Bounded, non-PII revocation vocabulary. Persisted, so it is a closed set. */
export type CapabilityRevocationReason =
  | "REFUNDED"
  | "DISPUTED"
  | "CANCELLED"
  | "SUPERSEDED"
  /**
   * The send this capability was minted for was DEFINITELY rejected by the
   * provider, so the value reached no mailbox and must not stay live. This is
   * distinct from SUPERSEDED (a newer capability replaced it) and from an
   * UNKNOWN send, which revokes nothing precisely because the mail may be in
   * flight and the holder may yet receive it.
   */
  | "SEND_REJECTED"
  /**
   * An authenticated provider event reported a terminal delivery outcome — a
   * bounce, a complaint, or a failure. The mail was sent; it did not land, or it
   * landed somewhere it was not wanted. Re-establishing access after this is an
   * operator decision (issue a fresh capability), never something a held value
   * quietly keeps doing.
   */
  | "UNDELIVERABLE"
  | "STORAGE_FAILURE"
  | "ADMIN_REVOKED";

export const CAPABILITY_REVOCATION_REASONS: ReadonlySet<string> =
  new Set<string>([
    "REFUNDED",
    "DISPUTED",
    "CANCELLED",
    "SUPERSEDED",
    "SEND_REJECTED",
    "UNDELIVERABLE",
    "STORAGE_FAILURE",
    "ADMIN_REVOKED",
  ]);

/**
 * True for a well-formed capability value.
 *
 * Shape only — it says nothing about whether the value authorizes anything.
 * Its job is to stop malformed input before it reaches a digest or a query.
 */
export function isValidPacketDownloadCapability(value: unknown): boolean {
  return typeof value === "string" && CAPABILITY_VALUE.test(value);
}

/**
 * The persistent lookup key for a capability value: a domain-separated SHA-256,
 * lowercase hex.
 *
 * Returns null rather than a digest for anything malformed, so a caller cannot
 * accidentally turn arbitrary input into a database lookup key. The `otpdl:v1:`
 * prefix keeps this digest namespace disjoint from artifact content digests and
 * property fingerprints, so a value from one namespace can never be replayed as
 * a value in another.
 */
export function hashPacketDownloadCapability(value: unknown): string | null {
  if (!isValidPacketDownloadCapability(value)) return null;
  return createHash("sha256")
    .update(`otpdl:v1:${value as string}`, "utf8")
    .digest("hex");
}

export type PacketDownloadCapabilityRow = {
  id: string;
  capabilityHash: string;
  fulfillmentId: string;
  artifactId: string;
  artifactVersion: number;
  artifactSha256: string;
  sourceOrderId: string;
  propertyBindingFingerprint: string;
  expiresAt: Date | string | null;
  maxUses: number;
  useCount: number;
  revokedAt: Date | string | null;
};

export type PacketDownloadArtifactRow = {
  id: string;
  fulfillmentId: string;
  version: number;
  artifactSha256: string;
  byteSize: number;
  storageLocator: string;
  sourceOrderId: string | null;
  propertyBindingFingerprint: string | null;
};

export type PacketDownloadFulfillmentRow = {
  id: string;
  orderId: string;
  kind: string;
  status: OTFulfillmentStatus | string;
  /** Required only for NEUTRAL_RECORDS_REPORT; read from the durable QA join. */
  neutralQaApproved?: boolean;
};

export type PacketDownloadOrderRow = {
  id: string;
  tier: string;
  status: string;
  propertyPin: string | null;
  propertyAddress: string | null;
  /**
   * Optional because `ot_order` has no such columns: on that table a refund or a
   * dispute shows up as a non-`PAID` `status`, which is what actually ends
   * access. These two exist so a caller with a settlement source that DOES
   * distinguish them can refuse on them explicitly; absent means "not stated",
   * never "not refunded".
   */
  refunded?: boolean;
  disputed?: boolean;
};

export type PacketDownloadInput = {
  flagEnabled: boolean;
  /** Store-owned transaction time as a strict RFC3339 UTC instant. */
  trustedNow: string;
  /**
   * The digest of the SUBMITTED value, recomputed by the store. The raw value
   * never enters this module: there is nothing here that could leak it.
   */
  capabilityHash: string;
  capability: PacketDownloadCapabilityRow | null;
  artifact: PacketDownloadArtifactRow | null;
  fulfillment: PacketDownloadFulfillmentRow | null;
  order: PacketDownloadOrderRow | null;
};

/** What an authorized download may read. Payload-free; carries no PII. */
export type PacketDownloadGrant = {
  capabilityId: string;
  fulfillmentId: string;
  orderId: string;
  artifactId: string;
  artifactVersion: number;
  artifactSha256: string;
  storageLocator: string;
  byteSize: number;
  /** The count the use must be claimed from — a compare-and-set precondition. */
  expectedUseCount: number;
  nextUseCount: number;
};

export type PacketDownloadDecision =
  | { ok: true; grant: PacketDownloadGrant }
  | { ok: false; blocker: PacketDownloadBlocker };

function refuse(blocker: PacketDownloadBlocker): PacketDownloadDecision {
  return { ok: false, blocker };
}

function instant(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return parseStrictInstant(value);
}

function presentString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function expectedDownloadLocator(
  fulfillment: PacketDownloadFulfillmentRow,
  artifactSha256: string,
): string {
  return fulfillment.kind === "NEUTRAL_RECORDS_REPORT"
    ? neutralCustomerZipLocator(artifactSha256)
    : contentAddressedT2ArtifactLocator(artifactSha256);
}

/**
 * Decide whether this capability, as it stands right now, authorizes reading
 * these exact artifact bytes.
 *
 * Gate order is deliberate: the cheapest checks that reveal nothing run first,
 * the capability's own lifecycle before anything about the order, and the
 * authoritative settlement/lifecycle re-read last — so the expensive truth is
 * only consulted for a capability that is otherwise live.
 */
export function decidePacketDownload(
  input: PacketDownloadInput,
): PacketDownloadDecision {
  // 1. Activation. A disabled deployment authorizes nothing, ever.
  if (input.flagEnabled !== true) return refuse("FLAG_DISABLED");

  // 2. The lookup key must itself be a well-formed digest. A store that handed
  //    us anything else did not look up what we think it did.
  if (!isValidArtifactSha256(input.capabilityHash))
    return refuse("INVALID_CAPABILITY");

  const capability = input.capability;
  if (!capability) return refuse("CAPABILITY_NOT_FOUND");
  // Defence in depth: the row must be the row we asked for.
  if (capability.capabilityHash !== input.capabilityHash)
    return refuse("CAPABILITY_NOT_FOUND");

  // 3. A clock we cannot trust cannot expire anything, so nothing is authorized.
  const nowMs = parseStrictInstant(input.trustedNow);
  if (nowMs === null) return refuse("UNTRUSTED_CLOCK");

  // 4. Capability lifecycle. Revocation is checked before expiry so a revoked
  //    capability always reports as revoked, whatever its expiry says.
  if (capability.revokedAt !== null && capability.revokedAt !== undefined)
    return refuse("CAPABILITY_REVOKED");
  const expiresMs = instant(capability.expiresAt);
  // An unparseable expiry is not an unlimited one.
  if (expiresMs === null) return refuse("CAPABILITY_EXPIRED");
  if (expiresMs <= nowMs) return refuse("CAPABILITY_EXPIRED");

  // 5. Use budget. Counters must be schema-safe before they can be compared or
  //    incremented; the next value must also remain storable.
  if (
    !isPgIntInRange(
      capability.maxUses,
      MIN_CAPABILITY_MAX_USES,
      MAX_CAPABILITY_MAX_USES,
    )
  ) {
    return refuse("INVALID_CAPABILITY");
  }
  if (!isPgIntInRange(capability.useCount, 0, PG_INT_MAX - 1))
    return refuse("INVALID_CAPABILITY");
  if (capability.useCount >= capability.maxUses)
    return refuse("CAPABILITY_EXHAUSTED");

  // 6. Both sides of the fulfillment binding must exist and agree.
  const fulfillment = input.fulfillment;
  if (!fulfillment) return refuse("FULFILLMENT_NOT_FOUND");
  if (fulfillment.id !== capability.fulfillmentId)
    return refuse("CAPABILITY_BINDING_MISMATCH");
  if (fulfillment.kind !== "T2_APPEAL_EVIDENCE" &&
      !(fulfillment.kind === "NEUTRAL_RECORDS_REPORT" && fulfillment.neutralQaApproved === true))
    return refuse("CAPABILITY_BINDING_MISMATCH");
  if(fulfillment.kind==="NEUTRAL_RECORDS_REPORT"&&capability.maxUses!==1)return refuse("INVALID_CAPABILITY");

  const order = input.order;
  if (!order) return refuse("ORDER_NOT_FOUND");
  if (fulfillment.orderId !== order.id)
    return refuse("CAPABILITY_BINDING_MISMATCH");
  // The capability names its order directly, so a re-parented fulfillment can
  // never quietly carry a capability to a different order.
  if (capability.sourceOrderId !== order.id)
    return refuse("CAPABILITY_BINDING_MISMATCH");

  // 7. Exact artifact identity: the row id, its version, and its content digest
  //    must all be the ones this capability was minted against.
  const artifact = input.artifact;
  if (!artifact) return refuse("ARTIFACT_NOT_FOUND");
  if (artifact.id !== capability.artifactId)
    return refuse("ARTIFACT_IDENTITY_MISMATCH");
  if (artifact.fulfillmentId !== capability.fulfillmentId)
    return refuse("ARTIFACT_IDENTITY_MISMATCH");
  if (artifact.version !== capability.artifactVersion)
    return refuse("ARTIFACT_IDENTITY_MISMATCH");
  if (!isValidArtifactSha256(artifact.artifactSha256))
    return refuse("ARTIFACT_IDENTITY_MISMATCH");
  if (artifact.artifactSha256 !== capability.artifactSha256)
    return refuse("ARTIFACT_IDENTITY_MISMATCH");
  if (artifact.sourceOrderId !== order.id)
    return refuse("ARTIFACT_IDENTITY_MISMATCH");
  if (!isValidByteSize(artifact.byteSize))
    return refuse("ARTIFACT_IDENTITY_MISMATCH");

  // 8. The locator must be the private content address of that exact digest —
  //    never a public bearer URL, and never an operator-editable path that
  //    could point this route at unrelated bytes.
  if (!isValidPrivateStorageLocator(artifact.storageLocator))
    return refuse("INVALID_STORAGE_LOCATOR");
  if (
    artifact.storageLocator !==
    expectedDownloadLocator(fulfillment, artifact.artifactSha256)
  ) {
    return refuse("INVALID_STORAGE_LOCATOR");
  }

  // 9. Authoritative settlement, read fresh. Any non-PAID status — which is how
  //    a refund, dispute or cancellation presents on `ot_order` — ends access
  //    with no revocation step required. The two explicit flags are belt and
  //    braces for a caller whose settlement source states them separately.
  if (String(order.tier ?? "").trim() !== "T2")
    return refuse("ORDER_NOT_ELIGIBLE");
  if (order.refunded === true || order.disputed === true)
    return refuse("ORDER_NOT_ELIGIBLE");
  if (String(order.status ?? "").trim() !== "PAID")
    return refuse("ORDER_NOT_ELIGIBLE");

  // 10. Lifecycle allowlist — terminal states are absent, so none can be
  //     resurrected by a surviving capability.
  if (!DOWNLOADABLE_FULFILLMENT_STATUSES.has(String(fulfillment.status)))
    return refuse("FULFILLMENT_NOT_DOWNLOADABLE");

  // 11. Property binding. The packet must still describe the order's property,
  //     and the capability must have been minted against that same binding.
  if (!presentString(artifact.propertyBindingFingerprint))
    return refuse("PROPERTY_BINDING_UNVERIFIED");
  if (capability.propertyBindingFingerprint !== artifact.propertyBindingFingerprint)
    return refuse("PROPERTY_BINDING_UNVERIFIED");
  const binding = classifyPropertyBinding({
    storedFingerprint: artifact.propertyBindingFingerprint,
    orderId: order.id,
    propertyPin: order.propertyPin,
    propertyAddress: order.propertyAddress,
  });
  // Only an affirmative match authorizes a customer download. ABSENT — fine for
  // a legacy read model — is not fine here: it means we cannot show that these
  // bytes describe this order's property.
  if (binding !== "MATCHES") return refuse("PROPERTY_BINDING_UNVERIFIED");

  return {
    ok: true,
    grant: {
      capabilityId: capability.id,
      fulfillmentId: fulfillment.id,
      orderId: order.id,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      artifactSha256: artifact.artifactSha256,
      storageLocator: artifact.storageLocator,
      byteSize: artifact.byteSize,
      expectedUseCount: capability.useCount,
      nextUseCount: capability.useCount + 1,
    },
  };
}

export type CapabilityIssuanceInput = {
  flagEnabled: boolean;
  trustedNow: string;
  capabilityHash: string;
  ttlSeconds: number;
  maxUses: number;
  artifact: PacketDownloadArtifactRow | null;
  fulfillment: PacketDownloadFulfillmentRow | null;
  order: PacketDownloadOrderRow | null;
};

/** The exact durable capability row to insert. Never contains the value. */
export type CapabilityIssuance = {
  capabilityHash: string;
  fulfillmentId: string;
  artifactId: string;
  artifactVersion: number;
  artifactSha256: string;
  sourceOrderId: string;
  propertyBindingFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  maxUses: number;
};

export type CapabilityIssuanceDecision =
  | { ok: true; capability: CapabilityIssuance }
  | { ok: false; blocker: PacketDownloadBlocker };

/**
 * Decide whether a capability may be minted for this artifact.
 *
 * Every gate a download must pass also applies here, because issuing a
 * capability that could never be used is a lie to whoever holds it. The one
 * addition is a bounded lifetime: an unbounded or absurd TTL is refused rather
 * than clamped, so a caller's mistake cannot silently become a long-lived grant.
 */
export function decideCapabilityIssuance(
  input: CapabilityIssuanceInput,
): CapabilityIssuanceDecision {
  if (input.flagEnabled !== true) return { ok: false, blocker: "FLAG_DISABLED" };
  if (!isValidArtifactSha256(input.capabilityHash))
    return { ok: false, blocker: "INVALID_CAPABILITY" };
  if (
    !isPgIntInRange(
      input.ttlSeconds,
      MIN_CAPABILITY_TTL_SECONDS,
      MAX_CAPABILITY_TTL_SECONDS,
    )
  ) {
    return { ok: false, blocker: "INVALID_CAPABILITY" };
  }
  if (
    !isPgIntInRange(
      input.maxUses,
      MIN_CAPABILITY_MAX_USES,
      MAX_CAPABILITY_MAX_USES,
    )
  ) {
    return { ok: false, blocker: "INVALID_CAPABILITY" };
  }

  const nowMs = parseStrictInstant(input.trustedNow);
  if (nowMs === null) return { ok: false, blocker: "UNTRUSTED_CLOCK" };

  const fulfillment = input.fulfillment;
  if (!fulfillment) return { ok: false, blocker: "FULFILLMENT_NOT_FOUND" };
  if (fulfillment.kind !== "T2_APPEAL_EVIDENCE" &&
      !(fulfillment.kind === "NEUTRAL_RECORDS_REPORT" && fulfillment.neutralQaApproved === true))
    return { ok: false, blocker: "CAPABILITY_BINDING_MISMATCH" };
  if(fulfillment.kind==="NEUTRAL_RECORDS_REPORT"&&input.maxUses!==1)return {ok:false,blocker:"INVALID_CAPABILITY"};
  const order = input.order;
  if (!order) return { ok: false, blocker: "ORDER_NOT_FOUND" };
  if (fulfillment.orderId !== order.id)
    return { ok: false, blocker: "CAPABILITY_BINDING_MISMATCH" };

  const artifact = input.artifact;
  if (!artifact) return { ok: false, blocker: "ARTIFACT_NOT_FOUND" };
  if (!isBoundedOpaqueString(artifact.id, 128))
    return { ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" };
  if (artifact.fulfillmentId !== fulfillment.id)
    return { ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" };
  if (!isPgIntInRange(artifact.version, SLICE2_ARTIFACT_VERSION, PG_INT_MAX))
    return { ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" };
  if (!isValidArtifactSha256(artifact.artifactSha256))
    return { ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" };
  if (artifact.sourceOrderId !== order.id)
    return { ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" };
  if (!isValidByteSize(artifact.byteSize))
    return { ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" };
  if (!isValidPrivateStorageLocator(artifact.storageLocator))
    return { ok: false, blocker: "INVALID_STORAGE_LOCATOR" };
  if (
    artifact.storageLocator !==
    expectedDownloadLocator(fulfillment, artifact.artifactSha256)
  ) {
    return { ok: false, blocker: "INVALID_STORAGE_LOCATOR" };
  }

  if (String(order.tier ?? "").trim() !== "T2")
    return { ok: false, blocker: "ORDER_NOT_ELIGIBLE" };
  if (order.refunded === true || order.disputed === true)
    return { ok: false, blocker: "ORDER_NOT_ELIGIBLE" };
  if (String(order.status ?? "").trim() !== "PAID")
    return { ok: false, blocker: "ORDER_NOT_ELIGIBLE" };
  if (!DOWNLOADABLE_FULFILLMENT_STATUSES.has(String(fulfillment.status)))
    return { ok: false, blocker: "FULFILLMENT_NOT_DOWNLOADABLE" };

  if (!presentString(artifact.propertyBindingFingerprint))
    return { ok: false, blocker: "PROPERTY_BINDING_UNVERIFIED" };
  const binding = classifyPropertyBinding({
    storedFingerprint: artifact.propertyBindingFingerprint,
    orderId: order.id,
    propertyPin: order.propertyPin,
    propertyAddress: order.propertyAddress,
  });
  if (binding !== "MATCHES")
    return { ok: false, blocker: "PROPERTY_BINDING_UNVERIFIED" };

  const expiresMs = nowMs + input.ttlSeconds * 1000;
  return {
    ok: true,
    capability: {
      capabilityHash: input.capabilityHash,
      fulfillmentId: fulfillment.id,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      artifactSha256: artifact.artifactSha256,
      sourceOrderId: order.id,
      propertyBindingFingerprint: artifact.propertyBindingFingerprint,
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(expiresMs).toISOString(),
      maxUses: input.maxUses,
    },
  };
}
