"use client"

import { usePathname } from "next/navigation"
import { isPrivateSurfacePath } from "@/lib/analytics/private-surfaces"

/**
 * Mounts its children everywhere EXCEPT the private transactional surfaces.
 *
 * The root layout is shared by every route in this app, so anything mounted
 * there runs on `/packet` — the page that holds a customer's one-time packet
 * code in memory. That page's own contract says no analytics, no third-party
 * widget and no error reporter observes what is typed into it; this is what
 * prevents cold-load instrumentation. PrivateDocumentGate separately forces a
 * fresh document before a form mounts after public-route navigation. Unmounting
 * instrumentation alone does not undo already executed scripts.
 *
 * A client component because the decision needs the pathname, and because the
 * things being gated are all client effects: capture hooks, a route tracker, a
 * script tag. Returning `null` means they are never rendered and never mounted
 * on a private path — not rendered-then-suppressed.
 *
 * Route CONTENT never passes through here. Only instrumentation does, so a
 * change to this component can suppress telemetry and can never blank a page.
 */
export function InstrumentationBoundary({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  // `usePathname` is null only before hydration in edge cases; treating an
  // unknown path as private is the fail-closed direction.
  if (pathname === null || isPrivateSurfacePath(pathname)) return null
  return <>{children}</>
}
