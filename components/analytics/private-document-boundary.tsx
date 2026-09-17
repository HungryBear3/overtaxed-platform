"use client"

import { createContext, useContext, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { isPrivateSurfacePath } from "@/lib/analytics/private-surfaces"

const PrivateDocument = createContext(false)

/** Root-layout lifetime, not page lifetime. Once a public route has rendered,
 * evaluated third-party scripts may survive their React unmount. Never clear
 * this latch in the same document, including private -> public -> private.
 * Recording during render also blocks the first private render, before effects.
 * An abandoned public render can only cause an unnecessary safe reload.
 */
export function PrivateDocumentBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const publicRouteSeen = useRef(false)
  if (pathname !== null && !isPrivateSurfacePath(pathname)) publicRouteSeen.current = true
  const clean = pathname !== null && isPrivateSurfacePath(pathname) && !publicRouteSeen.current
  return <PrivateDocument.Provider value={clean}>{children}</PrivateDocument.Provider>
}

/** No form mounts in an instrumented document, even for a single effect/frame.
 * A fixed generic destination strips query/fragment; no bearer value is read.
 * If navigation fails the form stays absent and the ordinary link is usable.
 */
export function PrivateDocumentGate({ children }: { children: React.ReactNode }) {
  const clean = useContext(PrivateDocument)
  useEffect(() => {
    if (!clean) window.location.replace("/packet")
  }, [clean])
  if (!clean) return <p role="status">Opening the secure download page. <a href="/packet">Continue</a></p>
  return <>{children}</>
}
