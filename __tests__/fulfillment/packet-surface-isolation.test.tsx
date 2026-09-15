/**
 * `/packet` must run no instrumentation, and nothing about a packet request may
 * reach an error reporter.
 *
 * `app/packet/packet-form.tsx` states, as its own contract, that "there is no
 * analytics call, no third-party widget, and no error reporter on this path.
 * Nothing observes what is typed here." That was aspirational: every route in
 * this app inherits ONE root layout, and that layout mounted first-touch UTM
 * capture, approved-code capture and the analytics route tracker on every path,
 * plus the referral capture, Google Analytics and Vercel Analytics on the
 * production marketing host.
 *
 * The specific leak is not the argument. A page whose entire job is to hold a
 * bearer credential in memory should not also be running third-party script or
 * reporting page views, because each of those is behaviour we do not control
 * and would have to re-audit on every upgrade.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import {
  isPrivateRequestPath,
  isPrivateSurfacePath,
  pathnameOf,
  PRIVATE_API_PREFIXES,
  PRIVATE_SURFACE_PREFIXES,
} from "@/lib/analytics/private-surfaces"
import {
  isPrivateEvent,
  REDACTED,
  scrubSensitiveEvent,
} from "@/lib/observability/sentry-scrubbing"
import { InstrumentationBoundary } from "@/components/analytics/instrumentation-boundary"

const ROOT = process.cwd()
const LAYOUT = readFileSync(join(ROOT, "app/layout.tsx"), "utf8")

let pathname: string | null = "/"
jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

beforeEach(() => {
  pathname = "/"
})

describe("the private-surface path rule", () => {
  it.each(["/packet", "/packet/", "/packet/help", "/packet/a/b"])(
    "treats %s as private",
    (path) => {
      expect(isPrivateSurfacePath(path)).toBe(true)
    },
  )

  it.each(["/", "/pricing", "/check", "/packets", "/packet-status", "/apacket"])(
    "leaves %s public",
    (path) => {
      expect(isPrivateSurfacePath(path)).toBe(false)
    },
  )

  it("never prefix-matches a bare string, which would capture future routes", () => {
    // `/packets` would be a plain `startsWith` hit. A route added later must
    // not become silently uninstrumented because its name shares a prefix.
    expect(PRIVATE_SURFACE_PREFIXES).toContain("/packet")
    expect(isPrivateSurfacePath("/packetsomething")).toBe(false)
  })

  it("answers a null or empty pathname without throwing", () => {
    // The pure predicate says "not a known private path"; deciding what an
    // UNKNOWN path means is the boundary's job, and it fails closed. Keeping
    // the two separate means the rule stays a plain string test.
    expect(isPrivateSurfacePath(null)).toBe(false)
    expect(isPrivateSurfacePath("")).toBe(false)
  })

  it("covers the two request paths that carry a credential or a payload", () => {
    expect(PRIVATE_API_PREFIXES).toEqual([
      "/api/ot/packet/download",
      "/api/ot/webhooks/resend",
    ])
    for (const path of PRIVATE_API_PREFIXES)
      expect(isPrivateRequestPath(path)).toBe(true)
    expect(isPrivateRequestPath("/api/checkout/session")).toBe(false)
  })

  it("reads a pathname out of an absolute URL without throwing on rubbish", () => {
    expect(pathnameOf("https://www.overtaxed-il.com/packet?x=1")).toBe("/packet")
    expect(pathnameOf("/packet#frag")).toBe("/packet")
    expect(pathnameOf("not a url")).toBe("")
    expect(pathnameOf(undefined)).toBe("")
  })
})

describe("the instrumentation boundary", () => {
  const Probe = () => <div data-testid="instrumentation">mounted</div>

  it("mounts instrumentation on an ordinary page", () => {
    pathname = "/pricing"
    render(
      <InstrumentationBoundary>
        <Probe />
      </InstrumentationBoundary>,
    )
    expect(screen.getByTestId("instrumentation").textContent).toBe("mounted")
  })

  it("mounts nothing at all on /packet", () => {
    pathname = "/packet"
    render(
      <InstrumentationBoundary>
        <Probe />
      </InstrumentationBoundary>,
    )
    expect(screen.queryByTestId("instrumentation")).toBeNull()
  })

  it("fails closed when the pathname is unknown", () => {
    pathname = null
    render(
      <InstrumentationBoundary>
        <Probe />
      </InstrumentationBoundary>,
    )
    expect(screen.queryByTestId("instrumentation")).toBeNull()
  })
})

describe("the root layout gates every instrumentation mount", () => {
  /** The layout body between the boundary's open and close tags. */
  const gated = LAYOUT.slice(
    LAYOUT.indexOf("<InstrumentationBoundary>"),
    LAYOUT.indexOf("</InstrumentationBoundary>"),
  )

  it.each([
    "UtmFirstTouchCapture",
    "AttributionCodeCapture",
    "ReferralCapture",
    "GoogleAnalytics",
    "AnalyticsRouteTracker",
    "<Analytics />",
  ])("mounts %s inside the boundary", (component) => {
    expect(gated).toContain(component)
    // …and nowhere else in the layout, which would defeat the gate.
    const outside = LAYOUT.replace(gated, "")
      .split("export default")[1] ?? ""
    expect(outside).not.toContain(`<${component.replace(/[<>/ ]/g, "")} `)
  })

  it("keeps route children OUTSIDE the boundary", () => {
    // If `{children}` were gated, /packet would render an empty body. The whole
    // point is that this can suppress telemetry and can never blank a page.
    expect(gated).not.toContain("{children}")
    expect(LAYOUT.slice(LAYOUT.indexOf("</InstrumentationBoundary>"))).toContain(
      "{children}",
    )
  })

  it("no longer wraps the tree in the analytics provider", () => {
    // The provider rendered the tracker and `{children}` together, so gating it
    // would have gated the page. The tracker is mounted directly instead.
    expect(LAYOUT).not.toContain("AnalyticsProviderWithSuspense")
  })
})

describe("Sentry never captures a packet body or a callback payload", () => {
  const event = (url: string) => ({
    request: {
      url,
      method: "POST",
      data: { capability: "Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5Z2g" },
      headers: { cookie: "authjs.session-token=secret" },
      cookies: { ot_ref: "abc" },
      query_string: "x=1",
    },
  })

  it("recognizes the two private request paths from the event URL", () => {
    expect(isPrivateEvent(event("https://x.test/api/ot/packet/download"))).toBe(true)
    expect(isPrivateEvent(event("https://x.test/api/ot/webhooks/resend"))).toBe(true)
    expect(isPrivateEvent(event("https://x.test/packet"))).toBe(true)
    expect(isPrivateEvent(event("https://x.test/api/checkout/session"))).toBe(false)
  })

  it("strips the capability body and every other request field", () => {
    const scrubbed = scrubSensitiveEvent(
      event("https://x.test/api/ot/packet/download?leak=1"),
    )
    expect(JSON.stringify(scrubbed)).not.toContain("Zm9vYmFy")
    expect(scrubbed.request.data).toBe(REDACTED)
    expect(scrubbed.request.headers).toBe(REDACTED)
    expect(scrubbed.request.cookies).toBe(REDACTED)
    expect(scrubbed.request.query_string).toBe(REDACTED)
    // The path survives so the event is still attributable to a route.
    expect(scrubbed.request.url).toBe("/api/ot/packet/download")
  })

  it("strips a callback body, which carries the recipient address", () => {
    const scrubbed = scrubSensitiveEvent({
      request: {
        url: "https://x.test/api/ot/webhooks/resend",
        data: { data: { to: ["owner@example.com"] } },
      },
    })
    expect(JSON.stringify(scrubbed)).not.toContain("owner@example.com")
  })

  it("drops the body on EVERY route, not only the two private ones", () => {
    // An allowlist would stop covering whatever route is added next.
    const scrubbed = scrubSensitiveEvent(event("https://x.test/api/checkout/session"))
    expect(scrubbed.request.data).toBe(REDACTED)
    // …while a public route keeps the context that makes an error debuggable.
    expect(scrubbed.request.headers).not.toBe(REDACTED)
    expect(scrubbed.request.url).toBe("https://x.test/api/checkout/session")
  })

  it("scrubs a breadcrumb that names a private path", () => {
    const scrubbed = scrubSensitiveEvent({
      breadcrumbs: [
        {
          category: "fetch",
          data: { url: "/api/ot/packet/download", body: "capability=secret" },
        },
        { category: "fetch", data: { url: "/api/checkout/session", body: "keep" } },
      ],
    })
    expect(JSON.stringify(scrubbed)).not.toContain("capability=secret")
    expect(scrubbed.breadcrumbs[1].data).toMatchObject({ body: "keep" })
  })

  it("does not throw on an event with no request context at all", () => {
    expect(() => scrubSensitiveEvent({})).not.toThrow()
    expect(scrubSensitiveEvent({ message: "x" })).toEqual({ message: "x" })
  })

  it("is wired into both Sentry configs, including the transaction hook", () => {
    for (const config of ["sentry.server.config.ts", "sentry.edge.config.ts"]) {
      const source = readFileSync(join(ROOT, config), "utf8")
      expect(source).toContain("scrubSensitiveEvent(event)")
      expect(source).toContain("scrubSensitiveTransaction(event)")
      expect(source).toContain("sendDefaultPii: false")
    }
  })
})
