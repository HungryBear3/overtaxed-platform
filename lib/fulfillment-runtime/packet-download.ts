/**
 * Server-only read path for a T2 packet download.
 *
 * The ordering here is the whole point, so it is stated plainly:
 *
 *   1. activation is checked before anything else happens;
 *   2. the submitted capability is hashed — the raw value goes no further than
 *      this function, and is never passed to the store, a query, or a log;
 *   3. the store authorizes and claims exactly one use, under the authoritative
 *      order lock;
 *   4. bytes are read from PRIVATE storage with an authenticated server-side
 *      read. No URL is produced, signed, returned, or followed;
 *   5. the bytes are proven to be the exact artifact by digest and length;
 *   6. authority is RE-READ after that asynchronous gap and before a single byte
 *      is returned, and activation is re-checked once more after that. A refund,
 *      revocation, cancellation or terminal delivery outcome that lands while
 *      storage was being read therefore stops the download instead of racing it.
 *
 * What step 6 does NOT do is eliminate the race. It narrows the window from "the
 * whole storage round trip" to "the moment between the re-read committing and
 * the bytes leaving this function", and nothing outside PostgreSQL can be made
 * atomic with that. A revocation landing inside the remaining window still
 * serves one packet, and once bytes are on the wire nothing here can recall
 * them. The claim is that the window is bounded and small, not that it is gone.
 */
import "server-only";

import { computeArtifactSha256 } from "@/lib/fulfillment/artifact-digest";
import { t2PacketDownloadEnabled } from "@/lib/fulfillment/flag";
import {
  hashPacketDownloadCapability,
  type PacketDownloadBlocker,
} from "@/lib/fulfillment/packet-download";
import {
  prismaPacketDownloadStore,
  neutralPacketDownloadStore,
  authoritativeCapabilityKind,
  type PacketDownloadStore,
} from "@/lib/fulfillment-runtime/packet-download-store";
import { readT2ArtifactBytes } from "@/lib/fulfillment-runtime/t2-artifact-storage";
import { readNeutralCustomerZip } from "@/lib/fulfillment-runtime/neutral-customer-zip-storage";
import { NEUTRAL_CUSTOMER_ZIP_FILENAME, NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE } from "@/lib/fulfillment/neutral-customer-zip";

export type PacketDownloadRefusal =
  | PacketDownloadBlocker
  | "STORAGE_READ_FAILED"
  | "STORED_BYTES_MISMATCH"
  | "CAPABILITY_SPENT_REISSUE_REQUIRED";

export type PacketDownloadResult =
  | {
      ok: true;
      bytes: Buffer;
      artifactSha256: string;
      byteSize: number;
      mediaType?: "application/zip";
      filename?: "overtaxed-records-report.zip";
    }
  | { ok: false; blocker: PacketDownloadRefusal };

export type PacketDownloadDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  store?: PacketDownloadStore;
  readBytes?: (input: { locator: string }) => Promise<Buffer>;
};

/**
 * Exchange a capability value for the exact packet bytes it authorizes.
 *
 * Returns bounded refusal codes only. Nothing in a refusal distinguishes "this
 * capability never existed" from "this capability is for an order that was
 * refunded" at the transport layer — the route collapses both to the same
 * response — but the code is retained here so operators keep a precise signal.
 */
export async function readT2PacketForCapability(
  input: { capabilityValue: unknown },
  deps: PacketDownloadDeps = {},
): Promise<PacketDownloadResult> {
  const env = deps.env ?? process.env;
  if (!t2PacketDownloadEnabled(env))
    return { ok: false, blocker: "FLAG_DISABLED" };

  // The only place the raw value is ever touched. From here on there is nothing
  // in scope that a log line or a thrown error could leak.
  const capabilityHash = hashPacketDownloadCapability(input.capabilityValue);
  if (capabilityHash === null)
    return { ok: false, blocker: "INVALID_CAPABILITY" };

  let store=deps.store
  if(!store){let kind:string|null=null;try{kind=await authoritativeCapabilityKind(capabilityHash)}catch{kind=null}if(kind==="NEUTRAL_RECORDS_REPORT"&&!process.env.OT_NEUTRAL_DELIVERY_DATABASE_URL)return {ok:false,blocker:"CAPABILITY_NOT_FOUND"};store=kind==="NEUTRAL_RECORDS_REPORT"?neutralPacketDownloadStore():prismaPacketDownloadStore}
  const authorized=await store.authorize({ capabilityHash });
  if (!authorized.ok) return { ok: false, blocker: authorized.blocker };
  const grant = authorized.grant;
  const reissueRequired=async():Promise<PacketDownloadResult>=>{
    const revoked=await store.revoke({fulfillmentId:grant.fulfillmentId,reasonCode:"STORAGE_FAILURE"})
    if(!revoked.ok||revoked.revoked<1)throw new Error("CAPABILITY_STORAGE_FAILURE_REVOCATION_FAILED")
    return {ok:false,blocker:"CAPABILITY_SPENT_REISSUE_REQUIRED"}
  }
  const neutralZip = grant.storageLocator.startsWith("ot-neutral-customer/sha256/")
  const readBytes = deps.readBytes ?? (neutralZip
    ? ({locator}:{locator:string}) => readNeutralCustomerZip(locator)
    : readT2ArtifactBytes);

  let bytes: Buffer;
  try {
    // Authenticated private read against the content-addressed locator the
    // decision proved. No public or signed URL exists on this path.
    bytes = await readBytes({ locator: grant.storageLocator });
  } catch {
    // The thrown value may carry provider or connection detail and is never read.
    return reissueRequired();
  }

  // Hash-bound to the immutable artifact: what we serve must be exactly what was
  // bound, not merely something that lives at the right path.
  if (
    bytes.byteLength !== grant.byteSize ||
    computeArtifactSha256(bytes) !== grant.artifactSha256
  ) {
    return reissueRequired();
  }

  if (!t2PacketDownloadEnabled(env))
    return { ok: false, blocker: "FLAG_DISABLED" };

  // Authority is re-read after the storage round trip and before the response.
  const still = await store.reassert({ capabilityHash, grant });
  if (!still.ok) return { ok: false, blocker: still.blocker };

  // Final gate. `reassert` is itself an await, so a withdrawal can land during
  // it; re-reading activation after every await is what makes "default-off"
  // mean off, rather than off-unless-you-were-already-mid-request.
  if (!t2PacketDownloadEnabled(env))
    return { ok: false, blocker: "FLAG_DISABLED" };

  const base = {
    ok: true,
    bytes,
    artifactSha256: grant.artifactSha256,
    byteSize: grant.byteSize,
  } as const;
  return neutralZip ? {...base,mediaType:NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE,filename:NEUTRAL_CUSTOMER_ZIP_FILENAME} : base;
}
