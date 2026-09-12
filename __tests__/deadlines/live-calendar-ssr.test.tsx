/** @jest-environment node */
import { renderToString } from 'react-dom/server'
import LiveDeadlinesPage from '@/components/ot-design/LiveDeadlinesPage'
import Page from '@/app/deadlines/page'
import type { OfficialDeadlineSnapshot } from '@/lib/deadlines/official-source-state'
import { UNAVAILABLE_INFORMATIONAL_SNAPSHOT } from '@/lib/deadlines/use-live-informational-snapshot'

const snapshots: Array<OfficialDeadlineSnapshot | undefined> = []
jest.mock('@/components/ot-design/DeadlinesPage', () => ({
  __esModule: true,
  default: ({ snapshot }: { snapshot?: OfficialDeadlineSnapshot }) => {
    snapshots.push(snapshot)
    return <div>Informational calendar unavailable</div>
  },
}))
jest.mock('@/components/ot-design/SiteChrome', () => ({ SiteHeader: () => <header />, SiteFooter: () => <footer /> }))

test.each(['wrapper', 'page'])('%s SSR passes an explicit unavailable snapshot and never fetches', surface => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('SSR must not fetch'))
  snapshots.length = 0
  try {
    const html = renderToString(surface === 'wrapper' ? <LiveDeadlinesPage /> : <Page />)
    expect(html).toContain('Informational calendar unavailable')
    expect(snapshots).toEqual([UNAVAILABLE_INFORMATIONAL_SNAPSHOT])
    expect(snapshots[0]?.sources).toEqual({ assessor: null, bor: null })
    expect(fetch).not.toHaveBeenCalled()
  } finally { fetch.mockRestore() }
})
