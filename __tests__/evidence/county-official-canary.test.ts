/** @jest-environment node */
/** Explicit bounded public GET-only canary; never part of ordinary test runs. */
import fs from 'node:fs'
import path from 'node:path'
import {createCountyFactualAdapter,countyCaptureFor} from '@/lib/evidence/server/county-factual-acquisition'
import {analyzeAcquisition} from '@/lib/evidence/server/factual-analysis'
import {createInMemoryAnalysisStore} from '@/lib/evidence/server/analysis-store'
import {produceFactualPreviewPdf} from '@/lib/evidence/server/factual-document'
import {presentFactualResult} from '@/lib/evidence/evidence-presentation'
const run=process.env.OT_OFFICIAL_CANARY==='GET_ONLY'?it:it.skip
run('fresh actual official GET collector no customer input',async()=>{
 const source=process.env.OT_REAL_CAPTURE_DIR!,dir=process.env.OT_REAL_OUTPUT_DIR!
 const subject=JSON.parse(fs.readFileSync(path.join(source,'official-generic-subject.private.json'),'utf8'))[0]
 const adapter=createCountyFactualAdapter();const a=await adapter.acquire({pin:subject.pin})
 fs.writeFileSync(path.join(dir,'fresh-canary-status.json'),JSON.stringify({ok:a.ok,hold:!a.ok?a.hold:null}),{mode:0o600})
 expect(a.ok).toBe(true);if(!a.ok)return
 const store=createInMemoryAnalysisStore(),out=await analyzeAcquisition(store,a);expect(out.ok).toBe(true);if(!out.ok)return
 const pdf=await produceFactualPreviewPdf(store,out.result.resultId,{generatedAt:new Date().toISOString()})
 for(const [name,data] of [['fresh-result.private.json',JSON.stringify(out.result)],['fresh-capture.private.json',JSON.stringify(countyCaptureFor(a))],['fresh-free-view.private.json',JSON.stringify(presentFactualResult(out.result))],['fresh-paid-preview.private.pdf',pdf.bytes],['fresh-paid-text.private.txt',pdf.text]] as const)fs.writeFileSync(path.join(dir,name),data,{mode:0o600})
},125000)
