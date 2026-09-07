import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Next resolves its config by taking the first of these names that exists
 * (`CONFIG_FILES` in next/dist/shared/lib/constants). Anything later in the
 * order is silently inert — it reads as live settings that never reach a build.
 * A second config file is not redundancy, it is a decoy, so this suite pins the
 * repo to one source rather than to a preferred one.
 */
const CONFIG_FILES = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.mts"]

/** The Sentry build plugin is deliberately unwired; these strings would wire it. */
const SENTRY_BUILD_PLUGIN_MARKERS = ["@sentry/nextjs", "withSentryConfig", "automaticVercelMonitors"]

const root = process.cwd()

function presentConfigs(): string[] {
  return CONFIG_FILES.filter((name) => existsSync(join(root, name)))
}

type ResolvedConfig = {
  images?: { unoptimized?: boolean }
  typescript?: { ignoreBuildErrors?: boolean }
}

/**
 * Evaluates the config Next would actually resolve, as a module in a clean Node
 * process, so the assertions below read real values instead of matching source
 * text that may or may not survive evaluation.
 */
function effectiveConfig(): ResolvedConfig {
  const href = pathToFileURL(join(root, presentConfigs()[0])).href
  const json = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `import c from ${JSON.stringify(href)};process.stdout.write(JSON.stringify(c))`],
    { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] }
  )
  return JSON.parse(json)
}

describe("next config", () => {
  it("exists exactly once across every filename Next would resolve", () => {
    expect(presentConfigs()).toHaveLength(1)
  })

  it("keeps image optimization disabled", () => {
    expect(effectiveConfig().images?.unoptimized).toBe(true)
  })

  it("does not let the build skip TypeScript errors", () => {
    expect(effectiveConfig().typescript?.ignoreBuildErrors).not.toBe(true)
  })

  it("leaves the Sentry build plugin and its automatic Vercel monitors unwired", () => {
    const wired = presentConfigs().flatMap((name) => {
      const source = readFileSync(join(root, name), "utf8")
      return SENTRY_BUILD_PLUGIN_MARKERS.filter((marker) => source.includes(marker)).map(
        (marker) => `${name}: ${marker}`
      )
    })
    expect(wired).toEqual([])
  })
})
