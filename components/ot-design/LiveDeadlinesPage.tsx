'use client'
import DeadlinesPage from './DeadlinesPage'
import { useLiveInformationalSnapshot } from '@/lib/deadlines/use-live-informational-snapshot'

export default function LiveDeadlinesPage() {
  const snapshot = useLiveInformationalSnapshot()
  return <DeadlinesPage snapshot={snapshot} />
}
