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

/** One effect run of a mounted candidate. Inactive from its cleanup on. */
type Owner = { active: boolean }

type Installation = { pixelId: string; script: HTMLScriptElement; initialized: boolean; owner: Owner | null }

/**
 * Every `fbq` this module installed, with the pixel it serves, its script,
 * whether that pixel was initialized, and the live mount it now answers to —
 * none once that mount is gone. An `fbq` that is not in here — a tag
 * manager's, an extension's — is never written to.
 */
const installed = new WeakMap<Fbq, Installation>()

/**
 * Meta Pixel candidate: consent-gated, production-only, canonical-host-only,
 * default off — and mounted nowhere. Activation is on HOLD: the build refuses
 * to run while NEXT_PUBLIC_META_PIXEL_ID is set (next.config.mjs), and there
 * is no consent surface to grant it.
 *
 * Every gate (lib/analytics/meta-pixel-policy) is checked before a script is
 * inserted, and again before every hit, because the Pixel reports the page URL
 * and referrer by itself. Nothing is ever queued for the vendor script to send
 * later, and nothing is sent once the mount that asked for the Pixel is gone:
 * each effect run owns the installation until its cleanup, and a script load
 * or SDK that arrives after that finds no live owner. There is no `<noscript>`
 * image: a request made without JavaScript cannot check consent. Renders
 * nothing.
 */
export function MetaPixelCandidate({ pixelId }: MetaPixelCandidateProps) {
  const pathname = usePathname()

  useEffect(() => {
    if (!mayReportCurrentPage(pixelId)) return
    const owner: Owner = { active: true }
    const release = attachMetaPixel(pixelId, owner)
    return () => {
      owner.active = false
      release()
    }
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
    href: window.location.href,
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    referrer: document.referrer,
  })
}

/**
 * Makes `owner` the live mount of this page's installation — installing it
 * first if there is none — and returns the cleanup that ends that ownership
 * and detaches the owner's load callback. A later mount adopts the same
 * installation: one script per page, and an SDK that became ready while no
 * mount was live is initialized for the new owner, on the page as it is now.
 */
function attachMetaPixel(pixelId: string, owner: Owner): () => void {
  const metaWindow = window as MetaWindow
  const fbq = metaWindow.fbq ?? installMetaPixel(pixelId)
  const installation = installed.get(fbq)
  if (!installation || installation.pixelId !== pixelId) return () => {}

  installation.owner = owner
  const onLoad = () => initializeWhenReady(fbq, owner)
  installation.script.addEventListener("load", onLoad, { once: true })
  initializeWhenReady(fbq, owner)

  return () => {
    installation.script.removeEventListener("load", onLoad)
    if (installation.owner === owner) installation.owner = null
  }
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
function installMetaPixel(pixelId: string): Fbq {
  const metaWindow = window as MetaWindow
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

  const script = document.createElement("script")
  script.async = true
  script.src = META_FBEVENTS_URL
  installed.set(fbq, { pixelId, script, initialized: false, owner: null })
  document.head.appendChild(script)
  return fbq
}

/** Initializes once, for `owner` only while it is the live mount, on a page the Pixel may report. */
function initializeWhenReady(fbq: Fbq, owner: Owner): void {
  const installation = installed.get(fbq)
  if (!installation || installation.initialized || !isLiveOwner(installation, owner)) return
  if (typeof fbq.callMethod !== "function") return
  if (!mayReportCurrentPage(installation.pixelId)) return
  fbq("set", "autoConfig", false, installation.pixelId)
  fbq("init", installation.pixelId)
  installation.initialized = true
  trackMetaEvent("PageView")
}

function isLiveOwner(installation: Installation, owner: Owner | null): boolean {
  return owner !== null && owner.active && installation.owner === owner
}

/**
 * The only Meta writer. Hands a hit to the SDK this module installed — and
 * only once that SDK is ready, its pixel initialized and a mount is live —
 * while every load gate still holds, the current page is one the Pixel may
 * report, and the event is on the closed allowlist, which has no Purchase and
 * no custom events. Anything else is dropped, never deferred.
 */
export function trackMetaEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return
  const fbq = (window as MetaWindow).fbq
  const installation = fbq ? installed.get(fbq) : undefined
  if (!fbq || !installation?.initialized) return
  // Read the caller's values first, so nothing they do while being read can
  // change the page or the consent after the check below.
  const event = buildMetaBrowserEvent(eventName, params)
  if (!event) return
  if (!isLiveOwner(installation, installation.owner)) return
  if (!mayReportCurrentPage(installation.pixelId)) return
  fbq("track", event.name, event.params)
}

/** Custom events have no allowlist entry; kept so existing callers stay inert. */
export function trackMetaCustomEvent(_eventName: string, _params?: Record<string, unknown>): void {}
