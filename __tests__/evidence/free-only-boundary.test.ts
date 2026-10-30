/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {createSyntheticAdapter,SYNTHETIC_SUBJECT_PIN} from '@/test-support/factual-local-fixture'
import {analyzeAcquisition} from '@/lib/evidence/server/factual-analysis'
import {createPostgresAnalysisStore} from '@/lib/evidence/server/postgres-analysis-store'
import {produceFactualPreviewPdf} from '@/lib/evidence/server/factual-document'
import {withFactualTransaction} from '@/lib/evidence/server/factual-db'
// Raw denial probes use the same checked dedicated transaction as the store.
const prisma = {
 $queryRaw: <T>(strings:TemplateStringsArray,...values:unknown[])=>withFactualTransaction(tx=>tx.$queryRaw<T>(strings,...values)),
 $executeRaw: (strings:TemplateStringsArray,...values:unknown[])=>withFactualTransaction(tx=>tx.$executeRaw(strings,...values)),
 $disconnect: async()=>{},
}

const native = process.env.FACTUAL_APP_TEST_DATABASE_URL ? describe : describe.skip
native('least-privilege application connection, real PostgreSQL',()=>{
 afterAll(async()=>prisma.$disconnect())
 it('is the dedicated non-superuser non-bypass role, not an administrative connection',async()=>{
  const roles=await prisma.$queryRaw<Array<{name:string;rolsuper:boolean;rolbypassrls:boolean}>>`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`
  expect(roles).toEqual([{name:'ot_factual_app',rolsuper:false,rolbypassrls:false}])
 })
 it('persists, reloads, serializes new versions, issues and consumes a disclosure once, and renders the persisted PDF',async()=>{
  const store=createPostgresAnalysisStore(), adapter=createSyntheticAdapter()
  const acquisition=await adapter.acquire({pin:SYNTHETIC_SUBJECT_PIN})
  const one=await analyzeAcquisition(store,acquisition)
  expect(one.ok).toBe(true);if(!one.ok)throw Error('NO_RESULT')
  const result=await store.getResult(one.result.resultId)
  expect(result).toEqual(one.result)
  expect(await store.getLatestResult(one.result.subject)).toEqual(result)
  const token=await store.issueDisclosure(one.result.resultId)
  expect(token).toMatch(/^[a-f0-9]{64}$/)
  expect(await store.consumeDisclosure(one.result.resultId,token!)).toEqual(result)
  expect(await store.consumeDisclosure(one.result.resultId,token!)).toBeUndefined()
  const two=await analyzeAcquisition(store,acquisition)
  expect(two.ok).toBe(true);if(!two.ok)throw Error('NO_RESULT')
  expect(two.result.snapshotVersion).toBe(one.result.snapshotVersion+1)
  expect(await store.getLatestResult(one.result.subject)).toEqual(two.result)
  expect(await store.getResult(one.result.resultId)).toEqual(result)
  const pdf=await produceFactualPreviewPdf(store,one.result.resultId,{generatedAt:'2026-10-20T12:00:00Z'})
  expect(pdf.bytes.subarray(0,5).toString()).toBe('%PDF-')
  await expect(prisma.$executeRaw`UPDATE ot_factual_latest SET subject_key=subject_key WHERE false`).rejects.toThrow(/permission denied/)
  await expect(prisma.$executeRaw`UPDATE ot_factual_disclosure SET token_sha256=token_sha256 WHERE false`).rejects.toThrow(/permission denied/)
  await expect(prisma.$executeRaw`UPDATE ot_factual_result SET canonical='{}' WHERE id=${one.result.resultId}`).rejects.toThrow(/permission denied/)
  await expect(prisma.$executeRaw`DELETE FROM ot_factual_result WHERE id=${one.result.resultId}`).rejects.toThrow(/permission denied/)
  expect(await store.getResult(one.result.resultId)).toEqual(result)
 })
})

test('free-only runtime does not import paid purchase or shared paid PDF renderer',()=>{
 const root=process.cwd(), doc=fs.readFileSync(path.join(root,'lib/evidence/server/factual-document.ts'),'utf8')
 expect(doc).toContain('./free-factual-pdf')
 expect(doc).not.toContain('@/lib/fulfillment/t2-artifact-pdf')
 for(const p of ['app/api/ot/factual-purchase/route.ts','lib/evidence/server/factual-purchase.ts','prisma/migrations/20261019150000_factual_purchase_binding/migration.sql'])expect(fs.existsSync(path.join(root,p))).toBe(false)
})
