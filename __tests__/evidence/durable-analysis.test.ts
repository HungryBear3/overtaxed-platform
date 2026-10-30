/** @jest-environment node */
import { createFreeCheckRoute } from '@/lib/evidence/server/free-check-handler'
import { createSyntheticAdapter, SYNTHETIC_SUBJECT_PIN } from '@/test-support/factual-local-fixture'
import { createInMemoryAnalysisStore } from '@/lib/evidence/server/analysis-store'
import { issueSnapshotDisclosure, verifySnapshotAcknowledgment } from '@/lib/evidence/snapshot-acknowledgment'

it('storage refusal is a typed hold with no successful receipt', async () => {
 const store = createInMemoryAnalysisStore()
 const route = createFreeCheckRoute({adapter:createSyntheticAdapter(),store:{...store,
  persistResult: async () => {throw Error('private driver parameters must not escape')},
 } as any})
 const r=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})}))
 expect(r.status).toBe(503)
 expect(await r.json()).toMatchObject({hold:'STORAGE_UNAVAILABLE'})
})
it('disclosure authority is delegated to durable store, not module WeakMap', async () => {
 const store=createInMemoryAnalysisStore()
 const route=createFreeCheckRoute({adapter:createSyntheticAdapter(),store})
 const r=await (await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})}))).json()
 const first=await issueSnapshotDisclosure(store,r.resultId)
 expect(first.ok).toBe(true)
 if(!first.ok)throw Error('missing receipt')
 // Different app/store wrapper, same backing authority; no object identity grant.
 const second=await verifySnapshotAcknowledgment({...store},{shownResultId:r.resultId,token:first.token})
 expect(second).toMatchObject({ok:true,checkoutAuthorized:false})
 expect(await verifySnapshotAcknowledgment({...store},{shownResultId:r.resultId,token:first.token})).toMatchObject({ok:false})
})
