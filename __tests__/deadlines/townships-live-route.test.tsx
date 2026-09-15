import { act, render } from '@testing-library/react'
import TownshipsPage from '@/app/townships/page'
import DeadlinesPage from '@/app/deadlines/page'
import { TOWNSHIPS } from '@/lib/townships'
import { INFORMATIONAL_SOURCE_URL } from '@/lib/deadlines/informational-snapshot'

jest.mock('@/lib/analytics/events', () => ({ analytics: { deadlineMapView: jest.fn() } }))
const AT = new Date('2026-09-12T20:00:00Z')
const originalFetch = global.fetch
function fixture(at = AT) {
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: 'cook_county_assessor', sourceUrl: INFORMATIONAL_SOURCE_URL, finalUrl: INFORMATIONAL_SOURCE_URL,
    httpStatus: 200, retrievedAt: at.toISOString(), sourceUpdatedAt: null, contentSha256: 'a'.repeat(64),
    parseStatus: 'ok', parserVersion: 'ccao-dom/1.0.0',
  } }, townships: Object.fromEntries(TOWNSHIPS.map(t => [t.slug, { townshipName: t.name, stages: {
    assessor: t.slug === 'barrington' ? { noticeDate: '2026-08-24', openDate: '2026-08-24', lastFileDate: '2026-09-23' } : null,
  } }])) }
}
const response = (value: unknown) => ({ status: 200, text: async () => JSON.stringify(value) })
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(AT); global.fetch = jest.fn() })
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers() })

it.each([['townships', TownshipsPage], ['deadlines', DeadlinesPage]] as const)(
  '%s uses the real live calendar, then removes dates when the feed fails', async (_, Page) => {
    jest.mocked(fetch).mockResolvedValue(response(fixture()) as Response)
    const view = render(<Page />)
    await act(async () => {})
    expect(view.container.textContent).toContain('Sep 23, 2026')
    expect(view.container.textContent).toContain(AT.toISOString())
    expect(fetch).toHaveBeenCalledWith('/api/deadlines/informational', expect.objectContaining({ cache: 'no-store' }))
    expect(view.container.querySelector('input[type="email"]')).toBeNull()
    expect(view.container.textContent).not.toMatch(/Get notified|filing-ready packet/)
    jest.mocked(fetch).mockResolvedValue(response(null) as Response)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(view.container.textContent).not.toContain('Sep 23, 2026')
    expect(view.container.textContent).not.toContain(AT.toISOString())
    view.unmount()
  },
)
it('withdraws mounted township dates at Chicago midnight without a new successful response', async () => {
  const at = new Date('2026-09-13T04:59:59Z')
  jest.setSystemTime(at)
  jest.mocked(fetch).mockResolvedValue(response(fixture(at)) as Response)
  const view = render(<TownshipsPage />)
  await act(async () => {})
  expect(view.container.textContent).toContain('Sep 23, 2026')
  act(() => jest.advanceTimersByTime(1000))
  expect(view.container.textContent).not.toContain('Sep 23, 2026')
  expect(fetch).toHaveBeenCalledTimes(1)
})
