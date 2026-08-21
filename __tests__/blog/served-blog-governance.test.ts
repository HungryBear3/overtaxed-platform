/** @jest-environment node */

/**
 * Served blog governance — reconciled from the source that makes content reachable.
 *
 * Three review rounds each found the same defect in a different place: content
 * the app serves dynamically, governed by a list maintained by hand.
 * `/resources` passed its row while five appeal-domain downloads sat served and
 * crawlable. `/homestead-exemption` was live and in neither the 53-route corpus
 * nor the 22 named surfaces. And `content/blog` held 18 posts — every one
 * routable and every one advertised in `sitemap.xml` — while the safety sweep
 * named five, because five is what the frozen corpus accepts. Nine of the
 * thirteen nobody was looking at published banned claims.
 *
 * So this suite does not carry a list of posts to check. It asks `lib/blog` what
 * the site serves, and then requires everything else to agree: static
 * generation, the sitemap, the RSS feed, the `/blog` listing, the controller's
 * five, the four additive posts, and the retired evidence set. A tenth post
 * cannot be served, indexed or linked without failing here, and it cannot be
 * governed by being added to a list — it has to be clean.
 *
 * There is deliberately no exemption list, ignore list, baseline ledger or
 * accepted-failure count for public content. The live corpus is required to be
 * clean, not to match a snapshot of how dirty it currently is.
 */

const notFoundError = "NEXT_NOT_FOUND"

jest.mock("next/navigation", () => ({
  __esModule: true,
  notFound: () => {
    throw new Error(notFoundError)
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/blog",
}))

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

import { getAllPosts, getPostBySlug } from "@/lib/blog"
import { BANNED_LEXICON, readable } from "../lexicon/banned-claims.test"
import { publicBlogViolations } from "./blog-corpus-rules.test"

const ROOT = resolve(__dirname, "../..")
const CONTENT_DIR = join(ROOT, "content/blog")
const RETIRED_DIR = join(ROOT, "docs/retired-resources/blog-claims")

const MATRIX_PATH =
  "/Users/abigailclaw/.openclaw/workspace/rex/handoffs/ot-minimum-postable-rebuild-20260819/qa/acceptance-matrix.json"

/* ── The one source ───────────────────────────────────────────────────────── */

/** What the site serves. Derived, never enumerated. */
function liveSlugs(): string[] {
  return getAllPosts()
    .map((p) => p.slug)
    .sort()
}

/** The controller's frozen blog rows, read from the packet rather than copied. */
function controllerBlogSlugs(): string[] {
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8")) as {
    accepted_routes: Array<{ path: string }>
  }
  return matrix.accepted_routes
    .map((r) => r.path)
    .filter((p) => p.startsWith("/blog/"))
    .map((p) => p.slice("/blog/".length))
    .sort()
}

/**
 * Posts governed by this file rather than by the controller packet.
 *
 * Additive, implementer-owned, **pending controller ratification**. The frozen
 * declaration stays 53 routes / 22 surfaces and is not edited; these four are
 * the remainder of the live corpus, and they are governed here on exactly the
 * same terms as the controller's five — same sweeps, same thresholds, no
 * exemption.
 */
const ADDITIVE_GOVERNED_SLUGS = ["how-to-appeal-property-tax-illinois", "rule-15-appeal-cook-county-guide"].sort()

/** Withdrawn for banned claims. Evidence only; never public content. */
const RETIRED_SLUGS = [
  "bloom-township-property-tax-appeal-2026",
  "bremen-township-property-tax-appeal-2026",
  "calumet-township-property-tax-appeal-2026",
  "cook-county-comparable-sales-appeal",
  "cook-county-property-tax-how-it-works",
  "free-property-tax-check-cook-county",
  "how-much-can-you-save-appealing-property-taxes-illinois",
  "is-your-illinois-home-overassessed",
  "property-tax-appeal-cook-county",
  /**
   * These two were the "clean" remainder until the full corpus sweep ran.
   *
   * `cook-county-board-of-review-appeal-guide:70` — "reductions of $500–$2,000
   * per year are common", preceded by "frequently win reductions". No frozen
   * lexicon row catches it: BL-B3 matches "you could save"/"estimated savings",
   * and this phrases the same claim as a property of the outcome rather than a
   * promise to the reader.
   *
   * `cook-county-property-tax-appeal-deadline-2026:34` — "you typically have 30
   * days to file". The frozen countdown rule in `generated-content-safety`
   * matches this exactly; the post had simply never been swept, because it was
   * not one of the controller's five.
   *
   * Owner ruling 2 keeps a previously ungoverned post public *only if every
   * required sweep passes*. These do not pass, so they are retired on the same
   * terms as the other nine rather than exempted.
   */
  "cook-county-board-of-review-appeal-guide",
  "cook-county-property-tax-appeal-deadline-2026",
].sort()

/* ── Consumers, invoked for real ──────────────────────────────────────────── */

async function staticParamSlugs(): Promise<string[]> {
  const mod = (await import("@/app/blog/[slug]/page")) as {
    generateStaticParams: () => Promise<Array<{ slug: string }>>
  }
  return (await mod.generateStaticParams()).map((p) => p.slug).sort()
}

async function sitemapBlogSlugs(): Promise<string[]> {
  const mod = (await import("@/app/sitemap")) as { default: () => Array<{ url: string }> }
  return mod
    .default()
    .map((e) => e.url)
    .filter((u) => u.includes("/blog/"))
    .map((u) => u.split("/blog/")[1])
    .sort()
}

async function rssBlogSlugs(): Promise<string[]> {
  const mod = (await import("@/app/rss.xml/route")) as { GET: () => Response }
  const body = await mod.GET().text()
  return [...body.matchAll(/<link>[^<]*\/blog\/([^<]+)<\/link>/g)].map((m) => m[1]).sort()
}

async function listingSlugs(): Promise<string[]> {
  const mod = (await import("@/app/blog/page")) as { default: () => React.ReactElement }
  const html = renderToStaticMarkup(mod.default())
  return [...new Set([...html.matchAll(/href="\/blog\/([^"]+)"/g)].map((m) => m[1]))].sort()
}

function contentFileSlugs(): string[] {
  return readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort()
}

/* ── 1. One source of truth ───────────────────────────────────────────────── */

describe("every blog consumer derives from one source", () => {
  const CONSUMERS = [
    "app/blog/[slug]/page.tsx",
    "app/blog/page.tsx",
    "app/rss.xml/route.ts",
    "app/sitemap.ts",
  ]

  it.each(CONSUMERS)("%s imports the shared loader", (file) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toMatch(/from ['"]@\/lib\/blog['"]/)
  })

  it.each(CONSUMERS)("%s does not read the content directory itself", (file) => {
    // `app/sitemap.ts` used to call its own `readdirSync` on `content/blog`,
    // deriving slugs from *filenames* while every other consumer derived them
    // from frontmatter. A second source is how a post gets indexed at a URL the
    // router does not serve.
    const src = readFileSync(join(ROOT, file), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    expect({ file, readsDir: /readdirSync|readFileSync\s*\(/.test(src) }).toEqual({ file, readsDir: false })
  })

  it("the loader is the only module that reads content/blog", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${entry}`
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
        else if (/\.(ts|tsx)$/.test(entry)) {
          const src = readFileSync(join(ROOT, rel), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
          if (src.includes("content/blog")) offenders.push(rel)
        }
      }
    }
    walk("app")
    walk("components")
    walk("lib")
    expect(offenders).toEqual(["lib/blog.ts"])
  })
})

/* ── 2. Buckets reconcile, derived once ───────────────────────────────────── */

describe("the served set and the governed set are the same set", () => {
  it("serves exactly the controller five plus the additive four", () => {
    const live = liveSlugs()
    const governed = [...controllerBlogSlugs(), ...ADDITIVE_GOVERNED_SLUGS].sort()
    expect(live).toEqual(governed)
  })

  it("counts the buckets explicitly", () => {
    expect({
      live: liveSlugs().length,
      controller: controllerBlogSlugs().length,
      additive: ADDITIVE_GOVERNED_SLUGS.length,
      retired: RETIRED_SLUGS.length,
    }).toEqual({ live: 7, controller: 5, additive: 2, retired: 11 })
  })

  it("places every post in exactly one bucket", () => {
    const controller = new Set(controllerBlogSlugs())
    const additive = new Set(ADDITIVE_GOVERNED_SLUGS)
    const retired = new Set(RETIRED_SLUGS)

    for (const slug of liveSlugs()) {
      const buckets = [controller.has(slug), additive.has(slug), retired.has(slug)].filter(Boolean).length
      expect({ slug, buckets }).toEqual({ slug, buckets: 1 })
    }
    // And retirement is disjoint from everything public.
    expect(RETIRED_SLUGS.filter((s) => controller.has(s) || additive.has(s))).toEqual([])
  })

  it("has no duplicate slug", () => {
    const live = liveSlugs()
    expect(live).toEqual([...new Set(live)])
    const files = contentFileSlugs()
    expect(files).toEqual([...new Set(files)])
  })

  it("has no orphaned content file — every file is served", () => {
    // A file whose frontmatter slug differs from its filename is served at one
    // URL and stored under another. Both sets are derived, so they must agree.
    expect(contentFileSlugs()).toEqual(liveSlugs())
  })

  it("keeps every retired post out of the content directory and in evidence", () => {
    for (const slug of RETIRED_SLUGS) {
      expect({ slug, inContent: existsSync(join(CONTENT_DIR, `${slug}.md`)) }).toEqual({ slug, inContent: false })
      expect({ slug, inEvidence: existsSync(join(RETIRED_DIR, `${slug}.md`)) }).toEqual({ slug, inEvidence: true })
    }
    expect(existsSync(join(RETIRED_DIR, "README.md"))).toBe(true)
  })
})

/* ── 3. Route, sitemap, listing and feed all agree ────────────────────────── */

describe("nothing is served that is not indexed, and nothing indexed that is not served", () => {
  it("static generation emits exactly the live set", async () => {
    expect(await staticParamSlugs()).toEqual(liveSlugs())
  })

  it("the sitemap advertises exactly the live set", async () => {
    expect(await sitemapBlogSlugs()).toEqual(liveSlugs())
  })

  it("the RSS feed syndicates exactly the live set", async () => {
    expect(await rssBlogSlugs()).toEqual(liveSlugs())
  })

  it("the public listing links exactly the live set", async () => {
    expect(await listingSlugs()).toEqual(liveSlugs())
  })

  it("all four consumers agree with each other, not merely with the loader", async () => {
    const [params, sitemap, rss, listing] = await Promise.all([
      staticParamSlugs(),
      sitemapBlogSlugs(),
      rssBlogSlugs(),
      listingSlugs(),
    ])
    expect({ sitemap, rss, listing }).toEqual({ sitemap: params, rss: params, listing: params })
  })
})

/* ── 4. Retired posts are gone from every surface ─────────────────────────── */

describe("retired posts are unreachable", () => {
  it.each(RETIRED_SLUGS)("%s is not resolvable by the loader", async (slug) => {
    expect(await getPostBySlug(slug)).toBeNull()
  })

  it.each(RETIRED_SLUGS)("%s makes the real route call notFound()", async (slug) => {
    const mod = (await import("@/app/blog/[slug]/page")) as {
      default: (props: { params: Promise<{ slug: string }> }) => Promise<unknown>
    }
    await expect(mod.default({ params: Promise.resolve({ slug }) })).rejects.toThrow(notFoundError)
  })

  it.each(RETIRED_SLUGS)("%s is absent from static params, sitemap, RSS and the listing", async (slug) => {
    const [params, sitemap, rss, listing] = await Promise.all([
      staticParamSlugs(),
      sitemapBlogSlugs(),
      rssBlogSlugs(),
      listingSlugs(),
    ])
    expect({ slug, params: params.includes(slug) }).toEqual({ slug, params: false })
    expect({ slug, sitemap: sitemap.includes(slug) }).toEqual({ slug, sitemap: false })
    expect({ slug, rss: rss.includes(slug) }).toEqual({ slug, rss: false })
    expect({ slug, listing: listing.includes(slug) }).toEqual({ slug, listing: false })
  })

  it("is linked from no served surface, and has no served duplicate", () => {
    const served: string[] = []
    const walk = (dir: string) => {
      if (!existsSync(join(ROOT, dir))) return
      for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${entry}`
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
        else served.push(rel)
      }
    }
    walk("app")
    walk("components")
    walk("lib")
    walk("content")
    walk("public")

    for (const slug of RETIRED_SLUGS) {
      // Matched with a boundary, because one retired slug is a strict prefix of
      // a live one: `cook-county-property-tax-appeal-deadline-2026` sits inside
      // `cook-county-property-tax-appeal-deadline-2026-by-township`. A bare
      // substring search reports the live post as linking the retired one.
      const reference = new RegExp(`${slug}(?![a-z0-9-])`)
      const linking = served.filter(
        (rel) => /\.(ts|tsx|md|json|html|txt)$/.test(rel) && reference.test(readFileSync(join(ROOT, rel), "utf8")),
      )
      expect({ slug, linking }).toEqual({ slug, linking: [] })
      expect(served.filter((rel) => rel.endsWith(`${slug}.md`))).toEqual([])
    }
  })
})

/* ── 5. The live corpus is clean — no ledger, no exemption ────────────────── */

describe("every live post is clean under every required sweep", () => {
  const live = liveSlugs()

  it.each(live)("%s parses and renders", async (slug) => {
    const post = await getPostBySlug(slug)
    expect(post).not.toBeNull()
    expect(post!.contentHtml!.length).toBeGreaterThan(0)
    expect(post!.title.length).toBeGreaterThan(0)
  })

  it.each(live)("%s trips no corpus rule in source", (slug) => {
    const raw = readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8")
    expect({ slug, violations: publicBlogViolations(raw) }).toEqual({ slug, violations: [] })
  })

  it.each(live)("%s trips no corpus rule in its rendered HTML", async (slug) => {
    // Source and render can differ: markdown link syntax becomes an href, and a
    // reference-style link resolves only at render time.
    const post = await getPostBySlug(slug)
    expect({ slug, violations: publicBlogViolations(post!.contentHtml!) }).toEqual({ slug, violations: [] })
  })

  it("uses no exemption, ignore list or accepted-failure count", () => {
    // Stated as an assertion so it cannot quietly become untrue: the live corpus
    // is required to be clean, and there is no per-slug allowance anywhere here.
    //
    // Detected as a *declaration*, not a substring, so this test does not match
    // the names it is looking for in its own source.
    const self = readFileSync(join(ROOT, "__tests__/blog/served-blog-governance.test.ts"), "utf8")
    const declarations = [...self.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*[:=]/g)].map((m) => m[1])
    const ledgerLike = declarations.filter((name) =>
      /ALLOW|EXEMPT|IGNORE|ACCEPTED|KNOWN_VIOLATION|BASELINE|WAIVER|SKIP/.test(name),
    )
    expect({ declarations: declarations.sort(), ledgerLike }).toMatchObject({ ledgerLike: [] })

    for (const slug of live) {
      expect(publicBlogViolations(readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8"))).toEqual([])
    }
  })
})

/* ── 6. Retired evidence still reproduces the defect ──────────────────────── */

describe("retired evidence still trips the lexicon retroactively", () => {
  it.each(RETIRED_SLUGS)("%s still carries what it was withdrawn for", (slug) => {
    const raw = readFileSync(join(RETIRED_DIR, `${slug}.md`), "utf8")
    const violations = publicBlogViolations(raw)
    expect({ slug, reproduces: violations.length > 0 }).toEqual({ slug, reproduces: true })
  })

  it("still carries the two phrases that forced the lexicon widening", () => {
    const bloom = readFileSync(join(RETIRED_DIR, "bloom-township-property-tax-appeal-2026.md"), "utf8")
    const bremen = readFileSync(join(RETIRED_DIR, "bremen-township-property-tax-appeal-2026.md"), "utf8")
    expect(bloom).toContain("saved an average of")
    expect(bremen).toContain("nothing to lose")
  })

  it("does not treat evidence as public content", () => {
    // `docs/` is not served by Next.js, and the loader is pointed at
    // `content/blog` alone.
    expect(readFileSync(join(ROOT, "lib/blog.ts"), "utf8")).toContain("content/blog")
    expect(readFileSync(join(ROOT, "lib/blog.ts"), "utf8")).not.toContain("retired-resources")
    expect(liveSlugs().filter((s) => RETIRED_SLUGS.includes(s))).toEqual([])
  })
})
