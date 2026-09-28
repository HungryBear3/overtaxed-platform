/**
 * Browser storage for the immutable first touch and the last non-direct touch.
 *
 * A touch is recorded once per document, from the URL the document loaded at:
 *
 *   - the FIRST touch is the first landing seen inside the attribution window,
 *     direct or not, and is never overwritten while it is still valid;
 *   - the LAST NON-DIRECT touch is the most recent landing that carried at
 *     least one acceptable UTM value. A direct landing never replaces it.
 *
 * A landing whose referrer is this site is an internal navigation, not a touch.
 * The site's own pages re-tag onward links (`/hoa` tags its links
 * `utm_source=hoa`, the township pages tag theirs `utm_medium=organic`), and
 * counting those would replace the campaign a visitor actually arrived from.
 * The referrer is only compared, never stored. Client-side navigations reuse
 * this module instance and are never landings.
 *
 * Stored copies are revalidated against the touch contract before they are
 * trusted for anything, including suppressing a recapture: a value this code
 * did not write — unparseable, an unrecognized key, a hostile value, an instant
 * outside the window — counts as absent and is replaced by the next landing.
 *
 * localStorage only. No cookie, no network, and nothing here is read by any
 * analytics event; the only consumer is the checkout request, whose server
 * revalidates it again.
 */

import {
  type AttributionTouch,
  isCampaignTouch,
  sanitizeTouch,
  touchFromLanding,
} from "./touch-contract"

const FIRST_TOUCH_KEY = "ot_touch_first_v1"
const LAST_TOUCH_KEY = "ot_touch_last_v1"
const CANONICAL_HOSTS: ReadonlySet<string> = new Set(["overtaxed-il.com", "www.overtaxed-il.com"])

/** One landing per document. A fresh page load is a fresh module instance. */
let landingRecorded = false

function readTouch(key: string, now: number): AttributionTouch | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    return sanitizeTouch(JSON.parse(raw), now)
  } catch {
    return null
  }
}

function readLastTouch(now: number): AttributionTouch | null {
  const touch = readTouch(LAST_TOUCH_KEY, now)
  return touch && isCampaignTouch(touch) ? touch : null
}

function writeTouch(key: string, touch: AttributionTouch): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(touch))
  } catch {
    // Storage unavailable: the touch is simply not kept.
  }
}

function isInternalReferrer(referrer: string): boolean {
  if (!referrer) return false
  try {
    const url = new URL(referrer)
    return url.origin === window.location.origin || CANONICAL_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Record this document's landing. Safe to call more than once; only the first call counts. */
export function recordLandingTouch(): void {
  if (typeof window === "undefined" || landingRecorded) return
  landingRecorded = true
  try {
    if (isInternalReferrer(document.referrer)) return

    const now = Date.now()
    const current = touchFromLanding({ search: window.location.search, pathname: window.location.pathname, at: now })
    const storedFirst = readTouch(FIRST_TOUCH_KEY, now)
    const storedLast = readLastTouch(now)

    // When the first touch is missing or expired, the oldest surviving touch
    // becomes it, so the first touch is never newer than the last one.
    if (!storedFirst) writeTouch(FIRST_TOUCH_KEY, storedLast ?? current)
    if (isCampaignTouch(current)) writeTouch(LAST_TOUCH_KEY, current)
  } catch {
    // Attribution is never load-bearing for the page that is rendering.
  }
}

/** The `attribution` field of the checkout request body, or nothing. */
export function getCheckoutAttributionForRequest(): {
  attribution?: { first?: AttributionTouch; last?: AttributionTouch }
} {
  if (typeof window === "undefined") return {}
  const now = Date.now()
  const first = readTouch(FIRST_TOUCH_KEY, now)
  const last = readLastTouch(now)
  if (!first && !last) return {}
  return { attribution: { ...(first ? { first } : {}), ...(last ? { last } : {}) } }
}
