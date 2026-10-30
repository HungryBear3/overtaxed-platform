/** @jest-environment node */
import { PDFDocument } from 'pdf-lib'
import { execFileSync } from 'node:child_process'
import {createInMemoryAnalysisStore} from '@/lib/evidence/server/analysis-store'
import {createPostgresAnalysisStore} from '@/lib/evidence/server/postgres-analysis-store'
import {createGuardedFreeCheckRoute} from '@/lib/evidence/server/free-check-handler'
import {createFreeReportRoute} from '@/lib/evidence/server/free-report-handler'
import {createFreeResultAccess} from '@/lib/evidence/server/free-result-access'
import {createSyntheticAdapter,SYNTHETIC_SUBJECT_PIN} from '@/test-support/factual-local-fixture'
import {buildFactualDocumentText} from '@/lib/evidence/server/factual-document'
import {layoutT2PrintLines,renderT2ArtifactPdf} from '@/lib/evidence/server/free-factual-pdf'
import {FactualResultSchema} from '@/lib/evidence/public-factual-contract'

const native = process.env.FACTUAL_CAPACITY_NATIVE === '1'
describe(native ? 'restricted PostgreSQL bounded PDF' : 'bounded PDF',()=>{
 it.each([0,99,100,101,1300,4999])('accepts and renders %i cohort rows with explicit bounded detail',async count=>{
  const store=native?createPostgresAnalysisStore():createInMemoryAnalysisStore()
  const access=createFreeResultAccess({secret:'test-capacity-only-000000000000000000000000000'})
  const adapter=createSyntheticAdapter({mutate:a=>{
   if(!a.ok)return a
   const rows=Array.from({length:count},(_,i)=>({...a.parcels[1],pin:String(20000000000000+i).replace(/^(\d{2})(\d{2})(\d{3})(\d{3})(\d{4})$/,'$1-$2-$3-$4-$5'),assessedTotalCents:100_000_000_000,landCents:50_000_000_000,buildingCents:50_000_000_000}))
   return {...a,parcels:[...rows.reverse(),a.parcels[0]]}
  }})
  const check=createGuardedFreeCheckRoute({adapter,store,access})
  const post=await check.POST(new Request('http://local/api/free-check',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})}))
  expect(post.status).toBe(200)
  const receipt=await post.json(),cookie=post.headers.get('set-cookie')!.split(';')[0]
  const req=new Request('http://local/api/free-check/report?id='+receipt.resultId,{headers:{cookie}})
  const get=await check.GET(new Request('http://local/api/free-check?id='+receipt.resultId,{headers:{cookie}}))
  expect(get.status).toBe(200)
  const result=FactualResultSchema.parse(await get.json())
  expect(result.records).toHaveLength(count+1)
  // Cast allows the desired optional contract to execute against frozen RED source.
  const build=buildFactualDocumentText as (r:typeof result,o?:{detail:'bounded'})=>string
  const text=build(result,{detail:'bounded'})
  expect(text).toContain(`Listed: the subject parcel and ${Math.min(count,100)} of ${count} cohort parcels. ${Math.max(0,count-100)} cohort parcels are not listed.`)
  expect(text.match(/^PIN /gm)).toHaveLength(1+Math.min(count,100))
  expect(text.match(/^PIN .+$/gm)![0]).toContain(SYNTHETIC_SUBJECT_PIN)
  expect(text).toContain(`Total cents: ${count*100_000_000_000} (sum over all ${count} cohort parcels, including those not listed)`)
  expect(text).toContain('not a representative sample')
  expect(build({...result,records:[...result.records].reverse()},{detail:'bounded'})).toBe(text)
  expect(text.length).toBeLessThan(200000)
  const pages=Math.ceil(layoutT2PrintLines(text,'word-wrap').length/53)
  expect(pages).toBeLessThanOrEqual(12)
  const response=await createFreeReportRoute({store,access,now:()=> '2026-10-20T00:00:00.000Z'}).GET(req)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/pdf')
  const bytes=await response.arrayBuffer();expect((await PDFDocument.load(bytes)).getPageCount()).toBe(pages)
  const extracted=execFileSync('pdftotext',['-','-'],{input:Buffer.from(bytes)}).toString().replace(/\s+/g,' ')
  expect(extracted).toContain(`Listed: the subject parcel and ${Math.min(count,100)} of ${count} cohort parcels. ${Math.max(0,count-100)} cohort parcels are not listed.`)
  expect(extracted).toContain(`Total cents: ${count*100_000_000_000}`)
  expect(extracted).toContain('not a complete record listing')
  console.log(JSON.stringify({native,count,post:post.status,get:get.status,report:response.status,pages,bytes:bytes.byteLength}))
  const invalid=await createFreeReportRoute({store,access,now:()=> 'invalid'}).GET(req)
  expect(invalid.status).toBe(500);expect((await invalid.json()).code).toBe('RENDER_UNAVAILABLE')
  const unavailable=await createFreeReportRoute({store:{...store,getResult:async()=>{throw Error('private')}},access}).GET(req)
  expect(unavailable.status).toBe(503);expect((await unavailable.json()).code).toBe('STORAGE_UNAVAILABLE')
  if(count===4999)expect(FactualResultSchema.safeParse({...result,records:[...result.records,result.records[0]]}).success).toBe(false)
 })
 it('preserves renderer character and page safety caps',async()=>{
  await expect(renderT2ArtifactPdf('x'.repeat(200001),'2026-10-20T00:00:00.000Z')).rejects.toThrow('PDF_INPUT_INVALID')
  await expect(renderT2ArtifactPdf('x\n'.repeat(5301),'2026-10-20T00:00:00.000Z')).rejects.toThrow('PDF_INPUT_INVALID')
 })
})
