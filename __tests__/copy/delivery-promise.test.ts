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
import { readFileSync } from "node:fs"
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
    // Enumerated rather than globbed: the point is that each survivor was
    // looked at and justified, not that the sweep found nothing.
    const exemptFiles = new Set(EXEMPTIONS.map((e) => e.file))
    for (const { file, why } of EXEMPTIONS) {
      expect(why.length).toBeGreaterThan(20)
      expect(read(file)).toMatch(/24[ -]hours?/i)
    }
    const customerFacing = [
      "app/checkout/success/page.tsx",
      "app/checkout/page.tsx",
      "components/ot-design/CheckoutPage.tsx",
      "app/pricing/page.tsx",
      "app/faq/page.tsx",
    ]
    for (const file of customerFacing) {
      if (exemptFiles.has(file)) continue
      let text: string
      try {
        text = read(file)
      } catch {
        continue // surface does not exist on this branch
      }
      expect(text).not.toMatch(/within\s+(<strong>)?24\s*hours/i)
    }
  })
})
