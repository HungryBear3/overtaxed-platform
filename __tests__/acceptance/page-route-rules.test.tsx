/**
 * @jest-environment node
 *
 * Page-route derivation and sweep rules.
 *
 * Extracted into their own module for the reason the blog work already taught:
 * the governance suite and the mutation suite both need them, and having the
 * mutation suite import the governance suite makes Jest re-run tree-dependent
 * assertions *while the tree is deliberately mutated*.
 *
 * Everything here is either a pure predicate over a string or a derivation that
 * reads the filesystem on each call — never a cached list. The tests in this
 * file are fixture-based and tree-independent, so they hold during a mutation.
 * The derivation itself is proven against the real tree in
 * `page-route-governance.test.tsx`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import { BANNED_LEXICON, readable } from "../lexicon/banned-claims.test"

const ROOT = resolve(__dirname, "../..")
const APP_DIR = join(ROOT, "app")

export const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"]

/**
 * Prefixes `app/robots.ts` excludes from indexing. Read, never assumed.
 *
 * `root` defaults to the repository but is explicit so the mutation suites can
 * point the identical derivation at a temporary fixture tree instead of editing
 * the real checkout. See `governance-fixtures.test.ts` for why that matters.
 */
export function robotsDisallow(root: string = ROOT): string[] {
  const src = readFileSync(join(root, "app/robots.ts"), "utf8")
  const block = src.slice(src.indexOf("disallow:"))
  return [...block.slice(0, block.indexOf("]")).matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
}

/**
 * Every route Next serves a page for, derived from the filesystem router.
 *
 * Route groups `(name)` contribute no path segment, which is why they are
 * stripped rather than treated as directories.
 */
export function derivePageRoutes(root: string = ROOT): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    const entries = readdirSync(join(root, dir))
    if (entries.some((e) => PAGE_FILES.includes(e))) {
      const rel = dir.slice("app".length).replace(/\/\([^)]*\)/g, "") || "/"
      out.push(rel.startsWith("/") ? rel : `/${rel}`)
    }
    for (const entry of entries) {
      const child = `${dir}/${entry}`
      if (statSync(join(root, child)).isDirectory()) walk(child)
    }
  }
  walk("app")
  return [...new Set(out)].sort()
}

const ALL_PAGE_ROUTES = derivePageRoutes()
const DYNAMIC_ROUTES = ALL_PAGE_ROUTES.filter((p) => p.includes("["))
const STATIC_ROUTES = ALL_PAGE_ROUTES.filter((p) => !p.includes("["))
const DISALLOWED = robotsDisallow()

const isDisallowed = (p: string) => DISALLOWED.some((d) => p === d || p.startsWith(`${d}/`))

const CRAWLABLE = STATIC_ROUTES.filter((p) => !isDisallowed(p)).sort()
const AUTHENTICATED = STATIC_ROUTES.filter(isDisallowed).sort()


/**
 * The ratified additive governance layer for page routes.
 *
 * **This is a standing governance layer, not frozen-controller membership, and
 * not an exemption mechanism.** Membership here obliges a route to the same
 * sweeps as a controller-declared one — the frozen lexicon and every extended
 * rule below — and buys it nothing. A route cannot be quieted by being added;
 * it can only be added once it renders clean.
 *
 * The frozen packet stays at 53 routes / 22 surfaces / 10 fixtures / 0
 * mutations, is not edited, re-hashed, re-stamped or chmod'd, and these counts
 * must never be added to it when reporting controller status.
 */
export const ADDITIVE_PAGE_ROUTES = [
  "/",
  "/appeal-packet",
  "/blog",
  "/board-of-review",
  "/divorce-prep",
  "/expungement-guide",
  "/hoa",
  "/homestead-exemption",
  "/how-it-works",
  "/landlord-notices",
  "/legalkitsusa",
  "/legalkitsusa/privacy",
  "/privacy",
].sort()

/* ── Sweep rules ──────────────────────────────────────────────────────────── */

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December"

export const RETIRED_DOWNLOADS = [
  "/downloads/county-deadline-calendar.md",
  "/downloads/filing-instructions.md",
  "/downloads/faq.md",
  "/downloads/cover-letter-template.md",
  "/downloads/homestead-exemption/homestead-exemption-guide.md",
]

function retiredBlogSlugs(): string[] {
  return readdirSync(join(ROOT, "docs/retired-resources/blog-claims"))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => f.replace(/\.md$/, ""))
}

const RETIRED_SLUGS = retiredBlogSlugs()

type PageRule = { id: string; hit: (text: string, html: string) => boolean }

/**
 * Rules whose semantics match a page route.
 *
 * Deliberately *not* carried over from the blog corpus: the dollar-figure and
 * checkout rules. `/pricing` states a price and `/checkout` offers checkout —
 * that is the product, not a claim. Savings and overpayment promises are still
 * caught, because the frozen lexicon carries them (BL-B1/B3) and PR-1 applies it
 * in full to every page.
 */
export const PAGE_RULES: PageRule[] = [
  { id: "PR-1 frozen banned-claims lexicon", hit: (t) => BANNED_LEXICON.some(([, p]) => p.test(t)) },
  { id: "PR-2 non-canonical Assessor host", hit: (_t, html) => /cookcountyassessor\.com/i.test(html) },
  {
    /**
     * A date in *deadline context*, not any date.
     *
     * `/blog` renders each post's publication date beside its title. That is
     * metadata about when something was written, and the frozen guard in
     * `generated-content-safety` already exempts it for exactly this reason —
     * "sweeping it for date claims would fail every post for saying when it was
     * written". A rule that cannot tell a byline from a filing deadline would
     * force the corpus to hide its own publication dates.
     */
    id: "PR-3 states an appeal deadline of its own",
    hit: (t) => {
      const DATE = new RegExp(`\\b(?:${MONTH})\\s+\\d{1,2},?\\s+(?:19|20)\\d{2}\\b|\\b(?:19|20)\\d{2}-\\d{2}-\\d{2}\\b`, "g")
      const DEADLINE_CONTEXT = /\b(deadline|window|filing|file by|closes?|close date|due|last day|appeal by)\b/i
      for (const match of t.matchAll(DATE)) {
        const around = t.slice(Math.max(0, match.index - 90), match.index + match[0].length + 60)
        if (DEADLINE_CONTEXT.test(around)) return true
      }
      return false
    },
  },
  {
    id: "PR-4 runs a countdown",
    hit: (t) => /\b\d+\s*(days?|business days?|weeks?)\s*(left|remaining|until|before|to file|to appeal)/i.test(t),
  },
  {
    id: "PR-5 asserts an open or closing window",
    hit: (t) => {
      const pattern = /\b(window is (now )?open|currently open|open now|closes? (today|tomorrow|soon)|filing is open)\b/gi
      for (const match of t.matchAll(pattern)) {
        const before = t.slice(Math.max(0, match.index - 60), match.index)
        // A negation or an indirect question is not an assertion.
        if (/\b(not|never|n't|whether|if)\b[^.]*$/i.test(before)) continue
        // `/deadlines` and `/townships` render a status tally — "0 open now",
        // "38 pending official date". A count label with a number in front of
        // it is a legend, not a claim that any window is open; on both pages
        // that number is currently zero and the copy beside it says to confirm
        // the date with the county.
        if (/\d+\s*$/.test(before)) continue
        return true
      }
      return false
    },
  },
  { id: "PR-6 links a retired public download", hit: (_t, html) => RETIRED_DOWNLOADS.some((p) => html.includes(p)) },
  {
    id: "PR-7 links a retired blog post",
    hit: (_t, html) => RETIRED_SLUGS.some((s) => new RegExp(`${s}(?![a-z0-9-])`).test(html)),
  },
]

export function pageRouteViolations(html: string): string[] {
  const text = readable(html)
  return PAGE_RULES.filter((r) => r.hit(text, html)).map((r) => r.id)
}

/* ── Classification, derived on every call ───────────────────────────────── */

export type RouteSets = {
  all: string[]
  dynamic: string[]
  authenticated: string[]
  crawlable: string[]
  disallowed: string[]
}

/**
 * Re-derived from disk each time, so a mutation is visible immediately.
 *
 * `root` is a parameter rather than a module constant so a mutation proof can
 * run the real derivation over a disposable fixture tree.
 */
export function classifyRoutes(root: string = ROOT): RouteSets {
  const all = derivePageRoutes(root)
  const disallowed = robotsDisallow(root)
  const isBlocked = (p: string) => disallowed.some((d) => p === d || p.startsWith(`${d}/`))
  const statics = all.filter((p) => !p.includes("["))
  return {
    all,
    disallowed,
    dynamic: all.filter((p) => p.includes("[")),
    authenticated: statics.filter(isBlocked).sort(),
    crawlable: statics.filter((p) => !isBlocked(p)).sort(),
  }
}

/* ── Fixture-based proofs, independent of the tree ───────────────────────── */

describe("every page rule fires on the claim it bans", () => {
  const FIXTURES: Array<[string, string]> = [
    ["PR-1 frozen banned-claims lexicon", "<p>We file your appeal for you.</p>"],
    ["PR-2 non-canonical Assessor host", '<a href="https://www.cookcountyassessor.com">look up</a>'],
    ["PR-3 states an appeal deadline of its own", "<p>Your filing deadline is March 14, 2026.</p>"],
    ["PR-4 runs a countdown", "<p>Only 12 days left to file.</p>"],
    ["PR-5 asserts an open or closing window", "<p>Your appeal window is now open.</p>"],
    ["PR-6 links a retired public download", '<a href="/downloads/county-deadline-calendar.md">cal</a>'],
    ["PR-7 links a retired blog post", '<a href="/blog/free-property-tax-check-cook-county">post</a>'],
  ]

  it.each(FIXTURES)("%s", (id, fixture) => {
    expect(pageRouteViolations(fixture)).toContain(id)
  })

  it("covers every rule with a fixture", () => {
    expect(FIXTURES.map(([id]) => id).sort()).toEqual(PAGE_RULES.map((r) => r.id).sort())
  })

  it("PR-3 ignores a publication date, which is metadata and not a deadline", () => {
    // `/blog` renders each post's date beside its title.
    expect(pageRouteViolations("<h2>Rule 15 Appeals</h2><p>March 24, 2026</p>")).toEqual([])
  })

  it("PR-5 ignores a status tally, which is a legend and not a claim", () => {
    // `/deadlines` renders "0 open now · 38 pending official date · 0 closed".
    expect(pageRouteViolations("<span>0</span> <span>open now</span>")).toEqual([])
  })

  it("PR-5 ignores a refusal to state the window", () => {
    expect(pageRouteViolations("<p>We do not tell you whether the window is open today.</p>")).toEqual([])
  })

  it("passes ordinary product copy", () => {
    const benign =
      "<p>OverTaxed IL analyzes public Cook County records and prepares a defined Assessor-stage " +
      "appeal packet. Confirm your own deadline at cookcountyassessoril.gov.</p>"
    expect(pageRouteViolations(benign)).toEqual([])
  })
})
