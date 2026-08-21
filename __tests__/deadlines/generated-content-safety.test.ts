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
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { CC_11 } from "@/lib/copy/canonical"
import { BANNED_LEXICON, readable } from "../lexicon/banned-claims.test"

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

/* ── The widened row-14 sweep ─────────────────────────────────────────────── */

/**
 * Why this section exists.
 *
 * The sweep above proved two named HOA artifacts were gone from `/resources/`.
 * That satisfied map row 14 *as written* — "HOA HTML/PDF and five blogs" — and
 * contract §E is broader than the row. While the row passed, five other
 * appeal-domain documents sat in `public/downloads/`, crawlable, carrying
 * unsourced filing windows for ten counties, a "no extensions" finality warning
 * attached to their own dates, a Board-of-Review filing recommendation with no
 * CC-11, "You have nothing to lose by filing", a per-county "Estimated Annual
 * Tax Savings" table, "saved an average of $1,200+ per year", and a live $37
 * Etsy offer.
 *
 * The lexicon did not catch any of them, and that is the second lesson. Every
 * one of those strings passes all 22 `BANNED_LEXICON` rows: BL-B1 matches
 * "save an average of" but the document said "sav**ed** an average of"; BL-B5
 * matches "risk-free" but the document said "nothing to lose"; BL-C2 matches
 * "worth appealing" but the document said "Worth it for". A guard built on the
 * lexicon alone would have passed this tree unchanged — which is the same
 * defect as a guard that counts filenames.
 *
 * So the rules below are written against what the withdrawn documents actually
 * said, the lexicon is applied *in addition*, and the sweep covers the whole
 * served tree rather than a named prefix. `servedAppealDomainViolations` is a
 * pure function so it can be aimed at synthetic content and proven to fail.
 */

/** LegalKits is a separate product line, excluded from this finding by the controlling review. */
const LEGALKITS_DIRS = [
  "divorce-prep",
  "expungement",
  "landlord-notices",
  "small-claims",
  "ticket-dispute",
] as const

/** Served files that carry no readable text. Pinned so a new binary cannot appear silently. */
const NON_TEXT_SERVED = [
  "/.gitkeep",
  "/apple-icon.png",
  "/forms/cook-county-auth-form.pdf",
  "/icon-dark-32x32.png",
  "/icon-light-32x32.png",
  "/icon.svg",
  "/logo.svg",
  "/placeholder-logo.png",
  "/placeholder-logo.svg",
  "/placeholder-user.jpg",
  "/placeholder.jpg",
  "/placeholder.svg",
]

const SCANNABLE = /\.(md|markdown|html?|txt|json|csv)$/i

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December"
const NON_COOK_COUNTIES =
  /\b(DuPage|Lake County|Will County|Kane|McHenry|Sangamon|Winnebago|Peoria|Madison County|St\.? Clair)\b/gi

type ServedRule = { id: string; why: string; hit: (text: string, raw: string) => boolean }

const SERVED_RULES: ServedRule[] = [
  {
    id: "SD-1 board-of-review without CC-11",
    why: "BL-F5. The Board is the one stage OverTaxed cannot serve; naming it obliges the disclosure.",
    hit: (text, raw) => /board of review/i.test(text) && !raw.includes(CC_11),
  },
  {
    id: "SD-2 dollar savings claim",
    why: "BL-B1/B3. A served document may not tell a reader what they will save.",
    hit: (text) =>
      /\$\s?\d[\d,]*(\s*[–—-]\s*\$?\s?\d[\d,]*)?\s*(\/|\bper\b)?\s*(year|yr|annually)/i.test(text) ||
      /\bsaved?\s+an\s+average\s+of\b/i.test(text) ||
      /\bestimated\s+annual\s+tax\s+savings\b/i.test(text) ||
      /\bhow\s+much\s+can\s+you\s+save\b/i.test(text) ||
      /\baverages?d?\b[^.]{0,24}\bsavings\b/i.test(text),
  },
  {
    id: "SD-3 states a filing date or window of its own",
    why: "OD-4. A fixed document outlives the window it names; dates come from the canonical snapshot.",
    hit: (text) =>
      new RegExp(`\\b(${MONTH})\\s+\\d{1,2},?\\s+(19|20)\\d{2}\\b`).test(text) ||
      new RegExp(`\\b(${MONTH})\\s*[–—-]\\s*(${MONTH})\\b`).test(text) ||
      /\b(19|20)\d{2}-\d{2}-\d{2}\b/.test(text) ||
      /\b\d{1,2}\/\d{1,2}\/(19|20)\d{2}\b/.test(text),
  },
  {
    id: "SD-4 finality warning",
    why: "BL-D3. Permitted only beside an official feed, never on a document's own date.",
    hit: (text) => /\bno extensions\b|\bhard deadline\b|\bno grace period\b|\blate filings are not accepted\b/i.test(text),
  },
  {
    id: "SD-5 non-canonical host",
    why: "Controller hostname ruling: cookcountyassessoril.gov is canonical.",
    hit: (text, raw) => /cookcountyassessor\.com/i.test(raw) || /cookcountyassessor\.com/i.test(text),
  },
  {
    id: "SD-6 external paid offer",
    why: "A served document may not carry a purchase funnel; pricing is an owner decision surface.",
    hit: (text, raw) =>
      /\betsy\.com\b|\bgumroad\.com\b/i.test(raw) ||
      /\[[^\]]*\$\s?\d[^\]]*\]\(https?:\/\//.test(raw) ||
      /\b(buy|purchase|order)\b[^.]{0,40}\$\s?\d/i.test(text),
  },
  {
    id: "SD-7 implies coverage outside Cook",
    why: "BL-E3. OverTaxed serves Cook County; a multi-county table claims otherwise.",
    hit: (text) =>
      /\ball illinois counties\b|\ball other il counties\b/i.test(text) ||
      (text.match(NON_COOK_COUNTIES) ?? []).length >= 2,
  },
  {
    id: "SD-8 nothing-to-lose guarantee",
    why: "BL-B5 in substance. The lexicon matches 'risk-free'; the live document said this instead.",
    hit: (text) => /\bnothing to lose\b|\bnothing to risk\b/i.test(text),
  },
  {
    id: "SD-9 overpayment or merits finding",
    why: "BL-C2/C3 in substance.",
    hit: (text) =>
      /\bstop overpaying\b|\byou'?re overpaying\b|\byou are overpaying\b|\blikely overpaying\b/i.test(text) ||
      /\bfree money\b/i.test(text) ||
      /\bworth it for\b/i.test(text),
  },
  {
    id: "SD-10 frozen banned-claims lexicon",
    why: "The frozen rows, applied in addition to the rules above.",
    hit: (text) => BANNED_LEXICON.some(([, pattern]) => pattern.test(text)),
  },
]

/** Every rule a served document trips. Pure, so it can be aimed at a fixture. */
export function servedAppealDomainViolations(raw: string): string[] {
  const text = readable(raw)
  return SERVED_RULES.filter((rule) => rule.hit(text, raw)).map((rule) => rule.id)
}

/** Served paths, site-root relative, excluding the LegalKits product line. */
function servedAppealDomainPaths(): string[] {
  return walk(PUBLIC_DIR)
    .map((f) => f.slice(PUBLIC_DIR.length).replace(/\\/g, "/"))
    .filter((p) => !LEGALKITS_DIRS.some((dir) => p.startsWith(`/downloads/${dir}/`)))
}

const RETIRED_APPEAL_DOWNLOADS = [
  "/downloads/county-deadline-calendar.md",
  "/downloads/filing-instructions.md",
  "/downloads/faq.md",
  "/downloads/cover-letter-template.md",
  "/downloads/homestead-exemption/homestead-exemption-guide.md",
]

describe("the appeal-domain downloads are no longer public", () => {
  const served = walk(PUBLIC_DIR).map((f) => f.slice(PUBLIC_DIR.length).replace(/\\/g, "/"))

  it.each(RETIRED_APPEAL_DOWNLOADS)("%s is not in the served tree", (path) => {
    expect(existsSync(join(PUBLIC_DIR, path))).toBe(false)
    expect(served).not.toContain(path)
  })

  it("serves nothing at all under /downloads/homestead-exemption", () => {
    expect(served.filter((p) => p.startsWith("/downloads/homestead-exemption"))).toEqual([])
  })

  it("keeps every withdrawn document, rather than deleting it", () => {
    const dir = join(RETIRED_DIR, "appeal-downloads")
    for (const path of RETIRED_APPEAL_DOWNLOADS) {
      expect(existsSync(join(dir, path.split("/").pop() as string))).toBe(true)
    }
    expect(existsSync(join(dir, "README.md"))).toBe(true)
  })

  it("is referenced by no rendered surface", () => {
    const sources = [
      ...walk(join(ROOT, "app")),
      ...walk(join(ROOT, "components")),
      ...walk(join(ROOT, "lib")),
      ...walk(join(ROOT, "content")),
    ].filter((f) => /\.(ts|tsx|md|json)$/.test(f))

    const names = RETIRED_APPEAL_DOWNLOADS.map((p) => p.split("/").pop() as string)
    const offenders = sources.filter((f) => {
      const src = readFileSync(f, "utf8")
      return names.some((n) => src.includes(`/downloads/${n}`) || src.includes(`homestead-exemption/${n}`))
    })
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([])
  })

  it("still carries the claims that made them unservable", () => {
    // Asserted on the retired copies. If one is moved back, this names what has
    // to be gone first.
    const dir = join(RETIRED_DIR, "appeal-downloads")
    expect(readFileSync(join(dir, "county-deadline-calendar.md"), "utf8")).toContain("no extensions")
    expect(readFileSync(join(dir, "faq.md"), "utf8")).toContain("nothing to lose")
    expect(readFileSync(join(dir, "homestead-exemption-guide.md"), "utf8")).toContain("etsy.com")
    expect(readFileSync(join(dir, "README.md"), "utf8")).toMatch(/withdrawal/i)
  })
})

describe("the served appeal-domain tree carries no unsafe claim", () => {
  it.each(servedAppealDomainPaths().filter((p) => SCANNABLE.test(p)))(
    "%s trips no served-tree rule",
    (path) => {
      const raw = readFileSync(join(PUBLIC_DIR, path), "utf8")
      expect({ path, violations: servedAppealDomainViolations(raw) }).toEqual({ path, violations: [] })
    },
  )

  it("scans every served text file outside the LegalKits product line", () => {
    // The sweep is only as good as its reach. If a new served text file appears
    // and the walker does not see it, this is the test that notices.
    const scanned = servedAppealDomainPaths().filter((p) => SCANNABLE.test(p))
    expect(scanned).toContain("/downloads/evidence-checklist.md")
    expect(scanned.length).toBeGreaterThan(0)
  })

  it("pins the LegalKits exclusion, so it cannot grow to cover a violation", () => {
    expect([...LEGALKITS_DIRS].sort()).toEqual([
      "divorce-prep",
      "expungement",
      "landlord-notices",
      "small-claims",
      "ticket-dispute",
    ])
  })

  it("pins the non-text served files, so a new binary cannot arrive unread", () => {
    const nonText = servedAppealDomainPaths().filter((p) => !SCANNABLE.test(p))
    expect(nonText.sort()).toEqual([...NON_TEXT_SERVED].sort())
  })
})

describe("the served-tree guard can actually fail", () => {
  /** Every rule, fired by the exact string the withdrawn documents used. */
  const FIXTURES: Array<[string, string]> = [
    ["SD-1 board-of-review without CC-11", "File your appeal at the Cook County Board of Review."],
    ["SD-2 dollar savings claim", "Estimated Annual Tax Savings of $600–$1,500/year."],
    ["SD-3 states a filing date or window of its own", "The window runs September – November."],
    ["SD-4 finality warning", "Appeal window closes. Hard deadline — no extensions."],
    ["SD-5 non-canonical host", "Look it up at cookcountyassessor.com today."],
    ["SD-6 external paid offer", "[Illinois Property Tax Appeal Packet — $37](https://www.etsy.com/listing/4478290255)"],
    ["SD-7 implies coverage outside Cook", "Covers DuPage, Lake County, Will County and more."],
    ["SD-8 nothing-to-lose guarantee", "You have nothing to lose by filing."],
    ["SD-9 overpayment or merits finding", "Stop Overpaying Property Taxes — you may be missing free money."],
    ["SD-10 frozen banned-claims lexicon", "We file your appeal for you."],
  ]

  /**
   * The two variants added to the frozen lexicon in this commit, proven through
   * SD-10 — a third consumer, and a served-tree shape rather than a rendered
   * page or a markdown post. Both strings are verbatim from the withdrawn
   * documents, so this is also the retroactive proof for the widening itself.
   */
  const NEW_LEXICON_FIXTURES: Array<[string, string]> = [
    ["BL-B1 averaged savings, inflected", "the same steps used by homeowners who've saved an average of $1,200+ per year"],
    ["BL-B5 guarantee, nothing to lose", "You have nothing to lose by filing."],
  ]

  it.each(NEW_LEXICON_FIXTURES)("SD-10 carries the new %s variant into the served tree", (_id, fixture) => {
    expect(servedAppealDomainViolations(fixture)).toContain("SD-10 frozen banned-claims lexicon")
  })

  it.each(NEW_LEXICON_FIXTURES)("%s is a matcher on the frozen lexicon, not a local rule", (id) => {
    // If someone deletes the widening from the lexicon module, SD-10 stops
    // catching these and this names why.
    expect(BANNED_LEXICON.map(([label]) => label)).toContain(id)
  })

  it.each(FIXTURES)("%s fires on the string that was actually live", (id, fixture) => {
    expect(servedAppealDomainViolations(fixture)).toContain(id)
  })

  it("passes content that is merely informational", () => {
    const benign = readFileSync(join(PUBLIC_DIR, "downloads/evidence-checklist.md"), "utf8")
    expect(servedAppealDomainViolations(benign)).toEqual([])
  })

  it("fails when a forbidden fixture is introduced under a served path", () => {
    // The rules firing is not the same claim as the sweep reaching them. This
    // writes a real file into `public/`, re-walks the served tree exactly as the
    // sweep does, and proves the violation is found at its served path.
    const planted = join(PUBLIC_DIR, "downloads", "__served_tree_guard_fixture__.md")
    try {
      writeFileSync(
        planted,
        "# Fixture\n\nHard deadline — no extensions. File at the Cook County Board of Review.\n",
        "utf8",
      )

      const found = servedAppealDomainPaths()
        .filter((p) => SCANNABLE.test(p))
        .map((p) => ({ path: p, violations: servedAppealDomainViolations(readFileSync(join(PUBLIC_DIR, p), "utf8")) }))
        .filter((r) => r.violations.length > 0)

      expect(found.map((r) => r.path)).toEqual(["/downloads/__served_tree_guard_fixture__.md"])
      expect(found[0].violations).toEqual(
        expect.arrayContaining([
          "SD-1 board-of-review without CC-11",
          "SD-4 finality warning",
        ]),
      )
    } finally {
      if (existsSync(planted)) unlinkSync(planted)
    }
    expect(existsSync(planted)).toBe(false)
  })

  it.each(RETIRED_APPEAL_DOWNLOADS.map((p) => p.split("/").pop() as string))(
    "would have caught %s, the document that was actually served",
    (basename) => {
      // The retroactive proof. These five sat in the served tree through every
      // prior correction round. A guard that cannot flag them is decoration.
      const raw = readFileSync(join(RETIRED_DIR, "appeal-downloads", basename), "utf8")
      const violations = servedAppealDomainViolations(raw)
      expect({ basename, caught: violations.length > 0 }).toEqual({ basename, caught: true })
    },
  )

  it("names, per withdrawn document, exactly why it could not stay", () => {
    const read = (n: string) =>
      servedAppealDomainViolations(readFileSync(join(RETIRED_DIR, "appeal-downloads", n), "utf8"))

    expect(read("county-deadline-calendar.md")).toEqual(
      expect.arrayContaining([
        "SD-1 board-of-review without CC-11",
        "SD-3 states a filing date or window of its own",
        "SD-4 finality warning",
        "SD-5 non-canonical host",
        "SD-7 implies coverage outside Cook",
        "SD-9 overpayment or merits finding",
      ]),
    )
    expect(read("faq.md")).toEqual(
      expect.arrayContaining(["SD-1 board-of-review without CC-11", "SD-8 nothing-to-lose guarantee"]),
    )
    expect(read("filing-instructions.md")).toEqual(
      expect.arrayContaining(["SD-1 board-of-review without CC-11"]),
    )
    expect(read("cover-letter-template.md")).toEqual(
      expect.arrayContaining(["SD-1 board-of-review without CC-11"]),
    )
    expect(read("homestead-exemption-guide.md")).toEqual(
      expect.arrayContaining([
        "SD-2 dollar savings claim",
        "SD-5 non-canonical host",
        "SD-6 external paid offer",
        "SD-9 overpayment or merits finding",
      ]),
    )
  })

  it("does not fire on a LegalKits document, which is a separate product line", () => {
    // Excluded by path, not by pretending the content is clean.
    const excluded = servedAppealDomainPaths().filter((p) => p.startsWith("/downloads/small-claims/"))
    expect(excluded).toEqual([])
  })
})

/* ── The whole blog corpus ────────────────────────────────────────────────── */

/**
 * The blog corpus moved out of this file.
 *
 * A previous commit swept all 18 posts here and pinned the nine that carried
 * banned claims into an exact ledger, because rewriting nine marketing posts was
 * owner judgment and the alternative was leaving thirteen posts unswept. That
 * ledger was containment, not a fix, and it is now gone: eleven posts are
 * retired to `docs/retired-resources/blog-claims/`, seven remain live, and the
 * live corpus is required to be clean with no ledger, exemption or
 * accepted-failure count anywhere.
 *
 * Governance now lives in `__tests__/blog/served-blog-governance.test.ts`, which
 * derives the served set from `lib/blog` — the loader the dynamic route, the
 * `/blog` listing, `rss.xml` and the sitemap all share — rather than from a list
 * maintained here. What remains below is the one assertion this file still owns:
 * that the accepted five are among the live set and clean, so the two suites
 * cannot silently disagree about the corpus.
 */

const ACCEPTED_BLOG_SLUGS = [
  "cook-county-property-tax-appeal-deadline-2026-by-township",
  "oak-lawn-property-tax-appeal-2026",
  "rich-township-property-tax-appeal-2026",
  "thornton-township-property-tax-appeal-2026",
  "worth-township-property-tax-appeal-2026",
] as const

function blogBody(slug: string): string {
  const raw = readFileSync(join(ROOT, "content/blog", `${slug}.md`), "utf8")
  return raw.startsWith("---") ? raw.slice(raw.indexOf("\n---", 3) + 4) : raw
}

describe("the accepted blog rows are still served and still clean", () => {
  it.each([...ACCEPTED_BLOG_SLUGS])("%s is still in content/blog", (slug) => {
    expect(existsSync(join(ROOT, "content/blog", `${slug}.md`))).toBe(true)
  })

  it.each([...ACCEPTED_BLOG_SLUGS])("%s trips no lexicon row", (slug) => {
    const text = readable(blogBody(slug))
    const violations = BANNED_LEXICON.filter(([, p]) => p.test(text)).map(([label]) => label)
    expect({ slug, violations }).toEqual({ slug, violations: [] })
  })

  it("carries no violation ledger for public content", () => {
    // The ledger this file used to hold is closed. If one is reintroduced here,
    // the name will show up in this file's own source.
    const self = readFileSync(join(ROOT, "__tests__/deadlines/generated-content-safety.test.ts"), "utf8")
    const declarations = [...self.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*[:=]/g)].map((m) => m[1])
    expect(declarations.filter((n) => /UNGOVERNED|VIOLATION|ALLOW|EXEMPT|BASELINE/.test(n))).toEqual([])
  })
})
