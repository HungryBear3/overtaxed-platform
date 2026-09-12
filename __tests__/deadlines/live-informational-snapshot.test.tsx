import { act, renderHook } from '@testing-library/react'
import { useLiveInformationalSnapshot, UNAVAILABLE_INFORMATIONAL_SNAPSHOT } from '@/lib/deadlines/use-live-informational-snapshot'
import { INFORMATIONAL_SOURCE_URL } from '@/lib/deadlines/informational-snapshot'
import { TOWNSHIPS } from '@/lib/townships'

const AT = new Date('2026-09-12T07:00:00Z')
const previousFetch = global.fetch
const response = (raw: unknown, status = 200) => ({ status, text: async () => JSON.stringify(raw) })
function fixture(hash = 'a') {
  return { schemaVersion: 1, synthetic: false, sources: { bor: null, assessor: {
    authority: 'cook_county_assessor', sourceUrl: INFORMATIONAL_SOURCE_URL, finalUrl: INFORMATIONAL_SOURCE_URL,
    httpStatus: 200, retrievedAt: AT.toISOString(), sourceUpdatedAt: null, contentSha256: hash.repeat(64),
    parseStatus: 'ok', parserVersion: 'ccao-dom/1.0.0',
  } }, townships: Object.fromEntries(TOWNSHIPS.map(t => [t.slug, { townshipName: t.name, stages: { assessor: null } }])) }
}
function pending() {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}
let fetchMock: jest.Mock
let visibility: jest.SpyInstance
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(AT)
  fetchMock = jest.fn(() => new Promise(() => {})); global.fetch = fetchMock
  visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { global.fetch = previousFetch; visibility.mockRestore(); jest.useRealTimers() })
const flush = async () => { await act(async () => {}) }

test('initial delayed response is explicitly unavailable; exact source receipt is retained', async () => {
  const request = pending(); fetchMock.mockReturnValue(request.promise)
  const { result } = renderHook(useLiveInformationalSnapshot)
  expect(result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
  expect(fetchMock).toHaveBeenCalledWith('/api/deadlines/informational', expect.objectContaining({ method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: expect.any(AbortSignal) }))
  await act(async () => { request.resolve(response(fixture())) })
  expect(result.current.sources.assessor?.retrievedAt).toBe(AT.toISOString())
  expect(result.current).toEqual(fixture())
})
test('focus supersedes and aborts old requests, including reversed late completions', async () => {
  const first = pending(), second = pending(); fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const { result } = renderHook(useLiveInformationalSnapshot)
  const signal = fetchMock.mock.calls[0][1].signal
  act(() => window.dispatchEvent(new Event('focus')))
  expect(signal.aborted).toBe(true)
  await act(async () => { second.resolve(response(fixture('b'))) })
  await act(async () => { first.resolve(response(fixture('a'))) })
  expect(result.current.sources.assessor?.contentSha256).toBe('b'.repeat(64))
})
test('hidden aborts and clears, late hidden completion is ignored, resume refreshes', async () => {
  fetchMock.mockResolvedValueOnce(response(fixture()))
  const { result } = renderHook(useLiveInformationalSnapshot); await flush()
  const old = pending(); fetchMock.mockReturnValueOnce(old.promise)
  act(() => window.dispatchEvent(new Event('focus')))
  const signal = fetchMock.mock.calls[1][1].signal
  act(() => { visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')) })
  expect(signal.aborted).toBe(true); expect(result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
  await act(async () => { old.resolve(response(fixture())) })
  act(() => jest.advanceTimersByTime(300_000)); expect(fetchMock).toHaveBeenCalledTimes(2)
  fetchMock.mockResolvedValueOnce(response(fixture('c')))
  await act(async () => { visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')) })
  expect(result.current.sources.assessor?.contentSha256).toBe('c'.repeat(64))
})
test('refreshes every five active minutes and aborts/removes timers/listeners on cleanup', async () => {
  fetchMock.mockResolvedValueOnce(response(fixture()))
  const { result, unmount } = renderHook(useLiveInformationalSnapshot); await flush()
  act(() => jest.advanceTimersByTime(299_999)); expect(fetchMock).toHaveBeenCalledTimes(1)
  act(() => jest.advanceTimersByTime(1)); expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
  const signal = fetchMock.mock.calls[1][1].signal
  unmount(); expect(signal.aborted).toBe(true); expect(jest.getTimerCount()).toBe(0)
  act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
test.each([null, {}, { bad: 'shape' }, fixture('invalid')])('invalid response never becomes a bundled fallback', async raw => {
  fetchMock.mockResolvedValue(response(raw))
  const { result } = renderHook(useLiveInformationalSnapshot); await flush()
  expect(result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
})
test.each(['non200', 'malformed', 'network', 'body'])('fails closed for %s', async failure => {
  if (failure === 'network') fetchMock.mockRejectedValue(new Error('untrusted network error'))
  else fetchMock.mockResolvedValue(failure === 'non200' ? response(fixture(), 503) : {
    status: 200, text: async () => { if (failure === 'body') throw new Error('body failure'); return 'not json' },
  })
  const { result } = renderHook(useLiveInformationalSnapshot); await flush()
  expect(result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
})
test('completion clock refuses stale source; timeout bounds a stalled body', async () => {
  const request = pending(); fetchMock.mockReturnValueOnce(request.promise)
  const { result, unmount } = renderHook(useLiveInformationalSnapshot)
  await act(async () => { jest.setSystemTime(new Date(AT.getTime() + 86_400_001)); request.resolve(response(fixture())) })
  expect(result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT); unmount()
  fetchMock.mockResolvedValue({ status: 200, text: () => new Promise(() => {}) })
  const mounted = renderHook(useLiveInformationalSnapshot); await flush()
  const signal = fetchMock.mock.calls[1][1].signal
  act(() => jest.advanceTimersByTime(15_000))
  expect(signal.aborted).toBe(true); expect(mounted.result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
})
test('future retrieval and initially hidden mount remain unavailable without fallback', async () => {
  visibility.mockReturnValue('hidden')
  const hidden = renderHook(useLiveInformationalSnapshot)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(hidden.result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT); hidden.unmount()
  visibility.mockReturnValue('visible'); jest.setSystemTime(new Date(AT.getTime() - 1))
  fetchMock.mockResolvedValue(response(fixture()))
  const mounted = renderHook(useLiveInformationalSnapshot); await flush()
  expect(mounted.result.current).toBe(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
})
