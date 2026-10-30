/** Disposable-only process proof. No dotenv, provider, SMTP or county network. */
import assert from 'node:assert/strict'
import { createPostgresAnalysisStore } from '../lib/evidence/server/postgres-analysis-store'
import { createSyntheticAdapter, SYNTHETIC_SUBJECT_PIN } from './factual-local-fixture'
import { createFreeCheckRoute } from '../lib/evidence/server/free-check-handler'
import { issueSnapshotDisclosure, verifySnapshotAcknowledgment } from '../lib/evidence/snapshot-acknowledgment'
import { produceFactualPreviewPdf } from '../lib/evidence/server/factual-document'
import { prisma } from '../lib/db'
import { readFileSync, writeFileSync } from 'node:fs'
async function main(){
 assert.equal(process.env.DATABASE_URL,'postgresql://ot_app@127.0.0.1:54392/ot_disposable')
 const store=createPostgresAnalysisStore(),route=createFreeCheckRoute({adapter:createSyntheticAdapter(),store})
 const file=process.argv[3]
 if(process.argv[2]==='write'){
  const response=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})}))
  assert.equal(response.status,200)
  const receipt=await response.json(),result=await store.getResult(receipt.resultId)
  assert.ok(result)
  const disclosure=await issueSnapshotDisclosure(store,result.resultId);assert.ok(disclosure.ok)
  writeFileSync(file,JSON.stringify({result,disclosure}),{mode:0o600})
  console.log('WRITE canonical result and disclosure committed')
 }else{
  const {result,disclosure}=JSON.parse(readFileSync(file,'utf8'))
  assert.deepEqual(await store.getResult(result.resultId),result)
  assert.deepEqual(await store.getLatestResult(result.subject),result)
  assert.equal((await route.GET(new Request('http://local?id='+result.resultId))).status,200)
  const pdf=await produceFactualPreviewPdf(createPostgresAnalysisStore(),result.resultId,{generatedAt:'2026-10-19T00:00:00Z'})
  assert.ok(pdf.text.includes(result.resultId));assert.equal(pdf.bytes.subarray(0,5).toString(),'%PDF-')
  assert.equal((await verifySnapshotAcknowledgment(store,{shownResultId:result.resultId,token:disclosure.token})).ok,true)
  assert.equal((await verifySnapshotAcknowledgment(store,{shownResultId:result.resultId,token:disclosure.token})).ok,false)
  await assert.rejects(async()=>store.persistResult(result),/STORAGE_UNAVAILABLE/)
  const stale=await issueSnapshotDisclosure(store,result.resultId);assert.ok(stale.ok)
  const calls=Array.from({length:4},()=>route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})})))
  const responses=await Promise.all(calls);assert.ok(responses.every(r=>r.status===200))
  const current=await store.getLatestResult(result.subject);assert.equal(current?.snapshotVersion,result.snapshotVersion+4)
  assert.equal((await verifySnapshotAcknowledgment(store,{shownResultId:result.resultId,token:stale.token})).ok,false)
  assert.deepEqual(await store.getResult(result.resultId),result)
  await assert.rejects(prisma.$executeRaw`UPDATE ot_factual_result SET canonical = '{}' WHERE id = ${result.resultId}`)
  console.log('READ new-process canonical GET/PDF/latest/ack replay/immutability/concurrent versions/stale disclosure PASS')
 }
}
main().finally(()=>prisma.$disconnect()).catch(()=>{console.error('DISPOSABLE_PROOF_FAILED');process.exitCode=1})
