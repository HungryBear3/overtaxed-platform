import "server-only"
import { createHash } from "node:crypto"

export type NeutralCheckoutOfficialEvidence = {
  property: Record<string, unknown>
  dataEvidenceSha256: string
  sourceContentSha256: string
  officialRetrievedAt: string
  officialOldestRetrievedAt: string
}

export async function loadNeutralCheckoutOfficialProperty(propertyPin: string): Promise<NeutralCheckoutOfficialEvidence | null> {
  const { readNeutralOfficialBytesRuntime } = await import("@/lib/fulfillment-runtime/neutral-raw-gateway")
  const official = await readNeutralOfficialBytesRuntime({ propertyPin })
  if (!official.ok) return null
  const retrieved = official.evidence.sources.map(source => Date.parse(source.retrievedAt))
  const now=Date.now(), oldest=Math.min(...retrieved), latest=Math.max(...retrieved)
  if (!retrieved.length || retrieved.some(value => !Number.isFinite(value) || value > now || now-value > 24*60*60*1000)) return null
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
  }, dataEvidenceSha256: official.evidence.dataEvidenceSha256, sourceContentSha256, officialRetrievedAt: new Date(latest).toISOString(), officialOldestRetrievedAt:new Date(oldest).toISOString() }
}

export function neutralDeadlineEvidence(snapshot: unknown): { sha256: string; identitySha256: string; retrievedAt: string } | null {
  if (!snapshot || typeof snapshot !== "object") return null
  const value = snapshot as { retrievedAt?: unknown }
  if (typeof value.retrievedAt !== "string" || !Number.isFinite(Date.parse(value.retrievedAt))) return null
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))))
  const record=value as Record<string,unknown>
  const identity=JSON.stringify({closeDate:record.closeDate,sourceUrl:record.sourceUrl,status:record.status,townshipKey:record.townshipKey})
  return { sha256: createHash("sha256").update(canonical).digest("hex"), identitySha256:createHash("sha256").update(identity).digest("hex"), retrievedAt: new Date(value.retrievedAt).toISOString() }
}
export function neutralAdmissionSha256(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex")
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
