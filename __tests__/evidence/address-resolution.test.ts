/** @jest-environment node */
import { createFreeCheckRoute } from '@/lib/evidence/server/free-check-handler'
import { createInMemoryAnalysisStore } from '@/lib/evidence/server/analysis-store'
import { createSyntheticAdapter, SYNTHETIC_ADDRESS, SYNTHETIC_SUBJECT_PIN } from '@/test-support/factual-local-fixture'
const pin = SYNTHETIC_SUBJECT_PIN.replace(/-/g, '')
const other = '18062140210000'
function setup() {
  const base = createSyntheticAdapter()
  const row = {pin, address:SYNTHETIC_ADDRESS, city:'Cicero', zip:'60600'}
  const record = {...row, county:'Cook', township:'Cicero', taxYear:2025, crossStreet:'Example St'}
  const search = jest.fn(async () => ({ok:true, records:[row]}))
  const load = jest.fn(async () => record)
  const acquire = jest.fn(() => base.acquire({pin}))
  const store = createInMemoryAnalysisStore(); const put = jest.spyOn(store,'putResult')
  // Source injection is trusted server configuration, never a JSON body field.
  const adapter = {id:'synthetic-authoritative-records', acquire, addressSource:{search,load}}
  const route = createFreeCheckRoute({adapter,store})
  const post = (body:unknown) => route.POST(new Request('http://local',{method:'POST',body:JSON.stringify(body)}))
  return {post,search,load,acquire,put,row,record}
}
it('rejects a self-consistent wrong-address acquisition with the posted PIN', async () => {
  const t=setup(); t.load.mockResolvedValue({...t.record,address:'999 Other Avenue'})
  expect((await t.post({address:SYNTHETIC_ADDRESS,selectedPin:pin})).status).toBe(409)
  expect(t.acquire).not.toHaveBeenCalled(); expect(t.put).not.toHaveBeenCalled()
})
it('rejects an unoffered selection before acquisition', async () => {
  const t=setup(); t.search.mockResolvedValue({ok:true,records:[{...t.row,pin:other}]})
  expect((await t.post({address:SYNTHETIC_ADDRESS,selectedPin:pin})).status).toBe(409)
  expect(t.acquire).not.toHaveBeenCalled(); expect(t.put).not.toHaveBeenCalled()
})
it('returns useful candidates for unselected ambiguity', async () => {
  const t=setup(); t.search.mockResolvedValue({ok:true,records:[t.row,{...t.row,pin:other}]})
  const r=await t.post({address:SYNTHETIC_ADDRESS}); expect(r.status).toBe(409)
  expect(await r.json()).toMatchObject({code:'ADDRESS_AMBIGUOUS',candidateCount:2,candidates:[{pin},{pin:other}]})
  expect(t.load).not.toHaveBeenCalled(); expect(t.acquire).not.toHaveBeenCalled()
})
it('accepts a chosen corroborated address and binds returned subject', async () => {
  const t=setup(); t.search.mockResolvedValue({ok:true,records:[t.row,{...t.row,pin:other}]})
  const r=await t.post({address:SYNTHETIC_ADDRESS,selectedPin:pin}); expect(r.status).toBe(200)
  expect((await r.json()).subject).toEqual({pin:SYNTHETIC_SUBJECT_PIN,township:'Cicero',taxYear:2025})
  expect(t.acquire).toHaveBeenCalledWith({pin}); expect(t.put).toHaveBeenCalledTimes(1)
})
it.each(['address','unit','crossStreet','taxYear'])('cannot reuse successful resolution after changed %s', async key => {
  const t=setup(); expect((await t.post({address:SYNTHETIC_ADDRESS,selectedPin:pin})).status).toBe(200)
  t.acquire.mockClear(); t.put.mockClear()
  const values={address:'999 Other Avenue',unit:'4B',crossStreet:'Wrong Street',taxYear:'2024'}
  const r=await t.post({address:SYNTHETIC_ADDRESS,selectedPin:pin,[key]:values[key as keyof typeof values]})
  expect(r.status).not.toBe(200); expect(t.acquire).not.toHaveBeenCalled(); expect(t.put).not.toHaveBeenCalled()
})
it('changed city triggers a fresh resolution rather than reusing prior authority', async () => {
  const t=setup(); await t.post({address:SYNTHETIC_ADDRESS,city:'Cicero',selectedPin:pin}); t.search.mockClear()
  await t.post({address:SYNTHETIC_ADDRESS,city:'Berwyn',selectedPin:pin})
  expect(t.search).toHaveBeenCalledWith(expect.any(String),'Berwyn',expect.any(Number),expect.any(Object))
})
it.each(['resolutionId','resolutionContext','verifier','offeredPins'])('rejects public forged %s authority',async key=>{
  const t=setup(); expect((await t.post({address:SYNTHETIC_ADDRESS,[key]:'forged'})).status).toBe(400)
  expect(t.search).not.toHaveBeenCalled(); expect(t.put).not.toHaveBeenCalled()
})
it.each(['township','taxYear','pin'])('rejects wrong returned %s despite consistent acquisition',async key=>{
  const t=setup(); t.load.mockResolvedValue({...t.record,[key]:key==='taxYear'?2024:key==='pin'?other:'Berwyn'})
  expect((await t.post({address:SYNTHETIC_ADDRESS})).status).not.toBe(200); expect(t.put).not.toHaveBeenCalled()
})
it('rejects a different acquired subject after valid address resolution',async()=>{
  const t=setup(); const base=createSyntheticAdapter()
  t.acquire.mockImplementation(()=>base.acquire({pin:other}))
  const r=await t.post({address:SYNTHETIC_ADDRESS,selectedPin:pin})
  expect(r.status).toBe(503); expect(await r.json()).toMatchObject({code:'ACQUISITION_HOLD',hold:'ACQUISITION_REJECTED'})
  expect(t.load).toHaveBeenCalledWith(pin); expect(t.acquire).toHaveBeenCalledWith({pin}); expect(t.put).not.toHaveBeenCalled()
})
it('accepts exact unit/year/cross-street corroboration with the real resolver',async()=>{
  const t=setup()
  t.search.mockResolvedValue({ok:true,records:[{...t.row,address:SYNTHETIC_ADDRESS+' APT 4B'}]})
  t.load.mockResolvedValue({...t.record,address:SYNTHETIC_ADDRESS+' UNIT 4B'})
  expect((await t.post({address:SYNTHETIC_ADDRESS,unit:'4B',taxYear:'2025',crossStreet:'Example Street'})).status).toBe(200)
  expect(t.put).toHaveBeenCalledTimes(1)
})
it('never caches successful context: refreshed wrong-address record fails',async()=>{
  const t=setup(); expect((await t.post({address:SYNTHETIC_ADDRESS})).status).toBe(200)
  t.load.mockResolvedValue({...t.record,address:'999 Other Avenue'}); t.put.mockClear(); t.acquire.mockClear()
  expect((await t.post({address:SYNTHETIC_ADDRESS})).status).toBe(409)
  expect(t.put).not.toHaveBeenCalled(); expect(t.acquire).not.toHaveBeenCalled(); expect(t.search).toHaveBeenCalledTimes(2)
})
it('caps selectable membership at the actual offered list',async()=>{
  const t=setup(); const rows=Array.from({length:9},(_,i)=>({...t.row,pin:`1806214${String(i+1).padStart(3,'0')}0000`}))
  t.search.mockResolvedValue({ok:true,records:rows})
  const r=await t.post({address:SYNTHETIC_ADDRESS,selectedPin:rows[8].pin})
  expect(r.status).toBe(409); expect((await r.json()).candidates).toHaveLength(8); expect(t.load).not.toHaveBeenCalled()
})
it('does not repair malformed provider PIN syntax into authority',async()=>{
  const t=setup(); t.search.mockResolvedValue({ok:true,records:[{...t.row,pin:'x'+pin}]})
  expect((await t.post({address:SYNTHETIC_ADDRESS})).status).toBe(404); expect(t.load).not.toHaveBeenCalled()
})
it('rejects conflicting duplicate source identities rather than first-row wins',async()=>{
  const t=setup(); t.search.mockResolvedValue({ok:true,records:[t.row,{...t.row,address:'999 Other Avenue'}]})
  expect((await t.post({address:SYNTHETIC_ADDRESS})).status).toBe(409); expect(t.load).not.toHaveBeenCalled()
})
it('bounds the authoritative source batch without silently truncating',async()=>{
  const t=setup(); t.search.mockResolvedValue({ok:true,records:Array(101).fill(t.row)})
  expect((await t.post({address:SYNTHETIC_ADDRESS})).status).toBe(503); expect(t.load).not.toHaveBeenCalled()
})
it('rejects malformed bounded JSON before any trusted source work',async()=>{
  const t=setup(); const route=createFreeCheckRoute({store:createInMemoryAnalysisStore(),adapter:{id:'fixture',acquire:t.acquire,addressSource:{search:t.search,load:t.load}}})
  for (const text of ['{"address":"a","address":"b"}',JSON.stringify({address:'a'.repeat(2001)}),'{"address":{}}','[]']) {
    expect((await route.POST(new Request('http://local',{method:'POST',body:text}))).status).toBe(400)
  }
  expect(t.search).not.toHaveBeenCalled(); expect(t.acquire).not.toHaveBeenCalled()
})
it('does not trust an address success from an adapter without resolution authority',async()=>{
  const base=createSyntheticAdapter(); const route=createFreeCheckRoute({store:createInMemoryAnalysisStore(),adapter:{id:'no-resolver',acquire:()=>base.acquire({pin})}})
  const r=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({address:SYNTHETIC_ADDRESS})}))
  expect(r.status).toBe(503)
})
