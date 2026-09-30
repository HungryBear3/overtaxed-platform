/**
 * Scan a production build for Vercel Web Analytics.
 *
 *   npx tsx scripts/vercel-analytics-bundle-scan.ts [.next]
 *
 * The markers are the package name, the beacon endpoint and CDN client the
 * package loads, and the global command queue it installs. The build cache is
 * skipped: it can hold stale chunks from an earlier build, and only what ships
 * is evidence. Symlinks (the build's externals links into node_modules) are not
 * followed; a link is a hit only when its own path names a marker. A directory
 * without BUILD_ID is not a completed build and is refused rather than reported
 * clean. Read-only; no network.
 *
 * Exit 0 CLEAN, 1 MARKERS_FOUND, 2 NOT_A_BUILD.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"

export const VERCEL_ANALYTICS_MARKERS = [
  "@vercel/analytics",
  "/_vercel/insights",
  "va.vercel-scripts.com",
  "window.vaq",
  "window.vam",
] as const

export type BundleScanHit = { file: string; marker: string }
export type BundleScanResult = {
  status: "CLEAN" | "MARKERS_FOUND" | "NOT_A_BUILD"
  hits: BundleScanHit[]
  filesScanned: number
}

type Entry = { path: string; link: boolean }

function entries(dir: string): Entry[] {
  const out: Entry[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) out.push({ path, link: true })
    else if (stat.isDirectory()) out.push(...entries(path))
    else out.push({ path, link: false })
  }
  return out
}

export function scanBuildForVercelAnalytics(buildDir: string): BundleScanResult {
  if (!existsSync(join(buildDir, "BUILD_ID"))) return { status: "NOT_A_BUILD", hits: [], filesScanned: 0 }
  const hits: BundleScanHit[] = []
  let filesScanned = 0
  for (const { path, link } of entries(buildDir)) {
    const file = relative(buildDir, path).split(sep).join("/")
    if (file === "BUILD_ID" || file.startsWith("cache/")) continue
    if (link) {
      for (const marker of VERCEL_ANALYTICS_MARKERS) {
        if (file.includes(marker)) hits.push({ file, marker })
      }
      continue
    }
    filesScanned += 1
    const body = readFileSync(path, "latin1")
    for (const marker of VERCEL_ANALYTICS_MARKERS) {
      if (body.includes(marker)) hits.push({ file, marker })
    }
  }
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.marker.localeCompare(b.marker))
  return { status: hits.length === 0 ? "CLEAN" : "MARKERS_FOUND", hits, filesScanned }
}

if (require.main === module) {
  const result = scanBuildForVercelAnalytics(resolve(process.argv[2] ?? ".next"))
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.status === "CLEAN" ? 0 : result.status === "MARKERS_FOUND" ? 1 : 2)
}
