/** @jest-environment node */

/**
 * The 15-row freshness test map, reconciled.
 *
 * The contract's required verification reads: "all 15 freshness test-map files
 * **or equivalent exact coverage with a reconciliation table**." Five of the
 * fifteen were absent and no reconciliation table was written, so the shortfall
 * was invisible — and two of the five missing rows were exactly the tests that
 * would have caught the two worst defects the independent review found:
 *
 *   row 13, reminder-email-suppression   → the deadline-reminder cron mailing
 *                                          an unvalidated date and countdown;
 *   row 14, generated-content-safety     → the HOA flyer still served with a
 *                                          standing "Current appeal windows".
 *
 * Both now exist. This file is the reconciliation, kept as an executable table
 * rather than a paragraph in a handoff: a row satisfied by an equivalent names
 * the equivalent, and the equivalent must be on disk. Deleting a covering suite
 * fails here rather than quietly reopening a row.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(__dirname, "../..")

type Row = {
  row: number
  specified: string
  /** Files that satisfy the row. The specified path itself, or its equivalents. */
  satisfiedBy: string[]
  /** Stated when the specified file does not exist, so the substitution is explicit. */
  note?: string
}

const MAP: Row[] = [
  { row: 1, specified: "__tests__/deadlines/official-source-state.test.ts", satisfiedBy: ["__tests__/deadlines/official-source-state.test.ts"] },
  { row: 2, specified: "__tests__/deadlines/township-resolution.test.ts", satisfiedBy: ["__tests__/deadlines/township-resolution.test.ts"] },
  { row: 3, specified: "__tests__/deadlines/refresh-parser.test.ts", satisfiedBy: ["__tests__/deadlines/refresh-parser.test.ts"] },
  { row: 4, specified: "__tests__/deadlines-2026.test.tsx", satisfiedBy: ["__tests__/deadlines-2026.test.tsx"] },
  { row: 5, specified: "__tests__/deadlines-sourcing.test.tsx", satisfiedBy: ["__tests__/deadlines-sourcing.test.tsx"] },
  { row: 6, specified: "__tests__/freecheck-appeal-window.test.ts", satisfiedBy: ["__tests__/freecheck-appeal-window.test.ts"] },
  {
    row: 7,
    specified: "__tests__/deadlines/consumer-parity.test.tsx",
    satisfiedBy: ["__tests__/acceptance/freshness-corpus.test.tsx", "__tests__/acceptance/named-surfaces.test.tsx"],
    note:
      "Parity across consumers is proven by rendering the consumers rather than by comparing tuples: " +
      "the corpus renders all 38 township pages, the campaign pages, /deadlines, /townships and /check " +
      "against one snapshot, and the named-surface sweep renders the other 12 surfaces. A consumer that " +
      "disagreed with the evaluated state would publish a date the sweep rejects.",
  },
  { row: 8, specified: "__tests__/deadlines/render-time-countdown.test.tsx", satisfiedBy: ["__tests__/deadlines/render-time-countdown.test.tsx"] },
  { row: 9, specified: "__tests__/township-jsonld.test.tsx", satisfiedBy: ["__tests__/township-jsonld.test.tsx"] },
  {
    row: 10,
    specified: "__tests__/deadlines/og-metadata-fail-closed.test.tsx",
    satisfiedBy: ["__tests__/acceptance/freshness-corpus.test.tsx", "__tests__/metadata-titles.test.ts"],
    note:
      "The corpus asserts township and campaign generateMetadata output carries no date claim, and " +
      "sweeps every JSON-LD block on all 38 township pages for Event/startDate nodes. Title rules are " +
      "in metadata-titles. The OG image routes are covered by the same suppression: their inputs are " +
      "the same evaluated view.",
  },
  { row: 11, specified: "__tests__/checkout/session-window-gates.test.ts", satisfiedBy: ["__tests__/checkout/session-window-gates.test.ts"] },
  { row: 12, specified: "__tests__/freecheck-followup.test.ts", satisfiedBy: ["__tests__/freecheck-followup.test.ts"] },
  {
    row: 13,
    specified: "__tests__/deadlines/reminder-email-suppression.test.ts",
    satisfiedBy: ["__tests__/deadlines/reminder-email-suppression.test.ts"],
    note: "Written in this remediation. Was absent; see the file header.",
  },
  {
    row: 14,
    specified: "__tests__/deadlines/generated-content-safety.test.ts",
    satisfiedBy: ["__tests__/deadlines/generated-content-safety.test.ts"],
    note: "Written in this remediation. Was absent; see the file header.",
  },
  {
    row: 15,
    specified: "__tests__/deadlines/52-path-contract.test.tsx",
    satisfiedBy: ["__tests__/acceptance/freshness-corpus.test.tsx"],
    note:
      "The corpus supersedes it and is larger: the controller's matrix moved from 52 to 53 accepted " +
      "rows when /check was added, and the corpus reads the row list from the controller packet rather " +
      "than restating it, so it cannot drift from what Rex verifies against.",
  },
]

describe("freshness test-map reconciliation", () => {
  it("accounts for all 15 rows exactly once", () => {
    expect(MAP).toHaveLength(15)
    expect(MAP.map((r) => r.row)).toEqual([...Array(15)].map((_, i) => i + 1))
  })

  it.each(MAP.map((r) => [r.row, r] as const))("row %i is satisfied by files that exist", (_row, entry) => {
    expect(entry.satisfiedBy.length).toBeGreaterThan(0)
    for (const file of entry.satisfiedBy) {
      expect({ row: entry.row, file, exists: existsSync(join(ROOT, file)) }).toEqual({
        row: entry.row,
        file,
        exists: true,
      })
    }
  })

  it("states a reason wherever the specified file is not the file that covers it", () => {
    // The silent-substitution guard. A row covered by something other than the
    // path the map named has to say what and why, in this file, or fail here.
    for (const entry of MAP) {
      const coveredBySpecified = entry.satisfiedBy.includes(entry.specified)
      const specifiedExists = existsSync(join(ROOT, entry.specified))
      if (coveredBySpecified && specifiedExists && !entry.note) continue
      expect({ row: entry.row, hasNote: Boolean(entry.note && entry.note.length > 40) }).toEqual({
        row: entry.row,
        hasNote: true,
      })
    }
  })

  it("names three rows as substituted and twelve as covered in place", () => {
    // Stated as a count so the shape of the reconciliation is itself pinned: if
    // a sixth row quietly becomes a substitution, this fails.
    const substituted = MAP.filter((r) => !r.satisfiedBy.includes(r.specified))
    expect(substituted.map((r) => r.row)).toEqual([7, 10, 15])
    const inPlace = MAP.filter((r) => r.satisfiedBy.includes(r.specified))
    expect(inPlace).toHaveLength(12)
  })
})
