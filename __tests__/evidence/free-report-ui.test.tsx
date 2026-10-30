/** @jest-environment ./test-support/factual-jsdom-environment.cjs */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FreeReportAction } from '@/components/check/SharedEvidenceSummary'
import HomePage from '@/components/ot-design/HomePage'
import { analytics } from '@/lib/analytics/events'
import { createInMemoryAnalysisStore } from '@/lib/evidence/server/analysis-store'
import { createGuardedFreeCheckRoute } from '@/lib/evidence/server/free-check-handler'
import { createFreeReportRoute } from '@/lib/evidence/server/free-report-handler'
import { createFreeResultAccess } from '@/lib/evidence/server/free-result-access'
import { createSyntheticAdapter } from '@/test-support/factual-local-fixture'

const SECRET = 'test-only-secret-0123456789abcdef0123456789abcdef'

/** Simulated same-origin browser: one cookie jar, real guarded handlers. */
function setup(reportOverride?: (req: Request) => Promise<Response>) {
  const store = createInMemoryAnalysisStore()
  const access = createFreeResultAccess({ secret: SECRET })
  const check = createGuardedFreeCheckRoute({ adapter: createSyntheticAdapter(), store, access })
  const report = createFreeReportRoute({ store, access, now: () => '2026-10-20T00:00:00.000Z' })
  let jar = ''
  const reportCalls: string[] = []
  const release: Array<() => void> = []
  jest.spyOn(analytics, 'factualCheckCompleted').mockImplementation(() => {})
  global.fetch = jest.fn(async (url: any, init?: RequestInit) => {
    const u = new URL(String(url), 'http://local')
    const headers = new Headers(init?.headers)
    if (jar) headers.set('cookie', jar)
    const req = new Request(u, { ...init, headers })
    if (u.pathname === '/api/free-check/report') {
      reportCalls.push(u.search)
      await new Promise<void>((r) => release.push(r))
      return reportOverride ? reportOverride(req) : report.GET(req)
    }
    if (u.pathname !== '/api/free-check') return new Response('{}', { status: 503 })
    const res = init?.method === 'POST' ? await check.POST(req) : await check.GET(req)
    const set = res.headers.get('set-cookie')
    if (set) jar = set.split(';')[0]
    return res
  }) as any
  const created: Blob[] = []
  ;(URL as any).createObjectURL = jest.fn((b: Blob) => { created.push(b); return 'blob:local/1' })
  ;(URL as any).revokeObjectURL = jest.fn()
  const view = render(<HomePage />)
  const input = view.container.querySelector('form.ot-check-card input') as HTMLInputElement
  fireEvent.change(input, { target: { value: '100 Synthetic Preview Ave' } })
  fireEvent.submit(input.closest('form')!)
  return { reportCalls, release, created, view }
}
beforeEach(() => jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

it.each(['success', 'failure', 'blob-rejection'])('abandons an old result download after receipt changes: %s', async (outcome) => {
  let resolve!: (r: Response) => void
  global.fetch = jest.fn(() => new Promise<Response>(r => { resolve = r })) as any
  ;(URL as any).createObjectURL = jest.fn(() => 'blob:stale')
  ;(URL as any).revokeObjectURL = jest.fn()
  const view = render(<FreeReportAction resultId={'res_' + 'a'.repeat(24)} />)
  fireEvent.click(screen.getByRole('button'))
  view.rerender(<FreeReportAction resultId={'res_' + 'b'.repeat(24)} />)
  await act(async () => {
    const response = new Response('%PDF-stale', { status: outcome === 'failure' ? 503 : 200, headers: { 'content-type': 'application/pdf' } })
    if (outcome === 'blob-rejection') response.blob = async () => { throw new Error('body failed') }
    resolve(response)
  })
  expect((URL as any).createObjectURL).not.toHaveBeenCalled()
  expect(screen.getByTestId('factual-report-status').textContent).toMatch(/^Free\./)
  expect(screen.getByRole('button')).toHaveProperty('disabled', false)
})

it('shared result view offers a no-money factual PDF action bound to the server result', async () => {
  const h = setup()
  const summary = await screen.findByTestId('factual-summary')
  const id = summary.getAttribute('data-result-id')!
  const button = screen.getByRole('button', { name: /download factual record \(pdf\)/i })
  expect(screen.getByTestId('factual-report-status').textContent).toContain('Summary plus detail for the subject and at most 100 cohort parcels; all records remain shown above.')
  expect(button.closest('[data-testid="factual-report-action"]')!.textContent).not.toMatch(/\$|pay|purchase|upgrade|checkout/i)
  fireEvent.click(button)
  expect(button).toHaveProperty('disabled', true)
  expect(screen.getByTestId('factual-report-status').textContent).toMatch(/preparing/i)
  fireEvent.click(button)
  await waitFor(() => expect(h.release).toHaveLength(1))
  expect(h.reportCalls).toEqual([`?id=${id}`])
  await act(async () => h.release[0]())
  await waitFor(() => expect(screen.getByTestId('factual-report-status').textContent).toMatch(/download started/i))
  expect(screen.getByTestId('factual-report-status').textContent).toContain('Summary plus detail for the subject and at most 100 cohort parcels; all records remain shown above.')
  expect(button).toHaveProperty('disabled', false)
  expect(h.created).toHaveLength(1)
  expect(h.created[0].type).toBe('application/pdf')
  expect((URL as any).revokeObjectURL).toHaveBeenCalledWith('blob:local/1')
})

it('report refusal shows a truthful error and clears busy state', async () => {
  const h = setup(async () => new Response(JSON.stringify({ error: 'Result not found.', code: 'RESULT_NOT_FOUND' }), { status: 404, headers: { 'content-type': 'application/json' } }))
  await screen.findByTestId('factual-summary')
  const button = screen.getByRole('button', { name: /download factual record \(pdf\)/i })
  fireEvent.click(button)
  await waitFor(() => expect(h.release).toHaveLength(1))
  await act(async () => h.release[0]())
  await waitFor(() => expect(screen.getByTestId('factual-report-status').textContent).toMatch(/could not be produced/i))
  expect(screen.getByTestId('factual-report-status').getAttribute('role')).toBe('alert')
  expect(button).toHaveProperty('disabled', false)
  expect(h.created).toHaveLength(0)
})

it('a non-PDF success body is not presented as a download', async () => {
  const h = setup(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  await screen.findByTestId('factual-summary')
  fireEvent.click(screen.getByRole('button', { name: /download factual record \(pdf\)/i }))
  await waitFor(() => expect(h.release).toHaveLength(1))
  await act(async () => h.release[0]())
  await waitFor(() => expect(screen.getByTestId('factual-report-status').textContent).toMatch(/could not be produced/i))
  expect(h.created).toHaveLength(0)
})
