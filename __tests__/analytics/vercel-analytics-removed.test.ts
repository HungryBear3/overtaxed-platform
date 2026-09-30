/** @jest-environment node */

/**
 * Vercel Web Analytics is removed, not gated. Its production beacon sent the
 * full raw landing URL (query and hash) and any external referrer, which is a
 * privacy surface GA4's governed page context was built to avoid. GA4 and the
 * funnel contract stay; nothing may bring the Vercel client, its endpoint or
 * its queue back — in source or in package metadata. The production-build scan
 * is in ./vercel-analytics-bundle-scan.test.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(__dirname, "../..")
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry)) out.push(rel)
  }
  return out
}

describe("Vercel Web Analytics is gone from source", () => {
  const runtime = [
    ...["app", "components", "lib", "hooks"].flatMap(sourceFiles),
    "middleware.ts",
    "next.config.mjs",
  ]

  it.each(runtime)("%s does not import it", (file) => {
    expect(read(file)).not.toMatch(/@vercel\/analytics|@vercel\/speed-insights/)
  })

  it("the root layout mounts no <Analytics /> and keeps GA4 and the route tracker", () => {
    const layout = read("app/layout.tsx")
    expect(layout).not.toMatch(/<Analytics\b/)
    expect(layout).toContain("<GoogleAnalytics")
    expect(layout).toContain("<AnalyticsRouteTracker")
  })
})

describe("Vercel Web Analytics is gone from package metadata", () => {
  it("package.json declares no dependency on it", () => {
    const pkg = JSON.parse(read("package.json")) as Record<string, Record<string, string> | undefined>
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      expect(Object.keys(pkg[field] ?? {})).not.toContain("@vercel/analytics")
    }
  })

  it("package-lock.json resolves no copy of it", () => {
    const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { dependencies?: Record<string, string> }> }
    expect(Object.keys(lock.packages[""].dependencies ?? {})).not.toContain("@vercel/analytics")
    expect(Object.keys(lock.packages).filter((key) => key.endsWith("node_modules/@vercel/analytics"))).toEqual([])
  })

  it("pnpm-lock.yaml resolves no copy of it", () => {
    expect(read("pnpm-lock.yaml")).not.toContain("@vercel/analytics")
  })
})
