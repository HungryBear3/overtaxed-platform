'use client'
import { useEffect, useState } from 'react'
import type { OfficialDeadlineSnapshot } from './official-source-state'
import { decodeInformationalSnapshot } from './informational-snapshot'

// Always pass an explicit snapshot: undefined would permit the legacy bundled default.
export const UNAVAILABLE_INFORMATIONAL_SNAPSHOT: OfficialDeadlineSnapshot = {
  schemaVersion: 1, synthetic: true, sources: { assessor: null, bor: null }, townships: {},
}

/** Public informational reads only; the existing calendar hook owns canonical expiry. */
export function useLiveInformationalSnapshot(): OfficialDeadlineSnapshot {
  const [snapshot, setSnapshot] = useState(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
  useEffect(() => {
    const isVisible = () => document.visibilityState !== 'hidden'
    let mounted = true
    let generation = 0
    let controller: AbortController | undefined
    let timeout: number | undefined
    const invalidate = () => {
      generation++
      controller?.abort()
      window.clearTimeout(timeout)
    }
    const refresh = async () => {
      invalidate()
      setSnapshot(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
      if (!isVisible()) return
      const current = generation
      const request = new AbortController()
      controller = request
      timeout = window.setTimeout(() => {
        if (mounted && current === generation) {
          invalidate()
          setSnapshot(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
        }
      }, 15_000)
      try {
        const response = await fetch('/api/deadlines/informational', {
          method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: request.signal,
        })
        const raw = response.status === 200 ? await response.text() : null
        if (mounted && current === generation && !request.signal.aborted && isVisible()) {
          setSnapshot(raw === null ? UNAVAILABLE_INFORMATIONAL_SNAPSHOT
            : decodeInformationalSnapshot(raw, new Date()) ?? UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
        }
      } catch {
        if (mounted && current === generation) setSnapshot(UNAVAILABLE_INFORMATIONAL_SNAPSHOT)
      } finally {
        // A late completion must not clear the newer request's timeout.
        if (current === generation) window.clearTimeout(timeout)
      }
    }
    const activeRefresh = () => {
      if (isVisible()) void refresh()
    }
    void refresh()
    const interval = window.setInterval(activeRefresh, 300_000)
    window.addEventListener('focus', activeRefresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      mounted = false
      invalidate()
      window.clearInterval(interval)
      window.removeEventListener('focus', activeRefresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return snapshot
}
