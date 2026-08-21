/** @jest-environment node */

/**
 * The canonical copy module is a transcription of a frozen document. A
 * transcription can be wrong in ways review does not catch: a straight
 * apostrophe for a typographic one, an en dash for an em dash, "practice" for
 * the British "practise", a dropped clause in a long sentence.
 *
 * So the strings are not reviewed here — they are compared byte-for-byte
 * against a checked-in copy of the frozen table. `fixtures/canonical-copy.json`
 * is the transcription of record; if it and `lib/copy/canonical.ts` ever
 * disagree, this fails and no surface ships the drifted sentence.
 */

import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

import {
  CC_01,
  CC_02,
  CC_03,
  CC_04,
  CC_05,
  CC_06,
  CC_07,
  CC_09,
  CC_10,
  CC_11,
  CC_12,
  CC_13,
  CC_14,
  CC_15,
  CC_17,
  CC_18,
  cc08,
  cc16,
} from "@/lib/copy/canonical"

const FIXTURE_PATH = join(__dirname, "fixtures", "canonical-copy.json")

type Fixture = {
  sourceDocument: string
  sourceSha256: string
  strings: Record<string, string>
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture

const MODULE_STRINGS: Record<string, string> = {
  "CC-01": CC_01,
  "CC-02": CC_02,
  "CC-03": CC_03,
  "CC-04": CC_04,
  "CC-05": CC_05,
  "CC-06": CC_06,
  "CC-07": CC_07,
  "CC-09": CC_09,
  "CC-10": CC_10,
  "CC-11": CC_11,
  "CC-12": CC_12,
  "CC-13": CC_13,
  "CC-14": CC_14,
  "CC-15": CC_15,
  "CC-17": CC_17,
}

describe("canonical copy fidelity", () => {
  it.each(Object.keys(MODULE_STRINGS))("%s matches the frozen source byte-for-byte", (id) => {
    expect(fixture.strings[id]).toBeDefined()
    expect(MODULE_STRINGS[id]).toBe(fixture.strings[id])
  })

  it("covers every id the frozen table defines as a literal string", () => {
    expect(Object.keys(MODULE_STRINGS).sort()).toEqual(Object.keys(fixture.strings).sort())
  })

  it("preserves the em dash in CC-11 rather than a hyphen or en dash", () => {
    expect(CC_11).toContain("Do not wait for us — confirm your own deadline")
    expect(CC_11).not.toContain(" - confirm")
    expect(CC_11).not.toContain("– confirm")
  })

  it("preserves the British spellings the frozen source uses", () => {
    expect(CC_11).toContain("practise before it")
    expect(CC_09).toContain("neighbourhood name")
    expect(CC_09).toContain("Chicago neighbourhoods")
  })

  it("keeps CC-02 as one indivisible string of exactly three sentences", () => {
    expect(CC_02.split(". ").length).toBe(3)
    expect(CC_02.startsWith("This free check compares")).toBe(true)
    expect(CC_02.endsWith("succeed or reduce taxes.")).toBe(true)
  })

  it("pins CC-02 by digest, because BL-F1 requires it verbatim on every result surface", () => {
    const digest = createHash("sha256").update(CC_02, "utf8").digest("hex")
    expect(digest).toBe(createHash("sha256").update(fixture.strings["CC-02"], "utf8").digest("hex"))
  })

  it("builds CC-18 as CC-01 followed by CC-12", () => {
    expect(CC_18).toBe(`${CC_01} ${CC_12}`)
    expect(CC_18).toContain(CC_01)
    expect(CC_18).toContain(CC_12)
  })

  it("refuses to leave CC-08 placeholders unresolved", () => {
    const rendered = cc08({ source: "Cook County Assessor", timestamp: "2026-08-19 14:02 CDT" })
    expect(rendered).not.toMatch(/[{}]/)
    expect(rendered).toContain("published by Cook County Assessor")
    expect(rendered).toContain("retrieved 2026-08-19 14:02 CDT")
    expect(rendered).toContain("Confirm your filing deadline with the county before you file.")
  })

  it("refuses to leave CC-16 placeholders unresolved", () => {
    const rendered = cc16({
      stage: "Assessor",
      township: "Elk Grove",
      source: "Cook County Assessor",
      timestamp: "2026-08-19 14:02 CDT",
    })
    expect(rendered).not.toMatch(/[{}]/)
    expect(rendered).toContain("The Assessor window for Elk Grove is not open")
    expect(rendered).toContain("We are not selling a packet for a closed window.")
  })

  it("carries CC-12's negated forms, which the banned lexicon must not flag", () => {
    // BL-B5 bans "guarantee"; BL-A-adjacent scanners ban "legal advice". CC-12
    // legitimately contains both in negated form. Any scanner built later has
    // to strip canonical strings before asserting, or it red-lines a correct
    // build. This test records the trap so that requirement is not forgotten.
    expect(CC_12).toContain("do not guarantee a reduction")
    expect(CC_12).toContain("does not provide legal or tax advice")
  })
})
