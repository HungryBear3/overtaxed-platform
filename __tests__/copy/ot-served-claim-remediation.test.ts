/**
 * @jest-environment node
 */
import fs from "node:fs"
import path from "node:path"

function read(relative: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relative), "utf8")
}

describe("served OT claim remediation", () => {
  it("removes the homepage's static Cicero window and merits verdict copy", () => {
    const source = read("components/ot-design/HomePage.tsx")
    expect(source).not.toMatch(/Cicero Township appeal window open through Jul 31, 2026/)
    expect(source).not.toMatch(/Over-assessed by 2\.1 percentage points/)
    expect(source).not.toMatch(/How we estimate your overpayment/)
    expect(source).not.toMatch(/If you&apos;re fairly assessed, we&apos;ll tell you/)
    expect(source).toMatch(/Synthetic sample only/)
    expect(source).toMatch(/Sample comparison only/)
  })

  it("replaces nearby claims with public-record comparable language", () => {
    expect(read("app/appeal-packet/page.tsx")).not.toMatch(/nearby Cook County comparables/i)
    expect(read("app/townships/page.tsx")).not.toMatch(/similar nearby homes/i)
    expect(read("app/hoa/hoa-client.tsx")).not.toMatch(/compares your assessment against nearby properties/i)

    expect(read("app/appeal-packet/page.tsx")).toMatch(/public-record comparable properties/i)
    expect(read("app/townships/page.tsx")).toMatch(/comparable Cook County properties from the public record/i)
    expect(read("app/hoa/hoa-client.tsx")).toMatch(/public-record comparable properties/i)
  })
})
