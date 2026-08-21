/**
 * @jest-environment node
 *
 * Crawlable page routes, derived and governed.
 *
 * The blog was closed structurally: `app/sitemap.ts` was collapsed onto
 * `lib/blog`, so the served set and the governed set are reconciled from the one
 * source that makes a post reachable. Page routes were not, and the gap showed:
 * twelve crawlable routes sat outside the frozen 53/22 declaration and outside
 * every additive registry, and two of them published frozen-lexicon claims — one
 * of those two being `/`, the site root, at sitemap priority 1.
 *
 * This file applies the same principle one level up. The route set is derived
 * from the thing that actually defines what Next serves — the presence of a
 * `page` module under `app/` — and then everything else has to agree with it. A
 * new crawlable page cannot be added without failing here, and it cannot be
 * governed by being written into a list: it has to render clean.
 *
 * What is deliberately excluded, and why each exclusion is safe:
 *
 *   route handlers / APIs   `route.ts` is not a page; `/api/*` is covered by the
 *                           named-surface registry (SURF-16…22) and the cron
 *                           fail-closed sweep.
 *   dynamic patterns        `[slug]`-style routes serve a set, not a page.
 *                           `/blog/[slug]` is governed by the served-blog suite,
 *                           `/township/[slug]` by the freshness corpus.
 *   metadata files          `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`,
 *                           `rss.xml` emit no crawlable prose.
 *   robots-disallowed       `/dashboard /properties /appeals /account /admin
 *                           /auth` are authenticated and excluded from indexing
 *                           by `app/robots.ts`, which this file reads rather
 *                           than assumes.
 *
 * Every exclusion is asserted, not assumed, so an exclusion cannot quietly grow
 * into a hiding place.
 */
jest.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404")
  },
}))

const getSession = jest.fn(async () => null)
jest.mock("@/lib/auth", () => ({ __esModule: true, getSession, authOptions: {} }))
jest.mock("@/lib/auth/session", () => ({ __esModule: true, getSession }))
jest.mock("next-auth/react", () => ({
  __esModule: true,
  useSession: () => ({ data: null, status: "unauthenticated" }),
  signIn: jest.fn(),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: unknown }) => children,
}))
jest.mock("next-auth", () => ({ __esModule: true, default: jest.fn(), AuthError: class extends Error {} }))
jest.mock("@/app/auth/signin/actions", () => ({ __esModule: true, signInWithCredentials: jest.fn(async () => ({})) }))

const prismaMock = {
  oTOrder: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  invoice: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
  user: { findUnique: jest.fn(async () => null) },
  property: { findMany: jest.fn(async () => []) },
  appeal: { findMany: jest.fn(async () => []) },
  townshipAlert: { findMany: jest.fn(async () => []) },
}
jest.mock("@/lib/db", () => ({ __esModule: true, prisma: prismaMock }))
jest.mock("@/lib/db/prisma", () => ({ __esModule: true, prisma: prismaMock }))

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement, type ReactElement } from "react"

import { readable } from "../lexicon/banned-claims.test"
import {
  ADDITIVE_PAGE_ROUTES,
  PAGE_FILES,
  classifyRoutes,
  pageRouteViolations,
} from "./page-route-rules.test"
import { readAcceptanceMatrix } from "../helpers/governance-fixtures.test"

const { all: ALL_PAGE_ROUTES, dynamic: DYNAMIC_ROUTES, authenticated: AUTHENTICATED, crawlable: CRAWLABLE, disallowed: DISALLOWED } = classifyRoutes()
const isDisallowed = (p: string) => DISALLOWED.some((d) => p === d || p.startsWith(`${d}/`))

/* ── Rendering ────────────────────────────────────────────────────────────── */

type PageModule = { default: (props: never) => ReactElement | Promise<ReactElement> }

/** Rendered markup, or the redirect a page issues — which is also its output. */
async function render(route: string): Promise<string> {
  const dir = route === "/" ? "" : route
  const mod = (await import(`@/app${dir}/page`)) as PageModule
  const Page = mod.default
  const attempt = async (props?: unknown) => {
    const isAsync = Page.constructor.name === "AsyncFunction"
    const el = isAsync
      ? await (Page as (p?: unknown) => Promise<ReactElement>)(props)
      : createElement(Page as never, props as never)
    return renderToStaticMarkup(el)
  }
  try {
    return await attempt()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith("REDIRECT:")) return `<!-- redirected to ${message.slice(9)} -->`
    if (message.includes("404")) return "<!-- 404 -->"
    // Several pages take `searchParams`; a page that needs them is not a finding.
    return await attempt({ searchParams: Promise.resolve({}), params: Promise.resolve({}) })
  }
}


const ROOT = resolve(__dirname, "../..")
const APP_DIR = join(ROOT, "app")

/* ── Derivation is honest ─────────────────────────────────────────────────── */

describe("the route set is derived from what Next serves", () => {
  it("finds a page module for every derived route", () => {
    for (const route of ALL_PAGE_ROUTES) {
      const dir = join(APP_DIR, route === "/" ? "" : route)
      const direct = PAGE_FILES.some((f) => existsSync(join(dir, f)))
      // A route group contributes no segment, so the file may sit under one.
      const viaGroup =
        !direct &&
        readdirSync(APP_DIR).some((e) => e.startsWith("(") && PAGE_FILES.some((f) => existsSync(join(APP_DIR, e, route.slice(1), f))))
      expect({ route, hasPage: direct || viaGroup }).toEqual({ route, hasPage: true })
    }
  })

  it("counts the derivation explicitly", () => {
    expect({
      all: ALL_PAGE_ROUTES.length,
      dynamic: DYNAMIC_ROUTES.length,
      authenticated: AUTHENTICATED.length,
      crawlable: CRAWLABLE.length,
    }).toEqual({ all: 58, dynamic: 11, authenticated: 20, crawlable: 27 })
  })

  it("classifies a route handler as not a page", () => {
    // `app/api/**` and `app/rss.xml` export handlers, not pages.
    for (const dir of ["api/free-check", "rss.xml"]) {
      expect(existsSync(join(APP_DIR, dir, "route.ts"))).toBe(true)
      expect(PAGE_FILES.some((f) => existsSync(join(APP_DIR, dir, f)))).toBe(false)
    }
    expect(ALL_PAGE_ROUTES.filter((p) => p.startsWith("/api"))).toEqual([])
    expect(ALL_PAGE_ROUTES).not.toContain("/rss.xml")
  })

  it("excludes metadata modules, which serve no crawlable prose", () => {
    for (const file of ["sitemap.ts", "robots.ts", "opengraph-image.tsx"]) {
      expect(existsSync(join(APP_DIR, file))).toBe(true)
    }
    expect(CRAWLABLE.some((p) => /sitemap|robots|opengraph/.test(p))).toBe(false)
  })

  it("takes the disallowed prefixes from robots.ts rather than assuming them", () => {
    expect(DISALLOWED).toEqual(["/account", "/admin", "/appeals", "/auth", "/dashboard", "/properties"])
    for (const route of AUTHENTICATED) {
      expect({ route, disallowed: isDisallowed(route) }).toEqual({ route, disallowed: true })
    }
    for (const route of CRAWLABLE) {
      expect({ route, disallowed: isDisallowed(route) }).toEqual({ route, disallowed: false })
    }
  })

  it("excludes dynamic patterns, which are governed by their own suites", () => {
    expect(DYNAMIC_ROUTES).toContain("/blog/[slug]")
    expect(DYNAMIC_ROUTES).toContain("/township/[slug]")
    expect(CRAWLABLE.some((p) => p.includes("["))).toBe(false)
    // Named, so the delegation is visible rather than implied.
    expect(existsSync(join(ROOT, "__tests__/blog/served-blog-governance.test.ts"))).toBe(true)
    expect(existsSync(join(ROOT, "__tests__/acceptance/freshness-corpus.test.tsx"))).toBe(true)
  })
})

/* ── Reconciliation ───────────────────────────────────────────────────────── */

/** The controller's frozen declaration, read from the packet at run time. */
function controllerDeclared(): Set<string> {
  const m = readAcceptanceMatrix() as {
    accepted_routes: Array<{ path: string }>
    named_surfaces: Array<{ path: string }>
  }
  return new Set([...m.accepted_routes.map((r) => r.path), ...m.named_surfaces.map((s) => s.path)])
}

describe("every crawlable page route is governed exactly once", () => {
  const declared = controllerDeclared()
  const controllerCrawlable = CRAWLABLE.filter((p) => declared.has(p)).sort()

  it("splits the crawlable set into controller-declared and ratified-additive", () => {
    expect([...controllerCrawlable, ...ADDITIVE_PAGE_ROUTES].sort()).toEqual(CRAWLABLE)
  })

  it("counts each bucket", () => {
    expect({
      crawlable: CRAWLABLE.length,
      controller: controllerCrawlable.length,
      additive: ADDITIVE_PAGE_ROUTES.length,
    }).toEqual({ crawlable: 27, controller: 14, additive: 13 })
  })

  it("places every crawlable route in exactly one bucket", () => {
    for (const route of CRAWLABLE) {
      const buckets = [declared.has(route), ADDITIVE_PAGE_ROUTES.includes(route)].filter(Boolean).length
      expect({ route, buckets }).toEqual({ route, buckets: 1 })
    }
  })

  it("never double-counts a controller route as additive", () => {
    expect(ADDITIVE_PAGE_ROUTES.filter((p) => declared.has(p))).toEqual([])
  })

  it("resolves every additive entry to a real page module", () => {
    for (const route of ADDITIVE_PAGE_ROUTES) {
      const dir = join(APP_DIR, route === "/" ? "" : route)
      expect({ route, hasPage: PAGE_FILES.some((f) => existsSync(join(dir, f))) }).toEqual({ route, hasPage: true })
    }
  })

  it("has no duplicate or orphaned entry", () => {
    expect(ADDITIVE_PAGE_ROUTES).toEqual([...new Set(ADDITIVE_PAGE_ROUTES)])
    expect(ADDITIVE_PAGE_ROUTES.filter((p) => !CRAWLABLE.includes(p))).toEqual([])
  })

  it("stays consistent with the per-surface additive registry, without double-counting", () => {
    // `/homestead-exemption` is deep-swept in `governed-public-surfaces.test.tsx`.
    // That file is a sub-layer of this one: every surface it governs must appear
    // here exactly once, and it must not introduce a route this reconciliation
    // has never seen.
    const gs = readFileSync(join(ROOT, "__tests__/acceptance/governed-public-surfaces.test.tsx"), "utf8")
    const paths = [...gs.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1])
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect({ path, inPageLayer: ADDITIVE_PAGE_ROUTES.filter((p) => p === path).length }).toEqual({
        path,
        inPageLayer: 1,
      })
    }
  })

  it("leaves the frozen controller declaration untouched at 53 / 22", () => {
    const m = readAcceptanceMatrix() as {
      accepted_routes: unknown[]
      named_surfaces: unknown[]
    }
    expect({ routes: m.accepted_routes.length, surfaces: m.named_surfaces.length }).toEqual({
      routes: 53,
      surfaces: 22,
    })
  })
})

/* ── The sweep ────────────────────────────────────────────────────────────── */

describe("every crawlable page route renders clean", () => {
  it.each(CRAWLABLE)("%s renders", async (route) => {
    const html = await render(route)
    expect(html.length).toBeGreaterThan(0)
  })

  it.each(CRAWLABLE)("%s trips no page rule", async (route) => {
    const html = await render(route)
    expect({ route, violations: pageRouteViolations(html) }).toEqual({ route, violations: [] })
  })
})

/* ── The four neutralized claims ──────────────────────────────────────────── */

describe("the neutralized claims are gone and their replacements are live", () => {
  const GONE: Array<[string, string, RegExp]> = [
    ["/", "BL-C5", /the only thing the board of review actually reads/i],
    ["/", "BL-D2", /checked regularly/i],
    ["/board-of-review", "BL-B2", /most homeowners/i],
  ]

  it.each(GONE)("%s no longer renders %s", async (route, _row, pattern) => {
    const text = readable(await render(route))
    expect({ route, matched: pattern.test(text) }).toEqual({ route, matched: false })
  })

  it("the homepage replacements are present, and say less", async () => {
    const text = readable(await render("/"))
    expect(text).toContain("A one-page report — your assessed value, your comps, and where every number came from.")
    expect(text).toContain("Cook County Assessor + Board of Review public records")
    expect(text).toContain("Township schedules, as published by the county")
  })

  it("the board-of-review replacements are present, and drop the popularity claim", async () => {
    const text = readable(await render("/board-of-review"))
    expect(text).toContain("Cook County has two separate levels of property tax appeal.")
    expect(text).toContain("This is where OverTaxed IL currently operates.")
    expect(text).not.toMatch(/don't even know the second one exists/i)
  })

  it("keeps the surrounding pages intact", async () => {
    // Layout and product copy either side of each edit still renders, so the
    // remediation was a claim swap and not a redesign.
    const home = readable(await render("/"))
    expect(home).toMatch(/What you(&#x27;|')ll get/)
    // The anchor here used to be "Estimated annual + 3-year overpayment", the
    // first item in the homepage deliverables list. It is gone deliberately:
    // the free-check route computes no overpayment on any path and sends both
    // `potentialOverpaymentPerYear` and `potentialOverpayment3Year` as null, so
    // the line promised, at the top of the page, a figure the product does not
    // produce. The intactness check anchors on a deliverable the check really
    // returns, and the removal is pinned so it cannot quietly come back.
    expect(home).toContain("Township appeal window")
    expect(home).not.toContain("Estimated annual + 3-year overpayment")
    expect(home).not.toMatch(/Estimated annual overpayment/i)
    const bor = readable(await render("/board-of-review"))
    expect(bor).toContain("Large commercial property owners use both")
    expect(bor).toContain("Available now")
  })
})
