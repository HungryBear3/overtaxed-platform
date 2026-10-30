/** @jest-environment ./test-support/factual-jsdom-environment.cjs */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HomePage from '@/components/ot-design/HomePage'
import { createFactualLocalRuntime, SYNTHETIC_SUBJECT_PIN } from '@/test-support/factual-local-fixture'

function setup() {
  const rt = createFactualLocalRuntime()
  const pending: Array<{ body: any; release: (response?: Response) => Promise<void> }> = []
  global.fetch = jest.fn(async (url: any, init?: RequestInit) => {
    if (init?.method !== 'POST') return rt.route.GET(new Request(new URL(String(url), 'http://local')))
    const req = new Request('http://local/api/free-check', init)
    return new Promise<Response>(resolve => pending.push({ body: JSON.parse(String(init.body)), release: async response => resolve(response ?? await rt.route.POST(req)) }))
  }) as any
  render(<HomePage />)
  const input = () => screen.getAllByPlaceholderText('123 S Sample Ave, La Grange IL')[1]
  const submit = (address: string) => {
    fireEvent.change(input(), { target: { value: address } })
    fireEvent.submit(input().closest('form')!)
  }
  return { pending, submit, input }
}

it('mounted POST A pending -> B success -> late A cannot replace B', async () => {
  const h = setup()
  h.submit('100 Synthetic Preview Ave')
  h.submit('200 Synthetic Preview Ave')
  await act(async () => h.pending[1].release())
  await waitFor(() => expect(screen.getByTestId('factual-summary').textContent).toContain('Berwyn'))
  const id = screen.getByTestId('factual-summary').getAttribute('data-result-id')
  await act(async () => h.pending[0].release())
  expect(screen.getByTestId('factual-summary').getAttribute('data-result-id')).toBe(id)
})
it.each(['input', 'mode'])('changing %s invalidates A before any replacement POST', async kind => {
  const h = setup()
  h.submit('100 Synthetic Preview Ave')
  if (kind === 'input') fireEvent.change(h.input(), { target: { value: '200 Synthetic Preview Ave' } })
  else fireEvent.click(screen.getByRole('button', { name: /I have my PIN instead/ }))
  await act(async () => h.pending[0].release())
  expect(screen.queryByTestId('factual-summary')).toBeNull()
  expect(screen.queryByText('Check another property')).toBeNull()
})
it('latest error cannot reveal late old success', async () => {
  const h = setup()
  h.submit('100 Synthetic Preview Ave'); h.submit('200 Synthetic Preview Ave')
  await act(async () => h.pending[1].release(new Response(JSON.stringify({ error: 'Held current lookup' }), { status: 503 })))
  await act(async () => h.pending[0].release())
  expect(screen.getByRole('alert').textContent).toContain('Held current lookup')
  expect(screen.queryByTestId('factual-summary')).toBeNull()
})
it('address submit never includes a retained hidden PIN', async () => {
  const h = setup()
  fireEvent.click(screen.getByRole('button', { name: /I have my PIN instead/ }))
  fireEvent.change(screen.getByPlaceholderText('16-01-216-001-0000'), { target: { value: SYNTHETIC_SUBJECT_PIN } })
  fireEvent.click(screen.getByRole('button', { name: /Look up by address instead/ }))
  h.submit('  200 Synthetic Preview Ave  ')
  expect(h.pending[0].body).toEqual({ mode: 'address', address: '200 Synthetic Preview Ave' })
})
it.each([
  { mode: 'address', address: '200 Synthetic Preview Ave', pin: SYNTHETIC_SUBJECT_PIN },
  { mode: 'pin', address: '200 Synthetic Preview Ave', pin: SYNTHETIC_SUBJECT_PIN },
  { address: '200 Synthetic Preview Ave', pin: SYNTHETIC_SUBJECT_PIN },
  { mode: 'other', pin: SYNTHETIC_SUBJECT_PIN },
  { mode: 'pin', pin: 'letters18062140110000' },
  { mode: 'pin', pin: SYNTHETIC_SUBJECT_PIN, selectedPin: SYNTHETIC_SUBJECT_PIN },
])('route refuses ambiguous/invalid identity %j before acquisition', async body => {
  const rt = createFactualLocalRuntime()
  const response = await rt.route.POST(new Request('http://local/api/free-check', { method: 'POST', body: JSON.stringify(body) }))
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'LOOKUP_INVALID' })
})
