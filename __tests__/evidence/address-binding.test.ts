/** @jest-environment node */
import { createFreeCheckRoute } from '@/lib/evidence/server/free-check-handler'
import { createInMemoryAnalysisStore } from '@/lib/evidence/server/analysis-store'
import { createSyntheticAdapter, SYNTHETIC_ADDRESS, SYNTHETIC_SUBJECT_PIN, SYNTHETIC_SECOND_PIN } from '@/test-support/factual-local-fixture'

it.each(['selectedPin', 'pin'])('rejects an acquisition for a different %s before storage', async field => {
  const store = createInMemoryAnalysisStore()
  const put = jest.spyOn(store, 'putResult')
  const adapter = createSyntheticAdapter()
  const acquire = jest.fn(() => adapter.acquire({address:SYNTHETIC_ADDRESS}))
  const route = createFreeCheckRoute({store, adapter:{id:'synthetic-mismatch', acquire}})
  const body = field === 'pin' ? {pin:SYNTHETIC_SECOND_PIN} : {address:SYNTHETIC_ADDRESS, selectedPin:SYNTHETIC_SECOND_PIN}
  const response = await route.POST(new Request('http://local', {method:'POST',body:JSON.stringify(body)}))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({code:'ACQUISITION_HOLD',hold:'ACQUISITION_REJECTED'})
  expect(put).not.toHaveBeenCalled()
})
it.each([SYNTHETIC_SUBJECT_PIN, SYNTHETIC_SUBJECT_PIN.replace(/-/g,'')])('accepts selected parcel binding %s', async selectedPin => {
  const route=createFreeCheckRoute({store:createInMemoryAnalysisStore(),adapter:createSyntheticAdapter()})
  const response=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({address:SYNTHETIC_ADDRESS,selectedPin})}))
  expect(response.status).toBe(200)
  expect((await response.json()).subject.pin).toBe(SYNTHETIC_SUBJECT_PIN)
})
