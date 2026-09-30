/**
 * @jest-environment jsdom
 *
 * The page context GA4 may see: the approved landing route (or "/(other)"),
 * a UTM query rebuilt only from governed values, and a referrer that is an
 * allowlisted host's origin or this site's governed path. Everything else a
 * URL can carry — a name or address in the path, a query, a fragment, userinfo,
 * an arbitrary referrer — has nowhere to go.
 */
import {
  buildSanitizedPageContext,
  governedPageLocation,
  governedPageReferrer,
  sanitizeGaEventParams,
  UNLISTED_PAGE_PATH,
} from "@/lib/analytics/ga4"
import { trackGA4Event } from "@/lib/analytics/events"

const ORIGIN = "https://www.overtaxed-il.com"
const MARKERS = [
  "jane",
  "doe",
  "main",
  "16-01-216",
  "1601216",
  "example",
  "cs_",
  "secret",
  "gclid",
  "fbclid",
  "utm_term",
  "#",
  "@",
  "%",
  "partner",
]

function expectClean(value: unknown) {
  const text = JSON.stringify(value).toLowerCase()
  for (const marker of MARKERS) expect(text).not.toContain(marker)
}

describe("governed page location", () => {
  it.each([
    ["/clients/jane-doe-123-main-st", `${ORIGIN}${UNLISTED_PAGE_PATH}`],
    ["/appeals/clx1abc2def3ghi4jkl", `${ORIGIN}${UNLISTED_PAGE_PATH}`],
    ["/property/16-01-216-001-0000", `${ORIGIN}${UNLISTED_PAGE_PATH}`],
    ["/blog/why-appeal", `${ORIGIN}/blog/[slug]`],
    ["/townships/cicero/", `${ORIGIN}/townships/[slug]`],
    ["/check/", `${ORIGIN}/check`],
    ["/", `${ORIGIN}/`],
  ])("reports %s as its approved route only", (path, expected) => {
    expect(governedPageLocation(`${ORIGIN}${path}?email=jane@example.test#secret`)).toBe(expected)
  })

  it("keeps only governed UTM values, rebuilt in a fixed order", () => {
    expect(
      governedPageLocation(
        `${ORIGIN}/check?utm_content=eml_a&utm_term=jane+doe&gclid=abc&utm_medium=email&fbclid=x&utm_source=newsletter&utm_campaign=ot_202610_ret_jane`,
      ),
    ).toBe(`${ORIGIN}/check?utm_source=newsletter&utm_medium=email&utm_content=eml_a`)
  })

  it.each([
    ["an ungoverned source", "utm_source=partner-jane-doe&utm_medium=email"],
    ["a PIN-shaped source", "utm_source=16-01-216-001-0000&utm_medium=cpc"],
    ["a repeated source", "utm_source=google&utm_source=bing&utm_medium=cpc"],
    ["an encoded address source", "utm_source=123%20Main%20St"],
  ])("sends no query at all for %s", (_label, query) => {
    expect(governedPageLocation(`${ORIGIN}/?${query}`)).toBe(`${ORIGIN}/`)
  })

  it("drops address-like, email-like and unapproved campaign values individually", () => {
    const location = governedPageLocation(
      `${ORIGIN}/?utm_source=google&utm_medium=jane@example.test&utm_campaign=ot_202610_acq_synthappeal&utm_content=123-main-st`,
    )
    expect(location).toBe(`${ORIGIN}/?utm_source=google`)
  })

  it("refuses userinfo, ports and non-web schemes", () => {
    expect(governedPageLocation("https://jane:secret@www.overtaxed-il.com/check")).toBe(`${ORIGIN}/check`)
    expect(governedPageLocation("https://www.overtaxed-il.com:8443/check")).toBeUndefined()
    expect(governedPageLocation("javascript:alert(1)")).toBeUndefined()
    expect(governedPageLocation("not a url")).toBeUndefined()
  })

  it("is idempotent", () => {
    for (const raw of [`${ORIGIN}/clients/jane`, `${ORIGIN}/check?utm_source=google&utm_medium=cpc&utm_content=img_b`]) {
      const once = governedPageLocation(raw)
      expect(governedPageLocation(once)).toBe(once)
    }
  })
})

describe("governed page referrer", () => {
  it.each([
    ["https://www.google.com/search?q=jane+doe+123+main+st", "https://www.google.com/"],
    ["https://l.facebook.com/l.php?u=https%3A%2F%2Fjane", "https://l.facebook.com/"],
    ["https://t.co/abc123", "https://t.co/"],
    ["https://partner.example.test/clients/jane-doe-123-main-st", ""],
    ["https://jane-doe-123-main-st.example.test/", ""],
    ["https://checkout.stripe.com/c/pay/cs_live_a1B2c3D4e5F6", ""],
    ["https://jane:secret@www.google.com/", "https://www.google.com/"],
    ["https://www.google.com:444/", ""],
    [`${ORIGIN}/clients/jane-doe`, `${ORIGIN}${UNLISTED_PAGE_PATH}`],
    [`${ORIGIN}/check?pin=16-01-216-001-0000`, `${ORIGIN}/check`],
    ["", ""],
    ["garbage", ""],
  ])("maps %s to %s", (raw, expected) => {
    expect(governedPageReferrer(raw)).toBe(expected)
  })
})

describe("generic GA4 events cannot carry a raw URL, referrer or path", () => {
  it("re-governs page_location, page_referrer and page_path supplied by a caller", () => {
    const out = sanitizeGaEventParams({
      page_location: `${ORIGIN}/clients/jane-doe-123-main-st`,
      page_referrer: "https://partner.example.test/jane-doe",
      page_path: "/property/16-01-216-001-0000",
      page_title: "Check",
    })
    expect(out).toEqual({
      page_location: `${ORIGIN}${UNLISTED_PAGE_PATH}`,
      page_referrer: "",
      page_path: UNLISTED_PAGE_PATH,
      page_title: "Check",
    })
  })

  it("keeps an explicit empty page context empty", () => {
    expect(sanitizeGaEventParams({ page_location: "", page_referrer: "" })).toEqual({ page_location: "", page_referrer: "" })
  })

  it("a page_view from a hostile URL and referrer carries only governed context", () => {
    window.history.replaceState(
      {},
      "",
      "/clients/jane-doe-123-main-st/parcel-1601216001?email=jane@example.test&utm_source=google&utm_term=jane#secret",
    )
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://partner.example.test/clients/jane-doe-123-main-st?cs=cs_live_a1B2c3D4e5F6",
    })
    const gtag = jest.fn()
    window.gtag = gtag
    try {
      trackGA4Event("page_view", { page_path: window.location.pathname, page_title: "Not found" })
      expect(gtag).toHaveBeenCalledTimes(1)
      const [, , params] = gtag.mock.calls[0]
      expect(params).toEqual({
        page_path: UNLISTED_PAGE_PATH,
        page_title: "Not found",
        page_location: `http://localhost${UNLISTED_PAGE_PATH}?utm_source=google`,
        page_referrer: "",
      })
      expectClean(gtag.mock.calls)
    } finally {
      delete (window as { gtag?: unknown }).gtag
    }
  })

  it("buildSanitizedPageContext never returns anything from the hostile markers", () => {
    expectClean(
      buildSanitizedPageContext({
        locationHref: `${ORIGIN}/clients/jane-doe-123-main-st?utm_source=google&utm_campaign=jane_doe#secret`,
        referrer: "https://jane-doe.partner.example.test/123-main-st",
      }),
    )
  })

  it("browser writers refuse purchase and refund", () => {
    const gtag = jest.fn()
    window.gtag = gtag
    try {
      trackGA4Event("purchase", { value: 69, transaction_id: "cs_live_a1B2c3D4e5F6" })
      trackGA4Event("refund", { value: 69 })
      expect(gtag).not.toHaveBeenCalled()
    } finally {
      delete (window as { gtag?: unknown }).gtag
    }
  })
})
