import { LookupReceiptSchema, FactualResultSchema } from '@/lib/evidence/public-factual-contract'
import type { FreeCheckSurface } from './free-check-funnel'
import { analytics } from './events'

// Ephemeral intent attribution, never persisted. A cached receipt is a new
// object and cannot replay a user completion. Shared renderers consume once.
const pending = new WeakMap<object, FreeCheckSurface>()
export function registerFactualCompletion(receipt: unknown, surface: FreeCheckSurface): void {
  if (LookupReceiptSchema.safeParse(receipt).success) pending.set(receipt as object, surface)
}
export function adoptFactualCompletion(receipt: unknown, result: unknown): void {
  if (!receipt || typeof receipt !== 'object') return
  const surface = pending.get(receipt)
  if (!surface) return
  const r = LookupReceiptSchema.safeParse(receipt)
  const v = FactualResultSchema.safeParse(result)
  if (!r.success || !v.success || r.data.resultId !== v.data.resultId || r.data.snapshotId !== v.data.snapshotId ||
      r.data.subject.pin !== v.data.subject.pin || r.data.subject.township !== v.data.subject.township ||
      r.data.subject.taxYear !== v.data.subject.taxYear) return
  pending.delete(receipt)
  analytics.factualCheckCompleted({surface, result: v.data})
}
