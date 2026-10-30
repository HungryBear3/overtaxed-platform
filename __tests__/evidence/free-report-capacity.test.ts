/** @jest-environment node */
import {createInMemoryAnalysisStore} from '@/lib/evidence/server/analysis-store'
import {createGuardedFreeCheckRoute} from '@/lib/evidence/server/free-check-handler'
import {createFreeReportRoute} from '@/lib/evidence/server/free-report-handler'
import {createFreeResultAccess} from '@/lib/evidence/server/free-result-access'
import {createSyntheticAdapter,SYNTHETIC_SUBJECT_PIN} from '@/test-support/factual-local-fixture'
import {buildFactualDocumentText} from '@/lib/evidence/server/factual-document'
import {layoutT2PrintLines} from '@/lib/evidence/server/free-factual-pdf'

describe('independent accepted-checker-to-PDF capacity counterexample',()=>{
 it.each([3,1300,4999])('accepted result with %i cohort records must render a PDF',async count=>{
  const store=createInMemoryAnalysisStore()
  const access=createFreeResultAccess({secret:'test-independent-review-only-00000000000000000000'})
  const adapter=createSyntheticAdapter({mutate:a=>{
   if(!a.ok)return a
   return {...a,parcels:[a.parcels[0],...Array.from({length:count},(_,i)=>({...a.parcels[1],pin:String(20000000000000+i).replace(/^(\d{2})(\d{2})(\d{3})(\d{3})(\d{4})$/,'$1-$2-$3-$4-$5')}))]}
  }})
  const check=createGuardedFreeCheckRoute({adapter,store,access})
  const report=createFreeReportRoute({store,access,now:()=> '2026-10-20T00:00:00.000Z'})
  const post=await check.POST(new Request('http://local/api/free-check',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})}))
  expect(post.status).toBe(200)
  const receipt=await post.json();const cookie=post.headers.get('set-cookie')!.split(';')[0]
  const resultResponse=await check.GET(new Request('http://local/api/free-check?id='+receipt.resultId,{headers:{cookie}}))
  expect(resultResponse.status).toBe(200)
  const result=await resultResponse.json();expect(result.records).toHaveLength(count+1)
  const text=buildFactualDocumentText(result)
  const response=await report.GET(new Request('http://local/api/free-check/report?id='+receipt.resultId,{headers:{cookie}}))
  console.log(JSON.stringify({cohort:count,records:result.records.length,post:post.status,get:resultResponse.status,textLength:text.length,pages:Math.ceil(layoutT2PrintLines(text,'word-wrap').length/53),report:response.status,error:response.status===200?null:await response.clone().json()}))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/pdf')
 })
})
