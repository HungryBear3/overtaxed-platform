import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(__dirname, "../..")

describe("billing webhook deployment safety", () => {
  it("keeps the Stripe webhook route in Vercel deployments", () => {
    const webhookRoute = join(repoRoot, "app/api/billing/webhook/route.ts")
    const ignoreLines = readFileSync(join(repoRoot, ".vercelignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))

    expect(existsSync(webhookRoute)).toBe(true)
    expect(ignoreLines).not.toContain("app/api/billing/webhook")
    expect(
      ignoreLines.filter((line) => /^(app|lib|components)\//.test(line)),
    ).toEqual([])
  })
})
