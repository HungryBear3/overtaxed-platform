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

interface MetaPixelProps {
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
 * Meta Pixel candidate: consent-gated, production-only, canonical-host-only,
 * default off. Environment variable: NEXT_PUBLIC_META_PIXEL_ID.
 *
 * Every gate (lib/analytics/meta-pixel-policy) is checked before a script is
 * inserted, and again before every hit, because the Pixel reports the page URL
 * and referrer by itself. There is no `<noscript>` image: a request made
 * without JavaScript cannot check consent. Renders nothing.
 */
export function MetaPixel({ pixelId }: MetaPixelProps) {
  const pathname = usePathname()

  useEffect(() => {
    if (!mayReportCurrentPage(pixelId)) return
    installMetaPixel(pixelId, () => trackMetaEvent("PageView"))
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
 * The standard Pixel bootstrap, minus everything that reports on its own:
 * pushState page views are disabled, automatic configuration (button and page
 * metadata collection) is off, `init` carries no Advanced Matching data, and
 * no hit is queued. PageView is sent from the script's load handler, through
 * the gated writer, so it describes the page as it is when the hit leaves.
 */
function installMetaPixel(pixelId: string, onReady: () => void): void {
  const metaWindow = window as MetaWindow
  if (metaWindow.fbq) return

  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args)
    else fbq.queue.push(args)
  } as Fbq
  fbq.queue = []
  fbq.push = fbq
  fbq.loaded = true
  fbq.version = "2.0"
  fbq.disablePushState = true
  metaWindow.fbq = fbq
  if (!metaWindow._fbq) metaWindow._fbq = fbq

  fbq("set", "autoConfig", false, pixelId)
  fbq("init", pixelId)

  const script = document.createElement("script")
  script.async = true
  script.src = META_FBEVENTS_URL
  script.addEventListener("load", onReady, { once: true })
  document.head.appendChild(script)
}

/**
 * The only Meta writer. Refuses unless every load gate still holds, the
 * current page is one the Pixel may report, and the event is on the closed
 * allowlist — which has no Purchase and no custom events.
 */
export function trackMetaEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return
  const fbq = (window as MetaWindow).fbq
  if (typeof fbq !== "function") return
  if (!mayReportCurrentPage(process.env.NEXT_PUBLIC_META_PIXEL_ID)) return
  const event = buildMetaBrowserEvent(eventName, params)
  if (!event) return
  fbq("track", event.name, event.params)
}

/** Custom events have no allowlist entry; kept so existing callers stay inert. */
export function trackMetaCustomEvent(_eventName: string, _params?: Record<string, unknown>): void {}
