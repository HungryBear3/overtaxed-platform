/** @jest-environment node */
/** REAL replay: private, hash-verified official HTTP bodies, never invented records.
 * Run explicitly with OT_REAL_CAPTURE_DIR. Not a portable synthetic fixture. */
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {analyzeAcquisition, type Acquisition} from '@/lib/evidence/server/factual-analysis'
import {createInMemoryAnalysisStore} from '@/lib/evidence/server/analysis-store'
import {decodeFactualResultJson} from '@/lib/evidence/public-factual-contract'
const root=process.env.OT_REAL_CAPTURE_DIR
const suite=root?describe:describe.skip
export function officialReplay() {
 const r=root!;const report=JSON.parse(fs.readFileSync(path.join(r,'SOURCE-QUALIFICATION.json'),'utf8'))
 const pins=new Map<string,string>()
 for(const x of report.datasets)pins.set(x.label+'.private.json',x.sha256)
 for(const [i,x] of report.existingGateway.requests.entries())pins.set(`county-${i}.private.json`,x.sha256)
 for(const x of report.rawFactualFieldProbe.requests)pins.set(`factual-assessed-${x.batch}.private.json`,x.sha256)
 for(const x of report.rawFactualFieldProbe.metadataAfter)pins.set(`meta-after-${x.id}.private.json`,x.sha256)
 const read=(f:string)=>{const b=fs.readFileSync(path.join(r,f));if(createHash('sha256').update(b).digest('hex')!==pins.get(f))throw Error('PRIVATE_CAPTURE_HASH');return b.toString()}
 const subject=JSON.parse(read('county-0.private.json'))[0]
 const pool=[2,3,4].flatMap(i=>JSON.parse(read(`county-${i}.private.json`)))
 const assessed=Array.from({length:13},(_,i)=>JSON.parse(read(`factual-assessed-${i}.private.json`))).flat()
 const calls:Record<string,number>={}
 const fetcher=async(url:string)=>{
  const u=new URL(url),id=u.pathname.split('/').pop()!.replace('.json','');let file:string
  if(u.pathname.includes('/api/views/')){const n=calls[id]??0;calls[id]=n+1;file=`meta-${n?'after-':''}${id}.private.json`}
  else if(id==='pabr-t5kh') {
   if(u.searchParams.get('$select')==='count(*) AS n')file='county-1.private.json'
   else if(u.searchParams.has('$offset'))file=`county-${2+Number(u.searchParams.get('$offset'))/500}.private.json`
   else file='county-0.private.json'
  }else if(id==='uzyt-m557') {
   const where=u.searchParams.get('$where')!;const i=pool.findIndex((x:any)=>where.includes(`'${x.pin}'`));if(i<0||i%100)throw Error('UNMATCHED_REAL_QUERY');file=`factual-assessed-${i/100}.private.json`
  }else throw Error('NO_REAL_CAPTURE')
  return new Response(read(file),{status:200,headers:{'content-type':'application/json'}})
 }
 return {subject,pool,assessed,fetcher}
}
suite('actual official immutable capture replay',()=>{
 it('real collector produces authenticated county facts; copied authority is refused',async()=>{
  const mod=await import('@/lib/evidence/server/county-factual-acquisition')
  const {subject,fetcher}=officialReplay()
  const adapter=mod.createCountyFactualAdapter(fetcher)
  const acq=await adapter.acquire({pin:subject.pin})
  expect(acq.ok).toBe(true)
  if(!acq.ok)return
  const out=await analyzeAcquisition(createInMemoryAnalysisStore(),acq)
  expect(out.ok).toBe(true)
  if(out.ok){expect(out.result.cohort.count).toBe(148);expect(out.result.dataOrigin).toBe('COUNTY_RECORD');expect(out.result.limitations).toContain('upstream_not_atomic');expect(decodeFactualResultJson(JSON.stringify(out.result)).ok).toBe(true)}
  const store=createInMemoryAnalysisStore();
  const {createFreeCheckRoute}=await import('@/lib/evidence/server/free-check-handler')
  const route=createFreeCheckRoute({store,adapter:{id:'actual-capture-replay',acquire:async()=>acq}})
  const response=await route.POST(new Request('http://local/api/free-check',{method:'POST',body:JSON.stringify({pin:subject.pin})}));expect(response.status).toBe(200)
  const receipt=await response.json();const free=await (await route.GET(new Request('http://local/api/free-check?id='+receipt.resultId))).json()
  const actual={ok:true,result:store.getResult(receipt.resultId)!};expect(JSON.stringify(free)===JSON.stringify(actual.result)).toBe(true)
  expect(Object.isFrozen(acq)).toBe(true)
  expect(()=>{(acq as any).parcels[0].assessedTotalCents=1}).toThrow()
  expect(mod.retainedCountyCapture(actual.result.countyCapture!.sha256)===mod.countyCaptureFor(acq)).toBe(true)
  if(actual.ok&&process.env.OT_REAL_OUTPUT_DIR){
   const {produceFactualPreviewPdf}=await import('@/lib/evidence/server/factual-document')
   const {presentFactualResult}=await import('@/lib/evidence/evidence-presentation')
   const pdf=await produceFactualPreviewPdf(store,actual.result.resultId,{generatedAt:'2026-10-19T00:57:27Z'})
   const p=presentFactualResult(actual.result)
   for(const t of [p.findingText,p.windowText,...p.limitations,p.identity.resultId,p.identity.snapshotId])expect(pdf.text.includes(t)).toBe(true)
   const dir=process.env.OT_REAL_OUTPUT_DIR
   for(const [name,data] of [['actual-result.private.json',JSON.stringify(actual.result)],['actual-capture.private.json',JSON.stringify(mod.countyCaptureFor(acq))],['actual-free-view.private.json',JSON.stringify(p)],['actual-paid-preview.private.pdf',pdf.bytes],['actual-paid-text.private.txt',pdf.text]] as const){fs.writeFileSync(path.join(dir,name),data,{mode:0o600});fs.chmodSync(path.join(dir,name),0o600)}
  }
  expect((await analyzeAcquisition(createInMemoryAnalysisStore(),JSON.parse(JSON.stringify(acq)))).ok).toBe(false)
 })
 it('unmapped six-digit neighborhood is refused before issuing county authority',async()=>{
  const mod=await import('@/lib/evidence/server/county-factual-acquisition');const {subject,fetcher}=officialReplay()
  const hostile=async(url:string)=>{const r=await fetcher(url);const j=await r.json();if(Array.isArray(j))for(const row of j){if('nbhd_code' in row)row.nbhd_code='123456';if('nbhd' in row)row.nbhd='123456'}return new Response(JSON.stringify(j),{status:200})}
  expect((await mod.createCountyFactualAdapter(hostile).acquire({pin:subject.pin})).ok).toBe(false)
 })
 it.each(['missing','duplicate','identity','drift','oversized','gap'])('real byte-derived hostile %s refuses',async(kind)=>{
  const mod=await import('@/lib/evidence/server/county-factual-acquisition')
  const {subject,fetcher}=officialReplay();let metas=0
  const hostile=async(url:string)=>{const r=await fetcher(url);let j=await r.json();const u=new URL(url)
   if(u.pathname.includes('uzyt-m557')&&!u.pathname.includes('/api/')){
    if(kind==='missing')delete j[0].mailed_tot
    if(kind==='duplicate')j.push({...j[0]})
    if(kind==='identity')j[0].year='1999'
    if(kind==='gap')j.pop()
   }
   if(u.pathname.includes('/api/views/pabr')){metas++;if(kind==='drift'&&metas>1)j.rowsUpdatedAt++}
   if(kind==='oversized'&&u.searchParams.get('$select')==='count(*) AS n')j=[{n:'5001'}]
   return new Response(JSON.stringify(j),{status:200})
  }
  expect((await mod.createCountyFactualAdapter(hostile).acquire({pin:subject.pin})).ok).toBe(false)
 })
 it('complete 148 cohort is representable without characteristic eligibility',async()=>{
  const {subject:s,pool,assessed}=officialReplay();const by=new Map(assessed.map((x:any)=>[x.pin,x]));const fmt=(p:string)=>p.replace(/^(..)(..)(...)(...)(....)$/,'$1-$2-$3-$4-$5')
  const rows=pool.filter((p:any)=>p.class===s.class).map((p:any)=>{const a:any=by.get(p.pin);return {pin:fmt(p.pin),role:p.pin===s.pin?'subject':'cohort',taxYear:Number(p.year),assessedTotalCents:Number(a.mailed_tot)*100,landCents:Number(a.mailed_land)*100,buildingCents:Number(a.mailed_bldg)*100,propertyClass:p.class[0]+'-'+p.class.slice(1),township:p.township_name,neighborhoodCode:p.nbhd_code.slice(0,2)+'-'+p.nbhd_code.slice(2),sourceId:'ccao_assessed_values',parcelSourceId:'ccao_parcel_universe',recordDate:null}})
  // Synthetic origin here isolates the OLD schema capacity defect using REAL rows.
  // This does not qualify county acquisition or mislabel the emitted real artifact.
  const a={ok:true,origin:'SYNTHETIC_PREVIEW',atomic:true,sources:['ccao_assessed_values','ccao_parcel_universe'],subject:{pin:fmt(s.pin),township:s.township_name,taxYear:Number(s.year)},cohort:{neighborhoodCode:rows[0].neighborhoodCode,propertyClass:rows[0].propertyClass},parcels:rows} as Acquisition
  const out=await analyzeAcquisition(createInMemoryAnalysisStore(),a)
  expect(out.ok).toBe(true)
  if(out.ok){expect(out.result.cohort.count).toBe(148);expect(decodeFactualResultJson(JSON.stringify(out.result)).ok).toBe(true)}
 })
})
