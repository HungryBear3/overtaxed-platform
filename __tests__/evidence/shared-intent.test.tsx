/** @jest-environment ./test-support/factual-jsdom-environment.cjs */
import React, { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HomePage from '@/components/ot-design/HomePage'
import { analytics } from '@/lib/analytics/events'
import { createFactualLocalRuntime } from '@/test-support/factual-local-fixture'

function setup(strict = false, delayGet = false) {
  const rt = createFactualLocalRuntime()
  const posts: Array<{ release: (error?: boolean) => Promise<void> }> = []
  const gets: Array<() => void> = []
  const complete = jest.spyOn(analytics, 'factualCheckCompleted').mockImplementation(() => {})
  global.fetch = jest.fn(async (url: any, init?: RequestInit) => {
    if (!String(url).includes('/api/free-check')) return new Response('{}', {status:503})
    if (init?.method !== 'POST') {
      const response = await rt.route.GET(new Request(new URL(String(url), 'http://local')))
      if (delayGet) await new Promise<void>(r => gets.push(r))
      return response
    }
    const req = new Request('http://local/api/free-check', init)
    return new Promise<Response>(resolve => posts.push({ release: async error => resolve(error ? new Response('{"error":"Current held"}', {status:503}) : await rt.route.POST(req)) }))
  }) as any
  const view = render(strict ? <StrictMode><HomePage /></StrictMode> : <HomePage />)
  const input = (surface: string) => view.container.querySelector(surface === 'hero' ? 'form.ot-check-card input' : '.ot-sticky-bar-input') as HTMLInputElement
  const submit = (surface: string, address: string) => {
    fireEvent.change(input(surface), {target:{value:address}})
    fireEvent.submit(input(surface).closest('form')!)
  }
  return {posts, gets, complete, view, input, submit}
}
afterEach(() => jest.restoreAllMocks())

it.each([['hero','sticky'],['sticky','hero']])('%s pending then %s success owns rendering and attribution', async (first, last) => {
  const h = setup()
  h.submit(first, '100 Synthetic Preview Ave'); h.submit(last, '200 Synthetic Preview Ave')
  await act(async () => h.posts[1].release())
  await waitFor(() => expect(screen.getByTestId('factual-summary').textContent).toContain('Berwyn'))
  const id = screen.getByTestId('factual-summary').getAttribute('data-result-id')
  await act(async () => h.posts[0].release())
  expect(screen.getByTestId('factual-summary').getAttribute('data-result-id')).toBe(id)
  expect(h.complete).toHaveBeenCalledTimes(1)
  expect(h.complete.mock.calls[0][0].surface).toBe(last === 'hero' ? 'home_hero' : 'sticky_bar')
})
it.each([['hero','sticky'],['sticky','hero']])('%s old success cannot resurrect after %s latest failure', async (first,last) => {
  const h=setup(); h.submit(first,'100 Synthetic Preview Ave'); h.submit(last,'200 Synthetic Preview Ave')
  await act(async()=>h.posts[1].release(true)); await act(async()=>h.posts[0].release())
  expect(screen.queryByTestId('factual-summary')).toBeNull()
  expect(document.body.textContent).toContain('Current held')
  expect(h.complete).not.toHaveBeenCalled()
})
it.each(['hero','sticky'])('context edit on %s invalidates already rendered result synchronously', async surface=>{
  const h=setup(); h.submit('hero','100 Synthetic Preview Ave'); await act(async()=>h.posts[0].release())
  await screen.findByTestId('factual-summary')
  if(surface==='hero') fireEvent.click(screen.getByText('Check another property'))
  fireEvent.change(h.input(surface),{target:{value:'200 Synthetic Preview Ave'}})
  expect(screen.queryByTestId('factual-summary')).toBeNull()
})
it.each([['hero','sticky'],['sticky','hero']])('%s delayed GET cannot paint under %s new intent',async(first,last)=>{
  const h=setup(false,true);h.submit(first,'100 Synthetic Preview Ave');await act(async()=>h.posts[0].release())
  await waitFor(()=>expect(h.gets).toHaveLength(1))
  if(last==='hero') fireEvent.click(screen.getByText('Check another property'))
  h.submit(last,'200 Synthetic Preview Ave')
  await act(async()=>h.gets[0]())
  expect(screen.queryByTestId('factual-summary')).toBeNull();expect(h.complete).not.toHaveBeenCalled()
  await act(async()=>h.posts[1].release());await waitFor(()=>expect(h.gets).toHaveLength(2))
  await act(async()=>h.gets[1]());await screen.findByTestId('factual-summary')
  expect(h.complete).toHaveBeenCalledTimes(1)
})
it('StrictMode restore invalidates pending requests but permits a legitimate retry',async()=>{
 const h=setup(true);h.submit('hero','100 Synthetic Preview Ave')
 act(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))
 h.submit('sticky','200 Synthetic Preview Ave');await act(async()=>h.posts[0].release())
 expect(screen.queryByTestId('factual-summary')).toBeNull()
 await act(async()=>h.posts[1].release());await screen.findByTestId('factual-summary')
 expect(h.complete).toHaveBeenCalledTimes(1)
})
