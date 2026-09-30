/** @jest-environment node */

/**
 * The production-build half of the Vercel Web Analytics removal: a scanner for
 * the client, endpoint and queue markers the package ships, and — when
 * OT_PRODUCTION_BUILD_DIR names a freshly built `.next` — a scan of that build.
 * `npx tsx scripts/vercel-analytics-bundle-scan.ts .next` runs the same scan
 * from the command line.
 */
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  VERCEL_ANALYTICS_MARKERS,
  scanBuildForVercelAnalytics,
} from "@/scripts/vercel-analytics-bundle-scan"

const ROOT = resolve(__dirname, "../..")

describe("the production-build marker scan", () => {
  function build(files: Record<string, string>, buildId = true): string {
    const dir = mkdtempSync(join(tmpdir(), "va-scan-"))
    if (buildId) writeFileSync(join(dir, "BUILD_ID"), "test-build")
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true })
      writeFileSync(join(dir, path), body)
    }
    return dir
  }

  it("names the client, endpoint and queue markers", () => {
    expect(VERCEL_ANALYTICS_MARKERS).toEqual(
      expect.arrayContaining(["/_vercel/insights", "va.vercel-scripts.com", "window.vaq", "@vercel/analytics"]),
    )
  })

  it.each([
    ["the endpoint", 'src:"/_vercel/insights/script.js"'],
    ["the CDN client", '"https://va.vercel-scripts.com/v1/script.debug.js"'],
    ["the queue", "window.vaq=window.vaq||[]"],
    ["the package", 'require("@vercel/analytics/next")'],
  ])("finds %s in a client chunk", (_label, snippet) => {
    const dir = build({ "static/chunks/a.js": `(()=>{${snippet}})()` })
    const result = scanBuildForVercelAnalytics(dir)
    expect(result.status).toBe("MARKERS_FOUND")
    expect(result.hits.map((hit) => hit.file)).toEqual(["static/chunks/a.js"])
  })

  it("passes a clean build and ignores the build cache", () => {
    const dir = build({
      "static/chunks/a.js": "gtag('config','G-XXXX',{send_page_view:false})",
      "server/app/page.js": "export default 1",
      "cache/webpack/stale.pack": "window.vaq=[]",
    })
    expect(scanBuildForVercelAnalytics(dir)).toEqual({ status: "CLEAN", hits: [], filesScanned: 2 })
  })

  it("does not follow externals symlinks, but flags one whose name is a marker", () => {
    const dir = build({ "static/chunks/a.js": "x" })
    mkdirSync(join(dir, "node_modules/@vercel"), { recursive: true })
    symlinkSync("../../../nowhere/analytics", join(dir, "node_modules/@vercel/analytics-0123abcd"))
    mkdirSync(join(dir, "node_modules/@prisma"), { recursive: true })
    symlinkSync("../../../nowhere/client", join(dir, "node_modules/@prisma/client-0123abcd"))

    const result = scanBuildForVercelAnalytics(dir)
    expect(result.status).toBe("MARKERS_FOUND")
    expect(result.hits).toEqual([{ file: "node_modules/@vercel/analytics-0123abcd", marker: "@vercel/analytics" }])
  })

  it("refuses a directory that is not a completed build", () => {
    const dir = build({ "static/chunks/a.js": "x" }, false)
    expect(scanBuildForVercelAnalytics(dir).status).toBe("NOT_A_BUILD")
  })

  const buildDir = process.env.OT_PRODUCTION_BUILD_DIR
  ;(buildDir ? it : it.skip)("a fresh production build (OT_PRODUCTION_BUILD_DIR) carries none of them", () => {
    const result = scanBuildForVercelAnalytics(resolve(ROOT, buildDir ?? ".next"))
    expect(result.hits).toEqual([])
    expect(result.status).toBe("CLEAN")
    expect(result.filesScanned).toBeGreaterThan(0)
  })
})
