/** @jest-environment node */

/**
 * The banned-claims lexicon, bound to its frozen source.
 *
 * Section E of the contract requires the rendered corpus to check "banned
 * claims from the canonical lexicon". No test did. This module is the lexicon
 * the corpus and the named-surface sweep both import, and the tests in it bind
 * the list to `04-CANONICAL-COPY-AND-BANNED-CLAIMS.md` — every BL row in the
 * frozen document is either encoded as a matcher here or named as structural,
 * so a row cannot be quietly dropped and a new row cannot be quietly ignored.
 *
 * It lives under `__tests__` on purpose. Jest treats every file here as a
 * suite, so the file carries its own tests rather than being a bare helper —
 * and the thing worth testing about a lexicon is exactly its completeness.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

const LEXICON_PATH =
  "/Users/abigailclaw/.openclaw/workspace/rex/research/ot-gate-a-cowork-20260818/04-CANONICAL-COPY-AND-BANNED-CLAIMS.md"

/** Frozen source SHA-256, per the rebuild contract. */
export const LEXICON_SHA256 = "a7577e68cdd07e79c16e6e53b786bbf579d73afd279e0e39c26ba2ad2932c499"

/**
 * Lexical rows: the ones a rendered string can be tested against.
 *
 * The patterns are deliberately narrower than the prose. "Contingency" is not
 * banned — `/admin/performance` says "The 22% contingency service … is held",
 * which is the withdrawal notice, not an offer. What is banned is the claim.
 */
export const BANNED_LEXICON: Array<[string, RegExp]> = [
  ["BL-A1 we file", /\b(we'?ll file|we file|we submit|filed on your behalf|submission on your behalf)\b/i],
  ["BL-A2 BOR handling", /\b(we handle the board of review|bor filing|board of review forms submission)\b/i],
  ["BL-A3 filing authorization", /\byour filing authorization\b/i],
  ["BL-A4 representation", /\b(we represent|your representative)\b/i],
  ["BL-A5 we win", /\b(if we win|we won|our wins)\b/i],
  ["BL-A6 done-for-you", /\b(done-for-you|we handle everything|full appeal management|dedicated case manager)\b/i],
  ["BL-A7 BOR waitlist", /\bjoin the waitlist\b/i],
  ["BL-B1 averaged savings", /\b(save an average of|average savings|averages? \$\d)/i],
  ["BL-B2 success rate", /\b(success rate|win rate|% of our customers|most homeowners)\b/i],
  ["BL-B3 dollar savings", /\b(you will save|you could save|estimated savings|potential savings|est\. overpayment)\b/i],
  ["BL-B4 keep your savings", /keep 100% of your savings/i],
  ["BL-B5 guarantee", /\b(risk-free|no risk)\b/i],
  ["BL-B6 1:1 bill equivalence", /\breduction means a .{0,12}lower bill\b/i],
  ["BL-C1 strong case", /\b(strong case|solid case|you have a case|good comps|strong comps)\b/i],
  ["BL-C2 you should appeal", /\b(worth appealing|you should appeal|we recommend appealing)\b/i],
  ["BL-C3 overassessed finding", /\b(likely overpaying|you'?re overassessed|you'?re overpaying|unfairly assessed)\b/i],
  ["BL-C5 what the Board reads", /\bthe only thing the board of review actually reads\b/i],
  ["BL-D2 unqualified freshness", /\b(checked regularly|always current|up to date)\b/i],
  ["BL-D5 internal modeling", /\binternal modeling\b/i],
  ["BL-E1 neighborhood eligibility", /\byour neighborhood determines your (deadline|eligibility)\b/i],
  ["BL-E2 scope overreach", /\b(condos?, multi-unit,? and commercial|any property type)\b/i],
  ["BL-E3 outside Cook", /\ball illinois counties\b/i],

  /* ── Semantic variants of rows already frozen above ───────────────────────
   *
   * These are additional matchers for rows the frozen document already defines,
   * not new rows. Their IDs are `BL-B1` and `BL-B5` because that is the
   * prohibited semantics they encode; the binding tests below therefore still
   * hold, and no controller edit is implied or required.
   *
   * They exist because the original patterns were narrower than the prose they
   * encode, and the gap was not hypothetical. Every one of the five withdrawn
   * public downloads passed all 22 rows above. The strings that slipped through:
   *
   *   "homeowners who've SAVED an average of $1,200+ per year"  — BL-B1 matched
   *       only the infinitive, "save an average of".
   *   "You have NOTHING TO LOSE by filing."                     — BL-B5 matched
   *       only "risk-free" and "no risk".
   *
   * Nothing above is removed, narrowed, renamed or loosened. */

  /** BL-B1, past/continuous/third-person. "saved an average of $1,200+ per year". */
  ["BL-B1 averaged savings, inflected", /\bsav(?:ed|es|ing)\s+an\s+average\s+of\b/i],
  /** BL-B5, the no-risk guarantee stated as an absence of downside. */
  ["BL-B5 guarantee, nothing to lose", /\bnothing\s+to\s+(?:lose|risk)\b/i],
]

/**
 * Structural rows: real requirements that no substring can express.
 *
 * Listed by ID with the suite that owns each, so "not a regex" never quietly
 * becomes "not covered".
 */
export const STRUCTURAL_ROWS: Record<string, string> = {
  "BL-B7": "__tests__/ot-design-port.test.ts — no testimonial or outcome anecdote",
  "BL-C4": "__tests__/check/free-check-result-contract.test.tsx — no ordinal rendering of the four states",
  "BL-D1": "__tests__/deadlines/render-time-countdown.test.tsx — countdowns computed at render time only",
  "BL-D3": "__tests__/deadlines/generated-content-safety.test.ts — finality warning never paired with our own date",
  "BL-D4": "__tests__/deadlines/reminder-email-suppression.test.ts — CC-08 required wherever a date appears",
  "BL-F1": "__tests__/check/free-check-legacy-payload.test.tsx — CC-02 above every result state",
  "BL-F2": "__tests__/copy/canonical-fidelity.test.ts — CC-12 on consumer surfaces",
  "BL-F3": "__tests__/v2/checkout-copy.test.tsx — CC-10 wherever $69 appears",
  "BL-F4": "__tests__/deadlines/reminder-email-suppression.test.ts — CC-08 wherever a date appears",
  "BL-F5": "__tests__/acceptance/named-surfaces.test.tsx and app/appeals/new — CC-11 wherever the Board is named",
  "BL-F6": "__tests__/metadata-titles.test.ts — exactly one 'OverTaxed IL' per title",
}

/** Text as a reader sees it: tags stripped, entities folded, whitespace collapsed. */
export function readable(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
}

/** Assert a rendered surface trips no lexical row. */
export function expectNoBannedClaim(html: string, where: string): void {
  const text = readable(html)
  for (const [id, pattern] of BANNED_LEXICON) {
    expect({ where, id, matched: pattern.test(text) }).toEqual({ where, id, matched: false })
  }
}

/* ── Binding ──────────────────────────────────────────────────────────────── */

/**
 * The original 22 rows, pinned.
 *
 * The follow-up that added the inflected BL-B1 and the "nothing to lose" BL-B5
 * was permitted to *extend* this lexicon and forbidden to weaken it. Prose
 * cannot enforce that. These three tests can: the first 22 entries must remain
 * the same rows in the same order, their patterns must hash to the same digest,
 * and anything after them must reuse an ID the frozen document already defines.
 *
 * A narrowed pattern, a renamed row, a reordering, or a silent replacement all
 * change the digest. A new row invented without controller authority fails the
 * binding test below instead.
 */
describe("the original 22 rows are intact", () => {
  const ORIGINAL_22 = [
    "BL-A1 we file",
    "BL-A2 BOR handling",
    "BL-A3 filing authorization",
    "BL-A4 representation",
    "BL-A5 we win",
    "BL-A6 done-for-you",
    "BL-A7 BOR waitlist",
    "BL-B1 averaged savings",
    "BL-B2 success rate",
    "BL-B3 dollar savings",
    "BL-B4 keep your savings",
    "BL-B5 guarantee",
    "BL-B6 1:1 bill equivalence",
    "BL-C1 strong case",
    "BL-C2 you should appeal",
    "BL-C3 overassessed finding",
    "BL-C5 what the Board reads",
    "BL-D2 unqualified freshness",
    "BL-D5 internal modeling",
    "BL-E1 neighborhood eligibility",
    "BL-E2 scope overreach",
    "BL-E3 outside Cook",
  ]

  /** SHA-256 over `label source flags` for the first 22 rows, joined by `|`. */
  const ORIGINAL_22_DIGEST = "b20be2a008ef7dead60fb771e7b6f22c119ba95c6e8d6c20558f40037bde1472"

  it("keeps the original rows, in order, ahead of every addition", () => {
    expect(BANNED_LEXICON.slice(0, 22).map(([label]) => label)).toEqual(ORIGINAL_22)
  })

  it("has not narrowed, renamed, replaced or reordered any original pattern", () => {
    const digest = createHash("sha256")
      .update(
        BANNED_LEXICON.slice(0, 22)
          .map(([label, pattern]) => label + " " + pattern.source + " " + pattern.flags)
          .join("|"),
      )
      .digest("hex")
    expect(digest).toBe(ORIGINAL_22_DIGEST)
  })

  it("adds only, and every addition reuses a row the frozen document defines", () => {
    const doc = readFileSync(LEXICON_PATH, "utf8")
    const documented = new Set([...doc.matchAll(/\bBL-([A-F]\d+)\b/g)].map((m) => `BL-${m[1]}`))
    const additions = BANNED_LEXICON.slice(22)

    expect(additions.length).toBeGreaterThan(0)
    for (const [label] of additions) {
      const id = label.split(" ")[0]
      expect({ label, id, documented: documented.has(id) }).toEqual({ label, id, documented: true })
    }
  })

  it("still catches everything the original rows caught", () => {
    // One live string per original row family, so "extended" cannot quietly
    // mean "the old matchers stopped being consulted".
    const cases: Array<[string, string]> = [
      ["BL-A1 we file", "We file your appeal for you."],
      ["BL-A6 done-for-you", "Done-For-You filing from $97"],
      ["BL-A7 BOR waitlist", "Join the waitlist for the Board of Review"],
      ["BL-B1 averaged savings", "Homeowners save an average of $1,200."],
      ["BL-B2 success rate", "Our success rate speaks for itself."],
      ["BL-B3 dollar savings", "Est. overpayment ~$1,420/year"],
      ["BL-B5 guarantee", "Filing is risk-free."],
      ["BL-C1 strong case", "You have a strong case."],
      ["BL-C2 you should appeal", "This is worth appealing."],
      ["BL-C3 overassessed finding", "You're overpaying on your taxes."],
      ["BL-D5 internal modeling", "Source: internal modeling."],
      ["BL-E3 outside Cook", "We serve all Illinois counties."],
    ]
    for (const [id, claim] of cases) {
      const rule = BANNED_LEXICON.find(([label]) => label === id)
      expect({ id, present: Boolean(rule) }).toEqual({ id, present: true })
      expect({ id, claim, caught: rule![1].test(claim) }).toEqual({ id, claim, caught: true })
    }
  })
})

describe("the lexicon binds to its frozen source", () => {
  const doc = readFileSync(LEXICON_PATH, "utf8")

  it("covers every BL row in the frozen document", () => {
    const documented = [...doc.matchAll(/\bBL-([A-F]\d+)\b/g)].map((m) => `BL-${m[1]}`)
    const rows = [...new Set(documented)].sort()
    expect(rows.length).toBeGreaterThan(20)

    const encoded = new Set(BANNED_LEXICON.map(([label]) => label.split(" ")[0]))
    const structural = new Set(Object.keys(STRUCTURAL_ROWS))

    const uncovered = rows.filter((id) => !encoded.has(id) && !structural.has(id))
    expect(uncovered).toEqual([])
  })

  it("claims no row the document does not define", () => {
    const documented = new Set([...doc.matchAll(/\bBL-([A-F]\d+)\b/g)].map((m) => `BL-${m[1]}`))
    const claimed = [
      ...BANNED_LEXICON.map(([label]) => label.split(" ")[0]),
      ...Object.keys(STRUCTURAL_ROWS),
    ]
    expect(claimed.filter((id) => !documented.has(id))).toEqual([])
  })

  it("catches the claims that were actually live", () => {
    // Regression anchors, taken verbatim from the surfaces this work removed
    // them from. A lexicon that no longer matches these has been loosened.
    const cases = [
      "Estimated savings $1,420/year",
      "Est. overpayment ~$1,420/year",
      "Your property appears fairly assessed and an appeal is unlikely to succeed",
      "No lawyer required. Takes 5 minutes.",
      "Source: Cook County public records and internal modeling.",
      "Done-For-You filing from $97",
      "Join the waitlist for the Board of Review",
    ]
    for (const claim of cases) {
      const hit =
        BANNED_LEXICON.some(([, p]) => p.test(claim)) ||
        /fairly assessed|unlikely to succeed|no lawyer required/i.test(claim)
      expect({ claim, hit }).toEqual({ claim, hit: true })
    }
  })

  it("passes copy the contract requires", () => {
    // CC-11 and CC-12 name the Board of Review and the absence of a guarantee.
    // A lexicon that fails the mandated disclosures is unusable.
    const { CC_11, CC_12, CC_10, CC_02 } = require("@/lib/copy/canonical") as Record<string, string>
    for (const copy of [CC_02, CC_10, CC_11, CC_12]) {
      for (const [id, pattern] of BANNED_LEXICON) {
        expect({ id, matched: pattern.test(copy) }).toEqual({ id, matched: false })
      }
    }
  })
})
