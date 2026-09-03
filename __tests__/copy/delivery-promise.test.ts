/**
 * The customer delivery promise.
 *
 * The approved wording (Gate A owner ruling 2026-08-31, D-3 / T-1) is delivery
 * within ONE BUSINESS DAY. The repository shipped "within 24 hours", which is a
 * different and harder commitment: a Friday-evening purchase is about fifteen
 * hours from a 24-hour promise expiring and three days from the end of the next
 * business day.
 *
 * This suite sweeps the customer-facing surfaces for the old wording and
 * requires every remaining "24 hours" in the tree to be a deliberate, named
 * exemption rather than a survivor.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..")
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8")

/**
 * Every file that still contains "24 hours" or "24-hour", with the reason it is
 * allowed to. A new customer-facing promise cannot be added without either
 * failing this suite or arguing itself into this table in review.
 */
const EXEMPTIONS: Array<{ file: string; why: string }> = [
  {
    file: "app/api/auth/register/route.ts",
    why: "email-verification link validity, which is a real token lifetime and not a delivery promise",
  },
  {
    file: "app/api/auth/resend-verification/route.ts",
    why: "email-verification link validity, as above",
  },
  {
    file: "lib/email/send.ts",
    why: "internal operations alert to staff ('respond to customer within 24 hours') plus the comment recording this change; neither is shown to a customer",
  },
  {
    file: "app/api/checkout/session/route.ts",
    why: "code comment describing the 24-hour source-freshness default",
  },
  {
    file: "lib/checkout/ot-contract.ts",
    why: "code comments describing the 24-hour source-freshness default",
  },
  {
    file: "lib/deadlines/official-source-state.ts",
    why: "code comment contrasting calendar days with elapsed 24-hour periods",
  },
  {
    file: "PRD-BILLING-OVERHAUL.md",
    why: "historical product requirements document, not shipped copy and not rendered to any customer; retained as a record of what the promise used to be",
  },
]

describe("the approved delivery promise", () => {
  it("is what the confirmation email sends", () => {
    const send = read("lib/email/send.ts")
    expect(send).toContain(
      "We'll email you within one business day with your completed appeal packet.",
    )
    expect(send).not.toContain(
      "We'll email you within 24 hours with your completed appeal packet.",
    )
  })

  it("is what the checkout success page renders", () => {
    const page = read("app/checkout/success/page.tsx")
    expect(page).toContain("<strong>one business day</strong>")
    expect(page).not.toContain("<strong>24 hours</strong>")
  })

  it("promises no outcome, acceptance, or saving alongside it", () => {
    for (const file of ["lib/email/send.ts", "app/checkout/success/page.tsx"]) {
      const text = read(file)
      expect(text).not.toMatch(/guarantee[ds]?\s+(a\s+)?(reduction|approval|acceptance|saving)/i)
      expect(text).not.toMatch(/we will (win|reduce|lower) your/i)
      expect(text).not.toMatch(/(estimated|potential|expected) savings/i)
    }
  })

  it("keeps the homeowner-files posture on the paid confirmation", () => {
    const send = read("lib/email/send.ts")
    expect(send).toMatch(/appeal packet/i)
    expect(send).not.toMatch(/we (will )?file (it|your appeal)/i)
    expect(send).not.toMatch(/filed on your behalf/i)
  })

  it("carries no unexplained twenty-four-hour promise anywhere in the tree", () => {
    // This walks the tree. An earlier version iterated a hardcoded five-file
    // list and swallowed missing files with try/catch, so a brand-new
    // customer-facing 24-hour promise in any other file passed unnoticed.
    const exemptFiles = new Set(EXEMPTIONS.map((e) => e.file))
    for (const { file, why } of EXEMPTIONS) {
      expect(why.length).toBeGreaterThan(20)
      // An exemption that no longer matches is stale and must be removed.
      expect(read(file)).toMatch(/24[ -]hours?/i)
    }

    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue
          walk(rel)
          continue
        }
        if (!/\.(ts|tsx|js|jsx|md|mdx|json|html)$/.test(entry.name)) continue
        if (exemptFiles.has(rel)) continue
        const text = readFileSync(join(ROOT, rel), "utf8")
        if (/24[ -]hours?/i.test(text)) offenders.push(rel)
      }
    }
    for (const root of ["app", "lib", "components", "content"]) {
      try {
        walk(root)
      } catch {
        // directory absent on this branch
      }
    }
    expect(offenders).toEqual([])
  })

  it("proves the sweep actually detects a new offender", () => {
    // Guards the guard: if the sweep silently stopped matching, this fails.
    const probe = "We will email your completed appeal packet within 24 hours."
    expect(/24[ -]hours?/i.test(probe)).toBe(true)
    expect(EXEMPTIONS.every((e) => !probe.includes(e.file))).toBe(true)
  })
})
