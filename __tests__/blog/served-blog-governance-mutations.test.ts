/** @jest-environment node */

/**
 * Adversarial proofs for the served-blog governance architecture.
 *
 * Every case here mutates something real — a file in `content/blog`, or the
 * source of `lib/blog` or `app/sitemap.ts` — and then asks the actual loader,
 * router, sitemap, feed and listing what they now do. None of it is a regex over
 * a hand-written list, because a hand-written list is the defect this whole
 * suite exists to remove.
 *
 * Every mutation is applied and reverted in `finally`, and the last test asserts
 * the tree is byte-identical to where it started, so a failed case cannot leave
 * a post behind.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { publicBlogViolations } from "./blog-corpus-rules.test"

const ROOT = resolve(__dirname, "../..")
const CONTENT_DIR = join(ROOT, "content/blog")
const RETIRED_DIR = join(ROOT, "docs/retired-resources/blog-claims")
const SITEMAP_SRC = join(ROOT, "app/sitemap.ts")
const LOADER_SRC = join(ROOT, "lib/blog.ts")

/** A fingerprint of the served corpus: filename → bytes. */
function contentFingerprint(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of readdirSync(CONTENT_DIR).sort()) out[f] = readFileSync(join(CONTENT_DIR, f), "utf8")
  return out
}

const BASELINE = contentFingerprint()
const BASELINE_SITEMAP = readFileSync(SITEMAP_SRC, "utf8")
const BASELINE_LOADER = readFileSync(LOADER_SRC, "utf8")

/** Re-read the loader after a filesystem change. It reads on every call. */
async function loaderSlugs(): Promise<string[]> {
  const { getAllPosts } = (await import("@/lib/blog")) as typeof import("@/lib/blog")
  return getAllPosts()
    .map((p) => p.slug)
    .sort()
}

async function sitemapSlugs(): Promise<string[]> {
  const mod = (await import("@/app/sitemap")) as { default: () => Array<{ url: string }> }
  return mod
    .default()
    .map((e) => e.url)
    .filter((u) => u.includes("/blog/"))
    .map((u) => u.split("/blog/")[1])
    .sort()
}

async function rssSlugs(): Promise<string[]> {
  const mod = (await import("@/app/rss.xml/route")) as { GET: () => Response }
  const body = await mod.GET().text()
  return [...body.matchAll(/<link>[^<]*\/blog\/([^<]+)<\/link>/g)].map((m) => m[1]).sort()
}

async function staticParams(): Promise<string[]> {
  const mod = (await import("@/app/blog/[slug]/page")) as {
    generateStaticParams: () => Promise<Array<{ slug: string }>>
  }
  return (await mod.generateStaticParams()).map((p) => p.slug).sort()
}

/** The governed set, exactly as the governance suite derives it. */
const CONTROLLER_FIVE = [
  "cook-county-property-tax-appeal-deadline-2026-by-township",
  "oak-lawn-property-tax-appeal-2026",
  "rich-township-property-tax-appeal-2026",
  "thornton-township-property-tax-appeal-2026",
  "worth-township-property-tax-appeal-2026",
]
const ADDITIVE_TWO = ["how-to-appeal-property-tax-illinois", "rule-15-appeal-cook-county-guide"]
const GOVERNED = [...CONTROLLER_FIVE, ...ADDITIVE_TWO].sort()

const FRONTMATTER = (slug: string, extra = "") =>
  `---\ntitle: Mutant\ndescription: Mutant post\ndate: "2026-01-01"\nslug: ${slug}\n---\n\n# Mutant\n\nOrdinary text.${extra}\n`

function withFile(name: string, contents: string, run: () => Promise<void> | void) {
  const path = join(CONTENT_DIR, name)
  return (async () => {
    writeFileSync(path, contents, "utf8")
    try {
      await run()
    } finally {
      if (existsSync(path)) unlinkSync(path)
    }
  })()
}

function withSource(path: string, mutate: (src: string) => string, run: () => Promise<void> | void) {
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

beforeEach(() => {
  jest.resetModules()
})

describe("the governance architecture fails when it should", () => {
  it("M1 — an unsafe retired post moved back into content/blog", async () => {
    const slug = "bremen-township-property-tax-appeal-2026"
    const target = join(CONTENT_DIR, `${slug}.md`)
    copyFileSync(join(RETIRED_DIR, `${slug}.md`), target)
    try {
      // The loader serves it again — governance is not advisory, the post is live.
      expect(await loaderSlugs()).toContain(slug)
      // And the governed set no longer equals the served set.
      expect(await loaderSlugs()).not.toEqual(GOVERNED)
      // And it is indexed again, by every consumer.
      expect(await sitemapSlugs()).toContain(slug)
      expect(await rssSlugs()).toContain(slug)
      expect(await staticParams()).toContain(slug)
      // And it still carries the claim it was withdrawn for.
      expect(publicBlogViolations(readFileSync(target, "utf8"))).toContain(
        "PB-7 states savings, overpayment or a guarantee",
      )
    } finally {
      unlinkSync(target)
    }
    expect(await loaderSlugs()).toEqual(GOVERNED)
  })

  it("M2 — a new content file appears without governance", async () => {
    await withFile("zz-brand-new-post.md", FRONTMATTER("zz-brand-new-post"), async () => {
      const live = await loaderSlugs()
      expect(live).toContain("zz-brand-new-post")
      // Served, indexed, and in no governed bucket.
      expect(live).not.toEqual(GOVERNED)
      expect(live.filter((s) => !GOVERNED.includes(s))).toEqual(["zz-brand-new-post"])
      expect(await sitemapSlugs()).toContain("zz-brand-new-post")
    })
    expect(await loaderSlugs()).toEqual(GOVERNED)
  })

  it("M3 — a file is served under a slug its filename does not match", async () => {
    // The historical bug, reproduced: the sitemap used to derive slugs from
    // filenames while the router derived them from frontmatter. Both sets are
    // now the loader's, so they agree — and the orphan check is what notices
    // that the file and the slug have diverged.
    await withFile("zz-filename.md", FRONTMATTER("zz-served-under-this"), async () => {
      const live = await loaderSlugs()
      const files = readdirSync(CONTENT_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
        .sort()

      expect(live).toContain("zz-served-under-this")
      expect(files).toContain("zz-filename")
      // Orphan: a file that is not served under its own name.
      expect(live).not.toEqual(files)
      // The single source keeps every consumer on the served slug, so nothing is
      // advertised at a URL the router will not answer.
      expect(await sitemapSlugs()).toContain("zz-served-under-this")
      expect(await sitemapSlugs()).not.toContain("zz-filename")
      expect(await staticParams()).toContain("zz-served-under-this")
    })
  })

  it("M4 — removing a post removes it from every consumer at once", async () => {
    // The other half of M3: no slug can be indexed without a route behind it.
    const slug = "rule-15-appeal-cook-county-guide"
    const path = join(CONTENT_DIR, `${slug}.md`)
    const original = readFileSync(path, "utf8")
    unlinkSync(path)
    try {
      const [live, sitemap, rss, params] = [
        await loaderSlugs(),
        await sitemapSlugs(),
        await rssSlugs(),
        await staticParams(),
      ]
      for (const set of [live, sitemap, rss, params]) expect(set).not.toContain(slug)
      expect({ sitemap, rss, params }).toEqual({ sitemap: live, rss: live, params: live })
      expect(live).not.toEqual(GOVERNED)
    } finally {
      writeFileSync(path, original, "utf8")
    }
    expect(await loaderSlugs()).toEqual(GOVERNED)
  })

  it("M5 — a clean public post gains a prohibited phrase", async () => {
    const slug = "how-to-appeal-property-tax-illinois"
    const path = join(CONTENT_DIR, `${slug}.md`)
    const original = readFileSync(path, "utf8")

    const CASES: Array<[string, string]> = [
      ["newly added — nothing to lose", "\n\nThe process is free to file — you have nothing to lose.\n"],
      ["newly added — saved an average of", "\n\nHomeowners who appealed saved an average of $1,200+ per year.\n"],
      ["original lexicon — we file", "\n\nWe file your appeal for you.\n"],
      ["original lexicon — strong case", "\n\nYou have a strong case.\n"],
    ]

    try {
      expect(publicBlogViolations(original)).toEqual([])
      for (const [label, injected] of CASES) {
        writeFileSync(path, original + injected, "utf8")
        const violations = publicBlogViolations(readFileSync(path, "utf8"))
        expect({ label, clean: violations.length === 0 }).toEqual({ label, clean: false })
      }
    } finally {
      writeFileSync(path, original, "utf8")
    }
    expect(publicBlogViolations(readFileSync(path, "utf8"))).toEqual([])
  })

  it("M6 — a retired slug is linked from a public surface", async () => {
    const retired = "free-property-tax-check-cook-county"
    const slug = "rule-15-appeal-cook-county-guide"
    const path = join(CONTENT_DIR, `${slug}.md`)
    const original = readFileSync(path, "utf8")
    try {
      writeFileSync(path, `${original}\n\nSee [our guide](/blog/${retired}).\n`, "utf8")
      const reference = new RegExp(`${retired}(?![a-z0-9-])`)
      const served = readdirSync(CONTENT_DIR)
        .filter((f) => f.endsWith(".md"))
        .filter((f) => reference.test(readFileSync(join(CONTENT_DIR, f), "utf8")))
      expect(served).toEqual([`${slug}.md`])
    } finally {
      writeFileSync(path, original, "utf8")
    }
  })

  it("M7 — the non-canonical Assessor host is introduced", async () => {
    const slug = "oak-lawn-property-tax-appeal-2026"
    const path = join(CONTENT_DIR, `${slug}.md`)
    const original = readFileSync(path, "utf8")
    try {
      writeFileSync(path, `${original}\n\nLook it up at cookcountyassessor.com/address-search.\n`, "utf8")
      expect(publicBlogViolations(readFileSync(path, "utf8"))).toContain("PB-2 non-canonical Assessor host")
    } finally {
      writeFileSync(path, original, "utf8")
    }
    expect(publicBlogViolations(readFileSync(path, "utf8"))).toEqual([])
  })

  it("M8 — the sitemap goes back to a second, independent source", async () => {
    await withSource(
      SITEMAP_SRC,
      (src) =>
        src.replace(
          "function getBlogSlugs(): string[] {\n  return getAllPosts().map((post) => post.slug)\n}",
          'function getBlogSlugs(): string[] {\n  const fs = require("fs")\n  const path = require("path")\n  return fs.readdirSync(path.join(process.cwd(), "content/blog")).filter((f: string) => f.endsWith(".md")).map((f: string) => f.replace(".md", ""))\n}',
        ),
      async () => {
        const src = readFileSync(SITEMAP_SRC, "utf8")
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
        // The single-source rule fails on the source itself...
        expect(/readdirSync/.test(src)).toBe(true)
        expect(src.includes("content/blog")).toBe(true)

        // ...and behaviourally: a frontmatter slug that differs from its
        // filename now produces a sitemap URL with no route behind it.
        await withFile("zz-filename.md", FRONTMATTER("zz-served-under-this"), async () => {
          const sitemap = await sitemapSlugs()
          const params = await staticParams()
          expect(sitemap).toContain("zz-filename")
          expect(params).toContain("zz-served-under-this")
          expect(sitemap).not.toEqual(params)
        })
      },
    )
    // Restored: one source again.
    expect(await sitemapSlugs()).toEqual(await staticParams())
  })

  it("M9 — the additive registry is narrowed while the app still serves the post", async () => {
    const narrowed = [...CONTROLLER_FIVE, "how-to-appeal-property-tax-illinois"].sort()
    const live = await loaderSlugs()
    // Dropping a governed slug from the registry does not stop the app serving
    // it; the reconciliation is what notices.
    expect(live).not.toEqual(narrowed)
    expect(live.filter((s) => !narrowed.includes(s))).toEqual(["rule-15-appeal-cook-county-guide"])
    expect(live).toEqual(GOVERNED)
  })

  it("M10 — the public loader is pointed at the retired evidence directory", async () => {
    await withSource(
      LOADER_SRC,
      (src) =>
        src.replace(
          "path.join(process.cwd(), 'content/blog')",
          "path.join(process.cwd(), 'docs/retired-resources/blog-claims')",
        ),
      async () => {
        const live = await loaderSlugs()
        // Every withdrawn post is suddenly public again.
        expect(live).toContain("bremen-township-property-tax-appeal-2026")
        expect(live).toContain("bloom-township-property-tax-appeal-2026")
        expect(live).not.toEqual(GOVERNED)
        // And they are indexed, because the consumers follow the loader.
        expect(await sitemapSlugs()).toContain("bremen-township-property-tax-appeal-2026")
      },
    )
    expect(await loaderSlugs()).toEqual(GOVERNED)
    expect(readFileSync(LOADER_SRC, "utf8")).toBe(BASELINE_LOADER)
  })
})

describe("no mutation left an artifact", () => {
  it("content/blog is byte-identical to where this suite started", () => {
    expect(contentFingerprint()).toEqual(BASELINE)
  })

  it("the mutated sources are byte-identical", () => {
    expect(readFileSync(SITEMAP_SRC, "utf8")).toBe(BASELINE_SITEMAP)
    expect(readFileSync(LOADER_SRC, "utf8")).toBe(BASELINE_LOADER)
  })

  it("no probe file remains", () => {
    const strays = readdirSync(CONTENT_DIR).filter((f) => f.startsWith("zz-"))
    expect(strays).toEqual([])
  })
})
