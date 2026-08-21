/** @jest-environment node */

/**
 * The public blog corpus rules.
 *
 * These live in their own module for a reason that is itself a lesson from this
 * work: the governance suite and the mutation suite both need them, and having
 * the mutation suite import the governance suite meant Jest re-ran the
 * governance assertions *while the content tree was deliberately mutated*. A
 * shared rule set has to be independent of the tree it judges.
 *
 * So everything here is pure — it takes a string and returns the rule IDs that
 * string trips — and the tests in this file are pure too, fixtures rather than
 * files. Jest treats every file under `__tests__` as a suite, so this file
 * carries its own tests instead of being a bare helper, in the same shape as
 * `__tests__/lexicon/banned-claims.test.ts`.
 *
 * The rules go beyond the frozen lexicon deliberately. Three separate live
 * claims passed all 22 original rows and were caught only by rules written
 * against what the documents actually said:
 *
 *   "saved an average of $1,200+ per year"          — BL-B1 matched only "save an average of"
 *   "you have nothing to lose"                      — BL-B5 matched only "risk-free"/"no risk"
 *   "reductions of $500-$2,000 per year are common" — BL-B3 matches "you could save"/"estimated
 *                                                     savings"; this phrases the same claim as a
 *                                                     property of the outcome, so nothing caught it
 */
import { BANNED_LEXICON, readable } from "../lexicon/banned-claims.test"

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December"

type CorpusRule = { id: string; hit: (text: string, raw: string) => boolean }

const CORPUS_RULES: CorpusRule[] = [
  {
    id: "PB-1 banned claim",
    hit: (t) => BANNED_LEXICON.some(([, p]) => p.test(t)),
  },
  {
    // Scoped to the Assessor host, which is what the controller's hostname
    // ruling is about. `cookcountyboardofreview.com` is the Board's own official
    // domain; citing it is correct, and two accepted posts do. What the
    // withdrawn `county-deadline-calendar.md` was flagged for was naming the
    // Board as the *filing route* with no CC-11, not the domain itself.
    id: "PB-2 non-canonical Assessor host",
    hit: (_t, raw) => /cookcountyassessor\.com/i.test(raw),
  },
  {
    id: "PB-3 states a date of its own",
    hit: (t) =>
      new RegExp(`\\b(${MONTH})\\s+\\d{1,2},?\\s+(19|20)\\d{2}\\b`).test(t) ||
      /\b(19|20)\d{2}-\d{2}-\d{2}\b/.test(t) ||
      /\b\d{1,2}\/\d{1,2}\/(19|20)\d{2}\b/.test(t),
  },
  {
    id: "PB-4 runs a countdown",
    hit: (t) => /\b\d+\s*(days?|business days?|weeks?)\s*(left|remaining|until|before|to file|to appeal)/i.test(t),
  },
  {
    /**
     * Asserting a window state, not discussing one.
     *
     * Two accepted posts open by saying they do *not* tell you whether the
     * window is open today — that sentence is the safe behaviour, and a rule
     * that flags it would be pressuring the corpus in the wrong direction. So
     * the match is discarded when it sits inside a negation or an indirect
     * question.
     */
    id: "PB-5 asserts an open or closing window",
    hit: (t) => {
      const pattern =
        /\b(window is (now )?open|currently open|open now|closes? (today|tomorrow|soon)|filing is open)\b/gi
      for (const match of t.matchAll(pattern)) {
        const before = t.slice(Math.max(0, match.index - 60), match.index)
        if (/\b(not|never|n't|whether|if)\b[^.]*$/i.test(before)) continue
        return true
      }
      return false
    },
  },
  {
    id: "PB-6 recommends filing or asserts merits",
    hit: (t) => /\b(you should (file|appeal)|we recommend (filing|appealing)|worth appealing|you have a case)\b/i.test(t),
  },
  {
    id: "PB-7 states savings, overpayment or a guarantee",
    hit: (t) =>
      /\$\s?\d[\d,]*(\s*[–—-]\s*\$?\s?\d[\d,]*)?\s*(\/|\bper\b)?\s*(year|yr|annually)/i.test(t) ||
      /\bsav(?:e|ed|es|ing)\s+an\s+average\s+of\b/i.test(t) ||
      /\bestimated\s+(annual\s+)?(tax\s+)?savings\b/i.test(t) ||
      /\bnothing\s+to\s+(lose|risk)\b/i.test(t) ||
      /\brisk-free\b/i.test(t),
  },
  {
    id: "PB-8 offers reminder capture, checkout or a paid CTA",
    hit: (t, raw) =>
      /\/auth\/signup\?plan=/.test(raw) ||
      /\bcheckout\b/i.test(raw) ||
      /\b(remind me|get a reminder|deadline reminder|notify me when|email me when)\b/i.test(t),
  },
  {
    id: "PB-9 links a retired public download",
    hit: (_t, raw) =>
      [
        "/downloads/county-deadline-calendar.md",
        "/downloads/filing-instructions.md",
        "/downloads/faq.md",
        "/downloads/cover-letter-template.md",
        "/downloads/homestead-exemption/homestead-exemption-guide.md",
      ].some((p) => raw.includes(p)),
  },
]

/** Every rule a post's rendered body trips. Pure, so it can be aimed at a fixture. */
export function publicBlogViolations(raw: string): string[] {
  const body = raw.startsWith("---") ? raw.slice(raw.indexOf("\n---", 3) + 4) : raw
  const text = readable(body)
  return CORPUS_RULES.filter((r) => r.hit(text, body)).map((r) => r.id)
}

/* ── The rules are falsifiable, proven on fixtures rather than files ──────── */

describe("every public blog corpus rule fires", () => {
  const FIXTURES: Array<[string, string]> = [
    ["PB-1 banned claim", "We file your appeal for you."],
    ["PB-2 non-canonical Assessor host", "Look it up at cookcountyassessor.com/address-search."],
    ["PB-3 states a date of its own", "The deadline is March 14, 2026."],
    ["PB-4 runs a countdown", "You typically have 30 days to file."],
    ["PB-5 asserts an open or closing window", "Your appeal window is now open."],
    ["PB-6 recommends filing or asserts merits", "You should appeal this year."],
    ["PB-7 states savings, overpayment or a guarantee", "Reductions of $500-$2,000 per year are common."],
    ["PB-8 offers reminder capture, checkout or a paid CTA", "Get a reminder before your deadline."],
    ["PB-9 links a retired public download", "Grab the [calendar](/downloads/county-deadline-calendar.md)."],
  ]

  it.each(FIXTURES)("%s fires on the claim it bans", (id, fixture) => {
    expect(publicBlogViolations(fixture)).toContain(id)
  })

  it("covers every rule with a fixture", () => {
    expect(FIXTURES.map(([id]) => id).sort()).toEqual(CORPUS_RULES.map((r) => r.id).sort())
  })

  it("passes ordinary informational prose", () => {
    const benign =
      "Cook County sets appeal dates by township and revises them through the year. " +
      "Check the Assessor's calendar at cookcountyassessoril.gov/assessment-calendar-and-deadlines " +
      "for the current status before you plan anything around it."
    expect(publicBlogViolations(benign)).toEqual([])
  })

  it("PB-5 does not fire on a post that refuses to state the window", () => {
    // Two accepted posts open by saying they do *not* tell you whether the
    // window is open today. That sentence is the safe behaviour; a rule that
    // punished it would push the corpus the wrong way.
    const refusal =
      "This page does not publish a filing date and does not tell you whether the window is open today."
    expect(publicBlogViolations(refusal)).toEqual([])
  })

  it("PB-7 catches the outcome-phrased savings claim the frozen lexicon misses", () => {
    const claim = "Homeowners frequently win reductions of $500-$2,000 per year."
    expect(BANNED_LEXICON.some(([, p]) => p.test(readable(claim)))).toBe(false)
    expect(publicBlogViolations(claim)).toContain("PB-7 states savings, overpayment or a guarantee")
  })

  it("strips frontmatter before judging", () => {
    const withFrontmatter = '---\ntitle: X\ndate: "2026-01-01"\n---\n\nOrdinary text.\n'
    expect(publicBlogViolations(withFrontmatter)).toEqual([])
  })
})
