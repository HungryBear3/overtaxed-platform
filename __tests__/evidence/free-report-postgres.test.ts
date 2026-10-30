/** @jest-environment node */
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// The only acquisition substitution is owned, explicitly invented test data.
jest.mock('@/lib/evidence/server/factual-analysis', () => {
  const actual = jest.requireActual('@/lib/evidence/server/factual-analysis')
  const { createSyntheticAdapter } = jest.requireActual('@/test-support/factual-local-fixture')
  return { ...actual, cookCountyUnsupportedAdapter: createSyntheticAdapter() }
})
// No timer-backed limiter in this native harness; production limiter is unchanged.
jest.mock('@/lib/rate-limit', () => ({rateLimit: () => ({allowed:true}), getClientIdentifier: () => 'owned-native'}))
const enabled = !!process.env.FACTUAL_REPORT_TEST_DATABASE_URL
;(enabled ? describe : describe.skip)('mounted no-money routes against owned PostgreSQL', () => {
  let check: typeof import('@/app/api/free-check/route')
  let report: typeof import('@/app/api/free-check/report/route')
  let db: typeof import('@/lib/db')
  let receipt: any, cookie: string
  const origin = 'https://owned.example.test'
  const request = (url: string, cap = cookie) => new NextRequest(origin + url, { headers: cap ? {cookie: cap, 'sec-fetch-site':'same-origin'} : {} })
  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET = 'test-free-report-native-not-a-real-credential-00000000'
    check = await import('@/app/api/free-check/route')
    report = await import('@/app/api/free-check/report/route')
    db = await import('@/lib/db')
    const response = await check.POST(new NextRequest(origin + '/api/free-check', {method:'POST', headers:{'content-type':'application/json',origin}, body:JSON.stringify({pin:'18062140110000'})}))
    expect(response.status).toBe(200)
    cookie = response.headers.get('set-cookie')!.split(';')[0]
    receipt = await response.json()
  })
  afterAll(async () => { await db?.prisma.$disconnect() })
  it('reloads persisted canonical identity through the actual result route', async () => {
    const r = await check.GET(request('/api/free-check?id='+receipt.resultId))
    expect(r.status).toBe(200)
    const result = await r.json()
    expect(result.resultId).toBe(receipt.resultId)
    expect(result.snapshotId).toBe(receipt.snapshotId)
    expect(result.dataOrigin).toBe('SYNTHETIC_PREVIEW')
  })
  it('generates actual PDF bytes from the persisted result without payment', async () => {
    const response = await report.GET(request('/api/free-check/report?id='+receipt.resultId))
    expect(response.status).toBe(200)
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(bytes.subarray(0,5).toString()).toBe('%PDF-')
    const dir = process.env.FACTUAL_TEST_ARTIFACT_DIR
    if(dir) {
      fs.writeFileSync(path.join(dir,'native-free-report.pdf'),bytes)
      fs.writeFileSync(path.join(dir,'native-free-report-receipt.json'),JSON.stringify({receipt,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,origin:'SYNTHETIC_PREVIEW',providerCalls:0},null,2))
    }
    // Free-only integration deliberately does not install the paid prerequisite.
    // Prove its table is absent rather than introducing it merely for a zero-row check.
    const paid = await db.prisma.$queryRaw<Array<{name:string|null}>>`SELECT to_regclass('public.ot_factual_purchase')::text AS name`
    expect(paid[0].name).toBeNull()
  })
  it('refuses the exact persisted result to a different browser', async () => {
    for(const route of ['/api/free-check?id=','/api/free-check/report?id=']) {
      const response = await (route.includes('report') ? report.GET : check.GET)(request(route+receipt.resultId,''))
      expect(response.status).toBe(404)
      expect((await response.json()).code).toBe('RESULT_NOT_FOUND')
    }
  })
  it('refuses unknown IDs and the database prevents canonical-result mutation', async () => {
    expect((await report.GET(request('/api/free-check/report?id=res_'+'0'.repeat(24)))).status).toBe(404)
    await expect(db.prisma.$executeRaw`UPDATE ot_factual_result SET sha256=${'0'.repeat(64)} WHERE id=${receipt.resultId}`).rejects.toThrow('FACTUAL_RESULT_IMMUTABLE')
    expect((await report.GET(request('/api/free-check/report?id='+receipt.resultId))).status).toBe(200)
  })
})
