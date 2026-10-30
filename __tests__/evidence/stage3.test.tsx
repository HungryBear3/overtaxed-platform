/** @jest-environment node */
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createFactualLocalRuntime, SYNTHETIC_SUBJECT_PIN } from '@/test-support/factual-local-fixture'
import { evaluateSnapshotAcknowledgment } from '@/lib/evidence/snapshot-acknowledgment'
import * as ack from '@/lib/evidence/snapshot-acknowledgment'
import { FactualResultSchema } from '@/lib/evidence/public-factual-contract'
import { SharedEvidenceSummary } from '@/components/check/SharedEvidenceSummary'
const post = () => new Request('http://local/api/free-check',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})})
async function result(rt:ReturnType<typeof createFactualLocalRuntime>) { const r=await rt.route.POST(post()); expect(r.status).toBe(200); const id=(await r.json()).resultId; return rt.store.getResult(id)! }
test('caller cannot choose obsolete current result even when presentation unchanged',async()=>{
 const rt=createFactualLocalRuntime(); const a=await result(rt);const b=await result(rt)
 expect(a.finding).toEqual(b.finding)
 expect(await evaluateSnapshotAcknowledgment(rt.store,{shownResultId:a.resultId,currentResultId:a.resultId})).toMatchObject({ok:false,checkoutAuthorized:false})
 const out=await evaluateSnapshotAcknowledgment(rt.store,{shownResultId:a.resultId} as any)
 expect(out).toMatchObject({ok:true,redisclosureRequired:true,checkoutAuthorized:false,acknowledges:{resultId:b.resultId}})
})
test('same PIN wrong township cannot act as current',async()=>{
 const rt=createFactualLocalRuntime(); const a=await result(rt)
 const b=rt.store.putResult({...a,resultId:rt.store.newId('res'),snapshotId:rt.store.newId('snap'),snapshotVersion:2,subject:{...a.subject,township:'Berwyn'},records:a.records.map(r=>({...r,township:'Berwyn'}))})
 expect(await evaluateSnapshotAcknowledgment(rt.store,{shownResultId:a.resultId,currentResultId:b.resultId})).toMatchObject({ok:false})
})
test('store rejects reused snapshot IDs and late older versions',async()=>{
 const rt=createFactualLocalRuntime();const a=await result(rt);const b=await result(rt)
 expect(()=>rt.store.putResult({...b,resultId:rt.store.newId('res')})).toThrow()
 expect(()=>rt.store.putResult({...a,resultId:rt.store.newId('res'),snapshotId:rt.store.newId('snap')})).toThrow()
})
test('server issued disclosure is single-use and late updates invalidate it',async()=>{
 const rt=createFactualLocalRuntime();const a=await result(rt)
 const issue=(ack as any).issueSnapshotDisclosure, verify=(ack as any).verifySnapshotAcknowledgment
 expect(typeof issue).toBe('function'); expect(typeof verify).toBe('function')
 const token=await issue(rt.store,a.resultId)
 expect(await verify(rt.store,{token:token.token,shownResultId:a.resultId,acknowledgedAt:'forged'})).toMatchObject({ok:false,checkoutAuthorized:false})
 expect(await verify(rt.store,{token:'unknown',shownResultId:a.resultId})).toMatchObject({ok:false})
 expect(await verify(rt.store,{token:token.token,shownResultId:a.resultId})).toMatchObject({ok:true,checkoutAuthorized:false})
 expect(await verify(rt.store,{token:token.token,shownResultId:a.resultId})).toMatchObject({ok:false})
 const stale=await issue(rt.store,a.resultId);await result(rt)
 expect(await verify(rt.store,{token:stale.token,shownResultId:a.resultId})).toMatchObject({ok:false})
})
test.each(['missing','wrong'])('per-record parcel universe citation %s is rejected before storage',async(kind)=>{
 const rt=createFactualLocalRuntime({mutate:a=>{if(a.ok){ const r:any=a.parcels[1]; if(kind==='missing') delete r.parcelSourceId;else r.parcelSourceId='ccao_assessed_values' }return a}})
 const put=jest.spyOn(rt.store,'putResult');const v=jest.spyOn(rt.store,'persistResult')
 expect((await rt.route.POST(post())).status).toBe(503);expect(put).not.toHaveBeenCalled();expect(v).not.toHaveBeenCalled()
})
test('each record binds both distinct source roles; unsupported classes refuse',async()=>{
 const rt=createFactualLocalRuntime();const a=await result(rt)
 for(const row of a.records) expect(row).toMatchObject({sourceId:'ccao_assessed_values',parcelSourceId:'ccao_parcel_universe'})
 for(const cls of ['2-99','3-01']) expect(FactualResultSchema.safeParse({...a,cohort:{...a.cohort,propertyClass:cls},records:a.records.map(r=>({...r,propertyClass:cls}))}).success).toBe(false)
})
test.each(['analysis-store','factual-analysis','free-check-handler','address-resolution','official-window','factual-document'])('server fence on %s',name=>{
 expect(fs.readFileSync(`lib/evidence/server/${name}.ts`,'utf8')).toMatch(/^import ['"]server-only['"]/)
})
test('raw table has named keyboard-accessible bounded scroll and separated cells',async()=>{
 const rt=createFactualLocalRuntime();const a=await result(rt);const html=renderToStaticMarkup(<SharedEvidenceSummary result={a}/> )
 expect(html).toContain('aria-label="Raw parcel records"');expect(html).toContain('tabindex="0"');expect(html).toContain('overflow-x-auto');expect(html).toContain('min-w-');expect(html).toContain('px-3');expect(html).toContain('not stated in source')
})
