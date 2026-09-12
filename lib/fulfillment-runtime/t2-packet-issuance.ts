/**
 * Server-only internal issuance of a T2 packet download capability.
 *
 * This is the piece the download surface never had: something trusted that mints
 * a capability. Its shape is deliberately narrow.
 *
 * **There is no public issuance endpoint, and there must never be one.** Nothing
 * here is reachable by an order id, an email address, a Stripe session id, or any
 * other identifier a customer or an attacker could present. The only caller is
 * the in-process delivery adapter, which is itself behind two flags and a
 * validated configuration. Issuance is a consequence of the server deciding to
 * send, never of anybody asking.
 *
 * **The raw value exists in exactly one place: this function's return.** It is
 * generated from `randomBytes`, hashed immediately, and only the hash is passed
 * to the store. It is never written to the database, an event row, a log line, a
 * metric, a URL, an error, or a piece of metadata. The caller's contract is to
 * put it into one outbound message body and then let it fall out of scope.
 *
 * **It cannot re-mint.** The store binds the new capability to the exact delivery
 * attempt inside the same transaction, conditional on that attempt having none.
 * So a retry after an ambiguous send cannot produce a second live value under the
 * same logical key — which matters because the first value is deliberately
 * unrecoverable, and a "replay" that quietly mailed a DIFFERENT code would be a
 * second delivery wearing the first one's identity.
 */
import "server-only";

import { randomBytes } from "node:crypto";
import { t2PacketDownloadEnabled } from "@/lib/fulfillment/flag";
import {
  hashPacketDownloadCapability,
  PACKET_DOWNLOAD_CAPABILITY_BYTES,
  type PacketDownloadBlocker,
} from "@/lib/fulfillment/packet-download";
import {
  prismaPacketDownloadStore,
  type PacketDownloadStore,
} from "@/lib/fulfillment-runtime/packet-download-store";

/**
 * Seven days, and five uses.
 *
 * Long enough that a customer who reads their mail on Monday and acts on it the
 * following weekend is not locked out, short enough that a mailbox compromised
 * months later finds a dead value. Five uses covers a failed download, a second
 * device, and a forwarded-to-spouse retry without becoming an unlimited grant.
 */
export const T2_PACKET_CAPABILITY_TTL_SECONDS = 7 * 24 * 60 * 60;
export const T2_PACKET_CAPABILITY_MAX_USES = 5;

export type T2PacketIssuance = {
  /**
   * The capability VALUE. In memory only. Never persist, never log, never place
   * in a URL, never return through an HTTP response.
   */
  value: string;
  capabilityId: string;
  artifactSha256: string;
  expiresAt: string;
  maxUses: number;
};

export type T2PacketIssuanceResult =
  | { ok: true; issuance: T2PacketIssuance }
  | { ok: false; blocker: PacketDownloadBlocker };

export type T2PacketIssuanceDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  store?: PacketDownloadStore;
  /** Injected only so a test can assert the entropy contract. */
  randomValue?: () => string;
};

/**
 * Mint one capability for the CURRENT artifact of a fulfillment and bind it to
 * the given delivery attempt.
 *
 * Every authority gate — settlement, tier, refund/dispute, fulfillment
 * lifecycle, artifact identity, property binding, bounded lifetime — is enforced
 * by `decideCapabilityIssuance` against state the store reads fresh under the
 * authoritative order lock. This function adds entropy and a hash and nothing
 * else; it has no opinion of its own about who may download what.
 */
export async function issueT2PacketCapability(
  input: {
    fulfillmentId: string;
    attemptNumber: number;
    provider: string;
    ttlSeconds?: number;
    maxUses?: number;
  },
  deps: T2PacketIssuanceDeps = {},
): Promise<T2PacketIssuanceResult> {
  // Defence in depth: a disabled deployment mints nothing and opens no
  // transaction, even though the store checks the same flag again.
  if (!t2PacketDownloadEnabled(deps.env ?? process.env))
    return { ok: false, blocker: "FLAG_DISABLED" };

  const value =
    deps.randomValue?.() ??
    randomBytes(PACKET_DOWNLOAD_CAPABILITY_BYTES).toString("base64url");

  // The single point at which the raw value is converted into something
  // storable. If the generator produced anything that is not a well-formed
  // capability, this fails closed rather than hashing arbitrary input.
  const capabilityHash = hashPacketDownloadCapability(value);
  if (capabilityHash === null)
    return { ok: false, blocker: "INVALID_CAPABILITY" };

  const store = deps.store ?? prismaPacketDownloadStore;
  const issued = await store.issue({
    capabilityHash,
    fulfillmentId: input.fulfillmentId,
    ttlSeconds: input.ttlSeconds ?? T2_PACKET_CAPABILITY_TTL_SECONDS,
    maxUses: input.maxUses ?? T2_PACKET_CAPABILITY_MAX_USES,
    attempt: {
      attemptNumber: input.attemptNumber,
      provider: input.provider,
    },
  });
  if (!issued.ok) return { ok: false, blocker: issued.blocker };

  return {
    ok: true,
    issuance: {
      value,
      capabilityId: issued.capabilityId,
      artifactSha256: issued.artifactSha256,
      expiresAt: issued.expiresAt,
      maxUses: issued.maxUses,
    },
  };
}
