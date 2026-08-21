/**
 * @jest-environment node
 *
 * Adversarial proofs for crawlable page-route governance.
 *
 * Each case mutates the real tree — a `page.tsx` created or removed, a component
 * source edited — and then re-derives from the filesystem router and re-renders,
 * exactly as the governance suite does. Nothing here asserts over a cached list;
 * `classifyRoutes()` reads disk on every call, which is what makes these proofs
 * mean anything.
 *
 * Every mutation is reverted in `finally`, and the closing describe asserts the
 * tree is byte-identical to where the suite started.
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

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { type ReactElement } from "react"

import { readable } from "../lexicon/banned-claims.test"
import { ADDITIVE_PAGE_ROUTES, classifyRoutes, pageRouteViolations } from "./page-route-rules.test"

const ROOT = resolve(__dirname, "../..")
const APP_DIR = join(ROOT, "app")
const HOMEPAGE = join(ROOT, "components/ot-design/HomePage.tsx")
const CHROME = join(ROOT, "components/ot-design/SiteChrome.tsx")
const BOR = join(ROOT, "app/board-of-review/page.tsx")

const MATRIX_PATH =
  "/Users/abigailclaw/.openclaw/workspace/rex/handoffs/ot-minimum-postable-rebuild-20260819/qa/acceptance-matrix.json"

function controllerDeclared(): Set<string> {
  const m = JSON.parse(readFileSync(MATRIX_PATH, "utf8")) as {
    accepted_routes: Array<{ path: string }>
    named_surfaces: Array<{ path: string }>
  }
  return new Set([...m.accepted_routes.map((r) => r.path), ...m.named_surfaces.map((s) => s.path)])
}

/** The reconciliation the governance suite performs, callable against a mutated tree. */
function reconcile(additive: string[] = ADDITIVE_PAGE_ROUTES) {
  const { crawlable } = classifyRoutes()
  const declared = controllerDeclared()
  const controller = crawlable.filter((p) => declared.has(p))
  const union = [...controller, ...additive].sort()
  return {
    crawlable,
    balanced: JSON.stringify(union) === JSON.stringify(crawlable),
    ungoverned: crawlable.filter((p) => !declared.has(p) && !additive.includes(p)),
    orphaned: additive.filter((p) => !crawlable.includes(p)),
    unresolved: additive.filter(
      (p) => !["page.tsx", "page.ts"].some((f) => existsSync(join(APP_DIR, p === "/" ? "" : p, f))),
    ),
  }
}

/**
 * A page module, created and removed.
 *
 * Cleanup removes the *topmost* directory this call had to create, not the leaf.
 * `zz-mutant-dyn/[id]` creates two levels, and removing only the leaf leaves an
 * empty parent behind — which the closing artifact check then catches, correctly.
 */
function withPage(routeDir: string, run: () => void | Promise<void>) {
  const dir = join(APP_DIR, routeDir)
  const segments = routeDir.split("/")
  let topmostCreated: string | null = null
  for (let i = 1; i <= segments.length; i++) {
    const candidate = join(APP_DIR, segments.slice(0, i).join("/"))
    if (!existsSync(candidate)) {
      topmostCreated = candidate
      break
    }
  }
  return (async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "page.tsx"), "export default function Mutant() {\n  return <div>Mutant</div>\n}\n", "utf8")
    try {
      await run()
    } finally {
      if (topmostCreated) rmSync(topmostCreated, { recursive: true, force: true })
      else rmSync(join(dir, "page.tsx"), { force: true })
    }
  })()
}

function withSource(path: string, mutate: (src: string) => string, run: () => void | Promise<void>) {
  const original = readFileSync(path, "utf8")
  return (async () => {
    writeFileSync(path, mutate(original), "utf8")
    jest.resetModules()
    try {
      await run()
    } finally {
      writeFileSync(path, original, "utf8")
      jest.resetModules()
    }
  })()
}

/**
 * Render a route from the *current* module registry.
 *
 * `jest.resetModules()` is what makes an edited component source take effect,
 * but it also gives the fresh registry its own copy of React. A
 * `renderToStaticMarkup` imported at the top of this file would then be holding
 * the old React and its dispatcher would be null, so both are re-imported here
 * on every call and travel together.
 */
async function render(route: string): Promise<string> {
  const dir = route === "/" ? "" : route
  const [{ renderToStaticMarkup: renderNow }, { createElement: createNow }, mod] = await Promise.all([
    import("react-dom/server"),
    import("react"),
    import(`@/app${dir}/page`) as Promise<{ default: (p: never) => ReactElement | Promise<ReactElement> }>,
  ])
  const Page = mod.default
  const isAsync = Page.constructor.name === "AsyncFunction"
  const el = isAsync ? await (Page as (p?: unknown) => Promise<ReactElement>)() : createNow(Page as never)
  return renderNow(el)
}

const BASELINE = {
  home: readFileSync(HOMEPAGE, "utf8"),
  chrome: readFileSync(CHROME, "utf8"),
  bor: readFileSync(BOR, "utf8"),
  routes: classifyRoutes(),
}

beforeEach(() => {
  jest.resetModules()
})

describe("page-route governance fails when it should", () => {
  it("P1 — a new crawlable page appears without governance", async () => {
    await withPage("zz-mutant-route", () => {
      const r = reconcile()
      expect(r.crawlable).toContain("/zz-mutant-route")
      expect(r.ungoverned).toEqual(["/zz-mutant-route"])
      expect(r.balanced).toBe(false)
    })
    expect(reconcile().balanced).toBe(true)
  })

  it("P2 — a governed page is deleted while its registry entry stays", async () => {
    const dir = join(APP_DIR, "board-of-review")
    const original = readFileSync(join(dir, "page.tsx"), "utf8")
    rmSync(join(dir, "page.tsx"))
    try {
      const r = reconcile()
      expect(r.crawlable).not.toContain("/board-of-review")
      // The entry no longer resolves to a real page module...
      expect(r.unresolved).toEqual(["/board-of-review"])
      // ...and it is orphaned against the served set.
      expect(r.orphaned).toEqual(["/board-of-review"])
      expect(r.balanced).toBe(false)
    } finally {
      writeFileSync(join(dir, "page.tsx"), original, "utf8")
    }
    expect(reconcile().balanced).toBe(true)
  })

  it("P3 — a served crawlable route is dropped from its bucket", () => {
    const narrowed = ADDITIVE_PAGE_ROUTES.filter((p) => p !== "/board-of-review")
    const r = reconcile(narrowed)
    expect(r.ungoverned).toEqual(["/board-of-review"])
    expect(r.balanced).toBe(false)
    expect(reconcile().balanced).toBe(true)
  })

  it("P6 — /homestead-exemption is narrowed out while it is still served", () => {
    // Named separately from P3 because it is the ratified additive entry the
    // brief calls out: removing it must fail, not silently ungovern the page.
    const narrowed = ADDITIVE_PAGE_ROUTES.filter((p) => p !== "/homestead-exemption")
    const r = reconcile(narrowed)
    expect(r.crawlable).toContain("/homestead-exemption")
    expect(r.ungoverned).toEqual(["/homestead-exemption"])
    expect(r.balanced).toBe(false)
    expect(reconcile().balanced).toBe(true)
  })

  it("P4 — a frozen-lexicon phrase is introduced into a clean rendered page", async () => {
    expect(pageRouteViolations(await render("/privacy"))).toEqual([])
    await withSource(
      join(ROOT, "app/privacy/page.tsx"),
      (src) =>
        src.replace(
          '<h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>',
          '<h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>\n        <p>We file your appeal for you.</p>',
        ),
      async () => {
        const html = await render("/privacy")
        expect(pageRouteViolations(html)).toContain("PR-1 frozen banned-claims lexicon")
      },
    )
    expect(pageRouteViolations(await render("/privacy"))).toEqual([])
  })

  it("P5a — BL-C5 is reintroduced on the homepage", async () => {
    await withSource(
      HOMEPAGE,
      (src) =>
        src.replace(
          "A one-page report — your assessed value, your comps, and where every number came from.",
          "A one-page report — the only thing the Board of Review actually reads.",
        ),
      async () => {
        const html = await render("/")
        expect(pageRouteViolations(html)).toContain("PR-1 frozen banned-claims lexicon")
        expect(readable(html)).toMatch(/the only thing the board of review actually reads/i)
      },
    )
    expect(pageRouteViolations(await render("/"))).toEqual([])
  })

  it("P5b — BL-D2 is reintroduced, in both places it was removed from", async () => {
    for (const [file, from, to] of [
      [HOMEPAGE, "Cook County Assessor + Board of Review public records", "Cook County Assessor + Board of Review public records, checked regularly"],
      [CHROME, "Township schedules, as published by the county", "Township schedules checked regularly"],
    ] as Array<[string, string, string]>) {
      await withSource(
        file,
        (src) => src.replace(from, to),
        async () => {
          const html = await render("/")
          expect({ file, violations: pageRouteViolations(html) }).toEqual({
            file,
            violations: ["PR-1 frozen banned-claims lexicon"],
          })
        },
      )
    }
    expect(pageRouteViolations(await render("/"))).toEqual([])
  })

  it("P5c — BL-B2 is reintroduced on /board-of-review", async () => {
    await withSource(
      BOR,
      (src) =>
        src.replace(
          "Cook County has two separate levels of property tax appeal.",
          "Most homeowners don&apos;t know Cook County has two separate levels of property tax appeal.",
        ),
      async () => {
        const html = await render("/board-of-review")
        expect(pageRouteViolations(html)).toContain("PR-1 frozen banned-claims lexicon")
        expect(readable(html)).toMatch(/most homeowners/i)
      },
    )
    expect(pageRouteViolations(await render("/board-of-review"))).toEqual([])
  })

  it("P7a — a route handler is not misclassified as a crawlable page", async () => {
    const dir = join(APP_DIR, "zz-mutant-handler")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "route.ts"), "export function GET() {\n  return new Response('ok')\n}\n", "utf8")
    try {
      const r = classifyRoutes()
      expect(r.all).not.toContain("/zz-mutant-handler")
      expect(r.crawlable).not.toContain("/zz-mutant-handler")
      expect(reconcile().balanced).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("P7b — a dynamic pattern is not misclassified as a crawlable page", async () => {
    await withPage("zz-mutant-dyn/[id]", () => {
      const r = classifyRoutes()
      expect(r.dynamic).toContain("/zz-mutant-dyn/[id]")
      expect(r.crawlable).not.toContain("/zz-mutant-dyn/[id]")
      // The parent directory has no page module, so it contributes no route.
      expect(r.crawlable).not.toContain("/zz-mutant-dyn")
      expect(reconcile().balanced).toBe(true)
    })
  })

  it("P7c — a robots-disallowed route is not misclassified as crawlable", async () => {
    await withPage("admin/zz-mutant-admin", () => {
      const r = classifyRoutes()
      expect(r.all).toContain("/admin/zz-mutant-admin")
      expect(r.authenticated).toContain("/admin/zz-mutant-admin")
      expect(r.crawlable).not.toContain("/admin/zz-mutant-admin")
      expect(reconcile().balanced).toBe(true)
    })
  })
})

describe("no page-route mutation left an artifact", () => {
  it("the mutated sources are byte-identical", () => {
    expect(readFileSync(HOMEPAGE, "utf8")).toBe(BASELINE.home)
    expect(readFileSync(CHROME, "utf8")).toBe(BASELINE.chrome)
    expect(readFileSync(BOR, "utf8")).toBe(BASELINE.bor)
  })

  it("the route surface is byte-identical", () => {
    expect(classifyRoutes()).toEqual(BASELINE.routes)
  })

  it("no probe route remains under app/", () => {
    const strays: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        if (entry.startsWith("zz-mutant")) strays.push(`${dir}/${entry}`)
        const child = `${dir}/${entry}`
        if (statSync(join(ROOT, child)).isDirectory()) walk(child)
      }
    }
    walk("app")
    expect(strays).toEqual([])
  })
})
