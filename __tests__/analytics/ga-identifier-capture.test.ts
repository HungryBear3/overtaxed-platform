/**
 * @jest-environment jsdom
 *
 * The anonymous GA identifiers checkout forwards: the client id from `_ga` and
 * the session id and session number from THIS property's `_ga_<container>`
 * cookie. They are read exactly or not at all. A cookie value that is not a GA
 * value, a cookie set twice with different values, or a session cookie for
 * some other property yields nothing rather than a best guess.
 */
import { getAnonymousGaIdentifiersForRequest, sanitizeAnonymousGaIdentifiers } from "@/lib/analytics/ga4"

function setCookies(cookies: string[]) {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookies.join("; "),
  })
}

const CLIENT_COOKIE = "_ga=GA1.1.1234567890.1724102400"

beforeEach(() => {
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC1234"
})

afterAll(() => {
  delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
})

describe("client-side GA identifier capture", () => {
  it("reads the client id and this property's GS1 session exactly", () => {
    setCookies([CLIENT_COOKIE, "_ga_ABC1234=GS1.1.1724102400.4.1.1724102500.0.0.0"])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({
      gaClientId: "1234567890.1724102400",
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })
  })

  it("reads a GS2 session cookie exactly", () => {
    setCookies([CLIENT_COOKIE, "_ga_ABC1234=GS2.1.s1724102400$o4$g1$t1724102500$j60$l0$h0"])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({
      gaClientId: "1234567890.1724102400",
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })
  })

  it.each([
    ["embedded in other text", "_ga=xxGA1.1.1234567890.1724102400yy"],
    ["with an overlong timestamp", "_ga=GA1.1.1234567890.17241024009999"],
    ["percent-encoded", "_ga=GA1%2E1%2E1234567890%2E1724102400"],
    ["with malformed percent-encoding", "_ga=%E0%A4%A"],
  ])("refuses a client id %s", (_label, cookie) => {
    setCookies([cookie, "_ga_ABC1234=GS1.1.1724102400.4"])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })
  })

  it("refuses a client id cookie set twice with different values", () => {
    setCookies([CLIENT_COOKIE, "_ga=GA1.2.9876543210.1724102400", "_ga_ABC1234=GS1.1.1724102400.4"])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({
      gaSessionId: "1724102400",
      gaSessionNumber: "4",
    })
  })

  it("accepts the same client id cookie repeated with the same value", () => {
    setCookies([CLIENT_COOKIE, CLIENT_COOKIE])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({ gaClientId: "1234567890.1724102400" })
  })

  it.each([
    ["trailing markup", "_ga_ABC1234=GS1.1.1724102400.4<script>"],
    ["percent-encoding", "_ga_ABC1234=GS1%2E1%2E1724102400%2E4"],
    ["a session number beyond its bound", "_ga_ABC1234=GS1.1.1724102400.9999999"],
    ["a session id that is not an epoch-seconds value", "_ga_ABC1234=GS1.1.17241024.4"],
    ["a GS2 session with trailing markup", "_ga_ABC1234=GS2.1.s1724102400$o4$g1<img>"],
  ])("refuses a session cookie with %s", (_label, cookie) => {
    setCookies([CLIENT_COOKIE, cookie])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({ gaClientId: "1234567890.1724102400" })
  })

  it("refuses this property's session cookie when it is set twice with different values", () => {
    setCookies([CLIENT_COOKIE, "_ga_ABC1234=GS1.1.1724102400.4", "_ga_ABC1234=GS1.1.1724109999.5"])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({ gaClientId: "1234567890.1724102400" })
  })

  it("never falls back to another property's session cookie when the measurement id is unset", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
    setCookies([CLIENT_COOKIE, "_ga_EVIL99=GS1.1.1724102400.9"])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({ gaClientId: "1234567890.1724102400" })
  })

  it.each([
    ["lowercase", "g-abc1234"],
    ["carrying cookie syntax", "G-ABC1234; _ga_EVIL99"],
  ])("never derives a session cookie name from a %s measurement id", (_label, measurementId) => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = measurementId
    setCookies([CLIENT_COOKIE, "_ga_ABC1234=GS1.1.1724102400.4", "_ga_EVIL99=GS1.1.1724102400.9"])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({ gaClientId: "1234567890.1724102400" })
  })

  it("ignores near-miss cookie names", () => {
    setCookies([CLIENT_COOKIE, "_ga_abc1234=GS1.1.1724102400.4", "x_ga_ABC1234=GS1.1.1724102400.5"])

    expect(getAnonymousGaIdentifiersForRequest()).toEqual({ gaClientId: "1234567890.1724102400" })
  })
})

describe("server-side GA identifier revalidation", () => {
  it("keeps exactly bounded identifiers", () => {
    expect(
      sanitizeAnonymousGaIdentifiers({
        gaClientId: "1234567890.1724102400",
        gaSessionId: "1724102400",
        gaSessionNumber: "999999",
      }),
    ).toEqual({
      gaClientId: "1234567890.1724102400",
      gaSessionId: "1724102400",
      gaSessionNumber: "999999",
    })
  })

  it.each([
    ["a client id with a short timestamp", { gaClientId: "1.2" }],
    ["a client id with an overlong random part", { gaClientId: "12345678901.1724102400" }],
    ["a session id that is not epoch seconds", { gaSessionId: "123" }],
    ["a session id with a leading zero", { gaSessionId: "0724102400" }],
    ["a session number beyond its bound", { gaSessionNumber: "1000000" }],
    ["a non-string identifier", { gaClientId: 1234567890.1724102 }],
  ])("drops %s", (_label, input) => {
    expect(sanitizeAnonymousGaIdentifiers(input as Record<string, unknown>)).toEqual({})
  })
})
