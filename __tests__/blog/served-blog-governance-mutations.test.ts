/** @jest-environment node */

/**
 * Adversarial proofs for the served-blog governance architecture.
 *
 * **Every mutation happens in a disposable fixture corpus.** The earlier version
 * wrote probe posts into the real `content/blog`, deleted real posts, and
 * rewrote `lib/blog.ts` and `app/sitemap.ts` in place, reverting each in
 * `finally`. Reversion was byte-exact, but Jest's default workers meant the
 * governance suite was reading that directory at the same time — the `ENOENT`
 * on a transient `zz-filename.md`, and the reason `npx jest` only passed under
 * `--runInBand`.
 *
 * What makes the fixtures faithful rather than a re-implementation: `lib/blog`
 * resolves its corpus as `path.join(process.cwd(), 'content/blog')` at module
 * load, so pointing `process.cwd()` at a fixture root and re-importing gives the
 * *real* loader, the *real* sitemap, the *real* feed and the *real* route
 * reading a corpus this test owns. None of it is a regex over a hand-written
 * list, because a hand-written list is the defect this suite exists to remove.
 *
 * `guardRepoWrites()` makes the boundary enforced: any write beneath the
 * repository fails the test at its call site.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { guardRepoWrites, withFixtureRoot } from "../helpers/governance-fixtures.test"
import { publicBlogViolations } from "./blog-corpus-rules.test"

const ROOT = resolve(__dirname, "../..")
const CONTENT_DIR = join(ROOT, "content/blog")
const RETIRED_DIR = join(ROOT, "docs/retired-resources/blog-claims")
const SITEMAP_SRC = join(ROOT, "app/sitemap.ts")
const LOADER_SRC = join(ROOT, "lib/blog.ts")

guardRepoWrites()

/* ── Fixture corpora ──────────────────────────────────────────────────────── */

/** Copy the served corpus into a fixture, byte for byte. */
function seedLiveCorpus(root: string): void {
  mkdirSync(join(root, "content/blog"), { recursive: true })
  for (const f of readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"))) {
    copyFileSync(join(CONTENT_DIR, f), join(root, "content/blog", f))
  }
}

/** Copy the withdrawn corpus into a fixture's served directory. */
function seedRetiredCorpusAsServed(root: string): void {
  mkdirSync(join(root, "content/blog"), { recursive: true })
  for (const f of readdirSync(RETIRED_DIR).filter((f) => f.endsWith(".md") && f !== "README.md")) {
    copyFileSync(join(RETIRED_DIR, f), join(root, "content/blog", f))
  }
}

/**
 * Run `body` with the real blog stack bound to a fixture corpus.
 *
 * `process.cwd()` is stubbed before `jest.resetModules()` so that `lib/blog`'s
 * module-level `postsDirectory` resolves into the fixture on re-import. The stub
 * is restored in `finally`, and the module registry reset again, so nothing
 * leaks into the next test.
 */
async function withBlogFixture(
  name: string,
  seed: (root: string) => void,
  body: (root: string) => void | Promise<void>,
): Promise<void> {
  await withFixtureRoot(`blog-${name}`, async (root) => {
    seed(root)
    const cwd = jest.spyOn(process, "cwd").mockReturnValue(root)
    jest.resetModules()
    try {
      await body(root)
    } finally {
      cwd.mockRestore()
      jest.resetModules()
    }
  })
}

/* ── The real consumers, re-imported against the current corpus ──────────── */

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

const BASELINE_SITEMAP = readFileSync(SITEMAP_SRC, "utf8")
const BASELINE_LOADER = readFileSync(LOADER_SRC, "utf8")
const BASELINE_CONTENT: Record<string, string> = Object.fromEntries(
  readdirSync(CONTENT_DIR)
    .sort()
    .map((f) => [f, readFileSync(join(CONTENT_DIR, f), "utf8")]),
)

beforeEach(() => {
  jest.resetModules()
})

/* ── Fixture fidelity ─────────────────────────────────────────────────────── */

describe("the fixture corpus is a faithful stand-in for the served one", () => {
  it("serves exactly the governed set, through the real loader and every consumer", async () => {
    await withBlogFixture("fidelity", seedLiveCorpus, async () => {
      const live = await loaderSlugs()
      expect(live).toEqual(GOVERNED)
      expect(await sitemapSlugs()).toEqual(live)
      expect(await rssSlugs()).toEqual(live)
      expect(await staticParams()).toEqual(live)
    })
  })
})

/* ── Mutations ────────────────────────────────────────────────────────────── */

describe("the governance architecture fails when it should", () => {
  it("M1 — an unsafe retired post moved back into content/blog", async () => {
    const slug = "bremen-township-property-tax-appeal-2026"
    await withBlogFixture(
      "m1",
      (root) => {
        seedLiveCorpus(root)
        copyFileSync(join(RETIRED_DIR, `${slug}.md`), join(root, "content/blog", `${slug}.md`))
      },
      async (root) => {
        // The loader serves it again — governance is not advisory, the post is live.
        expect(await loaderSlugs()).toContain(slug)
        // And the governed set no longer equals the served set.
        expect(await loaderSlugs()).not.toEqual(GOVERNED)
        // And it is indexed again, by every consumer.
        expect(await sitemapSlugs()).toContain(slug)
        expect(await rssSlugs()).toContain(slug)
        expect(await staticParams()).toContain(slug)
        // And it still carries the claim it was withdrawn for.
        expect(publicBlogViolations(readFileSync(join(root, "content/blog", `${slug}.md`), "utf8"))).toContain(
          "PB-7 states savings, overpayment or a guarantee",
        )
      },
    )
  })

  it("M2 — a new content file appears without governance", async () => {
    await withBlogFixture(
      "m2",
      (root) => {
        seedLiveCorpus(root)
        writeFileSync(join(root, "content/blog/zz-brand-new-post.md"), FRONTMATTER("zz-brand-new-post"), "utf8")
      },
      async () => {
        const live = await loaderSlugs()
        expect(live).toContain("zz-brand-new-post")
        // Served, indexed, and in no governed bucket.
        expect(live).not.toEqual(GOVERNED)
        expect(live.filter((s) => !GOVERNED.includes(s))).toEqual(["zz-brand-new-post"])
        expect(await sitemapSlugs()).toContain("zz-brand-new-post")
      },
    )
  })

  it("M3 — a file is served under a slug its filename does not match", async () => {
    // The historical bug, reproduced: the sitemap used to derive slugs from
    // filenames while the router derived them from frontmatter. Both sets are
    // now the loader's, so they agree — and the orphan check is what notices
    // that the file and the slug have diverged.
    await withBlogFixture(
      "m3",
      (root) => {
        seedLiveCorpus(root)
        writeFileSync(join(root, "content/blog/zz-filename.md"), FRONTMATTER("zz-served-under-this"), "utf8")
      },
      async (root) => {
        const live = await loaderSlugs()
        const files = readdirSync(join(root, "content/blog"))
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
      },
    )
  })

  it("M4 — removing a post removes it from every consumer at once", async () => {
    // The other half of M3: no slug can be indexed without a route behind it.
    const slug = "rule-15-appeal-cook-county-guide"
    await withBlogFixture(
      "m4",
      (root) => {
        seedLiveCorpus(root)
        unlinkSync(join(root, "content/blog", `${slug}.md`))
      },
      async () => {
        const [live, sitemap, rss, params] = [
          await loaderSlugs(),
          await sitemapSlugs(),
          await rssSlugs(),
          await staticParams(),
        ]
        for (const set of [live, sitemap, rss, params]) expect(set).not.toContain(slug)
        expect({ sitemap, rss, params }).toEqual({ sitemap: live, rss: live, params: live })
        expect(live).not.toEqual(GOVERNED)
      },
    )
  })

  it("M5 — a clean public post gains a prohibited phrase", async () => {
    const slug = "how-to-appeal-property-tax-illinois"
    const original = readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8")

    const CASES: Array<[string, string]> = [
      ["newly added — nothing to lose", "\n\nThe process is free to file — you have nothing to lose.\n"],
      ["newly added — saved an average of", "\n\nHomeowners who appealed saved an average of $1,200+ per year.\n"],
      ["original lexicon — we file", "\n\nWe file your appeal for you.\n"],
      ["original lexicon — strong case", "\n\nYou have a strong case.\n"],
    ]

    await withBlogFixture(
      "m5",
      seedLiveCorpus,
      async (root) => {
        const path = join(root, "content/blog", `${slug}.md`)
        expect(publicBlogViolations(readFileSync(path, "utf8"))).toEqual([])
        for (const [label, injected] of CASES) {
          writeFileSync(path, original + injected, "utf8")
          const violations = publicBlogViolations(readFileSync(path, "utf8"))
          expect({ label, clean: violations.length === 0 }).toEqual({ label, clean: false })
        }
      },
    )
    // The shipped post is clean and was never the thing edited.
    expect(publicBlogViolations(readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8"))).toEqual([])
  })

  it("M6 — a retired slug is linked from a public surface", async () => {
    const retired = "free-property-tax-check-cook-county"
    const slug = "rule-15-appeal-cook-county-guide"
    await withBlogFixture(
      "m6",
      (root) => {
        seedLiveCorpus(root)
        const path = join(root, "content/blog", `${slug}.md`)
        writeFileSync(path, `${readFileSync(path, "utf8")}\n\nSee [our guide](/blog/${retired}).\n`, "utf8")
      },
      async (root) => {
        const dir = join(root, "content/blog")
        const reference = new RegExp(`${retired}(?![a-z0-9-])`)
        const served = readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .filter((f) => reference.test(readFileSync(join(dir, f), "utf8")))
        expect(served).toEqual([`${slug}.md`])
      },
    )
  })

  it("M7 — the non-canonical Assessor host is introduced", async () => {
    const slug = "oak-lawn-property-tax-appeal-2026"
    await withBlogFixture(
      "m7",
      seedLiveCorpus,
      async (root) => {
        const path = join(root, "content/blog", `${slug}.md`)
        writeFileSync(path, `${readFileSync(path, "utf8")}\n\nLook it up at cookcountyassessor.com/address-search.\n`, "utf8")
        expect(publicBlogViolations(readFileSync(path, "utf8"))).toContain("PB-2 non-canonical Assessor host")
      },
    )
    expect(publicBlogViolations(readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8"))).toEqual([])
  })

  it("M8 — the sitemap must not go back to a second, independent source", async () => {
    // Two halves. The static half reads the shipped source and asserts it has no
    // second derivation — this is what a reintroduced `readdirSync` over
    // `content/blog` would trip, and it reads the real file rather than editing
    // it. The behavioural half proves *why* that matters, in a fixture where a
    // frontmatter slug differs from its filename: a filename-derived sitemap
    // would advertise `zz-filename`, which no route answers.
    const src = BASELINE_SITEMAP.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    expect(/readdirSync/.test(src)).toBe(false)
    expect(src.includes("content/blog")).toBe(false)
    expect(src).toMatch(/getAllPosts\(\)/)

    await withBlogFixture(
      "m8",
      (root) => {
        seedLiveCorpus(root)
        writeFileSync(join(root, "content/blog/zz-filename.md"), FRONTMATTER("zz-served-under-this"), "utf8")
      },
      async (root) => {
        const filenameDerived = readdirSync(join(root, "content/blog"))
          .filter((f) => f.endsWith(".md"))
          .map((f) => f.replace(/\.md$/, ""))
          .sort()
        const sitemap = await sitemapSlugs()
        const params = await staticParams()

        // A second, filename-derived source would diverge from the router...
        expect(filenameDerived).toContain("zz-filename")
        expect(params).not.toContain("zz-filename")
        expect(filenameDerived).not.toEqual(params)
        // ...and the shipped sitemap does not diverge, because it has one source.
        expect(sitemap).toEqual(params)
      },
    )
  })

  it("M9 — the additive registry is narrowed while the app still serves the post", async () => {
    const narrowed = [...CONTROLLER_FIVE, "how-to-appeal-property-tax-illinois"].sort()
    await withBlogFixture("m9", seedLiveCorpus, async () => {
      const live = await loaderSlugs()
      // Dropping a governed slug from the registry does not stop the app serving
      // it; the reconciliation is what notices.
      expect(live).not.toEqual(narrowed)
      expect(live.filter((s) => !narrowed.includes(s))).toEqual(["rule-15-appeal-cook-county-guide"])
      expect(live).toEqual(GOVERNED)
    })
  })

  it("M10 — a loader pointed at the retired evidence directory serves every withdrawn post", async () => {
    // `lib/blog` resolves its corpus from `process.cwd()`, so a fixture whose
    // `content/blog` holds the withdrawn posts is behaviourally identical to
    // repointing the loader at `docs/retired-resources/blog-claims` — without
    // editing the shipped loader. The static half asserts the shipped loader
    // still points where it should.
    expect(BASELINE_LOADER).toMatch(/path\.join\(process\.cwd\(\), 'content\/blog'\)/)
    expect(BASELINE_LOADER).not.toMatch(/retired-resources/)

    await withBlogFixture("m10", seedRetiredCorpusAsServed, async () => {
      const live = await loaderSlugs()
      // Every withdrawn post is suddenly public again.
      expect(live).toContain("bremen-township-property-tax-appeal-2026")
      expect(live).toContain("bloom-township-property-tax-appeal-2026")
      expect(live).not.toEqual(GOVERNED)
      // And they are indexed, because the consumers follow the loader.
      expect(await sitemapSlugs()).toContain("bremen-township-property-tax-appeal-2026")
    })
  })
})

/* ── The checkout was never touched ──────────────────────────────────────── */

describe("no mutation reached the repository", () => {
  it("content/blog is byte-identical to where this suite started", () => {
    const now = Object.fromEntries(
      readdirSync(CONTENT_DIR)
        .sort()
        .map((f) => [f, readFileSync(join(CONTENT_DIR, f), "utf8")]),
    )
    expect(now).toEqual(BASELINE_CONTENT)
  })

  it("the loader and sitemap sources are byte-identical", () => {
    expect(readFileSync(SITEMAP_SRC, "utf8")).toBe(BASELINE_SITEMAP)
    expect(readFileSync(LOADER_SRC, "utf8")).toBe(BASELINE_LOADER)
  })

  it("no probe file was ever created in the served corpus", () => {
    expect(readdirSync(CONTENT_DIR).filter((f) => f.startsWith("zz-"))).toEqual([])
  })

  it("the served corpus is still exactly the seven governed posts", () => {
    expect(
      readdirSync(CONTENT_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
        .sort(),
    ).toEqual(GOVERNED)
  })
})
