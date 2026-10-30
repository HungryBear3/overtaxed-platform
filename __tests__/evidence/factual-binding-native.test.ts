/** @jest-environment node */
import {prisma} from '@/lib/db'
import {withFactualTransaction} from '@/lib/evidence/server/factual-db'
import {createPostgresAnalysisStore} from '@/lib/evidence/server/postgres-analysis-store'
import {analyzeAcquisition} from '@/lib/evidence/server/factual-analysis'
import {createSyntheticAdapter,SYNTHETIC_SUBJECT_PIN} from '@/test-support/factual-local-fixture'
const native=process.env.FACTUAL_APP_TEST_DATABASE_URL?describe:describe.skip
native('dedicated factual connection preserves paid client',()=>{
 afterAll(async()=>{await prisma.$disconnect()})
 it('paid client retains paid-only authority before and after actual factual store operations',async()=>{
  const before=await prisma.$queryRaw<any[]>`SELECT current_user AS name, value FROM paid_binding_sentinel`
  expect(before).toEqual([{name:'ot_paid_app',value:'paid-unchanged'}])
  await expect(prisma.$queryRaw`SELECT * FROM ot_factual_result`).rejects.toThrow(/permission denied/)
  const store=createPostgresAnalysisStore(), adapter=createSyntheticAdapter()
  const configured=process.env.OT_FACTUAL_DATABASE_URL
  delete process.env.OT_FACTUAL_DATABASE_URL
  try {await expect(store.getResult('res_'+'0'.repeat(24))).rejects.toThrow('STORAGE_UNAVAILABLE')}
  finally {process.env.OT_FACTUAL_DATABASE_URL=configured}
  await withFactualTransaction(async tx=>{
   const a=await tx.$queryRaw<any[]>`SELECT current_user AS role, pg_backend_pid() AS pid, txid_current()::text AS xid`
   const b=await tx.$queryRaw<any[]>`SELECT current_user AS role, pg_backend_pid() AS pid, txid_current()::text AS xid`
   expect(a[0].role).toBe('ot_factual_app');expect(b).toEqual(a)
  })
  await expect(withFactualTransaction(tx=>tx.$queryRaw`SELECT * FROM paid_binding_sentinel`)).rejects.toThrow(/permission denied/)
  const acquired=await adapter.acquire({pin:SYNTHETIC_SUBJECT_PIN})
  const result=await analyzeAcquisition(store,acquired)
  expect(result.ok).toBe(true);if(!result.ok)throw Error('NO_RESULT')
  expect(await store.getResult(result.result.resultId)).toEqual(result.result)
  expect(await prisma.$queryRaw`SELECT current_user AS name, value FROM paid_binding_sentinel`).toEqual(before)
  await expect(prisma.$queryRaw`SELECT * FROM ot_factual_result`).rejects.toThrow(/permission denied/)
 })
})
