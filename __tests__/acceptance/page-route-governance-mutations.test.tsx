/**
 * @jest-environment node
 *
 * Adversarial proofs for crawlable page-route governance.
 *
 * **Every structural mutation happens in a disposable fixture tree.** The
 * earlier version of this suite created probe routes under the real `app/`,
 * deleted real `page.tsx` files and rewrote real component sources, reverting
 * each in `finally`. Reversion was byte-exact, but Jest's default workers meant
 * other suites were walking that same tree concurrently — which is what made
 * `npx jest` nondeterministic while `--runInBand` passed, and what would have
 * left a real source file truncated had a worker died mid-mutation.
 *
 * The invariants are unchanged. `classifyRoutes()` still reads disk on every
 * call and still derives from the filesystem router; it is now handed a root, so
 * the same derivation runs over a tree built for the test. Fixture fidelity is
 * proven before any mutation: the mirrored tree classifies identically to the
 * real one, so a proof against the fixture is a proof against production.
 *
 * `guardRepoWrites()` makes that binding enforced rather than conventional — any
 * write beneath the repository fails the test at its call site.
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

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { type ReactElement } from "react"

import {
  controllerDeclaredPaths,
  guardRepoWrites,
  withFixtureRoot,
} from "../helpers/governance-fixtures.test"
import { readable } from "../lexicon/banned-claims.test"
import { ADDITIVE_PAGE_ROUTES, PAGE_FILES, classifyRoutes, pageRouteViolations } from "./page-route-rules.test"

const ROOT = resolve(__dirname, "../..")
const APP_DIR = join(ROOT, "app")
const HOMEPAGE = join(ROOT, "components/ot-design/HomePage.tsx")
const CHROME = join(ROOT, "components/ot-design/SiteChrome.tsx")
const BOR = join(ROOT, "app/board-of-review/page.tsx")

guardRepoWrites()

/* ── Fixture construction ─────────────────────────────────────────────────── */

/**
 * Mirror the real route surface into a fixture tree.
 *
 * Only what the derivation actually reads is reproduced: the directory shape,
 * one stub per page module, the route handlers, and `robots.ts` copied byte-for
 * -byte because its disallow list is parsed rather than assumed. Page bodies are
 * stubs — `classifyRoutes` never opens them, and a stub keeps the fixture
 * deterministic. Fidelity is asserted, not trusted; see the first test below.
 */
function mirrorRouteTree(root: string): void {
  const walk = (rel: string) => {
    const entries = readdirSync(join(ROOT, rel))
    mkdirSync(join(root, rel), { recursive: true })
    for (const entry of entries) {
      const child = `${rel}/${entry}`
      if (statSync(join(ROOT, child)).isDirectory()) {
        walk(child)
      } else if (PAGE_FILES.includes(entry) || entry === "route.ts" || entry === "route.tsx") {
        writeFileSync(join(root, child), "export default function Stub() {\n  return null\n}\n", "utf8")
      }
    }
  }
  walk("app")
  mkdirSync(join(root, "app"), { recursive: true })
  copyFileSync(join(ROOT, "app/robots.ts"), join(root, "app/robots.ts"))
}

/** Add a page module to the fixture at `routeDir`. */
function addFixturePage(root: string, routeDir: string): void {
  const dir = join(root, "app", routeDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "page.tsx"), "export default function Mutant() {\n  return <div>Mutant</div>\n}\n", "utf8")
}

/** The reconciliation the governance suite performs, run against an arbitrary root. */
function reconcile(root: string, additive: string[] = ADDITIVE_PAGE_ROUTES) {
  const { crawlable } = classifyRoutes(root)
  const declared = controllerDeclaredPaths()
  const controller = crawlable.filter((p) => declared.has(p))
  const union = [...controller, ...additive].sort()
  return {
    crawlable,
    balanced: JSON.stringify(union) === JSON.stringify(crawlable),
    ungoverned: crawlable.filter((p) => !declared.has(p) && !additive.includes(p)),
    orphaned: additive.filter((p) => !crawlable.includes(p)),
    unresolved: additive.filter(
      (p) => !PAGE_FILES.some((f) => existsSync(join(root, "app", p === "/" ? "" : p, f))),
    ),
  }
}

/** Build a mirrored fixture, run `body` against it, and remove it. */
function withRouteFixture(name: string, body: (root: string) => void | Promise<void>) {
  return withFixtureRoot(`routes-${name}`, async (root) => {
    mirrorRouteTree(root)
    await body(root)
  })
}

/* ── Rendering ────────────────────────────────────────────────────────────── */

/**
 * Render a real route. Read-only: nothing here writes to the checkout.
 *
 * `jest.resetModules()` gives the fresh registry its own copy of React, so
 * `renderToStaticMarkup` and `createElement` are re-imported on every call and
 * travel together; a hoisted one would hold the old React and its dispatcher
 * would be null.
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

/**
 * Put a withdrawn claim back into rendered output.
 *
 * The sweep's subject is rendered HTML, so the reintroduction is applied to the
 * render rather than to a component source on disk — which is what removes the
 * shared-tree race without weakening the proof. The anchor is the neutralised
 * copy that shipped, so a match failure means the page no longer renders what
 * the remediation put there, and this throws rather than quietly asserting
 * against an unmutated string.
 */
function reintroduce(html: string, from: string, to: string): string {
  const mutated = html.replace(from, to)
  if (mutated === html) {
    throw new Error(`reintroduce(): anchor copy is not present in the rendered output: ${JSON.stringify(from)}`)
  }
  return mutated
}

beforeEach(() => {
  jest.resetModules()
})

/* ── Fixture fidelity ─────────────────────────────────────────────────────── */

describe("the fixture tree is a faithful stand-in for the real route surface", () => {
  it("classifies identically to the real tree", async () => {
    await withRouteFixture("fidelity", (root) => {
      expect(classifyRoutes(root)).toEqual(classifyRoutes())
    })
  })

  it("reconciles balanced before anything is mutated, exactly as production does", async () => {
    await withRouteFixture("balanced", (root) => {
      const r = reconcile(root)
      expect(r.balanced).toBe(true)
      expect(r.ungoverned).toEqual([])
      expect(r.orphaned).toEqual([])
      expect(r.unresolved).toEqual([])
    })
  })
})

/* ── Structural mutations, all in fixtures ───────────────────────────────── */

describe("page-route governance fails when it should", () => {
  it("P1 — a new crawlable page appears without governance", async () => {
    await withRouteFixture("p1", (root) => {
      addFixturePage(root, "zz-mutant-route")
      const r = reconcile(root)
      expect(r.crawlable).toContain("/zz-mutant-route")
      expect(r.ungoverned).toEqual(["/zz-mutant-route"])
      expect(r.balanced).toBe(false)
    })
    await withRouteFixture("p1-clean", (root) => expect(reconcile(root).balanced).toBe(true))
  })

  it("P2 — a governed page is deleted while its registry entry stays", async () => {
    await withRouteFixture("p2", (root) => {
      rmSync(join(root, "app/board-of-review/page.tsx"))
      const r = reconcile(root)
      expect(r.crawlable).not.toContain("/board-of-review")
      // The entry no longer resolves to a real page module...
      expect(r.unresolved).toEqual(["/board-of-review"])
      // ...and it is orphaned against the served set.
      expect(r.orphaned).toEqual(["/board-of-review"])
      expect(r.balanced).toBe(false)
    })
  })

  it("P3 — a served crawlable route is dropped from its bucket", async () => {
    await withRouteFixture("p3", (root) => {
      const narrowed = ADDITIVE_PAGE_ROUTES.filter((p) => p !== "/board-of-review")
      const r = reconcile(root, narrowed)
      expect(r.ungoverned).toEqual(["/board-of-review"])
      expect(r.balanced).toBe(false)
      expect(reconcile(root).balanced).toBe(true)
    })
  })

  it("P6 — /homestead-exemption is narrowed out while it is still served", async () => {
    // Named separately from P3 because it is the ratified additive entry the
    // brief calls out: removing it must fail, not silently ungovern the page.
    await withRouteFixture("p6", (root) => {
      const narrowed = ADDITIVE_PAGE_ROUTES.filter((p) => p !== "/homestead-exemption")
      const r = reconcile(root, narrowed)
      expect(r.crawlable).toContain("/homestead-exemption")
      expect(r.ungoverned).toEqual(["/homestead-exemption"])
      expect(r.balanced).toBe(false)
      expect(reconcile(root).balanced).toBe(true)
    })
  })

  it("P7a — a route handler is not misclassified as a crawlable page", async () => {
    await withRouteFixture("p7a", (root) => {
      const dir = join(root, "app/zz-mutant-handler")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "route.ts"), "export function GET() {\n  return new Response('ok')\n}\n", "utf8")
      const r = classifyRoutes(root)
      expect(r.all).not.toContain("/zz-mutant-handler")
      expect(r.crawlable).not.toContain("/zz-mutant-handler")
      expect(reconcile(root).balanced).toBe(true)
    })
  })

  it("P7b — a dynamic pattern is not misclassified as a crawlable page", async () => {
    await withRouteFixture("p7b", (root) => {
      addFixturePage(root, "zz-mutant-dyn/[id]")
      const r = classifyRoutes(root)
      expect(r.dynamic).toContain("/zz-mutant-dyn/[id]")
      expect(r.crawlable).not.toContain("/zz-mutant-dyn/[id]")
      // The parent directory has no page module, so it contributes no route.
      expect(r.crawlable).not.toContain("/zz-mutant-dyn")
      expect(reconcile(root).balanced).toBe(true)
    })
  })

  it("P7c — a robots-disallowed route is not misclassified as crawlable", async () => {
    await withRouteFixture("p7c", (root) => {
      addFixturePage(root, "admin/zz-mutant-admin")
      const r = classifyRoutes(root)
      expect(r.all).toContain("/admin/zz-mutant-admin")
      expect(r.authenticated).toContain("/admin/zz-mutant-admin")
      expect(r.crawlable).not.toContain("/admin/zz-mutant-admin")
      expect(reconcile(root).balanced).toBe(true)
    })
  })

  it("P7d — a robots.ts that stops disallowing a prefix exposes those routes", async () => {
    // The mirror copies `robots.ts` rather than assuming its contents, so the
    // disallow list is a real input — and narrowing it is a real mutation.
    await withRouteFixture("p7d", (root) => {
      const robots = join(root, "app/robots.ts")
      const src = readFileSync(robots, "utf8")
      expect(classifyRoutes(root).crawlable).not.toContain("/admin")
      writeFileSync(robots, src.replace(/"\/admin\/?"/, '"/zz-nothing-here"'), "utf8")
      const r = classifyRoutes(root)
      expect(r.disallowed).not.toContain("/admin")
      expect(r.crawlable.some((p) => p === "/admin" || p.startsWith("/admin/"))).toBe(true)
      expect(reconcile(root).balanced).toBe(false)
    })
  })
})

/* ── Claim reintroduction, over real renders ─────────────────────────────── */

describe("a withdrawn claim is caught if it comes back", () => {
  it("P4 — a frozen-lexicon phrase is introduced into a clean rendered page", async () => {
    const clean = await render("/privacy")
    expect(pageRouteViolations(clean)).toEqual([])
    const mutated = reintroduce(
      clean,
      "<h1 class=\"text-3xl font-bold text-gray-900 mb-2\">Privacy Policy</h1>",
      "<h1 class=\"text-3xl font-bold text-gray-900 mb-2\">Privacy Policy</h1><p>We file your appeal for you.</p>",
    )
    expect(pageRouteViolations(mutated)).toContain("PR-1 frozen banned-claims lexicon")
  })

  it("P5a — BL-C5 is reintroduced on the homepage", async () => {
    const clean = await render("/")
    expect(pageRouteViolations(clean)).toEqual([])
    const mutated = reintroduce(
      clean,
      "A one-page report — your assessed value, your comps, and where every number came from.",
      "A one-page report — the only thing the Board of Review actually reads.",
    )
    expect(pageRouteViolations(mutated)).toContain("PR-1 frozen banned-claims lexicon")
    expect(readable(mutated)).toMatch(/the only thing the board of review actually reads/i)
  })

  it("P5b — BL-D2 is reintroduced, in both places it was removed from", async () => {
    const clean = await render("/")
    expect(pageRouteViolations(clean)).toEqual([])
    for (const [label, from, to] of [
      [
        "HomePage specificity bar",
        "Cook County Assessor + Board of Review public records",
        "Cook County Assessor + Board of Review public records, checked regularly",
      ],
      ["SiteChrome status chip", "Township schedules, as published by the county", "Township schedules checked regularly"],
    ] as Array<[string, string, string]>) {
      const mutated = reintroduce(clean, from, to)
      expect({ label, violations: pageRouteViolations(mutated) }).toEqual({
        label,
        violations: ["PR-1 frozen banned-claims lexicon"],
      })
    }
  })

  it("P5c — BL-B2 is reintroduced on /board-of-review", async () => {
    const clean = await render("/board-of-review")
    expect(pageRouteViolations(clean)).toEqual([])
    const mutated = reintroduce(
      clean,
      "Cook County has two separate levels of property tax appeal.",
      "Most homeowners don&#x27;t know Cook County has two separate levels of property tax appeal.",
    )
    expect(pageRouteViolations(mutated)).toContain("PR-1 frozen banned-claims lexicon")
    expect(readable(mutated)).toMatch(/most homeowners/i)
  })

  it("the neutralised copy is gone from the sources, not merely from the render", () => {
    // The renders above prove the sweep still catches the phrases. This proves
    // the phrases are not in the shipped sources to begin with.
    for (const [file, banned] of [
      [HOMEPAGE, /the only thing the Board of Review actually reads/i],
      [HOMEPAGE, /checked regularly/i],
      [CHROME, /checked regularly/i],
      [BOR, /most homeowners/i],
    ] as Array<[string, RegExp]>) {
      expect({ file, present: banned.test(readFileSync(file, "utf8")) }).toEqual({ file, present: false })
    }
  })
})

/* ── The checkout was never touched ──────────────────────────────────────── */

describe("no page-route mutation reached the repository", () => {
  it("the component sources are byte-identical to HEAD", () => {
    for (const file of [HOMEPAGE, CHROME, BOR]) {
      expect(readFileSync(file, "utf8")).toBe(BASELINE[file])
    }
  })

  it("the real route surface is unchanged", () => {
    expect(classifyRoutes()).toEqual(BASELINE_ROUTES)
  })

  it("no probe route was ever created under the real app/", () => {
    const strays: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        if (entry.startsWith("zz-mutant") || entry.startsWith("zz-nothing")) strays.push(`${dir}/${entry}`)
        const child = `${dir}/${entry}`
        if (statSync(join(ROOT, child)).isDirectory()) walk(child)
      }
    }
    walk("app")
    expect(strays).toEqual([])
  })
})

const BASELINE: Record<string, string> = {
  [HOMEPAGE]: readFileSync(HOMEPAGE, "utf8"),
  [CHROME]: readFileSync(CHROME, "utf8"),
  [BOR]: readFileSync(BOR, "utf8"),
}
const BASELINE_ROUTES = classifyRoutes()
