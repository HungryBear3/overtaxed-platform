"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import {
  META_FBEVENTS_URL,
  buildMetaBrowserEvent,
  decideMetaPixelLoad,
  isMetaSafePageContext,
  readMetaPixelConsent,
} from "@/lib/analytics/meta-pixel-policy"
import { isClientProductionMarketingRuntime } from "@/lib/marketing/preview-gate-client"

interface MetaPixelCandidateProps {
  pixelId: string
}

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[][]
  push: Fbq
  loaded: boolean
  version: string
  disablePushState?: boolean
}

type MetaWindow = Window & { fbq?: Fbq; _fbq?: Fbq }

/**
 * Every `fbq` this module installed, with the pixel it serves and whether that
 * pixel was initialized. An `fbq` that is not in here — a tag manager's, an
 * extension's — is never written to.
 */
const installed = new WeakMap<Fbq, { pixelId: string; initialized: boolean }>()

/**
 * Meta Pixel candidate: consent-gated, production-only, canonical-host-only,
 * default off — and mounted nowhere. Activation is on HOLD: the build refuses
 * to run while NEXT_PUBLIC_META_PIXEL_ID is set (next.config.mjs), and there
 * is no consent surface to grant it.
 *
 * Every gate (lib/analytics/meta-pixel-policy) is checked before a script is
 * inserted, and again before every hit, because the Pixel reports the page URL
 * and referrer by itself. Nothing is ever queued for the vendor script to send
 * later. There is no `<noscript>` image: a request made without JavaScript
 * cannot check consent. Renders nothing.
 */
export function MetaPixelCandidate({ pixelId }: MetaPixelCandidateProps) {
  const pathname = usePathname()

  useEffect(() => {
    if (!mayReportCurrentPage(pixelId)) return
    installMetaPixel(pixelId)
  }, [pixelId, pathname])

  return null
}

function mayReportCurrentPage(pixelId: unknown): boolean {
  if (typeof window === "undefined") return false
  const decision = decideMetaPixelLoad({
    pixelId,
    productionRuntime: isClientProductionMarketingRuntime(),
    host: window.location.host,
    consent: readMetaPixelConsent(),
  })
  if (!decision.allowed) return false
  return isMetaSafePageContext({
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    referrer: document.referrer,
  })
}

/**
 * The standard Pixel bootstrap, minus everything that reports on its own or
 * reports late. The stub never queues: until fbevents.js has taken over
 * dispatch (`callMethod`), a call is dropped, so there is no backlog for the
 * SDK to send after consent was withdrawn or the page changed. pushState page
 * views are disabled; `init` carries no Advanced Matching data and runs, with
 * automatic configuration off, only once the SDK is ready and every gate still
 * holds for the page as it is then.
 */
function installMetaPixel(pixelId: string): void {
  const metaWindow = window as MetaWindow
  if (metaWindow.fbq) return

  const fbq = function (...args: unknown[]) {
    if (typeof fbq.callMethod === "function") fbq.callMethod(...args)
  } as Fbq
  fbq.queue = []
  fbq.push = fbq
  fbq.loaded = true
  fbq.version = "2.0"
  fbq.disablePushState = true
  metaWindow.fbq = fbq
  if (!metaWindow._fbq) metaWindow._fbq = fbq
  installed.set(fbq, { pixelId, initialized: false })

  const script = document.createElement("script")
  script.async = true
  script.src = META_FBEVENTS_URL
  script.addEventListener("load", () => initializeWhenReady(fbq), { once: true })
  document.head.appendChild(script)
}

function initializeWhenReady(fbq: Fbq): void {
  const state = installed.get(fbq)
  if (!state || typeof fbq.callMethod !== "function") return
  if (!mayReportCurrentPage(state.pixelId)) return
  fbq("set", "autoConfig", false, state.pixelId)
  fbq("init", state.pixelId)
  state.initialized = true
  trackMetaEvent("PageView")
}

/**
 * The only Meta writer. Hands a hit to the SDK this module installed — and
 * only once that SDK is ready and its pixel initialized — while every load
 * gate still holds, the current page is one the Pixel may report, and the
 * event is on the closed allowlist, which has no Purchase and no custom
 * events. Anything else is dropped, never deferred.
 */
export function trackMetaEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return
  const fbq = (window as MetaWindow).fbq
  const state = fbq ? installed.get(fbq) : undefined
  if (!fbq || !state?.initialized) return
  if (!mayReportCurrentPage(state.pixelId)) return
  const event = buildMetaBrowserEvent(eventName, params)
  if (!event) return
  fbq("track", event.name, event.params)
}

/** Custom events have no allowlist entry; kept so existing callers stay inert. */
export function trackMetaCustomEvent(_eventName: string, _params?: Record<string, unknown>): void {}
