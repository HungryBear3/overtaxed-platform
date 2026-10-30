/** @jest-environment node */
import {withFactualTransaction} from '@/lib/evidence/server/factual-db'
import {createPostgresAnalysisStore} from '@/lib/evidence/server/postgres-analysis-store'
import {prisma} from '@/lib/db'
const enabled=process.env.OT_FACTUAL_BINDING_REFUSAL==='1'
;(enabled?describe:describe.skip)('native factual binding refuses unsafe or absent authority',()=>{
 afterAll(async()=>{await prisma.$disconnect()})
 it('refuses before callback and exposes only sanitized store failure without altering paid access',async()=>{
  const callback=jest.fn(async()=>true)
  await expect(withFactualTransaction(callback)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'})
  expect(callback).not.toHaveBeenCalled()
  await expect(createPostgresAnalysisStore().getResult('res_'+'0'.repeat(24))).rejects.toThrow('STORAGE_UNAVAILABLE')
  expect(await prisma.$queryRaw`SELECT current_user AS name, value FROM paid_binding_sentinel`).toEqual([{name:'ot_paid_app',value:'paid-unchanged'}])
 })
})
