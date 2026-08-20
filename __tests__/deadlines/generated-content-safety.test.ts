/** @jest-environment node */

/**
 * Generated content safety — freshness test-map row 14.
 *
 * "HOA HTML/PDF and five blogs contain no active/current/generated deadline
 * claims without valid provenance/expiry." Specified in the frozen map, never
 * written, and the gap it was specified to cover was real: accepted rows 46 and
 * 47 were reported as satisfied by a single assertion that three pages did not
 * link them. They were still served, byte-identical to the version that
 * predates every freshness correction in this work, at
 * `/resources/overtaxed-hoa-resident-resource.html` and `.pdf`, crawlable, on a
 * document whose own copy tells the reader to forward and post it.
 *
 * What that document asserts: a standing "Current appeal windows" badge,
 * "Refreshed monthly", "Rev. May 2026", "Cook County property tax appeals —
 * 2026 window", and a description of `/deadlines` as a "Lookup table of all 38
 * Cook County townships, with open and close dates for the 2026 cycle" — of a
 * page that now publishes no dates at all.
 *
 * Availability is proven structurally rather than over HTTP. Next.js serves
 * exactly one directory at the site root, so a file's absence from `public/`,
 * together with the absence of any rewrite or route that could reconstruct the
 * path, is the whole proof. No network call is made or needed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(__dirname, "../..")
const PUBLIC_DIR = join(ROOT, "public")
const RETIRED_DIR = join(ROOT, "docs/retired-resources")

const RETIRED_BASENAMES = [
  "overtaxed-hoa-resident-resource.html",
  "overtaxed-hoa-resident-resource.pdf",
]

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

describe("the HOA resident artifacts are no longer public", () => {
  const served = walk(PUBLIC_DIR).map((f) => f.slice(PUBLIC_DIR.length).replace(/\\/g, "/"))

  it.each(RETIRED_BASENAMES)("/resources/%s is not in the served tree", (basename) => {
    expect(existsSync(join(PUBLIC_DIR, "resources", basename))).toBe(false)
    expect(served).not.toContain(`/resources/${basename}`)
  })

  it("serves nothing at all under /resources", () => {
    // Not just those two names — the whole prefix is gone, so a sibling copy
    // cannot be dropped in beside them.
    expect(served.filter((p) => p.startsWith("/resources/"))).toEqual([])
  })

  it("no rewrite, redirect, or route can reconstruct the path", () => {
    for (const config of ["next.config.ts", "next.config.mjs"]) {
      const src = readFileSync(join(ROOT, config), "utf8")
      expect(src).not.toMatch(/rewrites|redirects/)
      expect(src).not.toContain("resources")
    }
    expect(existsSync(join(ROOT, "app/resources"))).toBe(false)
    expect(existsSync(join(ROOT, "app/[...slug]"))).toBe(false)
  })

  it("keeps the artifacts outside the served tree rather than deleting them", () => {
    // Regenerating the flyer needs a real verified snapshot first, and the JSX
    // it was rendered from survives only inside the bundle. Withdrawal is the
    // disposition; destruction is not.
    for (const basename of RETIRED_BASENAMES) {
      expect(existsSync(join(RETIRED_DIR, basename))).toBe(true)
    }
    expect(existsSync(join(RETIRED_DIR, "README.md"))).toBe(true)
  })

  it("is referenced by no rendered surface", () => {
    const sources = [
      ...walk(join(ROOT, "app")),
      ...walk(join(ROOT, "components")),
      ...walk(join(ROOT, "lib")),
      ...walk(join(ROOT, "content")),
    ].filter((f) => /\.(ts|tsx|md|json)$/.test(f))

    const offenders = sources.filter((f) =>
      readFileSync(f, "utf8").includes("overtaxed-hoa-resident-resource"),
    )
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([])
  })

  it("still carries the claims that made it unservable, so it cannot be restored casually", () => {
    // Asserted on the retired copy, not the served tree. If someone regenerates
    // the flyer and moves it back, this test tells them what has to be gone.
    const html = readFileSync(join(RETIRED_DIR, "overtaxed-hoa-resident-resource.html"), "utf8")
    expect(html).toContain("__bundler")
    const readme = readFileSync(join(RETIRED_DIR, "README.md"), "utf8")
    expect(readme).toContain("Current appeal windows")
    expect(readme).toMatch(/must not remain public/i)
  })
})

describe("the five accepted blog artifacts publish no deadline of their own", () => {
  const SLUGS = [
    "cook-county-property-tax-appeal-deadline-2026-by-township",
    "oak-lawn-property-tax-appeal-2026",
    "rich-township-property-tax-appeal-2026",
    "thornton-township-property-tax-appeal-2026",
    "worth-township-property-tax-appeal-2026",
  ]

  const DATE_CLAIM =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}\b/
  const ISO_DATE = /\b(19|20)\d{2}-\d{2}-\d{2}\b/
  const NUMERIC_DATE = /\b\d{1,2}\/\d{1,2}\/(19|20)\d{2}\b/
  const COUNTDOWN = /\b\d+\s*(days?|business days?)\s*(left|remaining|until|to file)/i

  /** BL-B1/B2/B3, BL-C1/C2/C3, BL-D2. */
  const BANNED = [
    /average savings/i,
    /save an average/i,
    /you could save/i,
    /estimated savings/i,
    /potential savings/i,
    /success rate/i,
    /win rate/i,
    /most homeowners/i,
    /you're overpaying/i,
    /you are overpaying/i,
    /strong case/i,
    /worth appealing/i,
    /you should appeal/i,
    /always current/i,
    /up to date/i,
    /checked regularly/i,
    /currently open/i,
    /\bopen now\b/i,
  ]

  /**
   * The article body, with YAML frontmatter removed.
   *
   * The frontmatter `date:` is the post's publication date. It is not a filing
   * deadline and never renders as one, so sweeping it for date claims would
   * fail every post for saying when it was written.
   */
  function body(slug: string): string {
    const file = join(ROOT, "content/blog", `${slug}.md`)
    expect(existsSync(file)).toBe(true)
    const raw = readFileSync(file, "utf8")
    return raw.startsWith("---") ? raw.slice(raw.indexOf("\n---", 3) + 4) : raw
  }

  it.each(SLUGS)("%s states no date and runs no countdown", (slug) => {
    // An article is a fixed document that outlives the window it describes. It
    // may point at the county's calendar; it may not carry the calendar.
    const text = body(slug)
    expect({ slug, matched: DATE_CLAIM.test(text) }).toEqual({ slug, matched: false })
    expect({ slug, matched: ISO_DATE.test(text) }).toEqual({ slug, matched: false })
    expect({ slug, matched: NUMERIC_DATE.test(text) }).toEqual({ slug, matched: false })
    expect({ slug, matched: COUNTDOWN.test(text) }).toEqual({ slug, matched: false })
  })

  it.each(SLUGS)("%s makes no banned claim and cites only the canonical host", (slug) => {
    const text = body(slug)
    for (const pattern of BANNED) {
      expect({ slug, pattern: String(pattern), matched: pattern.test(text) }).toEqual({
        slug,
        pattern: String(pattern),
        matched: false,
      })
    }
    expect(text).toContain("cookcountyassessoril.gov")
    expect(text).not.toContain("cookcountyassessor.com")
  })

  it.each(SLUGS)("%s attaches no finality warning to a date of its own (BL-D3)", (slug) => {
    // BL-D3 bans "no grace period" and "late filings are not accepted" attached
    // to *a non-official-feed date*. Four of these five carry the warning, and
    // that is allowed precisely because they state no date: each one sends the
    // reader to the Assessor's calendar for the date the warning applies to.
    // The rule is therefore a conditional, and it is the pairing that breaks —
    // so if a date is ever restored to one of these posts while the warning
    // stands, this fails.
    const text = body(slug)
    const warns = /no grace period|late filings are not accepted/i.test(text)
    if (!warns) return

    expect({ slug, statesADate: DATE_CLAIM.test(text) || ISO_DATE.test(text) || NUMERIC_DATE.test(text) }).toEqual({
      slug,
      statesADate: false,
    })
    // And the warning must sit with a pointer to the authority that owns it.
    expect(text).toContain("cookcountyassessoril.gov")
  })
})
