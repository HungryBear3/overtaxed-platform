"use client"

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { LookupReceiptSchema } from '@/lib/evidence/public-factual-contract'

export type Intent = { generation: number; route: string }
const route = () => typeof window === 'undefined' ? '' : window.location.pathname

/** Page-owned, never global. Synchronous acquisition fences POST, GET and paint.
 * Receipt identity includes the server-issued tuple; no input or token is logged.
 */
function createCoordinator() {
  let generation = 0
  const listeners = new Set<() => void>()
  const receipts = new WeakMap<object, { owner: Intent; key: string }>()
  const key = (value: unknown) => {
    const r = LookupReceiptSchema.safeParse(value)
    return r.success ? JSON.stringify(r.data) : ''
  }
  const store = {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    snapshot: () => generation,
    begin: (): Intent => {
      generation += 1
      const owner = {generation, route: route()}
      listeners.forEach(fn => fn())
      return owner
    },
    owns: (owner: Intent) => owner.generation === generation && owner.route === route(),
    bind: (value: unknown, owner: Intent) => {
      if (!store.owns(owner)) return false
      if (value && typeof value === 'object') receipts.set(value, {owner, key:key(value)})
      return true
    },
    version: (value: unknown) => value && typeof value === 'object' ? receipts.get(value)?.owner.generation ?? 0 : 0,
    accepts: (value: unknown) => {
      if (!value || typeof value !== 'object') return true
      const bound = receipts.get(value)
      return !bound || (store.owns(bound.owner) && bound.key === key(value))
    },
  }
  return store
}
const Context = createContext<ReturnType<typeof createCoordinator> | null>(null)
export function SharedIntentProvider({children}: {children: ReactNode}) {
  const [store] = useState(createCoordinator)
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) store.begin() }
    const leave = () => { store.begin() }
    window.addEventListener('pageshow', restore)
    window.addEventListener('pagehide', leave)
    window.addEventListener('popstate', leave)
    return () => {
      window.removeEventListener('pageshow', restore)
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('popstate', leave)
      store.begin()
    }
  }, [store])
  return <Context.Provider value={store}>{children}</Context.Provider>
}
export function useSharedIntent() {
  const shared = useContext(Context)
  const [local] = useState(createCoordinator)
  const store = shared ?? local
  useEffect(() => () => { if (!shared) local.begin() }, [shared, local])
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  return store
}
