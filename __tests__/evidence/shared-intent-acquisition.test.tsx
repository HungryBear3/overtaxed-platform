/** @jest-environment ./test-support/factual-jsdom-environment.cjs */
import {act,render,screen,waitFor} from '@testing-library/react'
import HomePage from '@/components/ot-design/HomePage'
import {createFactualLocalRuntime,SYNTHETIC_SUBJECT_PIN} from '@/test-support/factual-local-fixture'

it('reacquiring the same receipt is a new GET generation, never an old GET adoption',async()=>{
 const rt=createFactualLocalRuntime()
 const receipt=await(await rt.route.POST(new Request('http://local/api/free-check',{method:'POST',body:JSON.stringify({pin:SYNTHETIC_SUBJECT_PIN})}))).json()
 const releases:Array<()=>void>=[]
 global.fetch=jest.fn(async(url:any)=>{
  if(!String(url).includes('/api/free-check'))return new Response('{}',{status:503})
  const response=await rt.route.GET(new Request(new URL(String(url),'http://local')))
  await new Promise<void>(r=>releases.push(r));return response
 }) as any
 render(<HomePage/>)
 const acquire=()=>act(()=>{window.dispatchEvent(new CustomEvent('ot:free-check-result',{detail:{result:receipt}}))})
 acquire();await waitFor(()=>expect(releases).toHaveLength(1))
 acquire()
 await act(async()=>releases[0]())
 expect(screen.queryByTestId('factual-summary')).toBeNull()
 await waitFor(()=>expect(releases).toHaveLength(2))
 await act(async()=>releases[1]());await screen.findByTestId('factual-summary')
})
