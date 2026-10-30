import "server-only"
import { createHash } from "node:crypto"
import type { AcquisitionSnapshotStore, StoredAcquisitionSnapshot } from "@/lib/evidence/server/acquisition-snapshot"
import type { BindResult, OrderSnapshotBindingStore, SnapshotTransferClaim } from "@/lib/commerce/snapshot-checkout-transfer"

export type NeutralCheckoutOfficialEvidence = {
  property: Record<string, unknown>
  dataEvidenceSha256: string
  sourceContentSha256: string
  officialRetrievedAt: string
  officialOldestRetrievedAt: string
  /** Always present on success: persisted canonical snapshot reference. */
  acquisitionSnapshot?:{ id: string; sha256: string; schema: string; dataEvidenceSha256: string }
}

export async function loadNeutralCheckoutOfficialProperty(propertyPin: string, options: { snapshotStore?: AcquisitionSnapshotStore } = {}): Promise<NeutralCheckoutOfficialEvidence | null> {
  // Default caller: canonical snapshot storage from env; unavailable config fails closed.
  const { createAcquisitionSnapshotStoreFromEnv } = await import("@/lib/evidence/server/acquisition-snapshot")
  const owned = options.snapshotStore ? null : createAcquisitionSnapshotStoreFromEnv()
  const snapshotStore = options.snapshotStore ?? owned
  if (!snapshotStore) return null
  try { return await loadWithSnapshot(propertyPin, snapshotStore) } finally { await owned?.close() }
}

async function loadWithSnapshot(propertyPin: string, snapshotStore: AcquisitionSnapshotStore): Promise<NeutralCheckoutOfficialEvidence | null> {
  const options = { snapshotStore }
  const { readNeutralOfficialBytesRuntime } = await import("@/lib/fulfillment-runtime/neutral-raw-gateway")
  const official = await readNeutralOfficialBytesRuntime({ propertyPin, sharedSnapshotProtections: true })
  if (!official.ok) return null
  const retrieved = official.evidence.sources.map(source => Date.parse(source.retrievedAt))
  const now=Date.now(), oldest=Math.min(...retrieved), latest=Math.max(...retrieved)
  if (!retrieved.length || retrieved.some(value => !Number.isFinite(value) || value > now || now-value > 24*60*60*1000)) return null
  // Same canonical normalized snapshot contract as the shared acquisition; a
  // requested snapshot that cannot be built or persisted fails closed.
  let acquisitionSnapshot: NeutralCheckoutOfficialEvidence["acquisitionSnapshot"]
  if (options.snapshotStore) {
    const { buildAcquisitionSnapshot } = await import("@/lib/evidence/server/acquisition-snapshot")
    const built = buildAcquisitionSnapshot(official.evidence)
    if (!built) return null
    try {
      const ref = await options.snapshotStore.persist(built.snapshot, built.pages)
      if (ref.id !== built.id || ref.sha256 !== built.sha256) return null
      acquisitionSnapshot = { id: ref.id, sha256: ref.sha256, schema: built.snapshot.schema, dataEvidenceSha256: official.evidence.dataEvidenceSha256 }
    } catch { return null }
  }
  const sourceContentSha256=createHash("sha256").update(JSON.stringify(official.evidence.sources.map(s=>({datasetId:s.datasetId,url:s.url,contentSha256:s.contentSha256})).sort((a,b)=>a.url.localeCompare(b.url)))).digest("hex")
  return { property: {
    pin: official.evidence.subject.pin,
    class: official.evidence.subject.propertyClass,
    year: official.evidence.subject.taxYear,
    pin_num_cards: official.evidence.subjectProration.pinNumCards,
    nbhd: official.evidence.subject.neighborhoodCode,
    char_bldg_sf: official.evidence.subject.buildingSqft,
    char_yrblt: official.evidence.subject.yearBuilt,
    char_type_resd: official.evidence.subject.residentialSubtype,
    mailed_tot: official.evidence.subject.assessedTotalValue,
  }, dataEvidenceSha256: official.evidence.dataEvidenceSha256, sourceContentSha256, officialRetrievedAt: new Date(latest).toISOString(), officialOldestRetrievedAt:new Date(oldest).toISOString(), ...(acquisitionSnapshot ? { acquisitionSnapshot } : {}) }
}

const sourceContentDigest = (sources: ReadonlyArray<{ datasetId: string; url: string; contentSha256?: unknown }>) =>
  createHash("sha256").update(JSON.stringify(sources.map(s=>({datasetId:s.datasetId,url:s.url,contentSha256:s.contentSha256})).sort((a,b)=>a.url.localeCompare(b.url)))).digest("hex")

/**
 * Checkout admission evidence from the free result's persisted snapshot named
 * by a verified transfer claim. Never calls the county collector; a missing,
 * mismatched, or stale (>24h source) snapshot fails closed.
 */
export async function loadNeutralCheckoutFromTransfer(claim: SnapshotTransferClaim, options: { snapshotStore?: AcquisitionSnapshotStore } = {}): Promise<NeutralCheckoutOfficialEvidence | null> {
  const { createAcquisitionSnapshotStoreFromEnv } = await import("@/lib/evidence/server/acquisition-snapshot")
  const owned = options.snapshotStore ? null : createAcquisitionSnapshotStoreFromEnv()
  const store = options.snapshotStore ?? owned
  if (!store) return null
  try {
    let stored: StoredAcquisitionSnapshot | undefined
    try { stored = await store.readPrivileged(claim.snapshotId) } catch { return null }
    const s = stored?.snapshot
    if (!stored || !s || stored.id !== claim.snapshotId || stored.sha256 !== claim.sha256 || s.subject?.pin !== claim.pin || !Array.isArray(s.sources) || !s.sources.length) return null
    const retrieved = s.sources.map(source => Date.parse(source.retrievedAt))
    const now = Date.now(), oldest = Math.min(...retrieved), latest = Math.max(...retrieved)
    if (retrieved.some(value => !Number.isFinite(value) || value > now || now - value > 24*60*60*1000)) return null
    if (typeof s.dataEvidenceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(s.dataEvidenceSha256) || !(s.subject.assessedTotalCents > 0)) return null
    return { property: {
      pin: s.subject.pin,
      class: s.subject.propertyClass,
      year: s.subject.taxYear,
      pin_num_cards: s.subjectProration?.pinNumCards,
      nbhd: s.subject.neighborhoodCode,
      char_bldg_sf: s.subject.buildingSqft,
      char_yrblt: s.subject.yearBuilt,
      char_type_resd: s.subject.residentialSubtype,
      mailed_tot: s.subject.assessedTotalCents / 100,
    }, dataEvidenceSha256: s.dataEvidenceSha256, sourceContentSha256: sourceContentDigest(s.sources), officialRetrievedAt: new Date(latest).toISOString(), officialOldestRetrievedAt: new Date(oldest).toISOString(), acquisitionSnapshot: { id: stored.id, sha256: stored.sha256, schema: s.schema, dataEvidenceSha256: s.dataEvidenceSha256 } }
  } finally { await owned?.close() }
}

/** Default caller: redeems the transfer into the order's immutable binding (env store; unconfigured fails closed). */
export async function bindNeutralCheckoutSnapshot(orderId: string, claim: SnapshotTransferClaim, options: { bindingStore?: OrderSnapshotBindingStore; boundedAdmission?: boolean } = {}): Promise<BindResult> {
  const { createOrderSnapshotBindingStoreFromEnv } = await import("@/lib/commerce/snapshot-checkout-transfer")
  const owned = options.bindingStore ? null : createOrderSnapshotBindingStoreFromEnv({ boundedAdmission: options.boundedAdmission })
  const store = options.bindingStore ?? owned
  if (!store) return { ok: false, blocker: "BINDING_UNAVAILABLE" }
  try { return await store.bind({ orderId, claim }) } finally { await owned?.close() }
}

/**
 * Retry without a transfer cookie: an order already bound to a snapshot must
 * never be re-reserved from a live refetch (evidence swap). Only a successful
 * no-row lookup permits the unbound path; missing config or a read failure
 * fails closed.
 */
export async function neutralCheckoutUnboundOrRefuse(orderId: string, options: { bindingStore?: OrderSnapshotBindingStore } = {}): Promise<{ ok: true } | { ok: false; blocker: "ORDER_ALREADY_BOUND" | "BINDING_UNAVAILABLE" }> {
  const { createOrderSnapshotBindingStoreFromEnv } = await import("@/lib/commerce/snapshot-checkout-transfer")
  const owned = options.bindingStore ? null : createOrderSnapshotBindingStoreFromEnv()
  const store = options.bindingStore ?? owned
  if (!store) return { ok: false, blocker: "BINDING_UNAVAILABLE" }
  try { return (await store.read(orderId)) ? { ok: false, blocker: "ORDER_ALREADY_BOUND" } : { ok: true } }
  catch { return { ok: false, blocker: "BINDING_UNAVAILABLE" } }
  finally { await owned?.close() }
}

/** Paid-side reload: the order's bound snapshot exactly, never the latest or a refetch. */
export async function readOrderBoundSnapshot(orderId: string, options: { bindingStore?: OrderSnapshotBindingStore; snapshotStore?: AcquisitionSnapshotStore } = {}): Promise<StoredAcquisitionSnapshot | undefined> {
  const [{ createOrderSnapshotBindingStoreFromEnv }, { createAcquisitionSnapshotStoreFromEnv }] = await Promise.all([import("@/lib/commerce/snapshot-checkout-transfer"), import("@/lib/evidence/server/acquisition-snapshot")])
  const ownedBinding = options.bindingStore ? null : createOrderSnapshotBindingStoreFromEnv()
  const ownedSnapshot = options.snapshotStore ? null : createAcquisitionSnapshotStoreFromEnv()
  const bindings = options.bindingStore ?? ownedBinding, snapshots = options.snapshotStore ?? ownedSnapshot
  try {
    if (!bindings || !snapshots) throw new Error("SNAPSHOT_STORAGE_UNAVAILABLE")
    const ref = await bindings.read(orderId)
    if (!ref) return undefined
    const stored = await snapshots.readPrivileged(ref.snapshotId)
    if (!stored || stored.sha256 !== ref.sha256 || stored.snapshot.subject?.pin !== ref.pin) throw new Error("SNAPSHOT_STORAGE_UNAVAILABLE")
    return stored
  } finally { await Promise.all([ownedBinding?.close(), ownedSnapshot?.close()]) }
}

export function neutralDeadlineEvidence(snapshot: unknown): { sha256: string; identitySha256: string; retrievedAt: string } | null {
  if (!snapshot || typeof snapshot !== "object") return null
  const value = snapshot as { retrievedAt?: unknown }
  if (typeof value.retrievedAt !== "string" || !Number.isFinite(Date.parse(value.retrievedAt))) return null
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))))
  const record=value as Record<string,unknown>
  // Admitted calendar facts: open/close dates, status, official source and township (not page bytes or retrieval instant).
  const identity=JSON.stringify({closeDate:record.closeDate,openDate:record.openDate,sourceUrl:record.sourceUrl,status:record.status,townshipKey:record.townshipKey})
  return { sha256: createHash("sha256").update(canonical).digest("hex"), identitySha256:createHash("sha256").update(identity).digest("hex"), retrievedAt: new Date(value.retrievedAt).toISOString() }
}
export function neutralAdmissionSha256(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

export async function prepareNeutralCheckoutAdmission(input: Parameters<typeof reserveNeutralCheckout>[0], claim: SnapshotTransferClaim) {
  const { prepareNeutralCheckoutAdmissionOrder } = await import("@/lib/fulfillment-runtime/neutral-report-repository")
  // Resolve the exported seam, not the lexical function: native contenders must
  // reach the same binder boundary as production before their latches release.
  const runtime = await import("@/lib/commerce/neutral-checkout-runtime")
  return prepareNeutralCheckoutAdmissionOrder(input, () => runtime.bindNeutralCheckoutSnapshot(input.orderId, claim, { boundedAdmission: true }))
}

export async function reserveNeutralCheckout(input: { orderId: string; propertyPin: string; dataEvidenceSha256: string; sourceContentSha256: string; officialRetrievedAt: string; officialOldestRetrievedAt:string; deadlineEvidenceSha256: string; deadlineIdentitySha256: string; deadlineRetrievedAt: string; admissionSha256: string }) {
  const { reserveNeutralCheckoutOrder } = await import("@/lib/fulfillment-runtime/neutral-report-repository")
  return reserveNeutralCheckoutOrder(input)
}

export async function abandonNeutralCheckout(orderId: string): Promise<boolean> {
  const { abandonNeutralCheckoutReservation } = await import("@/lib/fulfillment-runtime/neutral-report-repository")
  return abandonNeutralCheckoutReservation(orderId)
}
export async function markNeutralCheckoutUnknown(orderId:string):Promise<boolean>{
  const {markNeutralCheckoutOutcomeUnknown}=await import("@/lib/fulfillment-runtime/neutral-report-repository")
  return markNeutralCheckoutOutcomeUnknown(orderId)
}
export async function intendNeutralCheckout(input:{orderId:string;checkoutKey:string;idempotencyKey:string;contractSha256:string}){const {intendNeutralStripeCheckout}=await import("@/lib/fulfillment-runtime/neutral-report-repository");return intendNeutralStripeCheckout(input)}
export async function observeNeutralCheckout(attemptId:string,session:{id:string;status:string|null}){const {observeNeutralStripeCheckout}=await import("@/lib/fulfillment-runtime/neutral-report-repository");return observeNeutralStripeCheckout(attemptId,session)}
