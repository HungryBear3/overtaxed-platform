/** @jest-environment ./test-support/factual-jsdom-environment.cjs */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import HomePage from '@/components/ot-design/HomePage'
import { createFactualLocalRuntime } from '@/test-support/factual-local-fixture'

// Migration: estimator outcomes/preview bodies are retired, not normalized.
// Every positive now traverses the real POST receipt and GET stored result.
function setup(rewrite?: (body: any) => any, failure = false) {
  window.scrollTo = jest.fn()
  const rt = createFactualLocalRuntime()
  const responses: any[] = []
  const fetchMock = jest.fn(async (url: any, init?: RequestInit) => {
    const req = new Request(new URL(String(url), 'http://local'), init)
    if (init?.method === 'POST') {
      if (failure) return new Response(JSON.stringify({ error: 'No Cook County property found for this address.' }), { status: 404 })
      const res = await rt.route.POST(req)
      responses.push(await res.clone().json())
      return res
    }
    const res = await rt.route.GET(req)
    return rewrite ? new Response(JSON.stringify(rewrite(await res.json()))) : res
  })
  global.fetch = fetchMock as any
  render(<HomePage />)
  return { responses, fetchMock }
}
function submit(sticky = false, address = '100 Synthetic Preview Ave') {
  const input = screen.getAllByPlaceholderText('123 S Sample Ave, La Grange IL')[sticky ? 0 : 1]
  fireEvent.change(input, { target: { value: address } })
  fireEvent.submit(input.closest('form')!)
}
function noOffer() {
  expect(screen.queryByText(/DIY Appeal Packet \$69/)).toBeNull()
  expect(screen.queryByText(/Done-For-You/)).toBeNull()
  expect(screen.queryByRole('link', { name: /^Contingency$/ })).toBeNull()
}
async function refused() {
  await screen.findByTestId('factual-refused')
  expect(screen.queryByTestId('factual-summary')).toBeNull()
  expect(screen.getByTestId('factual-refused').closest('.ot-check-card')!.textContent).not.toMatch(/\$42,500|\$999|12\.1%/)
  noOffer()
}

describe('OT home free-check flow — factual-only migration', () => {
  it('submits hero and renders a canonical Cicero receipt instead of legacy equityRatio', async () => {
    const h = setup(); submit()
    const summary = await screen.findByTestId('factual-summary')
    expect(summary.getAttribute('data-result-id')).toBe(h.responses[0].resultId)
    expect(summary.textContent).toContain('Cicero')
    expect(summary.textContent).toContain('$42,500.00')
    expect(summary.textContent).not.toMatch(/equity|overpayment|12\.1%/i)
    expect(h.fetchMock).toHaveBeenCalledWith('/api/free-check', expect.objectContaining({ method: 'POST' }))
  })
  it('sticky quick check dispatches the same visible server result panel', async () => {
    const h = setup(); submit(true)
    const summary = await screen.findByTestId('factual-summary')
    expect(summary.getAttribute('data-result-id')).toBe(h.responses[0].resultId)
    expect(summary.textContent).toContain('Cicero')
    noOffer()
  })
  it('does not offer a packet when a favorable checkout outcome is injected into factual records', async () => {
    setup(b => ({ ...b, outcome: { code: 'supportive', allowCheckout: true, showFigures: true } })); submit()
    await refused()
  })
  it('fails closed on a contradictory outcome tuple rather than normalizing it', async () => {
    setup(b => ({ ...b, outcome: { code: 'insufficient_evidence', allowCheckout: true, showFigures: true } })); submit()
    await refused()
  })
  it('renders raw Berwyn records without a fabricated fair-assessment verdict or signed estimated gap', async () => {
    const h = setup(); submit(false, '200 Synthetic Preview Ave')
    const summary = await screen.findByTestId('factual-summary')
    expect(summary.getAttribute('data-result-id')).toBe(h.responses[0].resultId)
    expect(summary.textContent).toContain('$39,000.00')
    expect(summary.textContent).toContain('SYNTHETIC PREVIEW')
    expect(summary.textContent).not.toMatch(/not supportive|No overpayment|estimated|\+-\$|\-\$13,858/i)
    noOffer()
  })
  it('shows API errors instead of falling back to the sample', async () => {
    setup(undefined, true); submit()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No Cook County property found'))
    expect(screen.queryByTestId('factual-summary')).toBeNull()
    noOffer()
  })
  it('does not fabricate a deadline when the API window is UNKNOWN', async () => {
    setup(); submit()
    const summary = await screen.findByTestId('factual-summary')
    expect(summary.textContent).toContain('Filing window: UNKNOWN')
    expect(summary.textContent).toContain('not actionable')
    expect(summary.textContent).not.toMatch(/until close|Jul 31|window closes/)
    noOffer()
  })
  it('refuses unqualified future-cycle township windows without open urgency', async () => {
    setup(b => ({ ...b, window: { state: 'upcoming', actionable: false, openDate: '2028-05-08', closeDate: '2028-06-12' } })); submit()
    await refused()
    expect(document.body.textContent).not.toContain('2028-05-08')
  })
  it.each([
    ['omitted limitations', (b: any) => ({ ...b, limitations: [] })],
    ['wrong binding', (b: any) => ({ ...b, resultId: 'res_' + 'z'.repeat(24) })],
    ['normalized claims', (b: any) => ({ ...b, status: 'VALIDATED', validationRef: 1, subjectPerSqft: 999, relativeGap: 0.4 })],
  ])('refuses %s through the actual homepage consumer', async (_name, rewrite) => {
    setup(rewrite); submit(); await refused()
  })
})
