/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.overtaxed-il.com/"}
 *
 * The consent-gated, default-off Meta Pixel candidate. Nothing mounts it (see
 * meta-pixel-activation-hold.test.tsx); these tests mount it directly.
 *
 * The Pixel sends the page URL and referrer on every hit by itself, so a
 * closed parameter list is not enough: the page the hit would describe must
 * be an approved static path with no query, and the referrer must be empty or
 * a static page of this origin. Every refusal happens before any script is
 * inserted or any `fbq` call is made, and nothing is ever queued for the SDK
 * to send later: a hit is authorized when it is handed to the loaded SDK, or
 * dropped. Nothing here is mocked below the preview gate: the real installer,
 * the real consent reader and the real allowlist run. `runSdk` stands in for
 * fbevents.js — it takes over dispatch and drains whatever the bootstrap
 * queued, exactly as the vendor script does — so its calls are everything
 * that would leave the page.
 */
import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

let mockProduction = true
jest.mock("@/lib/marketing/preview-gate-client", () => ({
  isClientPreviewStubMode: () => !mockProduction,
  isClientProductionMarketingRuntime: () => mockProduction,
}))
const push = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => window.location.pathname,
}))

import CheckoutPage from "@/components/ot-design/CheckoutPage"
import { MetaPixelCandidate, trackMetaCustomEvent, trackMetaEvent } from "@/components/analytics/meta-pixel"
import { analytics } from "@/lib/analytics/events"
import {
  META_FBEVENTS_URL,
  MARKETING_CONSENT_STORAGE_KEY,
  buildMetaBrowserEvent,
  decideMetaPixelLoad,
  isMetaSafePageContext,
  parseMarketingConsent,
  readMetaPixelConsent,
} from "@/lib/analytics/meta-pixel-policy"
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract"

const PIXEL_ID = "1234567890123456"
const NOW = Date.parse("2026-09-28T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

type FbqStub = ((...args: unknown[]) => void) & {
  queue: unknown[][]
  callMethod?: (...args: unknown[]) => void
  disablePushState?: boolean
}

function grantConsent(at = NOW - DAY) {
  localStorage.setItem(MARKETING_CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, meta_pixel: "granted", decided_at: at }))
}

function setReferrer(referrer: string) {
  Object.defineProperty(document, "referrer", { configurable: true, value: referrer })
}

function fbq(): FbqStub | undefined {
  return (window as unknown as { fbq?: FbqStub }).fbq
}

function pixelScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll("script")).filter((script) => script.src.includes("facebook"))
}

/**
 * What fbevents.js does when it executes: install `callMethod`, then send
 * every call the bootstrap queued. The script's load event fires after that.
 * Returns the SDK's dispatch, which records every call that would leave.
 */
function runSdk(): jest.Mock {
  const sdk = jest.fn()
  const stub = fbq()!
  act(() => {
    stub.callMethod = sdk
    for (const call of stub.queue.splice(0)) sdk(...call)
    pixelScripts()[0].dispatchEvent(new Event("load"))
  })
  return sdk
}

function tracks(sdk: jest.Mock): unknown[][] {
  return sdk.mock.calls.filter((call) => call[0] === "track")
}

let nowSpy: jest.SpyInstance
let fetchSpy: jest.Mock
let beaconSpy: jest.Mock

beforeEach(() => {
  mockProduction = true
  process.env.NEXT_PUBLIC_META_PIXEL_ID = PIXEL_ID
  localStorage.clear()
  setReferrer("")
  window.history.replaceState({}, "", "/")
  nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW)
  fetchSpy = jest.fn()
  global.fetch = fetchSpy as unknown as typeof fetch
  beaconSpy = jest.fn()
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconSpy })
  delete (window as { fbq?: unknown }).fbq
  delete (window as { _fbq?: unknown })._fbq
  for (const script of pixelScripts()) script.remove()
  push.mockReset()
})

afterEach(() => {
  nowSpy.mockRestore()
  delete process.env.NEXT_PUBLIC_META_PIXEL_ID
  delete (window as { gtag?: unknown }).gtag
})

describe("load decision", () => {
  it.each([
    [{ pixelId: undefined }, "not_configured"],
    [{ pixelId: "" }, "not_configured"],
    [{ pixelId: "123456789" }, "not_configured"],
    [{ pixelId: "1234567890123456'); alert(1);//" }, "not_configured"],
    [{ productionRuntime: false }, "non_production"],
    [{ host: "overtaxed-platform-git-branch.vercel.app" }, "non_canonical_host"],
    [{ host: "localhost:3000" }, "non_canonical_host"],
    [{ host: null }, "non_canonical_host"],
    [{ consent: "unknown" }, "no_consent"],
    [{ consent: "denied" }, "no_consent"],
  ])("refuses %j with %s", (change, reason) => {
    const input = { pixelId: PIXEL_ID, productionRuntime: true, host: "www.overtaxed-il.com", consent: "granted", ...change }

    expect(decideMetaPixelLoad(input as never)).toEqual({ allowed: false, reason })
  })

  it("allows only a configured pixel in production on the canonical host with explicit consent", () => {
    expect(
      decideMetaPixelLoad({ pixelId: PIXEL_ID, productionRuntime: true, host: "overtaxed-il.com", consent: "granted" }),
    ).toEqual({ allowed: true, pixelId: PIXEL_ID })
  })
})

describe("explicit consent", () => {
  it.each([
    ["an explicit grant", { version: 1, meta_pixel: "granted", decided_at: NOW - DAY }, "granted"],
    ["an explicit refusal", { version: 1, meta_pixel: "denied", decided_at: NOW - DAY }, "denied"],
    ["an expired grant", { version: 1, meta_pixel: "granted", decided_at: NOW - 181 * DAY }, "unknown"],
    ["a grant from the future", { version: 1, meta_pixel: "granted", decided_at: NOW + DAY }, "unknown"],
    ["another consent version", { version: 2, meta_pixel: "granted", decided_at: NOW - DAY }, "unknown"],
    ["a truthy stand-in", { version: 1, meta_pixel: true, decided_at: NOW - DAY }, "unknown"],
    ["an extra field", { version: 1, meta_pixel: "granted", decided_at: NOW - DAY, email: "a@b.c" }, "unknown"],
    ["a string instant", { version: 1, meta_pixel: "granted", decided_at: String(NOW) }, "unknown"],
  ])("reads %s as %s", (_label, record, expected) => {
    expect(parseMarketingConsent(JSON.stringify(record), NOW)).toBe(expected)
  })

  it("treats absent or unparseable storage as unknown", () => {
    expect(parseMarketingConsent(null, NOW)).toBe("unknown")
    expect(parseMarketingConsent("granted", NOW)).toBe("unknown")
  })

  it("removes an expired or tampered consent record and keeps a valid one", () => {
    localStorage.setItem(MARKETING_CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, meta_pixel: "granted", decided_at: NOW - 400 * DAY }))
    expect(readMetaPixelConsent()).toBe("unknown")
    expect(localStorage.getItem(MARKETING_CONSENT_STORAGE_KEY)).toBeNull()

    grantConsent()
    expect(readMetaPixelConsent()).toBe("granted")
    expect(localStorage.getItem(MARKETING_CONSENT_STORAGE_KEY)).not.toBeNull()
  })
})

/**
 * The Pixel reports `location.href` and `document.referrer` raw, so a value is
 * reportable only when it is provably safe as raw bytes: no query at all
 * (except the one literal checkout link), no fragment, and a referrer that is
 * empty or a static page of this same canonical origin. A token's shape proves
 * nothing — a PIN, a street address or a Stripe id fits a "click id" pattern —
 * and another site's hostname is text somebody else chose.
 */
describe("page context the Pixel would describe", () => {
  const context = (overrides: Partial<{ origin: string; pathname: string; search: string; hash: string; referrer: string }> = {}) => ({
    origin: "https://www.overtaxed-il.com",
    pathname: "/",
    search: "",
    hash: "",
    referrer: "",
    ...overrides,
  })

  it.each([
    ["the home page", {}],
    ["the apex canonical origin", { origin: "https://overtaxed-il.com" }],
    ["an approved static page", { pathname: "/check" }],
    ["the literal checkout plan link", { pathname: "/checkout", search: "?plan=diy" }],
    ["a same-origin static referrer", { referrer: "https://www.overtaxed-il.com/pricing" }],
    ["a same-origin home referrer", { referrer: "https://www.overtaxed-il.com/" }],
  ])("accepts %s", (_label, overrides) => {
    expect(isMetaSafePageContext(context(overrides))).toBe(true)
  })

  it.each([
    // Page URL: path.
    ["a dynamic path", { pathname: "/townships/cicero" }],
    ["an unlisted path carrying a name and address", { pathname: "/clients/jane-doe-123-main-st" }],
    ["a PIN as the path", { pathname: "/16-01-216-001-0000" }],
    ["an email as the path", { pathname: "/jane@example.test" }],
    ["the private packet page", { pathname: "/packet" }],
    // Page URL: any query other than the literal checkout link.
    ["a PIN laundered as a Meta click id", { search: "?fbclid=16-01-216-001-0000" }],
    ["a name and street laundered as a Meta click id", { search: "?fbclid=jane-doe-123-main-st" }],
    ["a Checkout Session id laundered as a Meta click id", { search: "?fbclid=cs_live_a1B2c3D4e5F6g7H8" }],
    ["a PaymentIntent id laundered as a Meta click id", { search: "?fbclid=pi_3Nabcdefghijklmn" }],
    ["an order id laundered as a Meta click id", { search: "?fbclid=ord_t2_customer_000001" }],
    ["a shape-valid Meta click id", { search: "?fbclid=IwAR0abcDEF_123-xyz" }],
    ["governed source and medium", { search: "?utm_source=facebook&utm_medium=paid_social" }],
    ["a customer name as utm_content", { search: "?utm_content=jane_doe" }],
    ["a PIN in the query", { pathname: "/check", search: "?pin=16012160010000" }],
    ["an email in the query", { search: "?email=jane%40example.test" }],
    ["an order in the query", { pathname: "/checkout", search: "?order=ord_123" }],
    ["a search term", { search: "?utm_source=google&utm_term=jane+doe" }],
    ["an unapproved campaign", { search: "?utm_campaign=ot_202610_acq_cicero" }],
    ["an ungoverned source", { search: "?utm_source=jane_doe" }],
    ["a repeated key", { search: "?utm_source=facebook&utm_source=google" }],
    ["a malformed click id", { search: "?fbclid=jane@example.test" }],
    ["a plan outside checkout", { search: "?plan=diy" }],
    ["an unknown plan", { pathname: "/checkout", search: "?plan=dfy" }],
    ["the plan link plus a click id", { pathname: "/checkout", search: "?plan=diy&fbclid=16-01-216-001-0000" }],
    ["a percent-encoded plan", { pathname: "/checkout", search: "?plan=di%79" }],
    ["a trailing separator", { pathname: "/checkout", search: "?plan=diy&" }],
    ["a fragment", { hash: "#result" }],
    // Page origin.
    ["a preview origin", { origin: "https://overtaxed-platform-git-branch.vercel.app" }],
    ["a non-https origin", { origin: "http://www.overtaxed-il.com" }],
    ["a canonical host on another port", { origin: "https://www.overtaxed-il.com:8443" }],
    // Referrer: never another origin, whatever its shape.
    ["another site's root carrying a name and address", { referrer: "https://jane-doe-123-main-st.example.test/" }],
    ["a Meta redirector root", { referrer: "https://l.facebook.com/" }],
    ["a search engine root", { referrer: "https://www.google.com/" }],
    ["the Stripe checkout host", { referrer: "https://checkout.stripe.com/" }],
    ["a referrer with a path", { referrer: "https://partner.example.test/clients/jane-doe" }],
    ["a referrer with a query", { referrer: "https://www.google.com/?q=jane+doe" }],
    ["a referrer with credentials", { referrer: "https://jane:secret@partner.example.test/" }],
    ["the other canonical origin", { referrer: "https://overtaxed-il.com/pricing" }],
    ["this host over http", { referrer: "http://www.overtaxed-il.com/pricing" }],
    ["this host on another port", { referrer: "https://www.overtaxed-il.com:8443/pricing" }],
    ["a same-origin referrer with a PIN query", { referrer: "https://www.overtaxed-il.com/check?pin=16-01-216-001-0000" }],
    ["a same-origin referrer with an empty query", { referrer: "https://www.overtaxed-il.com/pricing?" }],
    ["a same-origin referrer with a fragment", { referrer: "https://www.overtaxed-il.com/pricing#ord_123" }],
    ["a same-origin referrer with credentials", { referrer: "https://jane:secret@www.overtaxed-il.com/pricing" }],
    ["a same-origin dynamic referrer", { referrer: "https://www.overtaxed-il.com/townships/cicero" }],
    ["a same-origin unlisted referrer", { referrer: "https://www.overtaxed-il.com/clients/jane-doe-123-main-st" }],
    ["a non-https referrer", { referrer: "android-app://com.google.android.gm/" }],
    ["an unparseable referrer", { referrer: "jane doe 123 main st" }],
  ])("refuses %s", (_label, overrides) => {
    expect(isMetaSafePageContext(context(overrides))).toBe(false)
  })
})

describe("the closed Meta event allowlist", () => {
  it("builds InitiateCheckout from checkout values only", () => {
    expect(buildMetaBrowserEvent("InitiateCheckout", { content_name: "T2", value: 69, email: "a@b.c", pin: "16012160010000" })).toEqual({
      name: "InitiateCheckout",
      params: { content_name: "T2", currency: "USD", value: 69 },
    })
    expect(buildMetaBrowserEvent("InitiateCheckout", { content_name: "100 W Randolph", value: -1 })).toEqual({
      name: "InitiateCheckout",
      params: {},
    })
  })

  it.each(["Purchase", "Lead", "CompleteRegistration", "PropertyAdded", "AppealStarted", "Subscribe", "free_check_qualified"])(
    "refuses %s",
    (name) => {
      expect(buildMetaBrowserEvent(name, { value: 69 })).toBeNull()
    },
  )
})

describe("the Pixel mount", () => {
  function expectNoTransport() {
    expect(pixelScripts()).toHaveLength(0)
    expect(fbq()).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(beaconSpy).not.toHaveBeenCalled()
  }

  it.each([
    ["no consent", () => undefined],
    ["a denied consent", () => localStorage.setItem(MARKETING_CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, meta_pixel: "denied", decided_at: NOW }))],
    ["a preview build", () => { grantConsent(); mockProduction = false }],
    ["a missing pixel id", () => { grantConsent(); delete process.env.NEXT_PUBLIC_META_PIXEL_ID }],
    ["a hostile page URL", () => { grantConsent(); window.history.replaceState({}, "", "/check?pin=16-01-216-001-0000&email=jane@example.test#result") }],
    ["a PIN disguised as a Meta click id", () => { grantConsent(); window.history.replaceState({}, "", "/?fbclid=16-01-216-001-0000") }],
    ["a hostile referrer", () => { grantConsent(); setReferrer("https://partner.example.test/clients/jane-doe-100-w-randolph?order=ord_123") }],
    ["another site's root as the referrer", () => { grantConsent(); setReferrer("https://jane-doe-123-main-st.example.test/") }],
  ])("inserts no script and makes no call with %s", (_label, arrange) => {
    arrange()

    render(<MetaPixelCandidate pixelId={process.env.NEXT_PUBLIC_META_PIXEL_ID ?? ""} />)

    expectNoTransport()
  })

  it("installs once with pushState tracking off and nothing queued, then initializes without automatic configuration or advanced matching and sends PageView only through the ready SDK", () => {
    grantConsent()

    const view = render(<MetaPixelCandidate pixelId={PIXEL_ID} />)
    view.rerender(<MetaPixelCandidate pixelId={PIXEL_ID} />)

    const scripts = pixelScripts()
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe(META_FBEVENTS_URL)
    expect(scripts[0].async).toBe(true)
    expect(fbq()?.disablePushState).toBe(true)
    expect(fbq()?.queue).toEqual([])

    const sdk = runSdk()

    expect(sdk.mock.calls).toEqual([
      ["set", "autoConfig", false, PIXEL_ID],
      ["init", PIXEL_ID],
      ["track", "PageView", {}],
    ])
    expect(fbq()?.queue).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("sends nothing at all, not even init, if the page became unsafe before the SDK loaded", () => {
    grantConsent()
    render(<MetaPixelCandidate pixelId={PIXEL_ID} />)

    window.history.replaceState({}, "", "/check?pin=16012160010000")
    const sdk = runSdk()

    expect(sdk).not.toHaveBeenCalled()
  })

  it("never initializes, and so never sends, if the script loads before the SDK has taken over dispatch", () => {
    grantConsent()
    render(<MetaPixelCandidate pixelId={PIXEL_ID} />)

    act(() => {
      pixelScripts()[0].dispatchEvent(new Event("load"))
    })
    const late = jest.fn()
    fbq()!.callMethod = late
    trackMetaEvent("InitiateCheckout", { content_name: "T2", value: 69 })

    expect(late).not.toHaveBeenCalled()
    expect(fbq()?.queue).toEqual([])
  })
})

/**
 * The vendor bootstrap queues any call made before fbevents.js runs, and the
 * SDK sends that queue as soon as it loads — after consent may have been
 * withdrawn or the page may have changed. So nothing is ever queued: a hit
 * requested before the SDK is ready is dropped, and every hit is authorized
 * at the moment it is handed to the SDK.
 */
describe("no hit outlives the conditions it was authorized under", () => {
  it("sends neither an early InitiateCheckout nor a PageView when consent is revoked and the page turns unsafe before the SDK loads", () => {
    grantConsent()
    render(<MetaPixelCandidate pixelId={PIXEL_ID} />)

    trackMetaEvent("InitiateCheckout", { content_name: "T2", value: 69 })
    localStorage.removeItem(MARKETING_CONSENT_STORAGE_KEY)
    window.history.replaceState({}, "", "/check?pin=16-01-216-001-0000")
    const sdk = runSdk()

    expect(sdk).not.toHaveBeenCalled()
    expect(fbq()?.queue).toEqual([])
  })

  it("drops, rather than defers, an event requested before the SDK is ready even when the page stays safe", () => {
    grantConsent()
    render(<MetaPixelCandidate pixelId={PIXEL_ID} />)

    trackMetaEvent("InitiateCheckout", { content_name: "T2", value: 69 })
    const sdk = runSdk()

    expect(tracks(sdk)).toEqual([["track", "PageView", {}]])
  })

  it("drops a direct call to the installed fbq made before the SDK is ready instead of queueing it for the SDK", () => {
    grantConsent()
    render(<MetaPixelCandidate pixelId={PIXEL_ID} />)

    fbq()!("track", "Purchase", { value: 69, transaction_id: "cs_live_a1B2c3D4e5F6g7H8" })
    const sdk = runSdk()

    expect(tracks(sdk)).toEqual([["track", "PageView", {}]])
  })

  it("never writes to an fbq it did not install and initialize", () => {
    grantConsent()
    const foreign = Object.assign(jest.fn(), { queue: [] as unknown[][] })
    ;(window as unknown as { fbq?: unknown }).fbq = foreign

    render(<MetaPixelCandidate pixelId={PIXEL_ID} />)
    trackMetaEvent("InitiateCheckout", { content_name: "T2", value: 69 })

    expect(pixelScripts()).toHaveLength(0)
    expect(foreign).not.toHaveBeenCalled()
  })
})

describe("events through the gated writer", () => {
  function installed(): jest.Mock {
    grantConsent()
    render(<MetaPixelCandidate pixelId={PIXEL_ID} />)
    const sdk = runSdk()
    sdk.mockClear()
    return sdk
  }

  it("sends nothing at all when consent is withdrawn after installation", () => {
    const sdk = installed()
    localStorage.setItem(MARKETING_CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, meta_pixel: "denied", decided_at: NOW }))

    trackMetaEvent("InitiateCheckout", { content_name: "T2", value: 69 })

    expect(sdk).not.toHaveBeenCalled()
  })

  it("sends nothing once the page carries a query, even a well-formed click id", () => {
    const sdk = installed()
    window.history.replaceState({}, "", "/?fbclid=IwAR0abcDEF_123-xyz")

    trackMetaEvent("InitiateCheckout", { content_name: "T2", value: 69 })

    expect(sdk).not.toHaveBeenCalled()
  })

  it("never writes a browser Purchase, a custom event or an identifier", () => {
    const sdk = installed()

    trackMetaEvent("Purchase", { value: 69, currency: "USD", transaction_id: "cs_live_a1B2c3D4e5F6g7H8" })
    trackMetaCustomEvent("PropertyAdded", { pin: "16012160010000" })
    analytics.propertyAdded("16012160010000")
    analytics.appealStarted("prop_123", "2026")
    analytics.pdfDownload("appeal_123")
    analytics.contactFormSubmit("billing")
    analytics.signUp("email")

    expect(sdk).not.toHaveBeenCalled()
  })

  it("never sends a free-check event to Meta", () => {
    const sdk = installed()
    window.gtag = jest.fn()

    analytics.freeCheckStarted({ surface: "home_hero", inputMode: "pin" })
    analytics.freeCheckCompleted({
      surface: "home_hero",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    })

    expect(sdk).not.toHaveBeenCalled()
  })

  it("serializes InitiateCheckout exactly, and not at all from a hostile page", () => {
    const sdk = installed()

    analytics.checkoutStarted("T3", 149)
    window.history.replaceState({}, "", "/checkout?plan=diy&email=jane@example.test")
    analytics.checkoutStarted("T2", 69)

    expect(sdk.mock.calls).toEqual([["track", "InitiateCheckout", { content_name: "T3", currency: "USD", value: 149 }]])
    const serialized = JSON.stringify(sdk.mock.calls)
    for (const marker of ["jane", "example", "16012160010000", "cs_live", "prop_123", "appeal_123"]) {
      expect(serialized).not.toContain(marker)
    }
  })
})

describe("checkout intent ownership carries over to the Meta candidate", () => {
  const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_redacted#fid"

  type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> }
  const response = (status: number, body: Record<string, unknown>): FakeResponse => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })

  let sdk: jest.Mock

  function fillDetails() {
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Buyer" } })
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Example" } })
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } })
    fireEvent.change(screen.getByLabelText("Property address"), { target: { value: "2834 W Henderson St, Chicago IL 60618" } })
  }

  function pageShow(persisted: boolean) {
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }))
  }

  function initiateCheckouts() {
    return tracks(sdk).filter((call) => call[1] === "InitiateCheckout")
  }

  beforeEach(() => {
    let uuid = 0
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => `57dc81a6-1329-4a85-9210-${String(++uuid).padStart(12, "0")}`,
    })
    window.history.replaceState({}, "", "/checkout?plan=diy")
    grantConsent()
    render(<MetaPixelCandidate pixelId={PIXEL_ID} />)
    sdk = runSdk()
    window.gtag = jest.fn()
  })

  it("sends one InitiateCheckout per intent, none for a stale response after a back-forward restore, and one for the next genuine intent", async () => {
    let releaseStale!: () => void
    const stale = new Promise<void>((resolve) => {
      releaseStale = resolve
    })
    let releaseCurrent!: (value: FakeResponse) => void
    const current = new Promise<FakeResponse>((resolve) => {
      releaseCurrent = resolve
    })
    fetchSpy
      .mockImplementationOnce(() => stale.then(() => response(200, { url: `${STRIPE_URL}-stale` })))
      .mockImplementationOnce(() => current)
      .mockImplementation(async () => response(200, { url: STRIPE_URL }))

    const { container } = render(<CheckoutPage />)
    const form = () => container.querySelector("form.ot-checkout-form") as HTMLFormElement
    fillDetails()
    fireEvent.submit(form())
    act(() => pageShow(true))
    fireEvent.submit(form())

    await act(async () => releaseStale())
    expect(initiateCheckouts()).toHaveLength(0)

    await act(async () => releaseCurrent(response(200, { url: STRIPE_URL })))
    expect(push.mock.calls).toEqual([[STRIPE_URL]])
    expect(initiateCheckouts()).toEqual([["track", "InitiateCheckout", { content_name: "T2", currency: "USD", value: 69 }]])

    act(() => pageShow(true))
    fireEvent.submit(form())
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2))
    expect(initiateCheckouts()).toHaveLength(2)
  })
})
