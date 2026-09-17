import type { NeutralSourceReceipt } from "@/lib/fulfillment/neutral-report-content"
function receiptOrder(a: NeutralSourceReceipt, b: NeutralSourceReceipt): number {
  return [a.datasetId, a.url, a.contentSha256 ?? "", a.retrievedAt, a.roles.join(",")].join("\0").localeCompare([b.datasetId, b.url, b.contentSha256 ?? "", b.retrievedAt, b.roles.join(",")].join("\0"))
}
/** Deterministic presentation ordering only; this module grants no authority. */
export function canonicalNeutralSourceOrder(sources: ReadonlyArray<NeutralSourceReceipt>): NeutralSourceReceipt[] { return [...sources].sort(receiptOrder) }
