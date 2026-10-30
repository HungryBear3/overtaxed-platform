/** @jest-environment node */
import {execFileSync} from 'node:child_process'
import {createFactualLocalRuntime,SYNTHETIC_SUBJECT_PIN} from '@/test-support/factual-local-fixture'
import {produceFactualPreviewPdf} from '@/lib/evidence/server/factual-document'
import {presentFactualResult} from '@/lib/evidence/evidence-presentation'
test('existing real PDF renderer reloads ID and extracted PDF matches canonical finding sources limits window identity',async()=>{
 const rt=createFactualLocalRuntime()
 const response=await rt.route.POST(new Request('http://local/api/free-check',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})}))
 expect(response.status).toBe(200);const receipt=await response.json()
 const canonical=await(await rt.route.GET(new Request(`http://local/api/free-check?id=${receipt.resultId}`))).json()
 const doc=await produceFactualPreviewPdf(rt.store,receipt.resultId,{generatedAt:'2026-10-18T12:00:00Z'})
 const extracted=execFileSync('pdftotext',['-','-'],{input:doc.bytes}).toString().replace(/\s+/g,' ')
 const p=presentFactualResult(canonical)
 for(const expected of [p.findingText,p.windowText,...p.limitations,...p.sources.map(s=>s.url),canonical.resultId,canonical.snapshotId]) expect(extracted).toContain(expected.replace(/\s+/g,' '))
 for(const row of p.rows) {
   expect(extracted).toContain(`PIN ${row.pin} | ${row.role} | Class ${row.propertyClass}`)
   expect(extracted).toContain(`Assessed ${row.assessed} | Land ${row.land} | Building ${row.building}`)
   expect(extracted).toContain(`Date: ${row.date}`)
 }
 expect(extracted).toContain('SYNTHETIC PREVIEW')
 await expect(produceFactualPreviewPdf(rt.store,'res_unknown',{generatedAt:'2026-10-18T12:00:00Z'})).rejects.toThrow('RESULT_NOT_FOUND')
})
