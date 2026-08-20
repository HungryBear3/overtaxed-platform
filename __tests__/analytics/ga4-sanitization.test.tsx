import {
  buildSanitizedPageContext,
  getAnonymousGaIdentifiersForRequest,
  sanitizeGaEventParams,
  sanitizeAnonymousGaIdentifiers,
  shouldEnableLiveGa,
} from "@/lib/analytics/ga4"

let pathname = "/appeal-deadline/cicero"
let searchParams = new URLSearchParams()

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}))

jest.mock("@/lib/analytics/utm-tracking", () => ({
  captureUTMParams: jest.fn(),
}))

const trackGA4EventMock = jest.fn()
jest.mock("@/lib/analytics/events", () => ({
  trackGA4Event: (...args: unknown[]) => trackGA4EventMock(...args),
}))

describe("GA4 live gating", () => {
  it("enables live GA only on canonical OT production hosts", () => {
    expect(shouldEnableLiveGa({ measurementId: "G-TEST123", host: "www.overtaxed-il.com" })).toBe(true)
    expect(shouldEnableLiveGa({ measurementId: "G-TEST123", host: "overtaxed-il.com" })).toBe(true)
    expect(shouldEnableLiveGa({ measurementId: "G-TEST123", host: "preview.vercel.app" })).toBe(false)
    expect(shouldEnableLiveGa({ measurementId: "G-TEST123", host: "localhost:3000" })).toBe(false)
    expect(shouldEnableLiveGa({ measurementId: "", host: "www.overtaxed-il.com" })).toBe(false)
  })
})

describe("GA4 sanitization", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pathname = "/appeal-deadline/cicero"
    searchParams = new URLSearchParams("email=buyer@example.com&session_id=cs_test_123&pin=12-34-567-890-1234")
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://checkout.stripe.com/pay/cs_test_secret?prefilled_email=buyer@example.com",
    })
  })

  it("sanitizes initial and route-change location/referrer to origin plus pathname only", () => {
    expect(
      buildSanitizedPageContext({
        locationHref: "https://www.overtaxed-il.com/checkout?email=a@example.com#done",
        referrer: "https://www.google.com/search?q=ot",
      }),
    ).toEqual({
      page_location: "https://www.overtaxed-il.com/checkout",
      page_referrer: "https://www.google.com/search",
    })
  })

  it("suppresses Stripe hosted-checkout referrers", () => {
    expect(
      buildSanitizedPageContext({
        locationHref: "https://www.overtaxed-il.com/checkout/success?session_id=cs_test_123",
        referrer: "https://checkout.stripe.com/pay/cs_test_secret?foo=bar",
      }),
    ).toEqual({
      page_location: "https://www.overtaxed-il.com/checkout/success",
      page_referrer: "",
    })
  })

  it("preserves an explicit empty referrer for direct and invalid traffic", () => {
    expect(buildSanitizedPageContext({
      locationHref: "https://www.overtaxed-il.com/check?pin=secret",
      referrer: "not a url",
    })).toEqual({
      page_location: "https://www.overtaxed-il.com/check",
      page_referrer: "",
    })
    expect(sanitizeGaEventParams({ page_referrer: "" })).toEqual({ page_referrer: "" })
  })

  it("drops sensitive query strings and PII-like event fields from outbound payloads", () => {
    expect(
      sanitizeGaEventParams({
        page_location: "https://www.overtaxed-il.com/check?email=buyer@example.com",
        page_referrer: "https://www.google.com/search?q=ot",
        pin: "12-34-567-890-1234",
        email: "buyer@example.com",
        name: "Buyer Example",
        address: "1 Test St",
        stripe_url: "https://checkout.stripe.com/pay/cs_test_secret",
        session_id: "cs_test_secret",
        keep_me: "ok",
      }),
    ).toEqual({
      page_location: "https://www.overtaxed-il.com/check",
      page_referrer: "https://www.google.com/search",
      keep_me: "ok",
    })
  })

  it("rejects nested blocked keys and raw urls from arbitrary structures", () => {
    expect(
      sanitizeGaEventParams({
        keep_me: "ok",
        nested: {
          email: "buyer@example.com",
          pin: "12-34-567-890-1234",
          url: "https://checkout.stripe.com/pay/cs_test?prefilled_email=buyer@example.com",
        },
        list: [
          { address: "1 Test St" },
          "https://www.overtaxed-il.com/check?session_id=cs_test",
        ],
      }),
    ).toEqual({
      keep_me: "ok",
    })
  })

  it("bounds anonymous GA identifiers before accepting them", () => {
    expect(sanitizeAnonymousGaIdentifiers({
      gaClientId: "1234567890.1234567890",
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })).toEqual({
      gaClientId: "1234567890.1234567890",
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })

    expect(sanitizeAnonymousGaIdentifiers({
      gaClientId: `${"1".repeat(101)}.${"2".repeat(101)}`,
      gaSessionId: "9".repeat(21),
      gaSessionNumber: "1".repeat(11),
    })).toEqual({})

    expect(sanitizeAnonymousGaIdentifiers({
      gaClientId: "1234567890.1234567890",
      gaSessionId: "9007199254740992",
      gaSessionNumber: "4",
    })).toEqual({
      gaClientId: "1234567890.1234567890",
      gaSessionNumber: "4",
    })
  })

  it("fails closed on malformed cookie percent-encoding and chooses the deterministic measurement cookie", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC1234"
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => [
        "_ga=GA1.1.1234567890.1724102400",
        "_ga_FAKE=GS1.1.9999999999.9",
        "_ga_ABC1234=GS1.1.1724102400.4",
        "_ga_BAD=%E0%A4%A",
      ].join("; "),
    })

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({
      gaClientId: "1234567890.1724102400",
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })
  })
})
