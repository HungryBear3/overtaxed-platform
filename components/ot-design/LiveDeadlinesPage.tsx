'use client'
import DeadlinesPage from './DeadlinesPage'
import type { OfficialDeadlineSnapshot } from '@/lib/deadlines/official-source-state'
import { useLiveInformationalSnapshot } from '@/lib/deadlines/use-live-informational-snapshot'

/**
 * `initialSnapshot` and `evaluatedAt` come from one server read at one instant
 * (see app/deadlines/page.tsx), so server HTML and first hydration match.
 * Omitted, the page starts explicitly unavailable.
 */
export default function LiveDeadlinesPage(
  { initialSnapshot, evaluatedAt }: { initialSnapshot?: OfficialDeadlineSnapshot; evaluatedAt?: string } = {},
) {
  const snapshot = useLiveInformationalSnapshot(initialSnapshot)
  return <DeadlinesPage snapshot={snapshot} evaluatedAt={evaluatedAt} />
}
